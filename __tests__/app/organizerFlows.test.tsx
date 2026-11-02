import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import type { Item } from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteSettingsRepository } from '../../src/storage/SettingsRepository';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
import {
  hasText,
  isSelected,
  openTab,
  pressLabel,
  pressText,
  settle,
  texts,
  typeInto,
} from '../../test-utils/appHarness';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// The app's real storage stack (repositories + serialized connection) on a
// plain SQLite database; only the SQLCipher open step is replaced.
let mockDb: SqlDatabase;
jest.mock('../../src/storage/openStorage', () => ({
  openStorage: async () => {
    const {
      serializeDatabase: serialize,
    } = require('../../src/storage/serialDatabase');
    const db = serialize(mockDb);
    const items =
      new (require('../../src/storage/SqliteItemRepository').SqliteItemRepository)(
        db,
      );
    const settings =
      new (require('../../src/storage/SettingsRepository').SqliteSettingsRepository)(
        db,
      );
    return {
      items,
      settings,
      initialItems: await items.listAll(),
      initialTheme: (await settings.get('theme.preference')) ?? 'system',
    };
  },
}));

const ISO = (d: string) => new Date(d).toISOString();
const soon = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

const seed: Item[] = [
  {
    id: 'note-1',
    type: 'note',
    title: 'Garage code',
    body: 'Door 4471',
    pinned: true,
    createdAt: ISO('2026-10-01T09:00:00Z'),
    updatedAt: ISO('2026-10-20T09:00:00Z'),
  },
  {
    id: 'rem-1',
    type: 'reminder',
    title: 'Pay rent',
    dueAt: soon(),
    localStart: '2026-11-02T10:00',
    intervalMinutes: null,
    repeat: 'once',
    notes: 'Bank transfer',
    completed: false,
    pinned: false,
    createdAt: ISO('2026-10-02T09:00:00Z'),
    updatedAt: ISO('2026-10-02T09:00:00Z'),
  },
  {
    id: 'rem-2',
    type: 'reminder',
    title: 'Old errand',
    dueAt: ISO('2026-09-01T09:00:00Z'),
    localStart: '2026-11-02T10:00',
    intervalMinutes: null,
    repeat: 'once',
    notes: '',
    completed: true,
    pinned: false,
    createdAt: ISO('2026-08-01T09:00:00Z'),
    updatedAt: ISO('2026-09-01T09:00:00Z'),
  },
  {
    id: 'card-1',
    type: 'card',
    title: 'Book Corner',
    cardNumber: '99881122',
    codeFormat: 'barcode',
    holderName: 'Ana',
    notes: '',
    pinned: false,
    createdAt: ISO('2026-10-03T09:00:00Z'),
    updatedAt: ISO('2026-10-18T09:00:00Z'),
  },
  {
    id: 'doc-1',
    type: 'document',
    kind: 'warranty',
    title: 'Fridge',
    merchant: 'Cold Store',
    date: '2026-01-10',
    expiresOn: '2028-01-10',
    amount: 899,
    currency: 'EUR',
    notes: '',
    attachment: null,
    pinned: false,
    createdAt: ISO('2026-10-04T09:00:00Z'),
    updatedAt: ISO('2026-10-17T09:00:00Z'),
  },
  {
    id: 'doc-2',
    type: 'document',
    kind: 'document',
    title: 'Passport',
    merchant: 'Ministry of Interior',
    date: '2024-05-01',
    expiresOn: '2034-05-01',
    amount: null,
    currency: 'EUR',
    notes: '',
    attachment: null,
    pinned: false,
    createdAt: ISO('2026-10-05T09:00:00Z'),
    updatedAt: ISO('2026-10-16T09:00:00Z'),
  },
];

/** Repository on the same database, for checking what was persisted. */
const stored = () => new SqliteItemRepository(serializeDatabase(mockDb));

let app: ReactTestRenderer.ReactTestRenderer;

async function launch() {
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await settle();
}

async function restart() {
  await ReactTestRenderer.act(async () => app.unmount());
  await launch();
}

beforeEach(async () => {
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  const repo = stored();
  for (const item of seed) {
    await repo.save(item);
  }
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => app?.unmount());
});

