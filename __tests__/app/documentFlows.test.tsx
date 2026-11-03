import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import type {
  Attachment,
  AttachmentMimeType,
  DocumentItem,
  DocumentKind,
} from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
import {
  hasText,
  openTab,
  pressLabel,
  pressText,
  settle,
  texts,
  typeInto,
} from '../../test-utils/appHarness';
import { fakeAttachments } from '../../test-utils/fakeAttachments';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// The app's real storage stack on a plain SQLite database (see
// organizerFlows.test.tsx); attachment files are the in-memory fake.
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
      initialTheme: 'system',
    };
  },
}));

const ISO = (d: string) => new Date(d).toISOString();

let fileNo = 0;
/** A file as the native module reports it after import. */
const picked = (
  fileName: string,
  mimeType: AttachmentMimeType = 'application/pdf',
  sizeBytes = 1_258_291, // 1.2 MB
) => ({
  id: `01a1a0dd-991f-783c-9531-3fab9ef4${String(++fileNo).padStart(4, '0')}`,
  fileName,
  mimeType,
  sizeBytes,
  sha256: 'd'.repeat(64),
  formatVersion: 1,
});
const stamped = (p: ReturnType<typeof picked>): Attachment => ({
  ...p,
  createdAt: ISO('2026-11-01T09:00:00Z'),
});

const manual = stamped(picked('manual.pdf'));
const photo = stamped(picked('box.jpg', 'image/jpeg', 348_160)); // 340 KB

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
  notes: 'Paid by card',
  attachments: [],
  pinned: false,
  createdAt: ISO('2026-10-12T09:00:00Z'),
  updatedAt: ISO('2026-10-12T09:00:00Z'),
};

const warranty: DocumentItem = {
  id: 'doc-w',
  type: 'document',
  kind: 'warranty',
  title: 'Washing machine',
  merchant: 'Home Electro',
  date: '2026-01-10',
  expiresOn: '2028-01-10',
  amount: 499,
  currency: 'EUR',
  notes: '',
  attachments: [manual, photo],
  pinned: false,
  createdAt: ISO('2026-01-10T09:00:00Z'),
  updatedAt: ISO('2026-01-10T09:00:00Z'),
};

const stored = () => new SqliteItemRepository(serializeDatabase(mockDb));
const storedDoc = async (id: string) =>
  (await stored().listAll()).find(i => i.id === id) as DocumentItem;
const storedIds = async (id: string) =>
  (await storedDoc(id)).attachments.map(a => a.id);

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

async function openDoc(title: string) {
  await openTab(app, 'Documents');
  await pressText(app, title);
}

async function editDoc(title: string) {
  await openDoc(title);
  await pressLabel(app, 'Edit');
}

async function pick(button: string, next: typeof fakeAttachments.nextPick) {
  fakeAttachments.nextPick = next;
  await pressText(app, button);
  await settle();
}

async function fileOption(fileName: string, option: string) {
  await pressLabel(app, `Options for ${fileName}`);
  await pressText(app, option);
  await settle();
}

/** File names in the order the current screen shows them. */
const shownFiles = (names: string[]) =>
  texts(app).filter(t => names.includes(t));

async function discard() {
  await pressLabel(app, 'Cancel');
  expect(hasText(app, 'Discard changes?')).toBe(true);
  await pressText(app, 'Discard');
  await settle();
}

beforeEach(async () => {
  fakeAttachments.reset();
  fakeAttachments.files.add(manual.id);
  fakeAttachments.files.add(photo.id);
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await stored().save(receipt);
  await stored().save(warranty);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => app?.unmount());
});

describe('document details', () => {
  test('a document without attachments works as before', async () => {
    await launch();
    await openDoc('Groceries');
    expect(hasText(app, 'Corner Shop')).toBe(true);
    expect(hasText(app, 'Attachments')).toBe(false);
    expect(hasText(app, 'Attachment')).toBe(false);

    await pressLabel(app, 'Edit');
    expect(hasText(app, 'Add files')).toBe(true);
    await typeInto(app, 'Notes', 'Paid by card, kept receipt');
    await pressText(app, 'Save');

    expect(await storedDoc('doc-r')).toEqual({
      ...receipt,
      notes: 'Paid by card, kept receipt',
      updatedAt: expect.any(String),
    });
    expect(fakeAttachments.picks).toEqual([]);
  });

  test('lists attachments in order with their type and size, without opening them', async () => {
    await launch();
    await openDoc('Washing machine');
    expect(hasText(app, 'Attachments')).toBe(true);
    expect(shownFiles(['manual.pdf', 'box.jpg'])).toEqual([
      'manual.pdf',
      'box.jpg',
    ]);
    expect(hasText(app, 'PDF · 1.2 MB')).toBe(true);
    expect(hasText(app, 'JPEG image · 340 KB')).toBe(true);
    expect(fakeAttachments.views.size).toBe(0);
  });
});

