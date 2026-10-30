import { StorageError } from '../../src/storage/errors';
import {
  getUserVersion,
  LATEST_SCHEMA_VERSION,
  Migration,
  migrations,
  pendingMigrations,
  runMigrations,
} from '../../src/storage/migrations';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

const tableNames = async (db: ReturnType<typeof createNodeSqliteDatabase>) =>
  (
    await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
  ).map(r => r.name);

describe('migrations', () => {
  test('versions start at 1 and strictly increase', () => {
    migrations.forEach((m, i) => expect(m.version).toBe(i + 1));
  });

  test('fresh database migrates to the latest schema', async () => {
    const db = createNodeSqliteDatabase();
    const result = await runMigrations(db);
    expect(result).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION });
    expect(await tableNames(db)).toEqual([
      'cards',
      'documents',
      'items',
      'notes',
      'reminders',
      'settings',
    ]);
  });

  test('running again is a no-op', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    expect(await runMigrations(db)).toEqual({
      from: LATEST_SCHEMA_VERSION,
      to: LATEST_SCHEMA_VERSION,
    });
  });

  test('a newer schema is refused and left untouched', async () => {
    const db = createNodeSqliteDatabase();
    await db.execute(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    await expect(runMigrations(db)).rejects.toMatchObject({
      code: 'NEWER_SCHEMA',
    });
    expect(await getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION + 1);
    expect(await tableNames(db)).toEqual([]);
  });

  test('a failing migration rolls back to the last good version', async () => {
    const db = createNodeSqliteDatabase();
    const broken: Migration[] = [
      ...migrations,
      {
        version: LATEST_SCHEMA_VERSION + 1,
        description: 'adds a column, then fails',
        async up(tx) {
          await tx.execute('ALTER TABLE notes ADD COLUMN extra TEXT');
          await tx.execute('THIS IS NOT SQL');
        },
      },
    ];
    const error = await runMigrations(db, broken).catch(e => e);
    expect(error).toBeInstanceOf(StorageError);
    expect(error.code).toBe('MIGRATION_FAILED');
    expect(await getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const columns = await db.execute(
      "SELECT name FROM pragma_table_info('notes')",
    );
    expect(columns.map(c => c.name)).not.toContain('extra');
  });

  test('a later migration preserves existing rows', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await db.execute("INSERT INTO items VALUES ('a', 'note', 'Kept', 0, 1, 1)");
    await db.execute("INSERT INTO notes VALUES ('a', 'body')");
    const next: Migration[] = [
      ...migrations,
      {
        version: LATEST_SCHEMA_VERSION + 1,
        description: 'example additive change',
        async up(tx) {
          await tx.execute(
            "ALTER TABLE notes ADD COLUMN format TEXT NOT NULL DEFAULT 'plain'",
          );
        },
      },
    ];
    await runMigrations(db, next);
    expect(await db.execute('SELECT * FROM notes')).toEqual([
      { item_id: 'a', body: 'body', format: 'plain' },
    ]);
  });

  test('schema enforces types and allowed values', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await expect(
      db.execute("INSERT INTO items VALUES ('x', 'photo', 't', 0, 1, 1)"),
    ).rejects.toThrow();
    await expect(
      db.execute("INSERT INTO items VALUES ('x', 'note', 't', 0, 'soon', 1)"),
    ).rejects.toThrow();
  });

  test('detail rows require a parent item and cascade on delete', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await expect(
      db.execute("INSERT INTO notes VALUES ('orphan', 'x')"),
    ).rejects.toThrow();
    await db.execute("INSERT INTO items VALUES ('a', 'note', 't', 0, 1, 1)");
    await db.execute("INSERT INTO notes VALUES ('a', 'x')");
    await db.execute("DELETE FROM items WHERE id = 'a'");
    expect(await db.execute('SELECT * FROM notes')).toEqual([]);
  });

  test('pendingMigrations selects only newer versions', () => {
    expect(pendingMigrations(0).map(m => m.version)).toEqual(
      migrations.map(m => m.version),
    );
    expect(pendingMigrations(LATEST_SCHEMA_VERSION)).toEqual([]);
  });
});
