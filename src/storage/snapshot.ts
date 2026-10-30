import { databaseFiles } from './databaseFiles';
import { StorageError } from './errors';
import { getUserVersion } from './migrations';
import { SqlDatabase, SqlExecutor, SqlRow } from './sql';
import {
  databasePath,
  openEncrypted,
  rawKey,
  verifyEncryptedDatabase,
} from './sqlcipher';
import { vault } from './vault';

/** How many snapshot names to try per schema version before giving up. */
const MAX_SNAPSHOTS_PER_VERSION = 9;
const PAGE_SIZE = 500;

/**
 * `trezor.pre-migration-v1.db`, then `trezor.pre-migration-v1.2.db` … `.9.db`.
 * A later name is used only when every earlier one exists but is invalid or
 * stale; existing files are never overwritten or deleted.
 */
export function snapshotNames(dbName: string, fromVersion: number): string[] {
  const stem = `${dbName.replace(/\.db$/, '')}.pre-migration-v${fromVersion}`;
  return Array.from({ length: MAX_SNAPSHOTS_PER_VERSION }, (_, i) =>
    i === 0 ? `${stem}.db` : `${stem}.${i + 1}.db`,
  );
}

/**
 * Makes sure an encrypted, verified copy of the database exists before a
 * migration from `fromVersion`. Returns the snapshot's file name.
 * Throws SNAPSHOT_FAILED (and the migration must not start) if it cannot.
 */
export async function ensureVerifiedSnapshot(
  main: SqlDatabase,
  dbName: string,
  fromVersion: number,
  keyHex: string,
): Promise<string> {
  let freeName: string | null = null;
  for (const name of snapshotNames(dbName, fromVersion)) {
    if ((await databaseFiles.state(name)) === 'absent') {
      freeName = freeName ?? name;
      continue;
    }
    // An existing file is reused only if it verifies and still matches the
    // current database exactly (e.g. a retry after a failed migration).
    // Otherwise it is left untouched and another name is used.
    if ((await snapshotProblem(main, name, fromVersion, keyHex)) === null) {
      return name;
    }
  }
  if (!freeName) {
    throw new StorageError(
      'SNAPSHOT_FAILED',
      `No free snapshot name for v${fromVersion}`,
    );
  }

  const integrity = await main.execute('PRAGMA cipher_integrity_check');
  if (integrity.length > 0) {
    throw new StorageError(
      'DATABASE_CORRUPT',
      `${integrity.length} page(s) failed SQLCipher integrity check`,
    );
  }

  const suffix = Array.from(vault.randomBytes(6), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const temporary = freeName.replace(/\.db$/, `.${suffix}.partial.db`);
  if ((await databaseFiles.state(temporary)) !== 'absent') {
    throw new StorageError('SNAPSHOT_FAILED', 'Temporary name collision');
  }

  try {
    await exportTo(main, temporary, fromVersion, keyHex);
    const problem = await snapshotProblem(main, temporary, fromVersion, keyHex);
    if (problem) {
      throw new Error(`verification failed: ${problem}`);
    }
    await databaseFiles.renameNoReplace(temporary, freeName);
    return freeName;
  } catch (e) {
    // Remove only this attempt's temporary file; it was never trusted.
    await databaseFiles.deleteTemporary(temporary).catch(() => undefined);
    throw new StorageError(
      'SNAPSHOT_FAILED',
      `Snapshot before v${fromVersion} migration failed: ${
        (e as Error).message
      }`,
    );
  }
}

/** sqlcipher_export into a new attached file; DETACH closes it again. */
async function exportTo(
  main: SqlDatabase,
  name: string,
  version: number,
  keyHex: string,
): Promise<void> {
  await main.execute('ATTACH DATABASE ? AS snapshot KEY ?', [
    databasePath(name),
    rawKey(keyHex),
  ]);
  let failed = false;
  try {
    await main.execute("SELECT sqlcipher_export('snapshot')");
    // sqlcipher_export copies schema and data but not user_version.
    await main.execute(`PRAGMA snapshot.user_version = ${Math.trunc(version)}`);
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    try {
      await main.execute('DETACH DATABASE snapshot');
    } catch (e) {
      if (!failed) {
        throw e;
      }
    }
  }
}

/**
 * null if `name` opens with the key, is encrypted and intact, has the expected
 * schema version, and holds exactly the same schema and rows as `main`.
 * Otherwise a short reason.
 */
export async function snapshotProblem(
  main: SqlExecutor,
  name: string,
  expectedVersion: number,
  keyHex: string,
): Promise<string | null> {
  let snap: SqlDatabase;
  try {
    snap = openEncrypted(name, keyHex, { failOnCreate: true });
  } catch (e) {
    return `cannot open (${(e as Error).message})`;
  }
  try {
    await verifyEncryptedDatabase(snap);
    const version = await getUserVersion(snap);
    if (version !== expectedVersion) {
      return `schema v${version}, expected v${expectedVersion}`;
    }
    return await contentDifference(main, snap);
  } catch (e) {
    return (e as Error).message;
  } finally {
    snap.close();
  }
}

const SCHEMA_SQL =
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name";

/** Compares schema and every row (in rowid order, paged). */
async function contentDifference(
  a: SqlExecutor,
  b: SqlExecutor,
): Promise<string | null> {
  const schemaA = await a.execute(SCHEMA_SQL);
  const schemaB = await b.execute(SCHEMA_SQL);
  if (JSON.stringify(schemaA) !== JSON.stringify(schemaB)) {
    return 'schema differs';
  }
  const tables = schemaA
    .filter(r => r.type === 'table')
    .map(r => String(r.name));
  for (const table of tables) {
    // Table names come from sqlite_master; quote them for safety.
    const quoted = `"${table.replace(/"/g, '""')}"`;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const sql = `SELECT * FROM ${quoted} ORDER BY rowid LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
      const rowsA: SqlRow[] = await a.execute(sql);
      const rowsB: SqlRow[] = await b.execute(sql);
      if (JSON.stringify(rowsA) !== JSON.stringify(rowsB)) {
        return `rows differ in ${table}`;
      }
      if (rowsA.length < PAGE_SIZE) {
        break;
      }
    }
  }
  return null;
}
