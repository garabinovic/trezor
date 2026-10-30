import type { Item } from '../../src/data/types';
import { createSampleItems } from '../../src/data/sampleData';
import {
  InMemoryItemRepository,
  ItemRepository,
} from '../../src/storage/ItemRepository';
import { runMigrations } from '../../src/storage/migrations';
import {
  InMemorySettingsRepository,
  SettingsRepository,
  SqliteSettingsRepository,
} from '../../src/storage/SettingsRepository';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

const NOW = new Date('2026-10-30T12:00:00.000Z');

// Sample data has a document attachment, which is not persisted yet.
const persistable = (items: Item[]) =>
  items.map(i => (i.type === 'document' ? { ...i, attachment: null } : i));

const byId = (items: Item[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

async function sqliteRepo() {
  const db = createNodeSqliteDatabase();
  await runMigrations(db);
  return { db, repo: new SqliteItemRepository(db) };
}

const implementations: [string, () => Promise<ItemRepository>][] = [
  ['InMemoryItemRepository', async () => new InMemoryItemRepository()],
  ['SqliteItemRepository', async () => (await sqliteRepo()).repo],
];

describe.each(implementations)('%s contract', (_name, create) => {
  let repo: ItemRepository;
  let samples: Item[];

  beforeEach(async () => {
    repo = await create();
    samples = persistable(createSampleItems(NOW));
  });

  test('starts empty', async () => {
    expect(await repo.listAll()).toEqual([]);
  });

  test('round-trips every item type without loss', async () => {
    for (const item of samples) {
      await repo.save(item);
    }
    expect(byId(await repo.listAll())).toEqual(byId(samples));
  });

  test('lists most recently updated first', async () => {
    for (const item of samples) {
      await repo.save(item);
    }
    const listed = await repo.listAll();
    const times = listed.map(i => i.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  test('updates in place and keeps createdAt', async () => {
    const note = samples.find(i => i.type === 'note')!;
    await repo.save(note);
    const edited = {
      ...note,
      title: 'Edited',
      pinned: !note.pinned,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: NOW.toISOString(),
    };
    await repo.save(edited);
    const [stored] = await repo.listAll();
    expect(stored).toEqual({ ...edited, createdAt: note.createdAt });
  });

  test('deletes only the given item', async () => {
    const [a, b] = samples;
    await repo.save(a);
    await repo.save(b);
    await repo.delete(a.id);
    expect((await repo.listAll()).map(i => i.id)).toEqual([b.id]);
  });

  test('rejects changing an item type', async () => {
    const note = samples.find(i => i.type === 'note')!;
    await repo.save(note);
    const asReminder = samples.find(i => i.type === 'reminder')!;
    await expect(repo.save({ ...asReminder, id: note.id })).rejects.toThrow();
    expect((await repo.listAll())[0]).toEqual(note);
  });
});

describe('SqliteItemRepository storage details', () => {
  test('stores money in minor units and timestamps as integer ms', async () => {
    const { db, repo } = await sqliteRepo();
    const doc = persistable(createSampleItems(NOW)).find(
      i => i.type === 'document' && i.amount != null,
    )!;
    await repo.save(doc);
    const [row] = await db.execute(
      'SELECT d.amount_minor, i.created_at FROM documents d JOIN items i ON i.id = d.item_id',
    );
    expect(row.amount_minor).toBe(
      Math.round((doc as { amount: number }).amount * 100),
    );
    expect(row.created_at).toBe(Date.parse(doc.createdAt));
  });

  test('deleting an item removes its detail row', async () => {
    const { db, repo } = await sqliteRepo();
    const card = createSampleItems(NOW).find(i => i.type === 'card')!;
    await repo.save(card);
    await repo.delete(card.id);
    expect(await db.execute('SELECT * FROM cards')).toEqual([]);
  });

  test('a failed write leaves no partial rows and reports WRITE_FAILED', async () => {
    const { db, repo } = await sqliteRepo();
    const bad = {
      ...createSampleItems(NOW).find(i => i.type === 'reminder')!,
      dueAt: 'not a date',
    };
    await expect(repo.save(bad)).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    });
    expect(await db.execute('SELECT * FROM items')).toEqual([]);
  });
});

describe.each<[string, () => Promise<SettingsRepository>]>([
  ['InMemorySettingsRepository', async () => new InMemorySettingsRepository()],
  [
    'SqliteSettingsRepository',
    async () => new SqliteSettingsRepository((await sqliteRepo()).db),
  ],
])('%s', (_name, create) => {
  test('returns null until set, then the latest value', async () => {
    const settings = await create();
    expect(await settings.get('theme.preference')).toBeNull();
    await settings.set('theme.preference', 'dark');
    await settings.set('theme.preference', 'light');
    expect(await settings.get('theme.preference')).toBe('light');
  });
});
