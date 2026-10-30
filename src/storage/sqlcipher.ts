import { ANDROID_DATABASE_PATH, open } from '@op-engineering/op-sqlite';
import { StorageError } from './errors';
import { adaptOpSqlite } from './opSqliteAdapter';
import { SqlDatabase, SqlExecutor } from './sql';

/** A database key from the vault: exactly 32 bytes as lowercase hex. */
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Rejects anything that is not a full-length random key. Without this, an
 * empty or malformed value would be handed to SQLCipher as a weak passphrase.
 */
export function assertDatabaseKey(keyHex: unknown): asserts keyHex is string {
  if (typeof keyHex !== 'string' || !KEY_PATTERN.test(keyHex)) {
    throw new StorageError(
      'INVALID_KEY_FORMAT',
      'Database key has an unexpected format',
    );
  }
}

/** SQLCipher raw-key syntax: skips PBKDF2 because the key is already random. */
export function rawKey(keyHex: string): string {
  assertDatabaseKey(keyHex);
  return `x'${keyHex}'`;
}

/** Absolute path of a file in op-sqlite's default database directory. */
export function databasePath(name: string): string {
  return ANDROID_DATABASE_PATH.endsWith('/')
    ? `${ANDROID_DATABASE_PATH}${name}`
    : `${ANDROID_DATABASE_PATH}/${name}`;
}

/**
 * Opens `name` with the key applied before any statement runs.
 *
 * op-sqlite keeps the options object passed to open() alive for the lifetime
 * of the connection (it closes over it). The key is removed from that object
 * as soon as open() returns, so the connection no longer references it.
 * This shortens the key's reachable lifetime; it does not erase it from
 * memory (JS strings cannot be wiped).
 */
export function openEncrypted(
  name: string,
  keyHex: string,
  options: { failOnCreate?: boolean } = {},
): SqlDatabase {
  const params: {
    name: string;
    encryptionKey?: string;
    failOnCreate?: boolean;
  } = { name, encryptionKey: rawKey(keyHex) };
  if (options.failOnCreate) {
    params.failOnCreate = true;
  }
  try {
    return adaptOpSqlite(open(params as Parameters<typeof open>[0]));
  } finally {
    delete params.encryptionKey;
  }
}

/** SQLite result code from an op-sqlite error message ("… (code 26, …)"). */
export function sqliteCode(error: unknown): number | null {
  const match = /\(code (\d+)/.exec((error as Error)?.message ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Fails unless the key is right, the file is intact and SQLCipher is really
 * active (a plain SQLite build would silently ignore the key).
 */
export async function verifyEncryptedDatabase(db: SqlExecutor): Promise<void> {
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
