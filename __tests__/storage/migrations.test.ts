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

describe('foreign keys during migrations (M3, L2)', () => {
  // Rebuilds `items` the way SQLite documents for structural changes.
  const rebuildItems: Migration = {
    version: LATEST_SCHEMA_VERSION + 1,
    description: 'rebuild items with an extra column',
    async up(tx) {
      await tx.execute(`CREATE TABLE items_new (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('note','reminder','card','document')),
        title TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      ) STRICT`);
      await tx.execute(
        'INSERT INTO items_new (id, type, title, pinned, created_at, updated_at) SELECT id, type, title, pinned, created_at, updated_at FROM items',
      );
      await tx.execute('DROP TABLE items');
      await tx.execute('ALTER TABLE items_new RENAME TO items');
      await tx.execute(
        'CREATE INDEX items_type_updated ON items (type, updated_at DESC)',
      );
    },
  };

  async function seeded() {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await db.execute(
      "INSERT INTO items VALUES ('n1', 'note', 'Note', 0, 1, 1), ('r1', 'reminder', 'Rem', 0, 2, 2)",
    );
    await db.execute("INSERT INTO notes VALUES ('n1', 'body')");
    await db.execute("INSERT INTO reminders VALUES ('r1', 5, 'none', '', 0)");
    return db;
  }

  const foreignKeysOn = async (
    db: ReturnType<typeof createNodeSqliteDatabase>,
  ) => (await db.execute('PRAGMA foreign_keys'))[0].foreign_keys === 1;

  test('control: the same rebuild with foreign keys ON wipes dependent rows', async () => {
    const db = await seeded();
    await db.execute('PRAGMA foreign_keys = ON');
    await db.transaction(tx => rebuildItems.up(tx));
    expect(await db.execute('SELECT * FROM notes')).toEqual([]);
  });

  test('a table-rebuild migration keeps every relationship', async () => {
    const db = await seeded();
    const result = await runMigrations(db, [...migrations, rebuildItems]);
    expect(result.to).toBe(LATEST_SCHEMA_VERSION + 1);
    expect(await db.execute('SELECT * FROM notes')).toEqual([
      { item_id: 'n1', body: 'body' },
    ]);
    expect(await db.execute('SELECT item_id FROM reminders')).toEqual([
      { item_id: 'r1' },
    ]);
    expect(await db.execute('PRAGMA foreign_key_check')).toEqual([]);
    expect(await foreignKeysOn(db)).toBe(true);
    // Cascade still works against the rebuilt table.
    await db.execute("DELETE FROM items WHERE id = 'n1'");
    expect(await db.execute('SELECT * FROM notes')).toEqual([]);
  });

  test('a foreign key violation prevents the commit', async () => {
    const db = await seeded();
    const orphan: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      description: 'creates an orphan row',
      async up(tx) {
        await tx.execute(
          "INSERT INTO notes VALUES ('missing-parent', 'orphan')",
        );
        await tx.execute('ALTER TABLE notes ADD COLUMN extra TEXT');
      },
    };
    await expect(
      runMigrations(db, [...migrations, orphan]),
    ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    expect(await getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(
      await db.execute("SELECT * FROM notes WHERE item_id = 'missing-parent'"),
    ).toEqual([]);
    const columns = await db.execute(
      "SELECT name FROM pragma_table_info('notes')",
    );
    expect(columns.map(c => c.name)).not.toContain('extra');
    expect(await foreignKeysOn(db)).toBe(true);
  });

  test('foreign keys are ON after a failed migration', async () => {
    const db = await seeded();
    await db.execute('PRAGMA foreign_keys = OFF');
    const broken: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      description: 'fails',
      async up(tx) {
        await tx.execute('NOT VALID SQL');
      },
    };
    await expect(runMigrations(db, [...migrations, broken])).rejects.toThrow();
    expect(await foreignKeysOn(db)).toBe(true);
    // The connection is usable and not stuck in a transaction.
    await db.transaction(async tx => {
      await tx.execute("UPDATE items SET title = 'ok' WHERE id = 'n1'");
    });
  });

  test('with nothing pending, foreign keys are still turned ON', async () => {
    const db = await seeded();
    await db.execute('PRAGMA foreign_keys = OFF');
    await runMigrations(db);
    expect(await foreignKeysOn(db)).toBe(true);
  });
});
