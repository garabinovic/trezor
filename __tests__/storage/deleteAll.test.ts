import {
  onReconcileReleased,
  resetReconcileGateForTests,
  runReconcile,
} from '../../src/reminders/reconcileGate';
import {
  CONTENT_TABLES,
  deleteAllData,
  DeleteAllError,
  hasWipeMarker,
  resumeWipe,
  WIPE_MARKER,
  WipePlatform,
} from '../../src/storage/deleteAll';
import { StorageError } from '../../src/storage/errors';
import { getUserVersion, runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import type { SqlDatabase, SqlValue } from '../../src/storage/sql';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// Delete all data (Phase 7) on the real schema (node:sqlite) with a recording
// fake of the native half.
let mockCleanupPending = false;
jest.mock('../../src/backup/restore', () => ({
  restoreCleanupPending: () => mockCleanupPending,
}));

let db: SqlDatabase;
/** The first statement matching this fails, once. */
let failing: RegExp | null = null;

/** The live connection, with failure injection. */
function liveConnection(raw: SqlDatabase): SqlDatabase {
  return {
    async execute(sql: string, params?: SqlValue[]) {
      if (failing && failing.test(sql)) {
        failing = null;
        throw new Error('disk I/O error (code 10)');
      }
      return raw.execute(sql, params);
    },
    transaction: (fn, options) => raw.transaction(fn, options),
    close: () => raw.close(),
  };
}

const settingsOf = async () =>
  Object.fromEntries(
    (await db.execute('SELECT key, value FROM settings ORDER BY key')).map(
      r => [r.key, r.value],
    ),
  );

const counts = async () => {
  const result: Record<string, number> = {};
  for (const t of CONTENT_TABLES) {
    result[t] = Number(
      (await db.execute(`SELECT count(*) AS n FROM ${t}`))[0].n,
    );
  }
  return result;
};

const empty = Object.fromEntries(CONTENT_TABLES.map(t => [t, 0]));

async function seed() {
  const items = new SqliteItemRepository(db);
  const base = {
    pinned: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  await items.save({
    ...base,
    id: 'n',
    type: 'note',
    title: 'Note',
    body: 'x',
  });
  await items.save({
    ...base,
    id: 'r',
    type: 'reminder',
    title: 'Reminder',
    dueAt: '2026-12-01T09:00:00.000Z',
    localStart: '2026-12-01T10:00',
    intervalMinutes: null,
    repeat: 'once',
    notes: '',
    completed: false,
  });
  await items.save({
    ...base,
    id: 'c',
    type: 'card',
    title: 'Card',
    cardNumber: '123',
    codeFormat: 'barcode',
    holderName: '',
    notes: '',
    issuer: '',
    front: null,
    back: null,
  } as never);
  await items.save({
    ...base,
    id: 'd',
    type: 'document',
    title: 'Doc',
    kind: 'receipt',
    merchant: '',
    date: null,
    expiresOn: null,
    amount: null,
    currency: '',
    notes: '',
    attachments: [
      {
        id: '01a1a0dd-991f-783c-9531-3fab9ef47901',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
        formatVersion: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  });
  for (const [key, value] of [
    ['theme.preference', '"dark"'],
    ['notifications.showDetails', 'true'],
    ['notifications.permissionRequested', 'true'],
    ['notifications.exactAlarmRequested', 'true'],
  ]) {
    await db.execute('INSERT INTO settings (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  }
}

function fakePlatform(fail: Partial<Record<keyof WipePlatform, unknown>> = {}) {
  const calls: string[] = [];
  let locks = 0;
  const step =
    (name: keyof WipePlatform, result?: unknown) =>
    async (...args: unknown[]) => {
      calls.push(name === 'deleteFiles' ? `deleteFiles:${args[0]}` : name);
      if (fail[name]) {
        delete fail[name];
        throw Object.assign(new Error(name), { code: 'FAILED' });
      }
      return result;
    };
  const platform: WipePlatform = {
    lock: async () => {
      calls.push('lock');
      if (fail.lock) {
        throw Object.assign(new Error(), { code: 'RESTORE_IN_PROGRESS' });
      }
      locks += 1;
      return `token-${locks}`;
    },
    unlock: step('unlock') as WipePlatform['unlock'],
    acquireGate: step('acquireGate') as WipePlatform['acquireGate'],
    releaseGate: step('releaseGate') as WipePlatform['releaseGate'],
    purgeCaches: step('purgeCaches') as WipePlatform['purgeCaches'],
    clearReminders: step('clearReminders') as WipePlatform['clearReminders'],
    deleteFiles: step('deleteFiles') as WipePlatform['deleteFiles'],
    restartProcess: step('restartProcess') as WipePlatform['restartProcess'],
  };
  return { platform, calls };
}

const tick = (ms = 10) => new Promise<void>(r => setTimeout(() => r(), ms));

/** Runs the wipe until it restarts (it never settles then). */
async function runUntilRestart(run: Promise<unknown>, calls: string[]) {
  let settled: unknown = 'pending';
  run.then(
    () => (settled = 'resolved'),
    e => (settled = e),
  );
  for (let i = 0; i < 200 && !calls.includes('restartProcess'); i++) {
    await tick(2);
  }
  await tick();
  expect(calls).toContain('restartProcess');
  expect(settled).toBe('pending');
}

beforeEach(async () => {
  mockCleanupPending = false;
  failing = null;
  resetReconcileGateForTests();
  db = createNodeSqliteDatabase();
  await runMigrations(db);
  await seed();
});

test('the schema has exactly these content tables, plus settings', async () => {
  const tables = (
    await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
  ).map(r => r.name);
  // A new table must be added to CONTENT_TABLES (or kept on purpose) here.
  expect(tables).toEqual([...CONTENT_TABLES, 'settings'].sort());
});

test('deletes every content row and content setting, keeps device facts, then restarts once', async () => {
  const { platform, calls } = fakePlatform();
  const version = await getUserVersion(db);
  await runUntilRestart(
    deleteAllData({ database: serializeDatabase(db), platform }),
    calls,
  );
  expect(calls).toEqual([
    'lock',
    'acquireGate',
    'clearReminders',
    'purgeCaches',
    'unlock',
    'lock',
    'deleteFiles:token-2',
    'unlock',
    'restartProcess',
  ]);
  expect(await counts()).toEqual(empty);
  expect(await settingsOf()).toEqual({
    'notifications.exactAlarmRequested': 'true',
    'notifications.permissionRequested': 'true',
  });
  expect(await hasWipeMarker(db)).toBe(false);
  expect(await getUserVersion(db)).toBe(version);
  expect(
    (await db.execute('PRAGMA integrity_check')).map(r => r.integrity_check),
  ).toEqual(['ok']);
  // New data works at once.
  await new SqliteItemRepository(db).save({
    id: 'new',
    type: 'note',
    title: 'Fresh',
    body: '',
    pinned: false,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
  });
  expect((await counts()).items).toBe(1);
});

test('a reconcile waits for the wipe and never runs before the restart', async () => {
  const { platform, calls } = fakePlatform();
  const reconcile = jest.fn(async () => undefined);
  const run = deleteAllData({ database: serializeDatabase(db), platform });
  await tick();
  runReconcile(reconcile);
  await runUntilRestart(run, calls);
  expect(reconcile).not.toHaveBeenCalled();
});

test('refused while a restore is pending or holds the lock; nothing is deleted', async () => {
  const before = await counts();
  mockCleanupPending = true;
  await expect(
    deleteAllData({
      database: serializeDatabase(db),
      platform: fakePlatform().platform,
    }),
  ).rejects.toMatchObject({ code: 'RESTORE_IN_PROGRESS' });
  mockCleanupPending = false;
  const busy = fakePlatform({ lock: true });
  await expect(
    deleteAllData({ database: serializeDatabase(db), platform: busy.platform }),
  ).rejects.toMatchObject({ code: 'RESTORE_IN_PROGRESS' });
  expect(busy.calls).toEqual(['lock']);
  expect(await counts()).toEqual(before);
});

test('a cancelled or failed authentication deletes nothing and takes no lock', async () => {
  const before = await counts();
  for (const code of ['CANCELLED', 'LOCKOUT']) {
    const { platform, calls } = fakePlatform();
    await expect(
      deleteAllData({
        database: serializeDatabase(db),
        platform,
        confirmIdentity: async () => {
          throw Object.assign(new Error(), { code });
        },
      }),
    ).rejects.toEqual(new DeleteAllError(code));
    expect(calls).toEqual([]);
  }
  expect(await counts()).toEqual(before);
});

test('a failure before the commit rolls back everything and releases every gate', async () => {
  const before = await counts();
  const settings = await settingsOf();
  for (const fault of ['cards', 'COMMIT', 'purgeCaches']) {
    const released = jest.fn();
    const off = onReconcileReleased(released);
    const { platform, calls } =
      fault === 'purgeCaches'
        ? fakePlatform({ purgeCaches: true })
        : fakePlatform();
    failing =
      fault === 'cards'
        ? /DELETE FROM cards/
        : fault === 'COMMIT'
        ? /^COMMIT/
        : null;
    const e = await deleteAllData({
      database: serializeDatabase(liveConnection(db)),
      platform,
    }).catch(x => x);
    expect(e).toBeInstanceOf(DeleteAllError);
    expect(await counts()).toEqual(before);
    expect(await settingsOf()).toEqual(settings);
    expect(await hasWipeMarker(db)).toBe(false);
    expect(calls).toContain('releaseGate');
    expect(calls.at(-1)).toBe('unlock');
    expect(calls).not.toContain('deleteFiles:token-1');
    expect(calls).not.toContain('restartProcess');
    // The reconcile gate is free again (its listeners re-arm the reminders).
    expect(released).toHaveBeenCalledTimes(1);
    off();
  }
});

test('the marker is written in the same transaction as the deletion', async () => {
  // A failing COMMIT leaves neither the deletion nor the marker.
  failing = /^COMMIT/;
  await deleteAllData({
    database: serializeDatabase(liveConnection(db)),
    platform: fakePlatform().platform,
  }).catch(() => undefined);
  expect(await hasWipeMarker(db)).toBe(false);
  expect((await counts()).items).toBe(4);
  // A file failure after the commit: content gone, marker set, still restarts.
  const { platform, calls } = fakePlatform({ deleteFiles: true });
  await runUntilRestart(
    deleteAllData({ database: serializeDatabase(db), platform }),
    calls,
  );
  expect(await counts()).toEqual(empty);
  expect(await hasWipeMarker(db)).toBe(true);
  expect(calls.filter(c => c === 'restartProcess')).toHaveLength(1);
});

describe('resumeWipe (startup)', () => {
  test('nothing to do without the marker', async () => {
    const { platform, calls } = fakePlatform();
    await resumeWipe(db, platform);
    expect(calls).toEqual([]);
    expect((await counts()).items).toBe(4);
  });

  /**
   * Process death after each major step, then the next launch: resumeWipe on
   * the same database. Every case ends empty, without the marker, and the
   * schedule cleared and the files deleted again at startup.
   */
  test.each([
    ['after clearing the schedule (before the commit)', 'beforeCommit'],
    ['after the commit', 'deleteFiles'],
    ['after the files', 'VACUUM'],
    ['after VACUUM', 'marker'],
  ])('killed %s', async (_, where) => {
    const { platform } = fakePlatform(
      where === 'deleteFiles' ? { deleteFiles: true } : {},
    );
    if (where === 'beforeCommit') {
      failing = /^BEGIN/;
    } else if (where === 'VACUUM') {
      failing = /^VACUUM/;
    } else if (where === 'marker') {
      failing = /DELETE FROM settings WHERE key = \?/;
    }
    const run = deleteAllData({
      database: serializeDatabase(liveConnection(db)),
      platform,
    });
    run.catch(() => undefined);
    await tick(50);

    // The next launch.
    const next = fakePlatform();
    await resumeWipe(db, next.platform);
    if (where === 'beforeCommit') {
      // Nothing was deleted: nothing to resume, the data is all there.
      expect(next.calls).toEqual([]);
      expect((await counts()).items).toBe(4);
      return;
    }
    expect(next.calls).toEqual([
      'clearReminders',
      'lock',
      'deleteFiles:token-1',
      'unlock',
    ]);
    expect(await counts()).toEqual(empty);
    expect(await hasWipeMarker(db)).toBe(false);
  });

  test('resume failures keep the marker until a later attempt succeeds', async () => {
    await db.execute("INSERT INTO settings (key, value) VALUES (?, 'true')", [
      WIPE_MARKER,
    ]);
    for (const fault of ['clearReminders', 'deleteFiles'] as const) {
      const { platform } = fakePlatform({ [fault]: true });
      const e = await resumeWipe(db, platform).catch(x => x);
      expect(e).toBeInstanceOf(StorageError);
      expect(e.code).toBe('WIPE_INCOMPLETE');
      expect(await hasWipeMarker(db)).toBe(true);
    }
    failing = /^VACUUM/;
    await expect(
      resumeWipe(liveConnection(db), fakePlatform().platform),
    ).rejects.toMatchObject({ code: 'WIPE_INCOMPLETE' });
    expect(await hasWipeMarker(db)).toBe(true);
    await resumeWipe(db, fakePlatform().platform);
    expect(await hasWipeMarker(db)).toBe(false);
    expect(await counts()).toEqual(empty);
  });
});
