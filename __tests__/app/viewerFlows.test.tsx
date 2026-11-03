import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import App from '../../App';
import type {
  Attachment,
  AttachmentMimeType,
  DocumentItem,
  LoyaltyCard,
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
const file = (
  fileName: string,
  mimeType: AttachmentMimeType,
  sizeBytes = 1_258_291,
): Attachment => ({
  id: `01a1a0dd-991f-783c-9531-3fab9ef4${String(++fileNo).padStart(4, '0')}`,
  fileName,
  mimeType,
  sizeBytes,
  sha256: 'e'.repeat(64),
  formatVersion: 1,
  createdAt: ISO('2026-11-01T09:00:00Z'),
});

const front = file('front.jpg', 'image/jpeg');
const back = file('back.png', 'image/png');
const invoice = file('invoice.pdf', 'application/pdf');
const box = file('box.jpg', 'image/jpeg', 348_160);
const manual = file('manual.pdf', 'application/pdf');

const card: LoyaltyCard = {
  id: 'card-1',
  type: 'card',
  title: 'Greenleaf Rewards',
  issuer: 'Greenleaf Market',
  cardNumber: '4400112233',
  codeFormat: 'barcode',
  holderName: '',
  notes: '',
  frontImage: front,
  backImage: back,
  pinned: false,
  createdAt: ISO('2026-10-03T09:00:00Z'),
  updatedAt: ISO('2026-10-18T09:00:00Z'),
};

const doc: DocumentItem = {
  id: 'doc-1',
  type: 'document',
  kind: 'warranty',
  title: 'Washing machine',
  merchant: 'Home Electro',
  date: '2026-01-10',
  expiresOn: '2028-01-10',
  amount: 499,
  currency: 'EUR',
  notes: '',
  attachments: [invoice, box, manual],
  pinned: false,
  createdAt: ISO('2026-01-10T09:00:00Z'),
  updatedAt: ISO('2026-01-10T09:00:00Z'),
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

const byTestId = (id: string) =>
  app.root.findAll(
    n => typeof n.type === 'string' && n.props.testID === id,
  ) as ReactTestInstance[];

/** Gives the viewer a size, as Android's layout pass would. */
async function layout() {
  for (const id of ['pdf-viewer', 'image-viewer']) {
    for (const node of byTestId(id)) {
      await ReactTestRenderer.act(async () => {
        node.props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 760 } },
        });
      });
    }
  }
  await settle();
}

const hostImages = (label: string) =>
  app.root.findAll(
    n =>
      (n.type as unknown) === 'Image' && n.props.accessibilityLabel === label,
  );

/** View copies currently open for an attachment. */
const openViews = (a: Attachment) =>
  [...fakeAttachments.views.values()].filter(id => id === a.id).length;

beforeEach(async () => {
  fakeAttachments.reset();
  [front, back, invoice, box, manual].forEach(a =>
    fakeAttachments.files.add(a.id),
  );
  fakeAttachments.pdfPages.set(invoice.id, [
    [595, 842],
    [595, 842],
    [842, 595],
  ]);
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await stored().save(card);
  await stored().save(doc);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => app?.unmount());
});

describe('photo viewer', () => {
  test('opens a card photo full screen and pages to the other side', async () => {
    await launch();
    await openTab(app, 'Cards');
    await pressText(app, 'Greenleaf Rewards');
    expect(openViews(front)).toBe(1); // the detail tile

    await pressLabel(app, 'Open back photo');
    await layout();
    expect(hasText(app, 'Back of card')).toBe(true);
    expect(hasText(app, '2 of 2 · PNG image · 1.2 MB')).toBe(true);
    const [image] = hostImages('Back of card');
    expect(fakeAttachments.views.get(image.props.source.uri)).toBe(back.id);
    expect(openViews(back)).toBe(2); // tile + viewer

    await pressLabel(app, 'Previous file');
    await layout();
    expect(hasText(app, 'Front of card')).toBe(true);
    expect(openViews(back)).toBe(1); // the viewer's copy is gone
    expect(openViews(front)).toBe(2);

    await pressLabel(app, 'Close');
    expect(hasText(app, 'Greenleaf Market')).toBe(true);
    expect(openViews(front)).toBe(1);
    expect(openViews(back)).toBe(1);

    await pressLabel(app, 'Back');
    expect(fakeAttachments.views.size).toBe(0);
  });

  test('a missing, damaged or undecodable photo explains itself', async () => {
    fakeAttachments.files.delete(back.id);
    fakeAttachments.viewErrors.set(front.id, 'DAMAGED');
    await launch();
    await openTab(app, 'Cards');
    await pressText(app, 'Greenleaf Rewards');
    await pressLabel(app, 'Open front photo');
    expect(hasText(app, 'File is damaged')).toBe(true);
    await pressLabel(app, 'Next file');
    expect(hasText(app, 'File is missing')).toBe(true);
    expect(fakeAttachments.views.size).toBe(0);

    // Checked and decrypted, but Android can't decode it (e.g. HEIC before 9).
    fakeAttachments.files.add(back.id);
    await pressLabel(app, 'Close');
    await pressLabel(app, 'Open back photo');
    await layout();
    const [image] = hostImages('Back of card');
    await ReactTestRenderer.act(async () => image.props.onError());
    expect(hasText(app, 'Image can’t be shown')).toBe(true);
  });
});

