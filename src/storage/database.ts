import { databaseFiles } from './databaseFiles';
import { StorageError, toStorageError } from './errors';
import {
  getUserVersion,
  Migration,
  migrations,
  runMigrations,
} from './migrations';
import { ensureVerifiedSnapshot } from './snapshot';
import { SqlDatabase } from './sql';
import {
  assertDatabaseKey,
  openEncrypted,
  verifyEncryptedDatabase,
} from './sqlcipher';
import { vault } from './vault';

export const DATABASE_NAME = 'trezor.db';
const DATABASE_KEY_ID = 'database';

export interface OpenedDatabase {
  db: SqlDatabase;
  /** True when this launch created the database (first launch). */
  created: boolean;
  migratedFrom: number;
  schemaVersion: number;
  /** Snapshot taken (or reused) before migrating, if any. */
  snapshot: string | null;
}

interface OpenOptions {
  name?: string;
  migrationList?: Migration[];
}

/**
 * Opens the encrypted database, creating it only on a genuine first launch.
 *
 * | key envelope | database file | outcome                                   |
 * | ------------ | ------------- | ----------------------------------------- |
 * | missing      | absent        | first launch: create key, create database |
 * | missing      | present       | KEY_MISSING_FOR_DATABASE (never recreate) |
 * | present      | absent        | create database with the existing key     |
 * | present      | present       | open, verify, snapshot, migrate           |
 * | any          | unknown       | DATABASE_STATE_UNKNOWN (no key is created)|
 *
 * Never deletes or replaces an existing database or key.
 */
export async function openTrezorDatabase(
  options: OpenOptions = {},
): Promise<OpenedDatabase> {
  const name = options.name ?? DATABASE_NAME;
  const list = options.migrationList ?? migrations;

  const hasKey = await vault.hasKey(DATABASE_KEY_ID);
  // Rejects (instead of answering 'absent') if the file system can't tell.
  const exists = (await databaseFiles.state(name)) === 'present';
  if (!hasKey && exists) {
    throw new StorageError(
      'KEY_MISSING_FOR_DATABASE',
      'A database exists but its key is missing',
    );
  }

  const keyHex = hasKey
    ? await vault.getKey(DATABASE_KEY_ID)
    : await vault.createKey(DATABASE_KEY_ID);
  assertDatabaseKey(keyHex);

  let db: SqlDatabase;
  try {
    // Not failOnCreate: attached databases inherit the main connection's open
    // flags, and the pre-migration snapshot must be able to ATTACH a new file.
    db = openEncrypted(name, keyHex);
  } catch (e) {
    throw new StorageError(
      'DATABASE_UNREADABLE',
      `Could not open database: ${(e as Error).message}`,
    );
  }

  try {
    await verifyEncryptedDatabase(db);

    const from = await getUserVersion(db);
    const latest = list[list.length - 1].version;
    let snapshot: string | null = null;
    if (from >= 1 && from < latest) {
      // Throws if no verified snapshot can be made; migrations then never start.
      snapshot = await ensureVerifiedSnapshot(db, name, from, keyHex);
    }
    // Disables foreign keys while migrating and always re-enables them.
    const { to } = await runMigrations(db, list);
    return {
      db,
      created: !exists,
      migratedFrom: from,
      schemaVersion: to,
      snapshot,
    };
  } catch (e) {
    db.close();
    throw toStorageError(e);
  }
}
