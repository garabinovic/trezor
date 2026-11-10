import { restoreCleanupPending } from '../backup/restore';
import NativeTrezorRestore from '../native/NativeTrezorRestore';
import { holdReconcile } from '../reminders/reconcileGate';
import { nativeReminderPlatform } from '../reminders/platform';
import { StorageError } from './errors';
import type { SerialDatabase } from './serialDatabase';
import type { SqlExecutor } from './sql';

/**
 * Delete all data (Phase 7): the database is emptied in place (the keys and
 * the database file stay), every file that may hold user content is deleted,
 * and the app restarts empty. External backup files are never touched.
 *
 * The `wipe.pending` setting is the source of truth for an interrupted run:
 * it is written in the same transaction that deletes the content, and removed
 * only after every file is gone and `VACUUM` has run. Storage initialization
 * finishes a pending wipe before anything is shown or collected.
 */

export const WIPE_MARKER = 'wipe.pending';

/** Every table with user content, children first (foreign keys to `items`). */
export const CONTENT_TABLES = [
  'attachments',
  'notes',
  'reminders',
  'cards',
  'documents',
  'items',
] as const;

/** Device facts kept across a wipe; every other setting returns to its default. */
export const KEPT_SETTINGS = [
  'notifications.permissionRequested',
  'notifications.exactAlarmRequested',
] as const;

/** The native operations the wipe reuses (restore lock and gate, files, schedule, restart). */
export interface WipePlatform {
  /** The restore lock: refused while a restore or recovery runs (RESTORE_IN_PROGRESS). */
  lock(): Promise<string>;
  unlock(token: string): Promise<void>;
  /** The native attachment gate (drains work already accepted), and its release. */
  acquireGate(): Promise<void>;
  releaseGate(): Promise<void>;
  purgeCaches(): Promise<void>;
  /** Cancels every reminder alarm and shown notification (`sync(entries = [])`). */
  clearReminders(): Promise<void>;
  deleteFiles(token: string): Promise<void>;
  restartProcess(): Promise<void>;
}

export const nativeWipePlatform: WipePlatform = {
  lock: () => NativeTrezorRestore.recoveryBegin(),
  unlock: token => NativeTrezorRestore.recoveryEnd(token),
  acquireGate: () => NativeTrezorRestore.acquireGate(),
  releaseGate: () => NativeTrezorRestore.releaseGate(),
  purgeCaches: () => NativeTrezorRestore.purgeCaches(),
  clearReminders: () => nativeReminderPlatform.sync([], false),
  deleteFiles: token => NativeTrezorRestore.deleteAllFiles(token),
  restartProcess: () => NativeTrezorRestore.restartProcess(),
};

/** Why nothing was deleted: the data is as it was. */
export class DeleteAllError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DeleteAllError';
  }
}

/**
 * One transaction, with `secure_delete` so freed pages are overwritten: every
 * content table and every setting except [KEPT_SETTINGS] deleted, and the
 * marker set. Either all of it happens or none.
 */
