import type { Attachment, DocumentItem } from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import type { SqlDatabase } from '../../src/storage/sql';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import { fakeAttachments } from '../../test-utils/fakeAttachments';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// The real openStorage on a plain SQLite database; only the SQLCipher open
// step is replaced.
let mockDb: SqlDatabase;
let mockOpenFailure: Error | null = null;
/** The database file is absent, so this open creates it. */
let mockCreating = false;
jest.mock('../../src/storage/database', () => ({
  openTrezorDatabase: async (options?: {
    beforeCreate?: () => Promise<void>;
  }) => {
    if (mockOpenFailure) {
      throw mockOpenFailure;
    }
    if (mockCreating) {
      // The real openTrezorDatabase turns a failure here into STORAGE_ERROR
      // before anything is created (database.test.ts).
      await options?.beforeCreate?.();
    }
    return { db: mockDb, created: mockCreating };
  },
}));

import { openStorage } from '../../src/storage/openStorage';

const file = (n: number): Attachment => ({
  id: `01a1a0dd-991f-783c-9531-3fab9ef479${String(n).padStart(2, '0')}`,
  fileName: `scan-${n}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  sha256: 'a'.repeat(64),
  formatVersion: 1,
  createdAt: '2026-11-03T00:00:00.000Z',
});

const doc: DocumentItem = {
  id: 'd',
  type: 'document',
  title: 'Receipt',
  kind: 'receipt',
  merchant: '',
  date: null,
  expiresOn: null,
  amount: null,
  currency: '',
  notes: '',
  attachments: [file(1), file(2)],
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

beforeEach(async () => {
  fakeAttachments.reset();
  mockOpenFailure = null;
  mockCreating = false;
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await new SqliteItemRepository(mockDb).save(doc);
  // Files of the saved document, plus an orphan from an unsaved draft.
  [file(1).id, file(2).id, file(3).id].forEach(id =>
    fakeAttachments.files.add(id),
  );
});

describe('openStorage attachment cleanup', () => {
  test('removes only files no row refers to, before the app starts', async () => {
    const storage = await openStorage();

    expect(fakeAttachments.gcRuns).toEqual([[file(1).id, file(2).id]]);
    expect([...fakeAttachments.files].sort()).toEqual([file(1).id, file(2).id]);
    expect(storage.initialItems).toEqual([doc]);
  });

  test('a cleanup failure does not stop the app from opening', async () => {
    fakeAttachments.failNextGc = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const storage = await openStorage();

    expect(storage.initialItems).toEqual([doc]);
    expect(fakeAttachments.files.size).toBe(3);
    expect(warn).toHaveBeenCalledWith(
      '[attachments] cleanup failed: IO_FAILED',
    );
    warn.mockRestore();
  });

  test('M1: files that exist when the database is created are kept, now and later', async () => {
    // The database file is missing (its key is not); its files are still there.
    mockCreating = true;
    mockDb = createNodeSqliteDatabase();
    await runMigrations(mockDb);

    await openStorage();
    expect(fakeAttachments.keepRuns).toBe(1);
    expect(fakeAttachments.files.size).toBe(3);

    // Next launch: the database exists now and has none of their rows.
    mockCreating = false;
    await openStorage();
    expect(fakeAttachments.keepRuns).toBe(1);
    expect(fakeAttachments.files.size).toBe(3);
  });

  test('an existing database never records files as kept', async () => {
    await openStorage();
    expect(fakeAttachments.keepRuns).toBe(0);
  });

  test('nothing is cleaned up when the database cannot be opened', async () => {
    mockOpenFailure = Object.assign(new Error('locked'), {
      code: 'DATABASE_UNREADABLE',
    });

    await expect(openStorage()).rejects.toMatchObject({
      code: 'DATABASE_UNREADABLE',
    });
    expect(fakeAttachments.gcRuns).toEqual([]);
    expect(fakeAttachments.files.size).toBe(3);
  });
});
