import React from 'react';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import App from '../../App';
import type { DocumentItem } from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase, SqlValue } from '../../src/storage/sql';
import {
  hasText,
  openTab,
  pressLabel,
  pressText,
  settle,
  typeInto,
} from '../../test-utils/appHarness';
import { fakeAttachments } from '../../test-utils/fakeAttachments';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// The editor leaves only once its write is stored (audit V5). The app's real
// storage stack on plain SQLite; statements matching `mockHold` wait for it.
let mockDb: SqlDatabase;
let mockHold: { pattern: RegExp; until: Promise<void> } | null = null;
/** Every item row written, in order. */
let mockItemWrites: string[] = [];

function mockHolding(db: SqlDatabase): SqlDatabase {
  const executor = (target: { execute: SqlDatabase['execute'] }) => ({
    async execute(sql: string, params?: SqlValue[]) {
      const hold = mockHold;
      if (hold && hold.pattern.test(sql)) {
        mockHold = null;
        await hold.until;
      }
      if (/^\s*INSERT INTO items/i.test(sql)) {
        mockItemWrites.push(String(params?.[0]));
      }
      return target.execute(sql, params);
    },
  });
  return {
    ...executor(db),
    transaction: (fn, options) =>
      db.transaction(tx => fn(executor(tx)), options),
    close: () => db.close(),
  };
}

jest.mock('../../src/storage/openStorage', () => ({
  openStorage: async () => {
    const {
      serializeDatabase: serialize,
    } = require('../../src/storage/serialDatabase');
    const db = serialize(mockHolding(mockDb));
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
      initialTheme: 'system',
    };
  },
}));

const receipt: DocumentItem = {
  id: 'doc-r',
  type: 'document',
  kind: 'receipt',
  title: 'Groceries',
  merchant: 'Corner Shop',
  date: '2026-10-12',
  expiresOn: null,
  amount: 24.9,
  currency: 'EUR',
  notes: '',
  attachments: [],
  pinned: false,
  createdAt: '2026-10-12T09:00:00.000Z',
  updatedAt: '2026-10-12T09:00:00.000Z',
};

const scan = {
  id: '01a1a0dd-991f-783c-9531-3fab9ef49901',
  fileName: 'scan.pdf',
  mimeType: 'application/pdf' as const,
  sizeBytes: 1000,
  sha256: 'd'.repeat(64),
  formatVersion: 1,
};

const stored = () => new SqliteItemRepository(serializeDatabase(mockDb));

let app: ReactTestRenderer.ReactTestRenderer;

async function launch() {
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await settle();
}

function gate() {
  let release!: () => void;
  const until = new Promise<void>(resolve => (release = resolve));
  return { until, release };
}

/** Holds the next statement matching `pattern` until released. */
function holdWrite(pattern: RegExp) {
  const g = gate();
  mockHold = { pattern, until: g.until };
  return g.release;
}

