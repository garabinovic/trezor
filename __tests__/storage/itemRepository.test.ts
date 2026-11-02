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
      localStart: '2026-11-02T10:00',
      intervalMinutes: null,
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

// --- Phase 2: full CRUD per type, search, pinning, ordering, errors ---------

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-15T08:00:00.000Z';
const T2 = '2026-10-29T08:00:00.000Z';

const fixtures: Record<Item['type'], [Item, Item]> = {
  note: [
    {
      id: 'n',
      type: 'note',
      title: 'Note',
      body: 'First body',
      pinned: false,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 'n',
      type: 'note',
      title: 'Note edited',
      body: 'Second body\nwith lines',
      pinned: true,
      createdAt: T0,
      updatedAt: T1,
    },
  ],
  reminder: [
    {
      id: 'r',
      type: 'reminder',
      title: 'Reminder',
      dueAt: '2026-11-02T09:30:00.000Z',
      localStart: '2026-11-02T10:30',
      intervalMinutes: null,
      repeat: 'once',
      notes: 'desc',
      completed: false,
      pinned: false,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 'r',
      type: 'reminder',
      title: 'Reminder edited',
      dueAt: '2026-12-24T18:45:00.000Z',
      localStart: '2026-12-24T19:45',
      intervalMinutes: null,
      repeat: 'yearly',
      notes: 'new desc',
      completed: true,
      pinned: true,
      createdAt: T0,
      updatedAt: T1,
    },
  ],
  card: [
    {
      id: 'c',
      type: 'card',
      title: 'Shop',
      cardNumber: '0012 3456',
      codeFormat: 'barcode',
      holderName: 'Ana',
      notes: '',
      pinned: false,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 'c',
      type: 'card',
      title: 'Shop+',
      cardNumber: 'AB-99',
      codeFormat: 'qr',
      holderName: '',
      notes: 'gold tier',
      pinned: true,
      createdAt: T0,
      updatedAt: T1,
    },
  ],
  document: [
    {
      id: 'd',
      type: 'document',
      kind: 'receipt',
      title: 'TV',
      merchant: 'Store',
      date: '2026-10-01',
      expiresOn: null,
      amount: 499.99,
      currency: 'EUR',
      notes: '',
      attachment: null,
      pinned: false,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 'd',
      type: 'document',
      kind: 'document',
      title: 'ID card',
      merchant: 'Police',
      date: '2025-03-04',
      expiresOn: '2035-03-04',
      amount: null,
      currency: 'RSD',
      notes: 'renew',
      attachment: null,
      pinned: true,
      createdAt: T0,
      updatedAt: T1,
    },
  ],
};