describe('document viewer', () => {
  test('a PDF opens with its page count and renders only pages in view', async () => {
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Washing machine');
    await pressText(app, 'invoice.pdf');
    expect(fakeAttachments.pdfs.size).toBe(1);
    await layout();

    expect(hasText(app, '1 of 3 · PDF · 1.2 MB · Page 1 of 3')).toBe(true);
    expect(fakeAttachments.renders.length).toBeGreaterThan(0);
    expect(fakeAttachments.renders.length).toBeLessThanOrEqual(3);
    expect(fakeAttachments.renders[0].index).toBe(0);
    // 376 points wide (400 minus margins) at the test pixel ratio.
    expect(fakeAttachments.renders[0].widthPx).toBeGreaterThan(0);
    expect(hostImages('Page 1 of 3')).toHaveLength(1);

    const pages = [...fakeAttachments.pageViews.keys()];
    expect(pages.length).toBe(fakeAttachments.renders.length);

    await pressLabel(app, 'Close');
    expect(fakeAttachments.pdfs.size).toBe(0);
    expect(fakeAttachments.pageViews.size).toBe(0);
    // Each page is released by its own view too (also when scrolled away).
    expect(fakeAttachments.closed).toEqual(expect.arrayContaining(pages));
  });

  test('pages through mixed files; each file is closed when the next opens', async () => {
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Washing machine');
    await pressText(app, 'invoice.pdf');
    await layout();

    await pressLabel(app, 'Next file');
    await layout();
    expect(hasText(app, 'box.jpg')).toBe(true);
    expect(hasText(app, '2 of 3 · JPEG image · 340 KB')).toBe(true);
    expect(fakeAttachments.pdfs.size).toBe(0);
    expect(fakeAttachments.pageViews.size).toBe(0);
    expect(openViews(box)).toBe(1);

    await pressLabel(app, 'Next file');
    await layout();
    expect(hasText(app, 'manual.pdf')).toBe(true);
    expect(openViews(box)).toBe(0);
    expect([...fakeAttachments.pdfs.values()]).toEqual([manual.id]);
    // The last file: "Next" does nothing.
    await pressLabel(app, 'Next file');
    expect(hasText(app, '3 of 3 · PDF · 1.2 MB')).toBe(true);

    // Leaving through the detail screen as well leaves nothing open.
    await pressLabel(app, 'Close');
    await pressLabel(app, 'Back');
    expect(fakeAttachments.pdfs.size).toBe(0);
    expect(fakeAttachments.views.size).toBe(0);
    expect(fakeAttachments.pageViews.size).toBe(0);
  });

  test('protected, unsupported, missing and damaged PDFs show a clear message', async () => {
    const cases: [string | null, string][] = [
      ['PDF_PROTECTED', 'PDF is password-protected'],
      ['PDF_UNSUPPORTED', 'PDF can’t be shown'],
      ['DAMAGED', 'File is damaged'],
      ['KEY_UNAVAILABLE', 'File can’t be opened'],
      [null, 'File is missing'],
    ];
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Washing machine');
    for (const [code, title] of cases) {
      if (code) {
        fakeAttachments.viewErrors.set(invoice.id, code);
      } else {
        fakeAttachments.viewErrors.delete(invoice.id);
        fakeAttachments.files.delete(invoice.id);
      }
      await pressText(app, 'invoice.pdf');
      expect(hasText(app, title)).toBe(true);
      expect(fakeAttachments.pdfs.size).toBe(0);
      await pressLabel(app, 'Close');
    }
    // The detail screen is unaffected.
    expect(hasText(app, 'Home Electro')).toBe(true);
  });

  test('a page that fails to render is marked, the others still show', async () => {
    fakeAttachments.failingPages.add(1);
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Washing machine');
    await pressText(app, 'invoice.pdf');
    await layout();
    expect(hostImages('Page 1 of 3')).toHaveLength(1);
    if (fakeAttachments.renders.some(r => r.index === 2)) {
      expect(hostImages('Page 3 of 3')).toHaveLength(1);
    }
    expect(hasText(app, 'This page can’t be shown')).toBe(true);
  });

  test('closing the app mid-view leaves nothing open', async () => {
    await launch();
    await openTab(app, 'Documents');
    await pressText(app, 'Washing machine');
    await pressText(app, 'invoice.pdf');
    await layout();
    expect(fakeAttachments.pageViews.size).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => app.unmount());
    await settle();
    expect(fakeAttachments.pdfs.size).toBe(0);
    expect(fakeAttachments.pageViews.size).toBe(0);
    expect(fakeAttachments.views.size).toBe(0);
  });
});

describe('cleanup', () => {
  test('returning to the app removes view files nothing shows', async () => {
    const listeners: ((state: string) => void)[] = [];
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener as (state: string) => void);
        return { remove: () => undefined } as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    try {
      await launch();
      expect(fakeAttachments.purges).toBe(0);
      await ReactTestRenderer.act(async () => {
        listeners.forEach(l => l('background'));
      });
      expect(fakeAttachments.purges).toBe(0);
      await ReactTestRenderer.act(async () => {
        listeners.forEach(l => l('active'));
      });
      expect(fakeAttachments.purges).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
