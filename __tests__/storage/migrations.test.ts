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
    await db.execute(
      "INSERT INTO reminders (item_id, due_at, local_start, repeat, interval_minutes, notes, completed) VALUES ('r1', 5, '1970-01-01T01:00', 'once', NULL, '', 0)",
    );
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

describe('v2: reminder scheduling migration', () => {
  const v1Only = migrations.filter(m => m.version === 1);

  async function v1WithData() {
    const db = createNodeSqliteDatabase();
    await runMigrations(db, v1Only);
    await db.execute(
      "INSERT INTO items VALUES ('n', 'note', 'Note', 1, 1, 2), ('a', 'reminder', 'Once', 0, 1, 2), ('b', 'reminder', 'Daily', 0, 1, 2), ('c', 'reminder', 'Monthly', 0, 1, 2), ('d', 'reminder', 'Yearly', 1, 1, 2)",
    );
    await db.execute("INSERT INTO notes VALUES ('n', 'body')");
    const due = Date.parse('2026-01-31T09:15:00.000Z');
    for (const [id, repeat, completed] of [
      ['a', 'none', 0],
      ['b', 'daily', 0],
      ['c', 'monthly', 1],
      ['d', 'yearly', 0],
    ] as const) {
      await db.execute('INSERT INTO reminders VALUES (?, ?, ?, ?, ?)', [
        id,
        due,
        repeat,
        `desc ${id}`,
        completed,
      ]);
    }
    return { db, due };
  }

  test('preserves every reminder; "none" becomes "once"; local start from due_at', async () => {
    const { db, due } = await v1WithData();
    expect(await runMigrations(db)).toEqual({ from: 1, to: 2 });
    const rows = await db.execute(
      'SELECT item_id, due_at, local_start, repeat, interval_minutes, notes, completed FROM reminders ORDER BY item_id',
    );
    const d = new Date(due);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(rows).toEqual([
      {
        item_id: 'a',
        due_at: due,
        local_start: local,
        repeat: 'once',
        interval_minutes: null,
        notes: 'desc a',
        completed: 0,
      },
      {
        item_id: 'b',
        due_at: due,
        local_start: local,
        repeat: 'daily',
        interval_minutes: null,
        notes: 'desc b',
        completed: 0,
      },
      {
        item_id: 'c',
        due_at: due,
        local_start: local,
        repeat: 'monthly',
        interval_minutes: null,
        notes: 'desc c',
        completed: 1,
      },
      {
        item_id: 'd',
        due_at: due,
        local_start: local,
        repeat: 'yearly',
        interval_minutes: null,
        notes: 'desc d',
        completed: 0,
      },
    ]);
    // Other data untouched; relationships and integrity intact.
    expect(await db.execute('SELECT * FROM notes')).toEqual([
      { item_id: 'n', body: 'body' },
    ]);
    expect(await db.execute('PRAGMA foreign_key_check')).toEqual([]);
    expect((await db.execute('PRAGMA quick_check'))[0].quick_check).toBe('ok');
    expect((await db.execute('PRAGMA foreign_keys'))[0].foreign_keys).toBe(1);
    // Cascade still works on the rebuilt table; the index was recreated.
    await db.execute("DELETE FROM items WHERE id = 'a'");
    expect(
      (await db.execute('SELECT item_id FROM reminders')).map(r => r.item_id),
    ).toEqual(['b', 'c', 'd']);
    const indexes = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reminders'",
    );
    expect(indexes.map(i => i.name)).toContain('reminders_open_due');
  });

  test('new constraints: interval only with a valid interval_minutes', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await db.execute(
      "INSERT INTO items VALUES ('x', 'reminder', 't', 0, 1, 1)",
    );
    const insert = (
      repeat: string,
      interval: number | null,
      local = '2026-11-02T08:00',
    ) =>
      db.execute(
        'INSERT INTO reminders (item_id, due_at, local_start, repeat, interval_minutes) VALUES (?, 1, ?, ?, ?)',
        ['x', local, repeat, interval],
      );
    await expect(insert('interval', null)).rejects.toThrow();
    await expect(insert('daily', 60)).rejects.toThrow();
    await expect(insert('interval', 10)).rejects.toThrow();
    await expect(insert('none', null)).rejects.toThrow();
    await expect(insert('daily', null, '2026-11-02 08:00')).rejects.toThrow();
    await insert('interval', 240);
    expect(
      (await db.execute('SELECT interval_minutes FROM reminders'))[0],
    ).toEqual({
      interval_minutes: 240,
    });
  });

  test('a failure part-way through v2 rolls back to the intact v1 database', async () => {
    const { db } = await v1WithData();
    const v2 = migrations.find(m => m.version === 2)!;
    const broken: Migration[] = [
      ...v1Only,
      {
        ...v2,
        async up(tx) {
          await v2.up(tx);
          throw new Error('power cut');
        },
      },
    ];
    await expect(runMigrations(db, broken)).rejects.toMatchObject({
      code: 'MIGRATION_FAILED',
    });
    expect(await getUserVersion(db)).toBe(1);
    expect(
      (
        await db.execute(
          'SELECT item_id, repeat FROM reminders ORDER BY item_id',
        )
      ).map(r => `${r.item_id}:${r.repeat}`),
    ).toEqual(['a:none', 'b:daily', 'c:monthly', 'd:yearly']);
    expect(await tableNames(db)).not.toContain('reminders_v2');
    expect((await db.execute('PRAGMA foreign_keys'))[0].foreign_keys).toBe(1);
    // The real v2 then succeeds.
    expect(await runMigrations(db)).toEqual({ from: 1, to: 2 });
  });
});