export async function emptyDatabase(db: SqlExecutor): Promise<void> {
  await db.execute('PRAGMA secure_delete = ON');
  await db.execute('BEGIN IMMEDIATE');
  try {
    for (const table of CONTENT_TABLES) {
      await db.execute(`DELETE FROM ${table}`);
    }
    await db.execute(
      `DELETE FROM settings WHERE key NOT IN (${KEPT_SETTINGS.map(
        () => '?',
      ).join(', ')})`,
      [...KEPT_SETTINGS],
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, 'true')",
      [WIPE_MARKER],
    );
    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

export async function hasWipeMarker(db: SqlExecutor): Promise<boolean> {
  const rows = await db.execute('SELECT 1 AS one FROM settings WHERE key = ?', [
    WIPE_MARKER,
  ]);
  return rows.length > 0;
}

/**
 * The files (under the restore lock), `VACUUM`, a check that nothing is left,
 * then the marker. Any failure leaves the marker for the next attempt.
 */
async function finishWipe(db: SqlExecutor, platform: WipePlatform) {
  const token = await platform.lock();
  try {
    await platform.deleteFiles(token);
  } finally {
    await platform.unlock(token).catch(() => undefined);
  }
  await db.execute('VACUUM');
  for (const table of CONTENT_TABLES) {
    if (
      (await db.execute(`SELECT 1 AS one FROM ${table} LIMIT 1`)).length > 0
    ) {
      throw new Error('Content left after the wipe');
    }
  }
  await db.execute('DELETE FROM settings WHERE key = ?', [WIPE_MARKER]);
}

/**
 * Storage initialization, right after the database opened and before
 * anything is loaded or collected: finishes an interrupted wipe. The content
 * is deleted again (a no-op when the transaction had committed), the schedule
 * cleared, the files deleted. Rejects with WIPE_INCOMPLETE, keeping the marker,
 * if any step fails; Retry runs it again.
 */
export async function resumeWipe(
  db: SqlExecutor,
  platform: WipePlatform = nativeWipePlatform,
): Promise<void> {
  if (!(await hasWipeMarker(db))) {
    return;
  }
  try {
    await platform.clearReminders();
    await emptyDatabase(db);
    await finishWipe(db, platform);
  } catch {
    throw new StorageError(
      'WIPE_INCOMPLETE',
      'Deleting all data did not finish',
    );
  }
}

/**
 * Delete all data, from Settings. `confirmIdentity` is the system prompt when
 * App Lock is on; a cancel or failure there deletes nothing.
 *
 * Order: the restore lock (no restore or recovery meanwhile), the reconcile
 * gate, the database gate, the native attachment gate; then the schedule and
 * caches cleared, the content transaction, the files, `VACUUM`, the marker,
 * and the restart. Before the transaction commits, a failure releases
 * everything in reverse order and rejects with a DeleteAllError: nothing was
 * deleted (the next reconcile re-arms the reminders). Once it has committed,
 * nothing returns to the old UI: the process restarts and startup finishes
 * the wipe from the marker. Never settles on success.
 */
export async function deleteAllData(options: {
  database: SerialDatabase;
  confirmIdentity?: () => Promise<void>;
  platform?: WipePlatform;
}): Promise<never> {
  const platform = options.platform ?? nativeWipePlatform;
  if (restoreCleanupPending()) {
    throw new DeleteAllError('RESTORE_IN_PROGRESS');
  }
  if (options.confirmIdentity) {
    await options.confirmIdentity().catch(e => {
      throw new DeleteAllError(
        (e as { code?: string } | null)?.code ?? 'FAILED',
      );
    });
  }
  const token = await platform.lock().catch(e => {
    throw new DeleteAllError((e as { code?: string } | null)?.code ?? 'FAILED');
  });
  let releaseReconcile: (() => void) | undefined;
  try {
    releaseReconcile = await holdReconcile();
    await options.database.exclusive(async live => {
      await platform.acquireGate();
      let committed = false;
      try {
        await platform.clearReminders();
        await platform.purgeCaches();
        await emptyDatabase(live);
        committed = true;
      } catch (e) {
        await platform.releaseGate().catch(() => undefined);
        throw e;
      }
      if (committed) {
        // The files need the restore lock this run holds; hand it over.
        await platform.unlock(token);
        try {
          await finishWipe(live, platform);
        } catch {
          // Startup finishes it from the marker.
        }
        await platform.restartProcess().catch(() => undefined);
        await new Promise<never>(() => undefined);
      }
    });
  } catch (e) {
    releaseReconcile?.();
    throw e instanceof DeleteAllError
      ? e
      : new DeleteAllError(
          (e as { code?: string } | null)?.code === 'RESTORE_IN_PROGRESS'
            ? 'RESTORE_IN_PROGRESS'
            : 'FAILED',
        );
  } finally {
    await platform.unlock(token).catch(() => undefined);
  }
  // Not reached: the restart never returns.
  return new Promise<never>(() => undefined);
}
