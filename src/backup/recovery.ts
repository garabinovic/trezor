import NativeTrezorRestore from '../native/NativeTrezorRestore';
import { StorageError } from '../storage/errors';
import { migrations } from '../storage/migrations';
import type { SqlDatabase, SqlRow } from '../storage/sql';
import {
  assertDatabaseKey,
  openEncrypted,
  sqliteCode,
} from '../storage/sqlcipher';
import { vault } from '../storage/vault';
import { checkArtifactContent, referenceSchema, schemaOf } from './artifact';
import { BackupError } from './platform';

/**
 * Restore recovery at startup and Cancel restore (Phase 6 spec v2.4 §8.5,
 * v2.5 §1, §2, §7). File actions are native (RestoreRecovery.kt); the
 * database checks are here. Recovery never creates a key and never calls
 * openTrezorDatabase, which may migrate, snapshot or create (v2.5 §1.1).
 */

/** The outcome of verifying the restored database (v2.5 §1.3). */
export type Verification = 'pass' | 'fail' | 'retry' | 'unavailable';

/** A database to check: `location/name`, with the attachment ids beside it. */
export interface DatabaseTarget {
  location: string;
  name: string;
  attachmentIds: string[];
}

export type RecoveryRun =
  | { status: 'done' }
  | ({ status: 'verify' } & DatabaseTarget);

/**
 * The native half (TrezorRestoreModule). Replaceable in tests. A run holds
 * the restore lock from `recoveryBegin` (its token, or RESTORE_IN_PROGRESS)
 * to `recoveryEnd` with that token; only its holder can use or end it.
 */
export interface RecoveryPlatform {
  recoveryBegin(): Promise<string>;
  recoveryRun(token: string): Promise<RecoveryRun>;
  finishVerification(token: string, outcome: Verification): Promise<void>;
  previousData(token: string): Promise<DatabaseTarget>;
  cancelRestore(token: string): Promise<void>;
  recoveryEnd(token: string): Promise<void>;
}

const json = async <T>(text: Promise<string>): Promise<T> =>
  JSON.parse(await text) as T;

export const nativeRecoveryPlatform: RecoveryPlatform = {
  recoveryBegin: () => NativeTrezorRestore.recoveryBegin(),
  recoveryRun: token => json(NativeTrezorRestore.recoveryRun(token)),
  finishVerification: (token, outcome) =>
    NativeTrezorRestore.finishVerification(token, outcome),
  previousData: token => json(NativeTrezorRestore.previousData(token)),
  cancelRestore: token => NativeTrezorRestore.cancelRestore(token),
  recoveryEnd: token => NativeTrezorRestore.recoveryEnd(token),
};

/** The device database key; rejects (a StorageError) if it can't be had. Never creates one. */
export type DeviceKey = () => Promise<string>;

const deviceDatabaseKey: DeviceKey = async () => {
  if (!(await vault.hasKey('database'))) {
    throw new StorageError('KEY_NOT_FOUND', 'Database key missing');
  }
  const key = await vault.getKey('database');
  assertDatabaseKey(key);
  return key;
};

/** Key errors that mean the key is gone, not temporarily unavailable. */
const KEY_GONE = new Set<string>([
  'KEY_NOT_FOUND',
  'MASTER_KEY_MISSING',
  'KEY_INVALIDATED',
  'UNWRAP_FAILED',
  'INVALID_KEY_FORMAT',
]);

function keyOutcome(e: unknown): Verification {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && KEY_GONE.has(code)
    ? 'unavailable'
    : 'retry';
}

/**
 * v2.5 §1.2–1.3: a failed check result is deterministic; so are SQLite
 * NOTADB (26) and CORRUPT (11). Every other code, an error without one, and
 * unknown codes are transient: a wrong "transient" costs a Retry, a wrong
 * "deterministic" discards a valid restore. Code 26 can also mean a wrong
 * key; it is deterministic here because the key is the one step 6 used.
 */
export function classifyFailure(e: unknown): Verification {
  if (e instanceof BackupError) {
    return 'fail';
  }
  const raw = (e as { code?: unknown } | null)?.code;
  const code = typeof raw === 'number' ? raw : sqliteCode(e);
  if (code === null || !Number.isInteger(code)) {
    return 'retry';
  }
  // The primary result code is the low byte of an extended one.
  const primary = code % 256;
  return primary === 26 || primary === 11 ? 'fail' : 'retry';
}

function closeQuietly(db: SqlDatabase) {
  try {
    db.close();
  } catch {
    // Nothing was written; the outcome stands.
  }
}

const sameSet = (a: string[], b: string[]) => {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((x, i) => x === right[i]);
};

/**
 * Verifies the restored live database (v2.5 §1): Annex B §B.4 against the
 * schema-3 reference, and its `attachments.id` set equal to the restored
 * `.tza` files. Opened `failOnCreate` on its own connection, never migrated.
 */
export async function verifyRestoredDatabase(
  target: DatabaseTarget,
  deviceKey: DeviceKey = deviceDatabaseKey,
): Promise<Verification> {
  let key: string;
  try {
    key = await deviceKey();
  } catch (e) {
    return keyOutcome(e);
  }
  let db: SqlDatabase;
  try {
    db = openEncrypted(target.name, key, {
      failOnCreate: true,
      location: target.location,
    });
  } catch (e) {
    return classifyFailure(e);
  }
  try {
    await db.execute('SELECT count(*) AS n FROM sqlite_master');
    await checkArtifactContent(db);
    const ids = (await db.execute('SELECT id FROM attachments')).map(r =>
      String(r.id),
    );
    return sameSet(ids, target.attachmentIds) ? 'pass' : 'fail';
  } catch (e) {
    return classifyFailure(e);
  } finally {
    closeQuietly(db);
  }
}

