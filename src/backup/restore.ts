import { holdReconcile } from '../reminders/reconcileGate';
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

export interface PrepareOptions {
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
  /** Called once steps 1–12 have passed, before the preparation is undone. */
  onPrepared?: (
    prepared: PreparedRestore,
    live: SqlExecutor | undefined,
  ) => Promise<void>;
  platform?: RestorePlatform;
  /** The device database key (hex); default `vault.getKey('database')`. */
  deviceKey?: () => Promise<string>;
}

/**
 * Restore preparation (spec v2.4 §8.2 steps 1–12), as Step 3 of the plan
 * builds it: **exercised without the swap**. Every run ends in the pre-swap
 * failure path, so the live database and attachments are never replaced, and
 * the previous state (schedule, `fired`, alarms) is restored:
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
 *
 * then the pre-swap failure path: schedule restored and re-armed, staging and
 * this restore's quarantine deleted, journal deleted, gates released (which
 * requests a normal reconcile). Step 4 replaces "then" with the swap.
 *
 * Resolves with what was prepared, or rejects with a RestoreError whose
 * `cleanedUp` is false only if the pre-swap failure path itself failed.
 */
export async function prepareRestore(
  options: PrepareOptions,
): Promise<PreparedRestore> {
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

  const releaseReconcile = await holdReconcile();
  try {
    const run = async (live: SqlExecutor | undefined) => {
      let prepared: PreparedRestore | undefined;
      let failure: unknown;
      let gate = false;
      try {
        await platform.acquireGate();
        gate = true;
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
        const completed =
          live && options.firedOnceIds
            ? await completeFired(live, await options.firedOnceIds())
            : [];
        const schedule = await platform.saveAndClearSchedule(begun.sessionId);
        await platform.purgeCaches();
        prepared = {
          restoreId: staged.restoreId,
          backupId: staged.backupId,
          trailer: staged.trailer,
          attachments: staged.attachments.length,
          retained,
          schedule,
          completedFired: completed,
        };
        await options.onPrepared?.(prepared, live);
      } catch (e) {
        failure = e;
      }
      // Step 3 has no swap: the pre-swap failure path always follows.
      try {
        await platform.abortRestore(begun.sessionId);
      } catch (e) {
        if (gate) {
          await platform.releaseGate().catch(() => undefined);
        }
        throw RestoreError.from(e, false);
      }
      if (gate) {
        await platform.releaseGate().catch(e => {
          throw RestoreError.from(e);
        });
      }
      if (failure !== undefined || !prepared) {
        throw RestoreError.from(failure);
      }
      return prepared;
    };
    return options.database
      ? await options.database.exclusive(live => run(live))
      : await run(undefined);
  } finally {
    releaseReconcile();
  }
}
