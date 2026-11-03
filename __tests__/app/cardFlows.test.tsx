import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Barcode, QrCode } from 'lucide-react-native';
import App from '../../App';
import type { Attachment, LoyaltyCard } from '../../src/data/types';
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
/** A photo as the native module reports it after import. */
const photo = (name = `IMG_${++fileNo}.jpg`) => ({
  id: `01a1a0dd-991f-783c-9531-3fab9ef4${String(++fileNo).padStart(4, '0')}`,
  fileName: name,
  mimeType: 'image/jpeg',
  sizeBytes: 120_000,
  sha256: 'c'.repeat(64),
  formatVersion: 1,
});
const stamped = (p: ReturnType<typeof photo>): Attachment => ({
  ...p,
  mimeType: 'image/jpeg',
  createdAt: ISO('2026-11-01T09:00:00Z'),
});

const storedFront = stamped(photo('front.jpg'));

const plainCard: LoyaltyCard = {
  id: 'card-1',
  type: 'card',
  title: 'Book Corner',
  issuer: '',
  cardNumber: '99881122',
  codeFormat: 'barcode',
  holderName: 'Ana',
  notes: '',
  frontImage: null,
  backImage: null,
  pinned: false,
  createdAt: ISO('2026-10-03T09:00:00Z'),
  updatedAt: ISO('2026-10-18T09:00:00Z'),
};

const photoCard: LoyaltyCard = {
  ...plainCard,
  id: 'card-2',
  title: 'Greenleaf Rewards',
  issuer: 'Greenleaf Market',
  cardNumber: '4400112233',
  codeFormat: 'qr',
  frontImage: storedFront,
  createdAt: ISO('2026-10-04T09:00:00Z'),
  updatedAt: ISO('2026-10-19T09:00:00Z'),
};

const stored = () => new SqliteItemRepository(serializeDatabase(mockDb));
const storedCard = async (id: string) =>
  (await stored().listAll()).find(i => i.id === id) as LoyaltyCard;

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

/** Host <Image> nodes with this accessibility label. */
const images = (label: string) =>
  app.root.findAll(
    n =>
      (n.type as unknown) === 'Image' && n.props.accessibilityLabel === label,
  );

const codeGlyphs = () =>
  app.root.findAll(
    n => (n.type as unknown) === Barcode || (n.type as unknown) === QrCode,
  );

async function openCard(title: string) {
  await openTab(app, 'Cards');
  await pressText(app, title);
}

async function pick(label: string, next: typeof fakeAttachments.nextPick) {
  fakeAttachments.nextPick = next;
  await pressLabel(app, label);
  await settle();
}

beforeEach(async () => {
  fakeAttachments.reset();
  fakeAttachments.files.add(storedFront.id);
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await stored().save(plainCard);
  await stored().save(photoCard);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => app?.unmount());
});

describe('card details', () => {
  test('an existing card without photos shows its number as plain text, no code', async () => {
    await launch();
    await openCard('Book Corner');

    expect(hasText(app, '9988 1122')).toBe(true);
    expect(hasText(app, 'Card number · No barcode saved')).toBe(true);
    expect(hasText(app, 'Cardholder')).toBe(true);
    expect(hasText(app, 'Code type')).toBe(false);
    expect(hasText(app, 'Barcode')).toBe(false);
    expect(hasText(app, 'Front')).toBe(false);
    expect(codeGlyphs()).toHaveLength(0);
    expect(fakeAttachments.views.size).toBe(0);
  });

  test('shows the issuer and a decrypted photo while open, then deletes the copy', async () => {
    await launch();
    await openCard('Greenleaf Rewards');

    expect(hasText(app, 'Issuer')).toBe(true);
    expect(hasText(app, 'Greenleaf Market')).toBe(true);
    const [front] = images('Photo of the front of the card');
    expect(front.props.source).toEqual({
      uri: [...fakeAttachments.views.keys()][0],
    });
    expect([...fakeAttachments.views.values()]).toEqual([storedFront.id]);
    expect(images('Photo of the back of the card')).toHaveLength(0);
    expect(codeGlyphs()).toHaveLength(0);

    await pressLabel(app, 'Back');
    expect(fakeAttachments.views.size).toBe(0);
  });

  test('a missing or damaged photo is reported and the rest of the card works', async () => {
    fakeAttachments.files.delete(storedFront.id);
    await launch();
    await openCard('Greenleaf Rewards');
    expect(hasText(app, 'Photo file is missing')).toBe(true);
    expect(hasText(app, '4400 1122 33')).toBe(true);

    await restart();
    fakeAttachments.files.add(storedFront.id);
    fakeAttachments.viewErrors.set(storedFront.id, 'DAMAGED');
    await openCard('Greenleaf Rewards');
    expect(hasText(app, 'Photo file is damaged')).toBe(true);
  });
});

