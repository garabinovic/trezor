import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteSettingsRepository } from '../../src/storage/SettingsRepository';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { Reminder } from '../../src/data/types';
import type { SqlDatabase } from '../../src/storage/sql';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// Saving this reminder inserts the `items` row, then fails on the detail row
// (invalid date) and rolls back.
const failingReminder: Reminder = {
  id: 'r1',
  type: 'reminder',
  title: 'Will roll back',
  dueAt: 'not a date',
  localStart: '2026-11-02T10:00',
  intervalMinutes: null,
  repeat: 'once',
  notes: '',
  completed: false,
  pinned: false,
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
};

async function setup(wrap: (db: SqlDatabase) => SqlDatabase) {
  const raw = createNodeSqliteDatabase();
  await runMigrations(raw);
  const db = wrap(raw);
  return {
    raw,
    items: new SqliteItemRepository(db),
    settings: new SqliteSettingsRepository(db),
  };
}

describe('serialized writes (L3)', () => {
  test('control: without serialization a settings write is swallowed by a rolled-back save', async () => {
    const { items, settings } = await setup(db => db);
    const save = items.save(failingReminder);
    const theme = settings.set('theme.preference', 'dark');
    await expect(save).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    await theme;
    // The theme write ran inside the item transaction and was rolled back.
    expect(await settings.get('theme.preference')).toBeNull();
  });

  test('a settings write during a failing item save is not rolled back with it', async () => {
    const { items, settings } = await setup(serializeDatabase);
    const save = items.save(failingReminder);
    const theme = settings.set('theme.preference', 'dark');
    await expect(save).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    await expect(theme).resolves.toBeUndefined();
    expect(await settings.get('theme.preference')).toBe('dark');
    expect(await items.listAll()).toEqual([]);
  });

  test('a delete issued during a save does not run inside its transaction', async () => {
    const { raw, items } = await setup(serializeDatabase);
    await raw.execute(
      "INSERT INTO items VALUES ('n1', 'note', 'Old', 0, 1, 1)",
    );
    await raw.execute("INSERT INTO notes VALUES ('n1', '')");
    const save = items.save(failingReminder);
    const del = items.delete('n1');
    await expect(save).rejects.toThrow();
    await del;
    // The delete committed on its own even though the save rolled back.
    expect(await raw.execute('SELECT id FROM items')).toEqual([]);
  });

  test('operations run in submission order and errors reach their caller', async () => {
    const raw = createNodeSqliteDatabase();
    const db = serializeDatabase(raw);
    await db.execute('CREATE TABLE log (n INTEGER)');
    const results = await Promise.allSettled([
      db.execute('INSERT INTO log VALUES (1)'),
      db.transaction(async tx => {
        await tx.execute('INSERT INTO log VALUES (2)');
        throw new Error('boom');
      }),
      db.execute('INSERT INTO log VALUES (3)'),
      db.execute('NOT VALID SQL'),
      db.execute('INSERT INTO log VALUES (4)'),
    ]);
    expect(results.map(r => r.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('boom');
    expect(await db.execute('SELECT n FROM log')).toEqual([
      { n: 1 },
      { n: 3 },
      { n: 4 },
    ]);
  });

  test('a transaction returns its result and later operations still run', async () => {
    const db = serializeDatabase(createNodeSqliteDatabase());
    await db.execute('CREATE TABLE t (v TEXT)');
    const value = await db.transaction(async tx => {
      await tx.execute("INSERT INTO t VALUES ('a')");
      return (await tx.execute('SELECT count(*) AS c FROM t'))[0].c;
    });
    expect(value).toBe(1);
    expect(await db.execute('SELECT v FROM t')).toEqual([{ v: 'a' }]);
  });
});