const failWrites = (on: 'INSERT' | 'UPDATE') =>
  mockDb.execute(
    `CREATE TRIGGER no_writes BEFORE ${on} ON items BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
  );
const allowWrites = () => mockDb.execute('DROP TRIGGER no_writes');

/** The value of the editor's input with this label. */
function inputValue(label: string): string {
  const inputs = app.root.findAll(
    n =>
      (n.type as unknown as string) === 'TextInput' &&
      n.props.accessibilityLabel === label,
  );
  return inputs[inputs.length - 1].props.value;
}

/** The Save button's handler, to press it twice before React re-renders. */
function saveHandler(): () => void {
  const label = app.root
    .findAll(n => (n.type as unknown as string) === 'Text')
    .filter(n => ([] as unknown[]).concat(n.props.children).includes('Save'))
    .pop()!;
  let node: ReactTestInstance | null = label;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node!.props.onPress;
}

async function newNote(title: string) {
  await openTab(app, 'Notes');
  await pressLabel(app, 'New note');
  await typeInto(app, 'Title', title);
  await typeInto(app, 'Note', 'Milk, bread');
}

async function addScanToGroceries() {
  await openTab(app, 'Documents');
  await pressText(app, 'Groceries');
  await pressLabel(app, 'Edit');
  fakeAttachments.nextPick = { imported: [scan] };
  await pressText(app, 'Add files');
  await settle();
  expect(hasText(app, 'scan.pdf')).toBe(true);
}

beforeEach(async () => {
  fakeAttachments.reset();
  mockHold = null;
  mockItemWrites = [];
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await stored().save(receipt);
  mockItemWrites = [];
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => app?.unmount());
});

describe('the editor leaves only once its item is stored (V5)', () => {
  test('a successful save waits for the write, then leaves', async () => {
    await launch();
    await newNote('Shopping list');
    const release = holdWrite(/^\s*INSERT INTO items/i);

    await pressText(app, 'Save');
    await settle();
    // Still editing while the write runs; Save can't be pressed again.
    expect(hasText(app, 'New note')).toBe(true);
    await expect(pressText(app, 'Save')).rejects.toThrow('disabled');
    expect(
      (await stored().listAll()).some(i => i.title === 'Shopping list'),
    ).toBe(false);

    expect(mockHold).toBeNull(); // the write reached the hold
    release();
    await settle();
    expect(hasText(app, 'New note')).toBe(false);
    expect(hasText(app, 'Shopping list')).toBe(true);
    expect(
      (await stored().listAll()).some(i => i.title === 'Shopping list'),
    ).toBe(true);
  });

  test('a failed save keeps the editor open with every value, and can be retried', async () => {
    await launch();
    await newNote('Will fail first');
    await failWrites('INSERT');

    await pressText(app, 'Save');
    await settle();

    expect(hasText(app, 'Couldn’t save your change')).toBe(true);
    await pressText(app, 'OK');
    expect(hasText(app, 'New note')).toBe(true);
    expect(inputValue('Title')).toBe('Will fail first');
    expect(inputValue('Note')).toBe('Milk, bread');
    expect(await stored().listAll()).toEqual([receipt]);

    await allowWrites();
    await pressText(app, 'Save');
    await settle();
    expect(hasText(app, 'New note')).toBe(false);
    const saved = (await stored().listAll()).find(
      i => i.title === 'Will fail first',
    );
    expect(saved).toMatchObject({ type: 'note', body: 'Milk, bread' });
  });

  test('pressing Save twice writes the item once', async () => {
    await launch();
    await newNote('Once');
    const release = holdWrite(/^\s*INSERT INTO items/i);
    const press = saveHandler();

    await ReactTestRenderer.act(async () => {
      press();
      press();
    });
    release();
    await settle();

    expect(mockItemWrites).toHaveLength(1);
    expect(
      (await stored().listAll()).filter(i => i.title === 'Once'),
    ).toHaveLength(1);
  });

  test('leaving is blocked while the write runs', async () => {
    await launch();
    await newNote('Stay');
    const release = holdWrite(/^\s*INSERT INTO items/i);
    await pressText(app, 'Save');
    await settle();

    await pressLabel(app, 'Cancel');
    expect(hasText(app, 'Discard changes?')).toBe(false);
    expect(hasText(app, 'New note')).toBe(true);

    release();
    await settle();
    expect(hasText(app, 'New note')).toBe(false);
    expect((await stored().listAll()).some(i => i.title === 'Stay')).toBe(true);
  });
});

describe('draft attachment files and a failed save', () => {
  test('a failed save keeps the newly added file; a retry saves it', async () => {
    await launch();
    await addScanToGroceries();
    await failWrites('UPDATE');

    await pressText(app, 'Save');
    await settle();
    await pressText(app, 'OK');

    expect(fakeAttachments.deleted).toEqual([]);
    expect(fakeAttachments.files.has(scan.id)).toBe(true);
    expect(hasText(app, 'scan.pdf')).toBe(true);
    expect(((await stored().listAll())[0] as DocumentItem).attachments).toEqual(
      [],
    );

    await allowWrites();
    await pressText(app, 'Save');
    await settle();
    const doc = (await stored().listAll())[0] as DocumentItem;
    expect(doc.attachments.map(a => a.id)).toEqual([scan.id]);
    expect(fakeAttachments.deleted).toEqual([]);
  });

  test('after a failed save the file is the editor’s again: discarding deletes it', async () => {
    await launch();
    await addScanToGroceries();
    await failWrites('UPDATE');
    await pressText(app, 'Save');
    await settle();
    await pressText(app, 'OK');

    await pressLabel(app, 'Cancel');
    await pressText(app, 'Discard');
    await settle();

    expect(fakeAttachments.deleted).toEqual([scan.id]);
    expect(((await stored().listAll())[0] as DocumentItem).attachments).toEqual(
      [],
    );
  });

  test('a successful save keeps the file and deletes nothing', async () => {
    await launch();
    await addScanToGroceries();
    // Item rows are written as an upsert.
    const release = holdWrite(/^\s*INSERT INTO items/i);
    await pressText(app, 'Save');
    await settle();
    // Saving: the write is held, and the file already belongs to the item.
    expect(mockHold).toBeNull();
    expect(hasText(app, 'Edit document')).toBe(true);
    expect(fakeAttachments.deleted).toEqual([]);
    release();
    await settle();

    const doc = (await stored().listAll())[0] as DocumentItem;
    expect(doc.attachments.map(a => a.id)).toEqual([scan.id]);
    expect(fakeAttachments.deleted).toEqual([]);
    expect(fakeAttachments.files.has(scan.id)).toBe(true);
  });
});