describe('card editor', () => {
  test('creates a card with issuer and both photos, kept across a restart', async () => {
    await launch();
    await openTab(app, 'Cards');
    await pressLabel(app, 'New card');
    expect(hasText(app, 'Code type')).toBe(false);

    await typeInto(app, 'Card name', 'City Pool');
    await typeInto(app, 'Issuer', '  City Sports Centre ');
    await typeInto(app, 'Card number', '55 66 77');
    const front = photo();
    const back = photo();
    await pick('Add front photo', { imported: [front] });
    await pick('Add back photo', { imported: [back] });
    expect(fakeAttachments.picks).toEqual([
      { source: 'photos', imagesOnly: true, maxCount: 1 },
      { source: 'photos', imagesOnly: true, maxCount: 1 },
    ]);
    expect(images('Photo of the front of the card')).toHaveLength(1);
    await pressText(app, 'Save');

    const card = (await stored().listAll()).find(
      i => i.title === 'City Pool',
    ) as LoyaltyCard;
    expect(card).toMatchObject({
      issuer: 'City Sports Centre',
      cardNumber: '55 66 77',
      codeFormat: 'barcode',
      frontImage: { id: front.id, mimeType: 'image/jpeg' },
      backImage: { id: back.id },
    });
    expect(fakeAttachments.deleted).toEqual([]);
    expect(fakeAttachments.files.has(front.id)).toBe(true);
    expect(fakeAttachments.files.has(back.id)).toBe(true);

    await restart();
    await openCard('City Pool');
    expect(hasText(app, 'City Sports Centre')).toBe(true);
    expect(images('Photo of the front of the card')).toHaveLength(1);
    expect(images('Photo of the back of the card')).toHaveLength(1);
  });

  test('replacing a photo deletes unsaved picks at once and the old file only after saving', async () => {
    await launch();
    await openCard('Greenleaf Rewards');
    await pressLabel(app, 'Edit');

    const first = photo();
    const second = photo();
    await pick('Replace front photo', { imported: [first] });
    expect(fakeAttachments.deleted).toEqual([]);
    await pick('Replace front photo', { imported: [second] });
    // `first` was never saved, so it goes now; the stored photo stays.
    expect(fakeAttachments.deleted).toEqual([first.id]);
    expect(fakeAttachments.files.has(storedFront.id)).toBe(true);

    await pressText(app, 'Save');
    await settle();
    expect((await storedCard('card-2')).frontImage?.id).toBe(second.id);
    expect(fakeAttachments.deleted).toEqual([first.id, storedFront.id]);
    expect([...fakeAttachments.files]).toEqual([second.id]);
  });

  test('removing a photo deletes its file only after the save commits', async () => {
    await launch();
    await openCard('Greenleaf Rewards');
    await pressLabel(app, 'Edit');
    await pressLabel(app, 'Remove front photo');
    expect(hasText(app, 'Add front')).toBe(true);
    expect(fakeAttachments.files.has(storedFront.id)).toBe(true);

    await pressText(app, 'Save');
    await settle();
    expect((await storedCard('card-2')).frontImage).toBeNull();
    expect(fakeAttachments.files.has(storedFront.id)).toBe(false);
  });

  test('a failed save keeps the stored photo file', async () => {
    await launch();
    await openCard('Greenleaf Rewards');
    await pressLabel(app, 'Edit');
    await pick('Replace front photo', { imported: [photo()] });
    await mockDb.execute(
      "CREATE TRIGGER no_writes BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    await pressText(app, 'Save');
    await settle();

    expect((await storedCard('card-2')).frontImage?.id).toBe(storedFront.id);
    expect(fakeAttachments.files.has(storedFront.id)).toBe(true);
    expect(fakeAttachments.deleted).not.toContain(storedFront.id);
  });

  test('discarding the editor deletes newly picked files and keeps stored ones', async () => {
    await launch();
    await openCard('Greenleaf Rewards');
    await pressLabel(app, 'Edit');
    const back = photo();
    const front = photo();
    await pick('Add back photo', { imported: [back] });
    await pick('Replace front photo', { imported: [front] });

    await pressLabel(app, 'Cancel');
    expect(hasText(app, 'Discard changes?')).toBe(true);
    await pressText(app, 'Discard');
    await settle();

    expect(fakeAttachments.deleted.sort()).toEqual([back.id, front.id].sort());
    expect([...fakeAttachments.files]).toEqual([storedFront.id]);
    expect(await storedCard('card-2')).toEqual(photoCard);
  });

  test('removing a stored photo and discarding keeps it', async () => {
    await launch();
    await openCard('Greenleaf Rewards');
    await pressLabel(app, 'Edit');
    await pressLabel(app, 'Remove front photo');
    await pressLabel(app, 'Cancel');
    await pressText(app, 'Discard');
    await settle();

    expect(fakeAttachments.deleted).toEqual([]);
    expect((await storedCard('card-2')).frontImage).toEqual(storedFront);
  });

  test('failed picks are explained and change nothing', async () => {
    await launch();
    await openCard('Book Corner');
    await pressLabel(app, 'Edit');

    await pick('Add front photo', {
      failed: [{ fileName: 'statement.pdf', code: 'UNSUPPORTED_TYPE' }],
    });
    expect(
      hasText(
        app,
        '“statement.pdf” isn’t a supported photo. Use JPEG, PNG, WebP or HEIC.',
      ),
    ).toBe(true);
    expect(hasText(app, 'Add front')).toBe(true);

    await pick('Add front photo', {
      failed: [{ fileName: 'huge.jpg', code: 'TOO_LARGE' }],
    });
    expect(hasText(app, '“huge.jpg” is larger than 25 MB.')).toBe(true);

    await pick('Add front photo', { error: 'KEY_UNAVAILABLE' });
    expect(
      hasText(app, 'Photos can’t be added: the encryption key is unavailable.'),
    ).toBe(true);

    // Cancelling the picker clears the message and adds nothing.
    await pick('Add front photo', {});
    expect(hasText(app, '“huge.jpg” is larger than 25 MB.')).toBe(false);
    await pressText(app, 'Save');
    expect(await storedCard('card-1')).toMatchObject({
      frontImage: null,
      backImage: null,
    });
  });

  test('editing keeps the stored code type, which the editor no longer shows', async () => {
    await launch();
    await openCard('Greenleaf Rewards');
    await pressLabel(app, 'Edit');
    expect(hasText(app, 'Code type')).toBe(false);
    expect(hasText(app, 'QR code')).toBe(false);
    await typeInto(app, 'Issuer', 'Greenleaf');
    await pressText(app, 'Save');

    expect(await storedCard('card-2')).toMatchObject({
      issuer: 'Greenleaf',
      codeFormat: 'qr',
      frontImage: storedFront,
    });
  });

  test('Save waits while a photo is being added', async () => {
    await launch();
    await openCard('Book Corner');
    await pressLabel(app, 'Edit');
    fakeAttachments.holdPicks = true;
    const front = photo();
    await pick('Add front photo', { imported: [front] });
    expect(hasText(app, 'Adding photo…')).toBe(true);
    await expect(pressText(app, 'Save')).rejects.toThrow('disabled');

    await ReactTestRenderer.act(async () => fakeAttachments.releasePicks());
    await settle();
    await pressText(app, 'Save');
    expect((await storedCard('card-1')).frontImage?.id).toBe(front.id);
  });

  test('cards list the issuer with the masked number', async () => {
    await launch();
    await openTab(app, 'Cards');
    expect(hasText(app, 'Greenleaf Market · •••• 2233')).toBe(true);
  });
});
