import {
  formatLocalDateTime,
  localDateTimeOf,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
} from '../reminders/recurrence';
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
  {
    version: 2,
    description:
      'Reminder scheduling: once/daily/weekly/monthly/yearly/interval, local start, interval',
    async up(tx) {
      // The repeat CHECK can only change by rebuilding the table (SQLite's
      // documented procedure; runMigrations turns foreign keys off first).
      await tx.execute(`CREATE TABLE reminders_v2 (
        item_id           TEXT PRIMARY KEY NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        due_at            INTEGER NOT NULL,
        local_start       TEXT NOT NULL CHECK (local_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]'),
        repeat            TEXT NOT NULL CHECK (repeat IN ('once','daily','weekly','monthly','yearly','interval')),
        interval_minutes  INTEGER CHECK (interval_minutes IS NULL OR interval_minutes BETWEEN ${MIN_INTERVAL_MINUTES} AND ${MAX_INTERVAL_MINUTES}),
        notes             TEXT NOT NULL DEFAULT '',
        completed         INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
        CHECK ((repeat = 'interval') = (interval_minutes IS NOT NULL))
      ) STRICT`);
      const rows = await tx.execute(
        'SELECT item_id, due_at, repeat, notes, completed FROM reminders',
      );
      for (const row of rows) {
        const dueAt = Number(row.due_at);
        await tx.execute(
          'INSERT INTO reminders_v2 (item_id, due_at, local_start, repeat, interval_minutes, notes, completed) VALUES (?, ?, ?, ?, NULL, ?, ?)',
          [
            String(row.item_id),
            dueAt,
            // Existing reminders keep their wall-clock time as seen in the
            // device's zone at the time of the upgrade.
            formatLocalDateTime(localDateTimeOf(dueAt)),
            // 'none' is now called 'once'; every other value is unchanged.
            row.repeat === 'none' ? 'once' : String(row.repeat),
            row.notes,
            row.completed,
          ],
        );
      }
      await tx.execute('DROP TABLE reminders');
      await tx.execute('ALTER TABLE reminders_v2 RENAME TO reminders');
      await tx.execute(
        'CREATE INDEX reminders_open_due ON reminders (due_at) WHERE completed = 0',
      );
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

async function foreignKeysEnabled(db: SqlExecutor): Promise<boolean> {
  const rows = await db.execute('PRAGMA foreign_keys');
  return Number(rows[0]?.foreign_keys) === 1;
}

/** Turns enforcement on and confirms it took effect (it cannot inside a transaction). */
export async function enableForeignKeys(db: SqlExecutor): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  if (!(await foreignKeysEnabled(db))) {
    throw new StorageError(
      'MIGRATION_FAILED',
      'Foreign key enforcement could not be re-enabled (connection left in a transaction?)',
    );
  }
}

/**
 * Brings the schema up to date, following SQLite's procedure for schema
 * changes (https://sqlite.org/lang_altertable.html#otheralter):
 *
 * 1. Foreign keys OFF, outside any transaction (the pragma is a no-op inside
 *    one). Otherwise rebuilding a table (create new, copy, DROP, RENAME) would
 *    fire ON DELETE CASCADE and wipe dependent rows.
 * 2. Each migration in its own transaction: `up`, then `PRAGMA
 *    foreign_key_check`; any violation rolls the whole step back.
 * 3. `user_version` bumped inside the same transaction.
 * 4. Foreign keys back ON on every path (success and failure), verified.
 *
 * With nothing pending, only step 4 runs. A failure leaves the database at the
 * last fully committed version.
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

  const pending = pendingMigrations(from, list);
  if (pending.length > 0) {
    await db.execute('PRAGMA foreign_keys = OFF');
    try {
      for (const migration of pending) {
        try {
          await db.transaction(async tx => {
            await migration.up(tx);
            const violations = await tx.execute('PRAGMA foreign_key_check');
            if (violations.length > 0) {
              throw new Error(
                `${violations.length} foreign key violation(s); rolled back`,
              );
            }
            // PRAGMA cannot take bound parameters; version is a trusted integer.
            await tx.execute(
              `PRAGMA user_version = ${Math.trunc(migration.version)}`,
            );
          });
        } catch (e) {
          throw new StorageError(
            'MIGRATION_FAILED',
            `Migration to v${migration.version} failed: ${
              (e as Error).message
            }`,
          );
        }
      }
    } finally {
      await enableForeignKeys(db);
    }
  } else {
    await enableForeignKeys(db);
  }

  return { from, to: await getUserVersion(db) };
}