describe.each(implementations)('%s per-type CRUD', (_name, create) => {
  test.each(Object.keys(fixtures) as Item['type'][])(
    '%s: create, read, update every field, delete',
    async type => {
      const repo = await create();
      const [created, edited] = fixtures[type];
      await repo.save(created);
      expect(await repo.listAll()).toEqual([created]);
      await repo.save(edited);
      expect(await repo.listAll()).toEqual([edited]);
      await repo.delete(created.id);
      expect(await repo.listAll()).toEqual([]);
    },
  );

  test('types stay separate; the same title in two types is two items', async () => {
    const repo = await create();
    await repo.save({ ...fixtures.note[0], id: 'a', title: 'Same' });
    await repo.save({ ...fixtures.card[0], id: 'b', title: 'Same' });
    const listed = await repo.listAll();
    expect(listed.map(i => [i.id, i.type]).sort()).toEqual([
      ['a', 'note'],
      ['b', 'card'],
    ]);
  });

  test('deleting an unknown id leaves other items untouched', async () => {
    const repo = await create();
    await repo.save(fixtures.note[0]);
    await repo.delete('does-not-exist');
    expect(await repo.listAll()).toEqual([fixtures.note[0]]);
  });

  test('pin state round-trips', async () => {
    const repo = await create();
    await repo.save(fixtures.card[0]);
    await repo.save({ ...fixtures.card[0], pinned: true, updatedAt: T1 });
    expect((await repo.listAll())[0].pinned).toBe(true);
    await repo.save({ ...fixtures.card[0], pinned: false, updatedAt: T2 });
    expect((await repo.listAll())[0].pinned).toBe(false);
  });

  test('ordering follows the latest modification', async () => {
    const repo = await create();
    await repo.save({ ...fixtures.note[0], id: 'old', updatedAt: T0 });
    await repo.save({ ...fixtures.note[0], id: 'new', updatedAt: T1 });
    expect((await repo.listAll()).map(i => i.id)).toEqual(['new', 'old']);
    await repo.save({ ...fixtures.note[0], id: 'old', updatedAt: T2 });
    expect((await repo.listAll()).map(i => i.id)).toEqual(['old', 'new']);
  });

  test('search covers every type and its text fields', async () => {
    const repo = await create();
    for (const [first] of Object.values(fixtures)) {
      await repo.save(first);
    }
    await repo.save({ ...fixtures.document[1], id: 'd2' });
    const ids = async (term: string) =>
      (await repo.search(term)).map(i => i.id).sort();
    expect(await ids('first body')).toEqual(['n']); // note body
    expect(await ids('DESC')).toEqual(['r']); // reminder description
    expect(await ids('3456')).toEqual(['c']); // card number
    expect(await ids('ana')).toEqual(['c']); // cardholder
    expect(await ids('police')).toEqual(['d2']); // document issuer
    expect(await ids('receipt')).toEqual(['d']); // document type label
    expect(await ids('')).toEqual([]);
    expect(await ids('nothing-like-this')).toEqual([]);
  });

  test('search results are most recently updated first', async () => {
    const repo = await create();
    await repo.save({
      ...fixtures.note[0],
      id: 'a',
      title: 'Plan',
      updatedAt: T0,
    });
    await repo.save({
      ...fixtures.card[0],
      id: 'b',
      title: 'Plan',
      updatedAt: T2,
    });
    await repo.save({
      ...fixtures.document[0],
      id: 'c',
      title: 'Plan',
      updatedAt: T1,
    });
    expect((await repo.search('plan')).map(i => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('SqliteItemRepository persistence and errors', () => {
  test('a new repository on the same database sees every saved field', async () => {
    const { db, repo } = await sqliteRepo();
    for (const [, edited] of Object.values(fixtures)) {
      await repo.save(edited);
    }
    const reopened = new SqliteItemRepository(db);
    expect(byId(await reopened.listAll())).toEqual(
      byId(Object.values(fixtures).map(([, edited]) => edited)),
    );
  });

  test('database failures surface as errors, not empty results', async () => {
    const failing = {
      execute: async () => {
        throw new Error('disk I/O error');
      },
      transaction: async () => {
        throw new Error('disk I/O error');
      },
      close: () => undefined,
    };
    const repo = new SqliteItemRepository(failing);
    await expect(repo.save(fixtures.note[0])).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    });
    await expect(repo.delete('n')).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    });
    await expect(repo.listAll()).rejects.toThrow('disk I/O error');
    await expect(repo.search('x')).rejects.toThrow('disk I/O error');
  });

  test('invalid input is rejected without partial writes', async () => {
    const { db, repo } = await sqliteRepo();
    const bad = { ...fixtures.card[0], codeFormat: 'nfc' } as unknown as Item;
    await expect(repo.save(bad)).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    });
    expect(await db.execute('SELECT * FROM items')).toEqual([]);
    expect(await db.execute('SELECT * FROM cards')).toEqual([]);
  });
});

describe.each(implementations)(
  '%s reminder scheduling fields',
  (_name, create) => {
    test.each([
      'once',
      'daily',
      'weekly',
      'monthly',
      'yearly',
      'interval',
    ] as const)(
      '%s round-trips with its local start, interval and completion',
      async repeat => {
        const repo = await create();
        const r: Item = {
          id: `r-${repeat}`,
          type: 'reminder',
          title: 'R',
          dueAt: '2026-11-02T07:30:00.000Z',
          localStart: '2026-11-02T08:30',
          repeat,
          intervalMinutes: repeat === 'interval' ? 120 : null,
          notes: 'd',
          completed: false,
          pinned: false,
          createdAt: T0,
          updatedAt: T0,
        };
        await repo.save(r);
        expect(await repo.listAll()).toEqual([r]);
        await repo.save({ ...r, completed: true, updatedAt: T1 });
        expect((await repo.listAll())[0]).toMatchObject({ completed: true });
      },
    );
  },
);

describe('settings for notifications', () => {
  test('privacy and permission flags persist in SQLite', async () => {
    const { db } = await sqliteRepo();
    const settings = new SqliteSettingsRepository(db);
    expect(await settings.get('notifications.showDetails')).toBeNull();
    await settings.set('notifications.showDetails', true);
    await settings.set('notifications.permissionRequested', true);
    const reopened = new SqliteSettingsRepository(db);
    expect(await reopened.get('notifications.showDetails')).toBe(true);
    expect(await reopened.get('notifications.permissionRequested')).toBe(true);
  });
});
