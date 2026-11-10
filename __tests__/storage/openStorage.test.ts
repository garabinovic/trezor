import { nativeAttachmentPlatform } from '../../src/attachments/platform';
import type { Attachment, DocumentItem } from '../../src/data/types';
import { StorageError } from '../../src/storage/errors';
import { runMigrations } from '../../src/storage/migrations';
import type { OpenedStorage } from '../../src/storage/openStorage';
import type { SqlDatabase, SqlValue } from '../../src/storage/sql';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import { fakeAttachments } from '../../test-utils/fakeAttachments';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// The real openStorage on a plain SQLite database; only the SQLCipher open
// step is replaced, by one that records every connection it hands out.
let mockDb: SqlDatabase;
let mockOpenFailure: Error | null = null;
/** The database file is absent, so this open creates it. */
let mockCreating = false;
/** Each connection opened, in order. */
let mockConnections: MockConnection[] = [];
/** Held until resolved: the next open, or statements matching a pattern. */
let mockOpenGate: Promise<void> | null = null;
let mockHold: { pattern: RegExp; until: Promise<void> } | null = null;
/** The first statement matching this fails. */
let mockFailing: RegExp | null = null;

interface MockConnection extends SqlDatabase {
  /** Settled statements and the close, in order. */
  log: string[];
  closed: boolean;
}

function mockConnection(db: SqlDatabase): MockConnection {
  const connection: MockConnection = {
    log: [],
    closed: false,
    async execute(sql: string, params?: SqlValue[]) {
      if (connection.closed) {
        throw new Error('[op-sqlite] database is closed');
      }
      const hold = mockHold;
      if (hold && hold.pattern.test(sql)) {
        mockHold = null;
        await hold.until;
      }
      try {
        if (mockFailing && mockFailing.test(sql)) {
          mockFailing = null;
          throw new Error(
            '[op-sqlite] sqlite query error: disk I/O error (code 10)',
          );
        }
        return await db.execute(sql, params);
      } finally {
        connection.log.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      }
    },
    transaction: (fn, options) => db.transaction(fn, options),
    close() {
      connection.closed = true;
      connection.log.push('close');
    },
  };
  return connection;
}

jest.mock('../../src/storage/database', () => ({
  openTrezorDatabase: async (options?: {
    beforeCreate?: () => Promise<void>;
  }) => {
    if (mockOpenGate) {
      await mockOpenGate;
    }
    if (mockOpenFailure) {
      throw mockOpenFailure;
    }
    if (mockCreating) {
      // The real openTrezorDatabase turns a failure here into STORAGE_ERROR
      // before anything is created (database.test.ts).
      await options?.beforeCreate?.();
    }
    const connection = mockConnection(mockDb);
    mockConnections.push(connection);
    return { db: connection, created: mockCreating };
  },
}));

/**
 * openStorage as a new process sees it: a fresh copy of the module, so
 * nothing is shared with an earlier "process". The attachment platform is
 * this file's, so the fake's files outlive the process.
 */
function newProcess(): () => Promise<OpenedStorage> {
  let open!: typeof import('../../src/storage/openStorage').openStorage;
  jest.isolateModules(() => {
    open = require('../../src/storage/openStorage').openStorage;
  });
  return () => open(nativeAttachmentPlatform);
}

let openStorage: () => Promise<OpenedStorage>;

/** A new process whose startup recovery is `recover` (default: the native one, idle in Jest). */
function newProcessWith(recover: () => Promise<void>) {
  let open!: typeof import('../../src/storage/openStorage').openStorage;
  jest.isolateModules(() => {
    open = require('../../src/storage/openStorage').openStorage;
  });
  return () => open(nativeAttachmentPlatform, recover);
}

function gate() {
  let release!: () => void;
  const until = new Promise<void>(resolve => (release = resolve));
  return { until, release };
}

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
  mockConnections = [];
  mockOpenGate = null;
  mockHold = null;
  mockFailing = null;
  openStorage = newProcess();
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
    openStorage = newProcess();
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

const note = {
  id: 'n',
  type: 'note' as const,
  title: 'Added by the first root',
  body: '',
  pinned: false,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
};