describe('Home', () => {
  test('shows counts and sections from stored data', async () => {
    await launch();
    const t = texts(app);
    // Counts in the overview, in tab order: 1 note, 2 reminders, 1 card, 2 documents.
    const overview = t.slice(
      t.indexOf('Search everything') + 1,
      t.indexOf('Documents') + 1,
    );
    expect(overview).toEqual([
      '1',
      'Notes',
      '2',
      'Reminders',
      '1',
      'Cards',
      '2',
      'Documents',
    ]);
    expect(hasText(app, 'Coming up')).toBe(true);
    expect(hasText(app, 'Pay rent')).toBe(true); // open reminder
    expect(hasText(app, 'Old errand')).toBe(false); // completed: not upcoming
    expect(hasText(app, 'Pinned')).toBe(true);
    expect(hasText(app, 'Garage code')).toBe(true);
    expect(hasText(app, 'Recently updated')).toBe(true);
    expect(hasText(app, 'Book Corner')).toBe(true);
    expect(hasText(app, 'Welcome to Trezor')).toBe(false);
  });

  test('shows the welcome state when the database is empty', async () => {
    const repo = stored();
    for (const item of seed) {
      await repo.delete(item.id);
    }
    await launch();
    expect(hasText(app, 'Welcome to Trezor')).toBe(true);
  });
});

describe('category tabs', () => {
  test('each tab lists its stored items and filters by category chips', async () => {
    await launch();
    await openTab(app, 'Notes');
    expect(hasText(app, 'Garage code')).toBe(true);

    await openTab(app, 'Reminders');
    expect(hasText(app, 'Pay rent')).toBe(true);
    expect(hasText(app, 'Old errand')).toBe(false);
    await pressText(app, 'Done');
    expect(hasText(app, 'Old errand')).toBe(true);
    expect(hasText(app, 'Pay rent')).toBe(false);

    await openTab(app, 'Cards');
    expect(hasText(app, 'Book Corner')).toBe(true);

    await openTab(app, 'Documents');
    expect(hasText(app, 'Fridge')).toBe(true);
    expect(hasText(app, 'Passport')).toBe(true);
    await pressText(app, 'Warranties');
    expect(isSelected(app, 'Warranties')).toBe(true);
    expect(hasText(app, 'Fridge')).toBe(true);
    expect(hasText(app, 'Passport')).toBe(false);
    await pressText(app, 'Other');
    expect(hasText(app, 'Passport')).toBe(true);
    expect(hasText(app, 'Fridge')).toBe(false);
  });
});

