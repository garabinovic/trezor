import {
  announceCompleted,
  holdReconcile,
  ReconcileRelease,
} from '../reminders/reconcileGate';
import type { StorageErrorCode } from '../storage/errors';
import type { SerialDatabase } from '../storage/serialDatabase';
import type { SqlExecutor } from '../storage/sql';
import { assertDatabaseKey } from '../storage/sqlcipher';
import { vault } from '../storage/vault';
import {
  BACKUP_SCHEMA_VERSION,
  exportToDevice,
  readDeviceSettings,
  requireSameAttachments,
  rewriteSettings,
  verifyArtifact,
} from './artifact';
import { BackupError } from './platform';
import {
  nativeRestorePlatform,
  RestoreError,
  RestorePlatform,
  RestoreStaged,
  RetainedOutcome,
} from './restorePlatform';

/**
 * What the storage-error screen offers for its code (spec v2.4 §8.1). The
 * screen itself is Step 5.
 */
export type RestoreEntry = 'restore' | 'unavailable' | 'update' | 'retry';

export function restoreEntryFor(code: StorageErrorCode): RestoreEntry {
  switch (code) {
    case 'DATABASE_UNREADABLE':
    case 'DATABASE_CORRUPT':
    case 'MIGRATION_FAILED':
    case 'SNAPSHOT_FAILED':
      return 'restore';
    case 'KEY_MISSING_FOR_DATABASE':
    case 'MASTER_KEY_MISSING':
    case 'UNWRAP_FAILED':
    case 'KEY_INVALIDATED':
    case 'KEY_NOT_FOUND':
    case 'INVALID_KEY_FORMAT':
      return 'unavailable';
    case 'NEWER_SCHEMA':
    case 'ENVELOPE_UNSUPPORTED':
      return 'update';
    default:
      return 'retry';
  }
}

/** What a preparation reached (§8.2 steps 1–12). */
export interface PreparedRestore {
  restoreId: string;
  backupId: string;
  trailer: string;
  attachments: number;
  retained: RetainedOutcome;
  schedule: 'saved' | 'absent';
  /** ONCE reminders completed on the live database in step 9. */
  completedFired: string[];
}

/**
 * §8.2 step 9 on the live connection (through the gate's callback, §5): the
 * fired ONCE reminders that still exist and aren't completed are marked
 * completed, as `reconcile` does (`src/reminders/scheduler.ts`).
 */
async function completeFired(
  live: SqlExecutor,
  ids: string[],
): Promise<string[]> {
  const done: string[] = [];
  if (ids.length === 0) {
    return done;
  }
  const updatedAt = Date.now();
  await live.execute('BEGIN IMMEDIATE');
  try {
    for (const id of ids) {
      const rows = await live.execute(
        "SELECT 1 AS one FROM reminders WHERE item_id = ? AND repeat = 'once' AND completed = 0",
        [id],
      );
      if (rows.length === 0) {
        continue;
      }
      await live.execute(
        'UPDATE reminders SET completed = 1 WHERE item_id = ?',
        [id],
      );
      await live.execute('UPDATE items SET updated_at = ? WHERE id = ?', [
        updatedAt,
        id,
      ]);
      done.push(id);
    }
    await live.execute('COMMIT');
  } catch (e) {
    await live.execute('ROLLBACK').catch(() => undefined);
    throw e;
  }
  return done;
}

/** §8.2 step 6: the staged artifact checked, exported to `S_db`, rewritten, checked again. */
async function stageDatabase(
  staged: RestoreStaged,
  deviceKey: string,
  live: SqlExecutor | undefined,
): Promise<void> {
  if (staged.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupError('BACKUP_UNSUPPORTED');
  }
  const rows = await verifyArtifact(
    staged.location,
    staged.incoming,
    staged.key,
  );
  requireSameAttachments(rows, staged.attachments);
  await exportToDevice(
    staged.location,
    staged.incoming,
    staged.key,
    staged.staged,
    deviceKey,
  );
  const device = live ? await readDeviceSettings(live) : {};
  await rewriteSettings(staged.location, staged.staged, deviceKey, device);
  const stagedRows = await verifyArtifact(
    staged.location,
    staged.staged,
    deviceKey,
  );
  requireSameAttachments(stagedRows, staged.attachments);
}