describe('one storage per process (F9)', () => {
  test('React roots mounting together share one initialization and one connection', async () => {
    const open = gate();
    mockOpenGate = open.until;
    const first = openStorage();
    const second = openStorage();
    open.release();
    const [a, b] = await Promise.all([first, second]);

    expect(mockConnections).toHaveLength(1);
    expect(fakeAttachments.gcRuns).toHaveLength(1);
    // The same repositories, so the same serialized queue on that connection.
    expect(b.items).toBe(a.items);
    expect(b.settings).toBe(a.settings);
    expect(a.initialItems).toEqual([doc]);
    expect(b.initialItems).toEqual([doc]);
  });

  test('a root mounted later loads its own data, and initializes nothing again', async () => {
    const a = await openStorage();
    await a.items.save(note);
    await a.settings.set('theme.preference', 'dark');

    const b = await openStorage();

    expect(b.items).toBe(a.items);
    expect(b.initialItems.map(i => i.id).sort()).toEqual(['d', 'n']);
    expect(b.initialTheme).toBe('dark');
    expect(a.initialItems).toEqual([doc]);
    expect(mockConnections).toHaveLength(1);
    expect(fakeAttachments.gcRuns).toHaveLength(1);
    expect(mockConnections[0].closed).toBe(false);
  });

  test('a failure after opening closes that connection once its queued statements settle', async () => {
    // listAll fails while a settings read is still running.
    const settingsRead = gate();
    mockHold = { pattern: /FROM settings/, until: settingsRead.until };
    mockFailing = /FROM items i JOIN notes/;

    const opening = openStorage();
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10));
    expect(mockConnections[0].closed).toBe(false);
    settingsRead.release();

    await expect(opening).rejects.toThrow('disk I/O error');
    const { log } = mockConnections[0];
    expect(log[log.length - 1]).toBe('close');
    expect(log.filter(l => l === 'close')).toHaveLength(1);
    // Every statement started before the failure settled before the close.
    expect(log.filter(l => l.includes('FROM settings'))).toHaveLength(4);
    expect(fakeAttachments.gcRuns).toEqual([]);
  });

  test('Retry after a failed initialization opens a fresh connection', async () => {
    mockFailing = /FROM items i JOIN notes/;
    await expect(openStorage()).rejects.toThrow('disk I/O error');

    const storage = await openStorage();

    expect(mockConnections).toHaveLength(2);
    expect(mockConnections[0].closed).toBe(true);
    expect(mockConnections[1].closed).toBe(false);
    expect(storage.initialItems).toEqual([doc]);
    expect(fakeAttachments.gcRuns).toHaveLength(1);
  });

  test('a failing attempt never clears the attempt that replaces it', async () => {
    // Attempt 1 fails slowly: its connection waits for a settings read.
    const settingsRead = gate();
    mockHold = { pattern: /FROM settings/, until: settingsRead.until };
    mockFailing = /FROM items i JOIN notes/;
    const failing = openStorage();
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10));
    // A root arriving while it fails joins it: no second connection yet.
    const joined = openStorage();
    settingsRead.release();
    await expect(failing).rejects.toThrow('disk I/O error');
    await expect(joined).rejects.toThrow('disk I/O error');
    expect(mockConnections).toHaveLength(1);

    // Retry: attempt 2 is still opening when another root arrives.
    const open = gate();
    mockOpenGate = open.until;
    const retry = openStorage();
    const late = openStorage();
    open.release();
    const [a, b] = await Promise.all([retry, late]);

    expect(mockConnections).toHaveLength(2);
    expect(b.items).toBe(a.items);
    // Nothing from attempt 1 reset attempt 2: a later root still shares it.
    const later = await openStorage();
    expect(later.items).toBe(a.items);
    expect(mockConnections).toHaveLength(2);
    expect(mockConnections[1].closed).toBe(false);
  });
});

describe('openStorage restore recovery (Phase 6 spec v2.5 §7)', () => {
  /** Records what had happened when recovery ran. */
  function recording(result: () => Promise<void> = async () => undefined) {
    const seen: { connections: number; gc: number; keep: number }[] = [];
    const recover = jest.fn(async () => {
      seen.push({
        connections: mockConnections.length,
        gc: fakeAttachments.gcRuns.length,
        keep: fakeAttachments.keepRuns,
      });
      await result();
    });
    return { recover, seen };
  }

  test('recovery runs first: before the database opens or attachments are kept or collected', async () => {
    mockCreating = true;
    const { recover, seen } = recording();
    const storage = await newProcessWith(recover)();
    expect(seen).toEqual([{ connections: 0, gc: 0, keep: 0 }]);
    // And then startup continues as before.
    expect(mockConnections).toHaveLength(1);
    expect(fakeAttachments.keepRuns).toBe(1);
    expect(fakeAttachments.gcRuns).toHaveLength(1);
    expect(storage.initialItems).toEqual([doc]);
  });

  test('a recovery error stops startup with its code, and Retry runs recovery again first', async () => {
    let fail = true;
    const { recover, seen } = recording(async () => {
      if (fail) {
        throw new StorageError('RESTORE_VERIFY_RETRY', 'not verified');
      }
    });
    const open = newProcessWith(recover);
    await expect(open()).rejects.toMatchObject({
      code: 'RESTORE_VERIFY_RETRY',
    });
    expect(mockConnections).toHaveLength(0);
    expect(fakeAttachments.gcRuns).toHaveLength(0);
    fail = false;
    await open();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(seen[1]).toEqual({ connections: 0, gc: 0, keep: 0 });
  });

  test('after a JS reload (a new copy of the module) recovery runs first again', async () => {
    const first = recording();
    await newProcessWith(first.recover)();
    const second = recording();
    await newProcessWith(second.recover)();
    expect(second.recover).toHaveBeenCalledTimes(1);
    // Only the first runtime's connection existed when the second recovered.
    expect(second.seen).toEqual([{ connections: 1, gc: 1, keep: 0 }]);
    expect(mockConnections).toHaveLength(2);
  });

  test('a later root of the same runtime shares the opened storage: no second recovery', async () => {
    const { recover } = recording();
    const open = newProcessWith(recover);
    await open();
    await open();
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