describe('create, edit, delete, pin', () => {
  test('creating a note persists it and survives a restart', async () => {
    await launch();
    await openTab(app, 'Notes');
    await pressLabel(app, 'New note');
    await typeInto(app, 'Title', 'Shopping list');
    await typeInto(app, 'Note', 'Milk, bread');
    await pressText(app, 'Save');
    expect(hasText(app, 'Shopping list')).toBe(true);

    const saved = (await stored().listAll()).find(
      i => i.title === 'Shopping list',
    );
    expect(saved).toMatchObject({
      type: 'note',
      body: 'Milk, bread',
      pinned: false,
    });
    expect(saved!.id).toMatch(/^[0-9a-f-]{36}$/);

    await restart();
    await openTab(app, 'Notes');
    expect(hasText(app, 'Shopping list')).toBe(true);
  });

  test('a required field blocks saving and nothing is written', async () => {
    await launch();
    await openTab(app, 'Cards');
    await pressLabel(app, 'New card');
    await typeInto(app, 'Store or card name', 'No number');
    await pressText(app, 'Save');
    expect(hasText(app, 'Enter the card number.')).toBe(true);
    expect((await stored().listAll()).map(i => i.title)).not.toContain(
      'No number',
    );
  });

  test('editing updates the stored item and its modification time', async () => {
    await launch();
    await openTab(app, 'Cards');
    await pressText(app, 'Book Corner');
    await pressLabel(app, 'Edit');
    await typeInto(app, 'Store or card name', 'Book Corner Plus');
    await typeInto(app, 'Card number', '11223344');
    await pressText(app, 'Save');
    expect(hasText(app, 'Book Corner Plus')).toBe(true);

    const card = (await stored().listAll()).find(i => i.id === 'card-1');
    expect(card).toMatchObject({
      title: 'Book Corner Plus',
      cardNumber: '11223344',
      holderName: 'Ana',
      createdAt: seed[3].createdAt,
    });
    expect(card!.updatedAt > seed[3].updatedAt).toBe(true);
  });

  test('a document expiry date is kept for non-warranty kinds', async () => {
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Passport');
    expect(hasText(app, 'Issue date')).toBe(true);
    expect(hasText(app, 'Expires on')).toBe(true);
    await pressLabel(app, 'Edit');
    await typeInto(app, 'Notes', 'Renew early');
    await pressText(app, 'Save');
    const doc = (await stored().listAll()).find(i => i.id === 'doc-2');
    expect(doc).toMatchObject({
      expiresOn: '2034-05-01',
      notes: 'Renew early',
    });
  });

  test('deleting asks for confirmation, then removes the item', async () => {
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Fridge');
    await pressLabel(app, 'Delete');
    expect(hasText(app, 'Delete document?')).toBe(true);
    await pressText(app, 'Cancel');
    expect((await stored().listAll()).map(i => i.id)).toContain('doc-1');

    await pressLabel(app, 'Delete');
    await pressText(app, 'Delete');
    expect((await stored().listAll()).map(i => i.id)).not.toContain('doc-1');
    await restart();
    await openTab(app, 'Documents');
    expect(hasText(app, 'Fridge')).toBe(false);
  });

  test('pinning persists and shows on Home after a restart', async () => {
    await launch();
    await openTab(app, 'Cards');
    await pressText(app, 'Book Corner');
    await pressLabel(app, 'Pin to Home');
    expect(
      (await stored().listAll()).find(i => i.id === 'card-1')?.pinned,
    ).toBe(true);
    // The detail and the editor reflect the current state.
    expect(hasText(app, 'Card · Pinned')).toBe(true);

    await restart();
    const t = texts(app);
    const pinnedSection = t.slice(
      t.indexOf('Pinned'),
      t.indexOf('Recently updated'),
    );
    expect(pinnedSection).toContain('Book Corner');

    await openTab(app, 'Cards');
    await pressText(app, 'Book Corner');
    await pressLabel(app, 'Unpin');
    expect(
      (await stored().listAll()).find(i => i.id === 'card-1')?.pinned,
    ).toBe(false);
  });

  test('completing a reminder moves it to Done and persists', async () => {
    await launch();
    await openTab(app, 'Reminders');
    await pressText(app, 'Pay rent');
    await pressText(app, 'Mark as done');
    expect(
      (await stored().listAll()).find(i => i.id === 'rem-1'),
    ).toMatchObject({
      completed: true,
    });
  });

  test('a failed write is reported and the stored state is shown', async () => {
    await launch();
    const spy = jest
      .spyOn(SqliteItemRepository.prototype, 'save')
      .mockRejectedValueOnce(new Error('disk full'));
    await openTab(app, 'Notes');
    await pressLabel(app, 'New note');
    await typeInto(app, 'Title', 'Will fail');
    await pressText(app, 'Save');
    await settle(50);
    expect(hasText(app, 'Couldn’t save your change')).toBe(true);
    expect(hasText(app, 'Will fail')).toBe(false);
    spy.mockRestore();
  });
});

describe('search', () => {
  test('finds items across types from storage and opens the selected one', async () => {
    await launch();
    await pressLabel(app, 'Search everything');
    await typeInto(app, 'Search everything', 'co');
    await settle(200);
    // "co": Garage code (note), Book Corner (card), Cold Store (fridge merchant)
    const t = texts(app);
    expect(t).toEqual(expect.arrayContaining(['Notes', 'Cards', 'Documents']));
    expect(t).toEqual(
      expect.arrayContaining(['Garage code', 'Book Corner', 'Fridge']),
    );
    expect(t).not.toContain('Pay rent');

    await pressText(app, 'Book Corner');
    expect(hasText(app, 'Card number')).toBe(true);
    expect(hasText(app, '9988 1122')).toBe(true);
  });

  test('shows the empty state when nothing matches', async () => {
    await launch();
    await pressLabel(app, 'Search everything');
    await typeInto(app, 'Search everything', 'zzzz');
    await settle(200);
    expect(hasText(app, 'No results')).toBe(true);
  });
});

describe('settings', () => {
  test('the theme choice persists across a restart', async () => {
    await launch();
    await pressLabel(app, 'Settings');
    await pressText(app, 'Dark');
    expect(isSelected(app, 'Dark')).toBe(true);
    await settle(50);
    expect(
      await new SqliteSettingsRepository(serializeDatabase(mockDb)).get(
        'theme.preference',
      ),
    ).toBe('dark');

    await restart();
    await pressLabel(app, 'Settings');
    expect(isSelected(app, 'Dark')).toBe(true);
  });
});