export interface RestoreOptions {
  /** The backup document (from the Check/backup file picker). */
  uri: string;
  password: string;
  /**
   * The live database when the app is open normally; absent for the
   * storage-error entry (§8.1), where steps 6 and 9 use no live connection.
   */
  database?: SerialDatabase;
  /** Backup ID and trailer of a Check run on the same file in this flow (§8.3). */
  expected?: { backupId: string; trailer: string };
  /** The native scheduler's fired ONCE ids, for step 9. */
  firedOnceIds?: () => Promise<string[]>;
  /**
   * While a share is active, restore waits (§8.7): asked with the active
   * count, 'wait' polls again, 'cancel' ends the restore before step 3.
   * Default: cancel.
   */
  whileSharesActive?: (active: number) => Promise<'wait' | 'cancel'>;
  /** Called once steps 1–12 have passed, before step 13 (a failure here is pre-swap). */
  onPrepared?: (
    prepared: PreparedRestore,
    live: SqlExecutor | undefined,
  ) => Promise<void>;
  platform?: RestorePlatform;
  /** The device database key (hex); default `vault.getKey('database')`. */
  deviceKey?: () => Promise<string>;
}

/**
 * Restore (spec v2.4 §8.2, v2.5 §6):
 *
 * 1. password, memory, manifest, free space (native, before the gate);
 * 2. the restore gate: the reconcile gate, then one exclusive operation on the
 *    live database queue (queued work waits), then the native gate (attachment
 *    work refused; wait for active shares);
 * 3–5. journal, staging, Check consistency (native);
 * 6. `S_db` from the artifact under the device key, settings rewrite, checks;
 * 7–8. retained files to quarantine, `fsync` (native);
 * 9. fired ONCE reminders completed on the live connection;
 * 10–11. schedule saved and cleared (native, one call under its lock);
 * 12. decrypted caches purged (native);
 * 13. the live connection closed inside the gate's callback;
 * 13a–15. the pre-swap state check, the swap renames, `verifying` (native);
 * 16. the process restarted; the next start verifies and finishes (recovery).
 *
 * From step 13 on, this never settles: every exit, a failure included, ends
 * in the restart, and nothing else runs in this JS runtime (no gate is
 * released, work queued behind the gate never runs, L1).
 *
 * A failure in steps 1–12 takes the pre-swap failure path (schedule restored
 * and re-armed, staging and this restore's quarantine deleted, journal
 * deleted, gates released, which requests a normal reconcile) and rejects
 * with a RestoreError. Its `cleanedUp` is false only if that path itself
 * failed: then the journal and files stay, the native and reconcile gates
 * stay held (no reconcile runs), and `retryRestoreCleanup()` resumes the
 * cleanup and releases them once it succeeds. A new restore is refused
 * meanwhile.
 */
export async function restoreBackup(options: RestoreOptions): Promise<never> {
  const run = runRestore(options);
  running = run;
  try {
    return await run;
  } finally {
    if (running === run) {
      running = null;
    }
  }
}

/** The restore running in this JS runtime, if any (v2.5 §5.2). */
let running: Promise<never> | null = null;

/**
 * Storage initialization calls this before recovery (v2.5 §5.2): a restore of
 * this runtime settles first (after a swap it never does: the process ends),
 * and a failed pre-swap cleanup is resumed, so recovery never runs on files a
 * restore here still owns. Rejects if the resumed cleanup fails again.
 */
export async function settleRestore(): Promise<void> {
  if (running) {
    await running.catch(() => undefined);
  }
  if (pendingCleanup) {
    await retryRestoreCleanup();
  }
}

