import { open } from '@op-engineering/op-sqlite';
import { migrations, runMigrations } from '../storage/migrations';
import { adaptOpSqlite } from '../storage/opSqliteAdapter';
import { SqlDatabase, SqlExecutor, SqlRow } from '../storage/sql';
import { openEncrypted, rawKey } from '../storage/sqlcipher';
import { ArtifactAttachment, BackupError } from './platform';

/** Schema version every backup database has (spec v2.4 §3.8, Annex B §B.4). */
export const BACKUP_SCHEMA_VERSION = 3;

/** Annex B §B.2: what every connection to an artifact must report. */
const CIPHER_SETTINGS: [pragma: string, expected: string][] = [
  ['cipher_page_size', '4096'],
  ['cipher_hmac_algorithm', 'HMAC_SHA512'],
  ['cipher_kdf_algorithm', 'PBKDF2_HMAC_SHA512'],
  ['cipher_use_hmac', '1'],
  ['cipher_plaintext_header_size', '0'],
];

const SCHEMA_SQL =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name";

const inconsistent = () => new BackupError('BACKUP_INCONSISTENT');
const unsupported = () => new BackupError('BACKUP_UNSUPPORTED');

const firstValue = (rows: SqlRow[]) =>
  rows.length > 0 ? String(Object.values(rows[0])[0]) : null;

/**
 * Exports the live database into a new SQLCipher file at `path` under `keyHex` (spec
 * §6.2 step 3, Annex B §B.3), on the gate's executor: ATTACH, `sqlcipher_export`,
 * `user_version`, DETACH, with nothing else in between and no transaction open. This is
 * the snapshot procedure with another key. Every cipher setting stays at SQLCipher 4's
 * defaults (Annex B §B.2 requirement 1).
 */
export async function exportDatabase(
  live: SqlExecutor,
  path: string,
  keyHex: string,
): Promise<void> {
  await live.execute('ATTACH DATABASE ? AS backup KEY ?', [
    path,
    rawKey(keyHex),
  ]);
  let failed = false;
  try {
    await live.execute("SELECT sqlcipher_export('backup')");
    // sqlcipher_export copies schema and data but not user_version.
    await live.execute(`PRAGMA backup.user_version = ${BACKUP_SCHEMA_VERSION}`);
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    try {
      await live.execute('DETACH DATABASE backup');
    } catch (e) {
      if (!failed) {
        throw e;
      }
    }
  }
}

/** The app's own schema, built at runtime in memory from its migrations (Annex B §B.6). */
async function referenceSchema(): Promise<SqlRow[]> {
  const db = adaptOpSqlite(
    open({ name: 'trezor-schema-reference', location: ':memory:' }),
  );
  try {
    await runMigrations(db, migrations);
    return await db.execute(SCHEMA_SQL);
  } finally {
    db.close();
  }
}

/**
 * Verifies a database artifact, a staged one or a fresh export (Annex B §B.4), on a
 * separate connection, and returns its attachment rows. Any deviation rejects:
 * BACKUP_UNSUPPORTED for other cipher settings or schema version, BACKUP_CORRUPT for a
 * wrong key or damage, BACKUP_INCONSISTENT for constraint or schema differences.
 */
export async function verifyArtifact(
  location: string,
  name: string,
  keyHex: string,
): Promise<ArtifactAttachment[]> {
  let db: SqlDatabase;
  try {
    db = openEncrypted(name, keyHex, { failOnCreate: true, location });
  } catch {
    throw new BackupError('BACKUP_CORRUPT');
  }
  try {
    try {
      await db.execute('SELECT count(*) AS n FROM sqlite_master');
    } catch {
      throw new BackupError('BACKUP_CORRUPT');
    }
    const version = firstValue(await db.execute('PRAGMA cipher_version'));
    if (!version || !version.startsWith('4.')) {
      throw unsupported();
    }
    for (const [pragma, expected] of CIPHER_SETTINGS) {
      if (firstValue(await db.execute(`PRAGMA ${pragma}`)) !== expected) {
        throw unsupported();
      }
    }
    if ((await db.execute('PRAGMA cipher_integrity_check')).length > 0) {
      throw new BackupError('BACKUP_CORRUPT');
    }
    const integrity = await db.execute('PRAGMA integrity_check');
    if (integrity.length !== 1 || firstValue(integrity) !== 'ok') {
      throw new BackupError('BACKUP_CORRUPT');
    }
    if ((await db.execute('PRAGMA foreign_key_check')).length > 0) {
      throw inconsistent();
    }
    if (
      Number(firstValue(await db.execute('PRAGMA user_version'))) !==
      BACKUP_SCHEMA_VERSION
    ) {
      throw unsupported();
    }
    const schema = await db.execute(SCHEMA_SQL);
    if (JSON.stringify(schema) !== JSON.stringify(await referenceSchema())) {
      throw inconsistent();
    }
    const rows = await db.execute(
      'SELECT id, item_id, file_name, mime_type, size_bytes, sha256, format_version FROM attachments ORDER BY id',
    );
    return rows.map(r => ({
      id: String(r.id),
      itemId: String(r.item_id),
      fileName: String(r.file_name),
      mimeType: String(r.mime_type),
      sizeBytes: Number(r.size_bytes),
      sha256: String(r.sha256),
      formatVersion: Number(r.format_version),
    }));
  } catch (e) {
    throw e instanceof BackupError ? e : new BackupError('BACKUP_CORRUPT');
  } finally {
    db.close();
  }
}

/**
 * Spec §7 step 6: the artifact's `attachments` rows and the manifest's entries are the
 * same set, field by field.
 */
export function requireSameAttachments(
  rows: ArtifactAttachment[],
  manifest: ArtifactAttachment[],
): void {
  const key = (a: ArtifactAttachment) =>
    JSON.stringify([
      a.id,
      a.fileName,
      a.mimeType,
      a.sizeBytes,
      a.sha256,
      a.formatVersion,
    ]);
  const left = rows.map(key).sort();
  const right = manifest.map(key).sort();
  if (left.length !== right.length || left.some((k, i) => k !== right[i])) {
    throw inconsistent();
  }
}
