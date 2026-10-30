import { ANDROID_DATABASE_PATH, open } from '@op-engineering/op-sqlite';
import { StorageError, toStorageError } from './errors';
import {
  getUserVersion,
  Migration,
  migrations,
  runMigrations,
} from './migrations';
import { adaptOpSqlite } from './opSqliteAdapter';
import { SqlDatabase } from './sql';
import { vault } from './vault';

export const DATABASE_NAME = 'trezor.db';
const DATABASE_KEY_ID = 'database';

export interface OpenedDatabase {
  db: SqlDatabase;
  /** True when this launch created the database (first launch). */
  created: boolean;
  migratedFrom: number;
  schemaVersion: number;
}

interface OpenOptions {
  name?: string;
  migrationList?: Migration[];
}

/** SQLCipher raw-key syntax: skips PBKDF2 because the key is already random. */
const rawKey = (hex: string) => `x'${hex}'`;

/** SQLite result code from an op-sqlite error message ("… (code 26, …)"). */
function sqliteCode(error: unknown): number | null {
  const match = /\(code (\d+)/.exec((error as Error)?.message ?? '');
  return match ? Number(match[1]) : null;
}

function fileExists(name: string): boolean {
  try {
    // Opening without a key and without running a query reads nothing.
    open({ name, failOnCreate: true }).close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the encrypted database, creating it only on a genuine first launch.
 *
 * | key envelope | database file | outcome                                   |
 * | ------------ | ------------- | ----------------------------------------- |
 * | missing      | missing       | first launch: create key, create database |
 * | missing      | present       | KEY_MISSING_FOR_DATABASE (never recreate) |
 * | present      | missing       | create database with the existing key     |
 * | present      | present       | open, verify, migrate                     |
 *
 * Never deletes or replaces an existing database or key.
 */
export async function openTrezorDatabase(
  options: OpenOptions = {},
): Promise<OpenedDatabase> {
  const name = options.name ?? DATABASE_NAME;
  const list = options.migrationList ?? migrations;

  const hasKey = await vault.hasKey(DATABASE_KEY_ID);
  const exists = fileExists(name);
  if (!hasKey && exists) {
    throw new StorageError(
      'KEY_MISSING_FOR_DATABASE',
      'A database exists but its key is missing',
    );
  }

  const keyHex = hasKey
    ? await vault.getKey(DATABASE_KEY_ID)
    : await vault.createKey(DATABASE_KEY_ID);

  let db: SqlDatabase;
  try {
    db = adaptOpSqlite(open({ name, encryptionKey: rawKey(keyHex) }));
  } catch (e) {
    throw new StorageError(
      'DATABASE_UNREADABLE',
      `Could not open database: ${(e as Error).message}`,
    );
  }

  try {
    await verify(db);
    await db.execute('PRAGMA foreign_keys = ON');

    const from = await getUserVersion(db);
    const latest = list[list.length - 1].version;
    if (from >= 1 && from < latest) {
      await snapshotBeforeMigration(db, name, from, keyHex);
    }
    const { to } = await runMigrations(db, list);
    return { db, created: !exists, migratedFrom: from, schemaVersion: to };
  } catch (e) {
    db.close();
    throw toStorageError(e);
  }
}

/**
 * Fails unless the key is right, the file is intact and SQLCipher is really
 * encrypting (a plain SQLite build would silently ignore the key).
 */
async function verify(db: SqlDatabase): Promise<void> {
  try {
    await db.execute('SELECT count(*) AS n FROM sqlite_master');
  } catch (e) {
    const code = sqliteCode(e);
    throw new StorageError(
      code === 11 ? 'DATABASE_CORRUPT' : 'DATABASE_UNREADABLE',
      code === 26
        ? 'Database key does not match or file is not a database'
        : `Database probe failed: ${(e as Error).message}`,
    );
  }

  const cipher = await db.execute('PRAGMA cipher_version');
  if (!cipher[0]?.cipher_version) {
    throw new StorageError(
      'DATABASE_UNREADABLE',
      'SQLCipher is not active; refusing to use an unencrypted database',
    );
  }

  const check = await db.execute('PRAGMA quick_check');
  if (check[0]?.quick_check !== 'ok') {
    throw new StorageError(
      'DATABASE_CORRUPT',
      'Database integrity check failed',
    );
  }
}

/**
 * Encrypted copy of the database (same key) before an upgrade, kept in the
 * app's private databases directory, which is excluded from backup.
 * An existing snapshot for the same version is kept, never overwritten.
 */
async function snapshotBeforeMigration(
  db: SqlDatabase,
  name: string,
  fromVersion: number,
  keyHex: string,
): Promise<void> {
  const snapshotName = `${name.replace(
    /\.db$/,
    '',
  )}.pre-migration-v${fromVersion}.db`;
  if (fileExists(snapshotName)) {
    return;
  }
  const integrity = await db.execute('PRAGMA cipher_integrity_check');
  if (integrity.length > 0) {
    throw new StorageError(
      'DATABASE_CORRUPT',
      `${integrity.length} page(s) failed SQLCipher integrity check`,
    );
  }
  await db.execute('ATTACH DATABASE ? AS snapshot KEY ?', [
    `${ANDROID_DATABASE_PATH}/${snapshotName}`,
    rawKey(keyHex),
  ]);
  try {
    await db.execute("SELECT sqlcipher_export('snapshot')");
    // sqlcipher_export copies schema and data but not user_version.
    await db.execute(
      `PRAGMA snapshot.user_version = ${Math.trunc(fromVersion)}`,
    );
  } finally {
    await db.execute('DETACH DATABASE snapshot');
  }
}