async function runRestore(options: RestoreOptions): Promise<never> {
  if (pendingCleanup) {
    // A failed pre-swap cleanup still holds the gates: finish it first.
    throw new RestoreError('RESTORE_RECOVERY_RETRY', false);
  }
  const platform = options.platform ?? nativeRestorePlatform;
  const deviceKey =
    options.deviceKey ??
    (async () => {
      const key = await vault.getKey('database');
      assertDatabaseKey(key);
      return key;
    });

  const begun = await platform
    .beginRestore(options.uri, options.password)
    .catch(e => {
      throw RestoreError.from(e);
    });

  const cleanup: Cleanup = {
    platform,
    sessionId: begun.sessionId,
    gate: false,
    cleaned: false,
    completed: [],
    releaseReconcile: await holdReconcile(),
  };
  let prepared: PreparedRestore | undefined;
  let failure: unknown;
  let cleanupFailure: RestoreError | undefined;
  const run = async (live: SqlExecutor | undefined) => {
    try {
      await platform.acquireGate();
      cleanup.gate = true;
      for (;;) {
        const active = await platform.activeShareCount();
        if (active === 0) {
          break;
        }
        const decision = options.whileSharesActive
          ? await options.whileSharesActive(active)
          : 'cancel';
        if (decision === 'cancel') {
          throw new RestoreError('RESTORE_CANCELLED');
        }
      }
      const staged = await platform.stageRestore(
        begun.sessionId,
        options.expected,
      );
      await stageDatabase(staged, await deviceKey(), live);
      await platform.deleteIncoming(begun.sessionId);
      const retained = await platform.preserveRetained(begun.sessionId);
      if (live && options.firedOnceIds) {
        cleanup.completed = await completeFired(
          live,
          await options.firedOnceIds(),
        );
      }
      const schedule = await platform.saveAndClearSchedule(begun.sessionId);
      await platform.purgeCaches();
      prepared = {
        restoreId: staged.restoreId,
        backupId: staged.backupId,
        trailer: staged.trailer,
        attachments: staged.attachments.length,
        retained,
        schedule,
        completedFired: cleanup.completed,
      };
      await options.onPrepared?.(prepared, live);
    } catch (e) {
      failure = e;
    }
    if (failure === undefined) {
      await replaceAndRestart(platform, begun.sessionId, options.database);
    }
    // The pre-swap failure path, still inside the database gate.
    try {
      await cleanUp(cleanup);
    } catch (e) {
      cleanupFailure = RestoreError.from(e, false);
    }
  };
  if (options.database) {
    await options.database.exclusive(live => run(live));
  } else {
    await run(undefined);
  }
  if (cleanupFailure) {
    // The journal and files stay; the native gate and the reconcile gate stay
    // held, so no reconcile runs on a schedule that wasn't restored. Only the
    // database queue is released (the live database is untouched).
    // retryRestoreCleanup() resumes from the files.
    pendingCleanup = cleanup;
    // Step 9's completions are in the live database; the item state reloads
    // them now (the queue is free), while the reconcile gate stays held.
    announceCompleted(cleanup.completed);
    throw cleanupFailure;
  }
  releaseAfterCleanup(cleanup);
  throw RestoreError.from(failure);
}

/**
 * Steps 13–16 (v2.5 §6), inside the gate's callback, which never returns: the
 * live connection closes after the coordinator's last statement (step 13),
 * native checks the files and swaps (13a–15), and the process restarts (16).
 * A failure anywhere still restarts; the durable journal phase decides at the
 * next start.
 */
async function replaceAndRestart(
  platform: RestorePlatform,
  sessionId: string,
  database: SerialDatabase | undefined,
): Promise<never> {
  try {
    database?.close();
    await platform.swapRestore(sessionId);
  } catch {
    // Recovery decides from the journal and the files.
  }
  try {
    await platform.restartProcess();
  } catch {
    // Nothing else may run here either (L1).
  }
  return new Promise<never>(() => undefined);
}

/** One preparation's pre-swap failure path, resumable after a failure. */
interface Cleanup {
  platform: RestorePlatform;
  sessionId: string;
  /** The native gate is held. */
  gate: boolean;
  /** The native cleanup (schedule, files, journal) has succeeded. */
  cleaned: boolean;
  /** Step 9's completions, reloaded by the reminders provider on release. */
  completed: string[];
  releaseReconcile: (release?: ReconcileRelease) => void;
}

/** A cleanup that failed and still holds the native and reconcile gates. */
let pendingCleanup: Cleanup | null = null;

/** §8.2 pre-swap failure steps 1–3 (native), then the native gate. */
async function cleanUp(c: Cleanup): Promise<void> {
  if (!c.cleaned) {
    await c.platform.abortRestore(c.sessionId);
    c.cleaned = true;
  }
  if (c.gate) {
    await c.platform.releaseGate();
    c.gate = false;
  }
}

/** Pre-swap failure step 4: the reconcile gate last; its listeners reload and reconcile. */
function releaseAfterCleanup(c: Cleanup) {
  c.releaseReconcile({ completed: c.completed });
}

/** Whether a failed pre-swap cleanup is waiting for retryRestoreCleanup(). */
export function restoreCleanupPending(): boolean {
  return pendingCleanup !== null;
}

/**
 * Retries a failed pre-swap cleanup from the journal and files (every native
 * action is idempotent). The gates are released only once it has succeeded;
 * on another failure everything stays held and this can be called again.
 */
export async function retryRestoreCleanup(): Promise<void> {
  const c = pendingCleanup;
  if (!c) {
    throw new RestoreError('INVALID_STATE');
  }
  try {
    await cleanUp(c);
  } catch (e) {
    throw RestoreError.from(e, false);
  }
  pendingCleanup = null;
  releaseAfterCleanup(c);
}

/** Tests only. */
export function resetRestoreForTests() {
  pendingCleanup = null;
}