const RECOVERY_CODES = new Set<string>([
  'RESTORE_STATE_UNKNOWN',
  'RESTORE_RECOVERY_RETRY',
  'RESTORE_VERIFY_RETRY',
  'RESTORE_UNAVAILABLE',
  'RESTORE_IN_PROGRESS',
]);

function recoveryError(e: unknown): StorageError {
  if (e instanceof StorageError && RECOVERY_CODES.has(e.code)) {
    return e;
  }
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RECOVERY_CODES.has(code)
    ? new StorageError(code as StorageError['code'], 'Restore not finished')
    : // Anything else failed part-way: the journal decides on Retry.
      new StorageError('RESTORE_RECOVERY_RETRY', 'Restore not finished');
}

/** Verify → pass → cleanup is the longest JS round trip; more means a bug. */
const MAX_VERIFICATIONS = 4;

/**
 * Startup recovery (v2.5 §7.2), the first action of storage initialization.
 * Resolves once startup may continue; otherwise rejects with a StorageError
 * whose code the error screen shows (Retry runs it again from the start).
 */
export async function recoverRestore(
  platform: RecoveryPlatform = nativeRecoveryPlatform,
  deviceKey: DeviceKey = deviceDatabaseKey,
): Promise<void> {
  let token: string;
  try {
    token = await platform.recoveryBegin();
  } catch (e) {
    throw recoveryError(e);
  }
  try {
    for (let i = 0; i < MAX_VERIFICATIONS; i++) {
      const run = await platform.recoveryRun(token);
      if (run.status === 'done') {
        return;
      }
      const outcome = await verifyRestoredDatabase(run, deviceKey);
      await platform.finishVerification(token, outcome);
      if (outcome === 'retry') {
        throw new StorageError('RESTORE_VERIFY_RETRY', 'Restore not verified');
      }
      if (outcome === 'unavailable') {
        throw new StorageError('RESTORE_UNAVAILABLE', 'Restore not verified');
      }
    }
    throw new StorageError('RESTORE_RECOVERY_RETRY', 'Restore not finished');
  } catch (e) {
    throw recoveryError(e);
  } finally {
    await platform.recoveryEnd(token).catch(() => undefined);
  }
}

const firstValue = (rows: SqlRow[]) =>
  rows.length > 0 ? String(Object.values(rows[0])[0]) : null;

/**
 * Decision D4: the previous data is offered back only if `P_db` opens
 * read-only with the device key, passes `cipher_integrity_check` and
 * `integrity_check`, has the schema of its own `user_version` (1 … this
 * build's latest; nothing is migrated), and every attachment row has its file
 * in `P_att`.
 */
export async function checkPreviousData(
  previous: DatabaseTarget,
  deviceKey: DeviceKey = deviceDatabaseKey,
): Promise<boolean> {
  let db: SqlDatabase;
  try {
    db = openEncrypted(previous.name, await deviceKey(), {
      readOnly: true,
      location: previous.location,
    });
  } catch {
    return false;
  }
  try {
    await db.execute('SELECT count(*) AS n FROM sqlite_master');
    if ((await db.execute('PRAGMA cipher_integrity_check')).length > 0) {
      return false;
    }
    const integrity = await db.execute('PRAGMA integrity_check');
    if (integrity.length !== 1 || firstValue(integrity) !== 'ok') {
      return false;
    }
    const version = Number(firstValue(await db.execute('PRAGMA user_version')));
    const latest = migrations[migrations.length - 1].version;
    if (!Number.isInteger(version) || version < 1 || version > latest) {
      return false;
    }
    const schema = await schemaOf(db);
    if (
      JSON.stringify(schema) !== JSON.stringify(await referenceSchema(version))
    ) {
      return false;
    }
    if (schema.some(r => r.type === 'table' && r.name === 'attachments')) {
      const files = new Set(previous.attachmentIds);
      const rows = await db.execute('SELECT id FROM attachments');
      if (!rows.every(r => files.has(String(r.id)))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    closeQuietly(db);
  }
}

/**
 * Whether the error screen may offer "Cancel restore and return to previous
 * data" (v2.5 §2.1): native checks the journal and files, then D4 the
 * previous database. Never changes anything.
 */
export async function canCancelRestore(
  platform: RecoveryPlatform = nativeRecoveryPlatform,
  deviceKey: DeviceKey = deviceDatabaseKey,
): Promise<boolean> {
  let token: string;
  try {
    token = await platform.recoveryBegin();
  } catch {
    return false;
  }
  try {
    return await checkPreviousData(
      await platform.previousData(token),
      deviceKey,
    );
  } catch {
    return false;
  } finally {
    await platform.recoveryEnd(token).catch(() => undefined);
  }
}

/**
 * Cancel restore, after the user confirmed (v2.5 §2.2): every condition is
 * checked again, then native writes `rollingback` and nothing else. The next
 * recovery run (Retry) rolls back with the existing rows; previous data is
 * never deleted on this path.
 */
export async function cancelRestore(
  platform: RecoveryPlatform = nativeRecoveryPlatform,
  deviceKey: DeviceKey = deviceDatabaseKey,
): Promise<void> {
  let token: string;
  try {
    token = await platform.recoveryBegin();
  } catch (e) {
    throw recoveryError(e);
  }
  try {
    if (
      !(await checkPreviousData(await platform.previousData(token), deviceKey))
    ) {
      throw new StorageError(
        'RESTORE_VERIFY_RETRY',
        'Previous data not usable',
      );
    }
    await platform.cancelRestore(token);
  } catch (e) {
    throw recoveryError(e);
  } finally {
    await platform.recoveryEnd(token).catch(() => undefined);
  }
}