describe('document editor', () => {
  test.each<[DocumentKind, string]>([
    ['receipt', 'Receipt'],
    ['warranty', 'Warranty'],
    ['image', 'Image'],
    ['document', 'Document'],
  ])(
    'a new %s keeps photos and PDFs in order across a restart',
    async (kind, chip) => {
      await launch();
      await openTab(app, 'Documents');
      await pressLabel(app, 'New document');
      await pressText(app, chip);
      await typeInto(app, 'Title', `New ${kind}`);

      const pdf = picked('scan.pdf');
      const jpg = picked('front.jpg', 'image/jpeg');
      const png = picked('back.png', 'image/png');
      await pick('Add files', { imported: [pdf] });
      await pick('Add photos', { imported: [jpg, png] });
      expect(fakeAttachments.picks).toEqual([
        { source: 'files', imagesOnly: false, maxCount: 10 },
        { source: 'photos', imagesOnly: true, maxCount: 9 },
      ]);
      expect(shownFiles(['scan.pdf', 'front.jpg', 'back.png'])).toEqual([
        'scan.pdf',
        'front.jpg',
        'back.png',
      ]);
      await pressText(app, 'Save');

      const doc = (await stored().listAll()).find(
        i => i.title === `New ${kind}`,
      ) as DocumentItem;
      expect(doc.kind).toBe(kind);
      expect(doc.attachments.map(a => [a.id, a.fileName, a.mimeType])).toEqual([
        [pdf.id, 'scan.pdf', 'application/pdf'],
        [jpg.id, 'front.jpg', 'image/jpeg'],
        [png.id, 'back.png', 'image/png'],
      ]);
      expect(fakeAttachments.deleted).toEqual([]);

      await restart();
      await openDoc(`New ${kind}`);
      expect(shownFiles(['scan.pdf', 'front.jpg', 'back.png'])).toEqual([
        'scan.pdf',
        'front.jpg',
        'back.png',
      ]);
      expect(hasText(app, 'PNG image · 1.2 MB')).toBe(true);
    },
  );

  test('reordering is saved and keeps every other field', async () => {
    await launch();
    await editDoc('Washing machine');
    await pressLabel(app, 'Options for manual.pdf');
    // The first file can't move up.
    await expect(pressText(app, 'Move up')).rejects.toThrow('disabled');
    await pressText(app, 'Move down');
    await settle();
    expect(shownFiles(['manual.pdf', 'box.jpg'])).toEqual([
      'box.jpg',
      'manual.pdf',
    ]);
    await pressText(app, 'Save');

    expect(await storedDoc('doc-w')).toEqual({
      ...warranty,
      attachments: [photo, manual],
      updatedAt: expect.any(String),
    });
    expect(fakeAttachments.deleted).toEqual([]);

    await restart();
    await openDoc('Washing machine');
    expect(shownFiles(['manual.pdf', 'box.jpg'])).toEqual([
      'box.jpg',
      'manual.pdf',
    ]);
  });

  test('replacing keeps the position and deletes the old file only after saving', async () => {
    await launch();
    await editDoc('Washing machine');
    const first = picked('manual-v2.pdf');
    const second = picked('manual-v3.pdf');
    fakeAttachments.nextPick = { imported: [first] };
    await fileOption('manual.pdf', 'Replace');
    expect(fakeAttachments.picks).toEqual([
      { source: 'files', imagesOnly: false, maxCount: 1 },
    ]);
    fakeAttachments.nextPick = { imported: [second] };
    await fileOption('manual-v2.pdf', 'Replace');
    // `first` was never saved, so it goes now; the stored file stays.
    expect(fakeAttachments.deleted).toEqual([first.id]);
    expect(fakeAttachments.files.has(manual.id)).toBe(true);

    await pressText(app, 'Save');
    await settle();
    expect(await storedIds('doc-w')).toEqual([second.id, photo.id]);
    expect(fakeAttachments.deleted).toEqual([first.id, manual.id]);
  });

  test('removing deletes the file only after the save commits', async () => {
    await launch();
    await editDoc('Washing machine');
    await fileOption('box.jpg', 'Remove');
    expect(hasText(app, 'box.jpg')).toBe(false);
    expect(fakeAttachments.files.has(photo.id)).toBe(true);

    await pressText(app, 'Save');
    await settle();
    expect(await storedIds('doc-w')).toEqual([manual.id]);
    expect(fakeAttachments.files.has(photo.id)).toBe(false);
    expect(fakeAttachments.files.has(manual.id)).toBe(true);
  });

  test('a failed save keeps every stored file', async () => {
    await launch();
    await editDoc('Washing machine');
    await fileOption('box.jpg', 'Remove');
    await fileOption('manual.pdf', 'Remove');
    await mockDb.execute(
      "CREATE TRIGGER no_writes BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    await pressText(app, 'Save');
    await settle();

    expect(await storedIds('doc-w')).toEqual([manual.id, photo.id]);
    expect(fakeAttachments.deleted).toEqual([]);
  });

  test('discarding deletes new files and keeps the stored ones', async () => {
    await launch();
    await editDoc('Washing machine');
    const added = picked('extra.pdf');
    const replacement = picked('new-box.jpg', 'image/jpeg');
    await pick('Add files', { imported: [added] });
    fakeAttachments.nextPick = { imported: [replacement] };
    await fileOption('box.jpg', 'Replace');
    await fileOption('manual.pdf', 'Remove');
    await discard();

    expect(fakeAttachments.deleted.sort()).toEqual(
      [added.id, replacement.id].sort(),
    );
    expect(await storedDoc('doc-w')).toEqual(warranty);
    expect(fakeAttachments.files.has(manual.id)).toBe(true);
    expect(fakeAttachments.files.has(photo.id)).toBe(true);
  });

  test('partial imports keep what worked, explain the rest and are cleaned up on discard', async () => {
    await launch();
    await editDoc('Groceries');
    const ok = picked('receipt.pdf');
    await pick('Add files', {
      imported: [ok],
      failed: [
        { fileName: 'notes.docx', code: 'UNSUPPORTED_TYPE' },
        { fileName: 'video.jpg', code: 'TOO_LARGE' },
        { fileName: 'cloud.pdf', code: 'READ_FAILED' },
      ],
    });
    expect(hasText(app, 'receipt.pdf')).toBe(true);
    expect(
      hasText(
        app,
        '“notes.docx” isn’t supported. Use a photo (JPEG, PNG, WebP, HEIC) or a PDF.',
      ),
    ).toBe(true);
    expect(hasText(app, '“video.jpg” is larger than 25 MB.')).toBe(true);
    expect(hasText(app, '“cloud.pdf” couldn’t be read.')).toBe(true);

    await pick('Add files', { error: 'KEY_UNAVAILABLE' });
    expect(
      hasText(app, 'Files can’t be added: the encryption key is unavailable.'),
    ).toBe(true);
    expect(hasText(app, 'receipt.pdf')).toBe(true);

    await discard();
    expect(fakeAttachments.deleted).toEqual([ok.id]);
    expect(await storedDoc('doc-r')).toEqual(receipt);
  });

  test('at most 10 files: the picker is limited and extra picks are reported', async () => {
    const pages = Array.from({ length: 7 }, (_, i) =>
      stamped(picked(`page-${i + 1}.pdf`)),
    );
    pages.forEach(a => fakeAttachments.files.add(a.id));
    await stored().save({
      ...warranty,
      attachments: [...warranty.attachments, ...pages], // 9 files
    });
    await launch();
    await editDoc('Washing machine');

    const tenth = picked('page-10.pdf');
    await pick('Add files', { imported: [tenth], skipped: 2 });
    expect(fakeAttachments.picks).toEqual([
      { source: 'files', imagesOnly: false, maxCount: 1 },
    ]);
    expect(
      hasText(
        app,
        '2 files weren’t added: a document can have at most 10 attachments.',
      ),
    ).toBe(true);
    expect(
      hasText(app, '10 of 10 files attached. Remove one to add another.'),
    ).toBe(true);
    await expect(pressText(app, 'Add files')).rejects.toThrow('disabled');
    await expect(pressText(app, 'Add photos')).rejects.toThrow('disabled');

    await pressText(app, 'Save');
    expect(await storedIds('doc-w')).toHaveLength(10);

    // Removing one allows another pick again.
    await pressLabel(app, 'Edit');
    await fileOption('page-10.pdf', 'Remove');
    expect(hasText(app, 'Add files')).toBe(true);
    await pick('Add photos', {});
    expect(fakeAttachments.picks[1]).toEqual({
      source: 'photos',
      imagesOnly: true,
      maxCount: 1,
    });
  });

  test('document date validation is unchanged', async () => {
    // Dates are set through pickers; seed an invalid range directly instead.
    await mockDb.execute(
      "UPDATE documents SET expires_on = '2025-01-01' WHERE item_id = 'doc-w'",
    );
    await launch();
    await editDoc('Washing machine');
    await pick('Add files', { imported: [picked('extra.pdf')] });
    await pressText(app, 'Save');
    expect(hasText(app, 'Warranty end must be after the purchase date.')).toBe(
      true,
    );
    expect((await storedDoc('doc-w')).attachments).toEqual(
      warranty.attachments,
    );
  });
});

describe('while files are still being added', () => {
  async function finishImport() {
    await ReactTestRenderer.act(async () => {
      fakeAttachments.releasePicks();
    });
    await settle();
  }

  test('Save waits for the import, then saves the files the user chose', async () => {
    await launch();
    await editDoc('Groceries');
    fakeAttachments.holdPicks = true;
    const scan = picked('scan.pdf');
    await pick('Add files', { imported: [scan] });

    expect(hasText(app, 'Adding files…')).toBe(true);
    await expect(pressText(app, 'Save')).rejects.toThrow('disabled');
    expect(await storedDoc('doc-r')).toEqual(receipt);

    await finishImport();
    expect(hasText(app, 'Adding files…')).toBe(false);
    expect(hasText(app, 'scan.pdf')).toBe(true);
    await pressText(app, 'Save');
    expect(await storedIds('doc-r')).toEqual([scan.id]);
    expect(fakeAttachments.deleted).toEqual([]);
  });

  test('no second selection can start while one is running', async () => {
    await launch();
    await editDoc('Washing machine');
    fakeAttachments.holdPicks = true;
    await pick('Add photos', { imported: [picked('a.jpg', 'image/jpeg')] });
    await expect(pressText(app, 'Add files')).rejects.toThrow('disabled');
    await expect(pressText(app, 'Add photos')).rejects.toThrow('disabled');
    // The file menu doesn't open either.
    await pressLabel(app, 'Options for manual.pdf');
    expect(hasText(app, 'Move up')).toBe(false);
    expect(fakeAttachments.picks).toHaveLength(1);

    await finishImport();
    fakeAttachments.holdPicks = false;
    await pick('Add files', { imported: [picked('b.pdf')] });
    expect(fakeAttachments.picks).toHaveLength(2);
    await pressText(app, 'Save');
    expect(await storedIds('doc-w')).toHaveLength(4);
  });

  test('a failed import unblocks Save and changes nothing', async () => {
    await launch();
    await editDoc('Groceries');
    fakeAttachments.holdPicks = true;
    await pick('Add files', {
      failed: [{ fileName: 'big.pdf', code: 'TOO_LARGE' }],
    });
    await expect(pressText(app, 'Save')).rejects.toThrow('disabled');
    await finishImport();
    expect(hasText(app, '“big.pdf” is larger than 25 MB.')).toBe(true);
    await typeInto(app, 'Notes', 'Kept');
    await pressText(app, 'Save');
    expect(await storedDoc('doc-r')).toEqual({
      ...receipt,
      notes: 'Kept',
      updatedAt: expect.any(String),
    });
  });

  test('leaving the editor during an import deletes the files when they arrive', async () => {
    await launch();
    await editDoc('Groceries');
    fakeAttachments.holdPicks = true;
    const late = picked('late.pdf');
    await pick('Add files', { imported: [late] });
    await typeInto(app, 'Notes', 'Changed');
    await discard();
    expect(hasText(app, 'Corner Shop')).toBe(true);

    await finishImport();
    expect(fakeAttachments.deleted).toEqual([late.id]);
    expect(await storedDoc('doc-r')).toEqual(receipt);
  });
});
