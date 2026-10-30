import { StorageError } from './errors';
import { SqlDatabase, SqlExecutor } from './sql';

export interface Migration {
  /** Schema version after this migration runs. Strictly increasing from 1. */
  version: number;
  description: string;
  up(tx: SqlExecutor): Promise<void>;
}

/**
 * Append-only. Never edit or reorder a migration that has shipped: add a new
 * one instead. Each runs in its own transaction together with its
 * `user_version` bump.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: items with one detail table per type',
    async up(tx) {
      const statements = [
        `CREATE TABLE items (
          id          TEXT PRIMARY KEY NOT NULL,
          type        TEXT NOT NULL CHECK (type IN ('note','reminder','card','document')),
          title       TEXT NOT NULL,
          pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        ) STRICT`,
        'CREATE INDEX items_type_updated ON items (type, updated_at DESC)',

        `CREATE TABLE notes (
          item_id  TEXT PRIMARY KEY NOT NULL REFERENCES items (id) ON DELETE CASCADE,
          body     TEXT NOT NULL DEFAULT ''
        ) STRICT`,

        `CREATE TABLE reminders (
          item_id    TEXT PRIMARY KEY NOT NULL REFERENCES items (id) ON DELETE CASCADE,
          due_at     INTEGER NOT NULL,
          repeat     TEXT NOT NULL CHECK (repeat IN ('none','daily','weekly','monthly','yearly')),
          notes      TEXT NOT NULL DEFAULT '',
          completed  INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))
        ) STRICT`,
        'CREATE INDEX reminders_open_due ON reminders (due_at) WHERE completed = 0',

        `CREATE TABLE cards (
          item_id      TEXT PRIMARY KEY NOT NULL REFERENCES items (id) ON DELETE CASCADE,
          card_number  TEXT NOT NULL,
          code_format  TEXT NOT NULL CHECK (code_format IN ('barcode','qr')),
          holder_name  TEXT NOT NULL DEFAULT '',
          notes        TEXT NOT NULL DEFAULT ''
        ) STRICT`,

        `CREATE TABLE documents (
          item_id       TEXT PRIMARY KEY NOT NULL REFERENCES items (id) ON DELETE CASCADE,
          kind          TEXT NOT NULL CHECK (kind IN ('receipt','warranty','image','document')),
          merchant      TEXT NOT NULL DEFAULT '',
          date          TEXT,
          expires_on    TEXT,
          amount_minor  INTEGER,
          currency      TEXT NOT NULL DEFAULT 'EUR',
          notes         TEXT NOT NULL DEFAULT ''
        ) STRICT`,

        `CREATE TABLE settings (
          key    TEXT PRIMARY KEY NOT NULL,
          value  TEXT NOT NULL
        ) STRICT`,
      ];
      for (const sql of statements) {
        await tx.execute(sql);
      }
    },
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version;

export async function getUserVersion(db: SqlExecutor): Promise<number> {
  const rows = await db.execute('PRAGMA user_version');
  return Number(rows[0]?.user_version ?? 0);
}

/** Migrations that would run for a database at `current`. */
export function pendingMigrations(
  current: number,
  list: Migration[] = migrations,
): Migration[] {
  return list.filter(m => m.version > current);
}

/**
 * Brings the schema up to date. Each migration and its version bump commit
 * atomically, so a failure leaves the database at the last good version.
 */
export async function runMigrations(
  db: SqlDatabase,
  list: Migration[] = migrations,
): Promise<{ from: number; to: number }> {
  const latest = list[list.length - 1].version;
  const from = await getUserVersion(db);

  if (from > latest) {
    throw new StorageError(
      'NEWER_SCHEMA',
      `Database schema v${from} is newer than this app (v${latest})`,
    );
  }

  for (const migration of pendingMigrations(from, list)) {
    try {
      await db.transaction(async tx => {
        await migration.up(tx);
        // PRAGMA cannot take bound parameters; version is a trusted integer.
        await tx.execute(
          `PRAGMA user_version = ${Math.trunc(migration.version)}`,
        );
      });
    } catch (e) {
      throw new StorageError(
        'MIGRATION_FAILED',
        `Migration to v${migration.version} failed: ${(e as Error).message}`,
      );
    }
  }

  const violations = await db.execute('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new StorageError(
      'MIGRATION_FAILED',
      `${violations.length} foreign key violation(s) after migration`,
    );
  }
  return { from, to: await getUserVersion(db) };
}
