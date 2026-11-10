// Node built-ins via require: the project has no @types/node.
const fs = require('fs');
const path = require('path');
import { exportDatabase } from '../../src/backup/artifact';
import { BackupError } from '../../src/backup/platform';
import {
  resetRestoreForTests,
  restoreBackup,
  restoreCleanupPending,
  restoreEntryFor,
  RestoreOptions,
  retryRestoreCleanup,
  settleRestore,
} from '../../src/backup/restore';
import {
  RestoreError,
  RestorePlatform,
  RestoreStaged,
} from '../../src/backup/restorePlatform';
import {
  onCompletedElsewhere,
  onReconcileReleased,
  ReconcileRelease,
  resetReconcileGateForTests,
  runReconcile,
} from '../../src/reminders/reconcileGate';
import type { StorageErrorCode } from '../../src/storage/errors';
import { migrations, runMigrations } from '../../src/storage/migrations';
import { adaptOpSqlite } from '../../src/storage/opSqliteAdapter';
import {
  SerialDatabase,
  serializeDatabase,
} from '../../src/storage/serialDatabase';
import { SqlDatabase } from '../../src/storage/sql';
import { rawKey } from '../../src/storage/sqlcipher';
import { FakeSqlCipher } from '../../test-utils/fakeSqlCipher';

// Restore (spec v2.4 §8.2, v2.5 §6): the real step 6 (export to the device
// key, settings rewrite, Annex B checks) and step 9 on the SQLCipher fake, with
// a recording fake of the native platform; steps 13a–16 are native.
let mockFake: FakeSqlCipher;

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (params: never) => mockFake.open(params),
  isSQLCipher: () => true,
  get ANDROID_DATABASE_PATH() {
    return `${mockFake.dir}/`;
  },
}));

const DEVICE_KEY = '11'.repeat(32);
const ARTIFACT_KEY = '22'.repeat(32);
const SOURCE_KEY = '33'.repeat(32);
const SHA = 'ab'.repeat(32);

const openFake = (params: Parameters<FakeSqlCipher['open']>[0]) =>
  adaptOpSqlite(mockFake.open(params) as never);

let live: SerialDatabase;
let liveRaw: SqlDatabase;
let source: SqlDatabase;

async function addItem(
  db: SqlDatabase,
  id: string,
  type: string,
  title: string,
) {
  await db.execute(
    'INSERT INTO items (id, type, title, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)',
    [id, type, title],
  );
}

async function setting(db: SqlDatabase, key: string, value: unknown) {
  await db.execute('INSERT INTO settings (key, value) VALUES (?, ?)', [
    key,
    typeof value === 'string' && value.startsWith('raw:')
      ? value.slice(4)
      : JSON.stringify(value),
  ]);
}

beforeEach(async () => {
  resetReconcileGateForTests();
  resetRestoreForTests();
  mockFake = new FakeSqlCipher();
  // The live database, under the device key.
  liveRaw = openFake({ name: 'trezor.db', encryptionKey: rawKey(DEVICE_KEY) });
  await runMigrations(liveRaw, migrations);
  await addItem(liveRaw, 'live-note', 'note', 'Live');
  await liveRaw.execute(
    "INSERT INTO notes (item_id, body) VALUES ('live-note', 'x')",
  );
  await addItem(liveRaw, 'fired', 'reminder', 'Fired once');
  await liveRaw.execute(
    "INSERT INTO reminders (item_id, due_at, local_start, repeat, completed) VALUES ('fired', 1, '2026-11-01T09:00', 'once', 0)",
  );
  await setting(liveRaw, 'notifications.permissionRequested', true);
  await setting(liveRaw, 'notifications.exactAlarmRequested', 'raw:not json');
  live = serializeDatabase(liveRaw);
  // The backed-up database, on another "device".
  source = openFake({ name: 'source.db', encryptionKey: rawKey(SOURCE_KEY) });
  await runMigrations(source, migrations);
  await addItem(source, 'restored-doc', 'document', 'Restored');
  await source.execute(
    "INSERT INTO documents (item_id, kind) VALUES ('restored-doc', 'receipt')",
  );
  await source.execute(
    "INSERT INTO attachments (id, item_id, role, position, file_name, mime_type, size_bytes, sha256, format_version, created_at) VALUES ('a1', 'restored-doc', 'document', 0, 'scan.pdf', 'application/pdf', 10, ?, 1, 1)",
    [SHA],
  );
  await setting(source, 'theme.preference', 'dark');
  await setting(source, 'notifications.showDetails', true);
  await setting(source, 'notifications.permissionRequested', false);
  await setting(source, 'some.future.key', 1);
});

afterEach(() => {
  live.close();
  source.close();
  mockFake.cleanup();
});

const restoreDir = () => path.join(mockFake.dir, 'restore');

/** The native half: stages the artifact from `source` like stageRestore would. */
function fakePlatform(overrides: Partial<RestorePlatform> = {}) {
  const calls: string[] = [];
  let shares = 0;
  const staged = (): RestoreStaged => ({
    restoreId: 'e'.repeat(32),
    backupId: 'b'.repeat(32),
    trailer: 'f'.repeat(64),
    location: restoreDir(),
    incoming: 'incoming.db',
    staged: 'trezor.db',
    key: ARTIFACT_KEY,
    schemaVersion: 3,
    attachments: [
      {
        id: 'a1',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: SHA,
        formatVersion: 1,
      },
    ],
  });
  const platform: RestorePlatform = {
    preflight: async () => ({ status: 'ready' }),
    beginRestore: async () => {
      calls.push('begin');
      return {
        sessionId: 's1',
        backupId: 'b'.repeat(32),
        attachments: 1,
        databaseBytes: 4096,
      };
    },
    acquireGate: async () => {
      calls.push('gate');
    },
    activeShareCount: async () => shares,
    stageRestore: async (_, expected) => {
      calls.push(`stage:${expected ? 'expected' : 'none'}`);
      fs.mkdirSync(restoreDir(), { recursive: true });
      await exportDatabase(
        source,
        path.join(restoreDir(), 'incoming.db'),
        ARTIFACT_KEY,
      );
      return staged();
    },
    deleteIncoming: async () => {
      calls.push('deleteIncoming');
      fs.rmSync(path.join(restoreDir(), 'incoming.db'));
    },
    preserveRetained: async () => {
      calls.push('retained');
      return { linked: 1, copied: 0, missing: 0, failClosed: false };
    },
    saveAndClearSchedule: async () => {
      calls.push('schedule');
      return 'saved';
    },
    purgeCaches: async () => {
      calls.push('caches');
    },
    abortRestore: async () => {
      calls.push('abort');
      fs.rmSync(restoreDir(), { recursive: true, force: true });
    },
    releaseGate: async () => {
      calls.push('release');
    },
    swapRestore: async () => {
      calls.push('swap');
      return 'verifying';
    },
    restartProcess: async () => {
      calls.push('restart');
    },
    ...overrides,
  };
  return {
    platform,
    calls,
    setShares: (n: number) => {
      shares = n;
    },
  };
}

const prepare = (
  platform: RestorePlatform,
  extra: Partial<RestoreOptions> = {},
) =>
  restoreBackup({
    uri: 'content://backup',
    password: 'correct horse battery',
    database: live,
    firedOnceIds: async () => ['fired', 'missing-id'],
    platform,
    deviceKey: async () => DEVICE_KEY,
    ...extra,
  });

const tick = (ms = 5) => new Promise<void>(r => setTimeout(() => r(), ms));

/**
 * Waits until the restore asked for the restart (step 16), then confirms it
 * never settles: nothing continues in this runtime (L1).
 */
async function untilRestarted(run: Promise<unknown>, calls: string[]) {
  let settled = false;
  run.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 400 && !calls.includes('restart'); i++) {
    await tick();
  }
  await tick(20);
  expect(calls).toContain('restart');
  expect(settled).toBe(false);
}

/**
 * Another live connection: a swap never releases the queue it closed (L1), so
 * a test that restores again needs a new one.
 */
const anotherLive = () =>
  serializeDatabase(
    openFake({ name: 'trezor.db', encryptionKey: rawKey(DEVICE_KEY) }),
  );

/** A failure after steps 1–12, so the pre-swap failure path runs. */
const failAfterPrepared = {
  onPrepared: async () => {
    throw Object.assign(new Error(), { code: 'RESTORE_FAILED' });
  },
};

async function expectCode(run: Promise<unknown>, code: string) {
  const e = await run.then(
    () => {
      throw new Error('expected a failure');
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RestoreError);
  expect((e as RestoreError).code).toBe(code);
  return e as RestoreError;
}

const liveRows = async () => ({
  items: await liveRaw.execute('SELECT * FROM items ORDER BY id'),
  notes: await liveRaw.execute('SELECT * FROM notes'),
  settings: await liveRaw.execute('SELECT * FROM settings ORDER BY key'),
  attachments: await liveRaw.execute('SELECT * FROM attachments'),
});

describe('restoreBackup', () => {
  test('runs every step in order, stages S_db correctly, then swaps and restarts', async () => {
    const { platform, calls } = fakePlatform({
      swapRestore: async () => {
        // Step 13 came first: the live connection is closed.
        await expect(liveRaw.execute('SELECT 1')).rejects.toThrow(/closed/);
        calls.push('swap');
        return 'verifying';
      },
    });
    let stagedDb: Record<string, unknown> | undefined;
    let prepared: unknown;
    const run = prepare(platform, {
      expected: { backupId: 'b'.repeat(32), trailer: 'f'.repeat(64) },
      onPrepared: async p => {
        prepared = p;
        // S_db: the backed-up data under the *device* key, settings rewritten.
        const db = openFake({
          name: 'trezor.db',
          location: restoreDir(),
          encryptionKey: rawKey(DEVICE_KEY),
          failOnCreate: true,
        });
        stagedDb = {
          items: (await db.execute('SELECT id FROM items')).map(r => r.id),
          settings: await db.execute(
            'SELECT key, value FROM settings ORDER BY key',
          ),
          version: await db.execute('PRAGMA user_version'),
        };
        db.close();
        expect(fs.existsSync(path.join(restoreDir(), 'incoming.db'))).toBe(
          false,
        );
      },
    });
    await untilRestarted(run, calls);
    expect(calls).toEqual([
      'begin',
      'gate',
      'stage:expected',
      'deleteIncoming',
      'retained',
      'schedule',
      'caches',
      'swap',
      'restart',
    ]);
    expect(stagedDb).toEqual({
      items: ['restored-doc'],
      settings: [
        // §8.8: the device-local value from the live database; the invalid
        // live exactAlarmRequested is not inserted; the backup's own
        // permissionRequested and unknown keys are dropped.
        { key: 'notifications.permissionRequested', value: 'true' },
        { key: 'notifications.showDetails', value: 'true' },
        { key: 'theme.preference', value: '"dark"' },
      ],
      version: [{ user_version: 3 }],
    });
    expect(prepared).toMatchObject({
      restoreId: 'e'.repeat(32),
      attachments: 1,
      schedule: 'saved',
      completedFired: ['fired'],
    });
    // S_db was created under the device key, never the artifact key.
    expect(mockFake.keys.get(path.join(restoreDir(), 'trezor.db'))).toBe(
      rawKey(DEVICE_KEY),
    );
    // Step 9 completed the fired ONCE reminder on the live database, and
    // nothing is left attached to it.
    const check = openFake({
      name: 'trezor.db',
      encryptionKey: rawKey(DEVICE_KEY),
    });
    expect(
      await check.execute(
        "SELECT completed FROM reminders WHERE item_id = 'fired'",
      ),
    ).toEqual([{ completed: 1 }]);
    expect(
      (await check.execute('PRAGMA database_list')).map(r => r.name),
    ).not.toContain('staged');
    check.close();
  });

  test('the pre-swap failure path undoes the preparation and keeps the live data', async () => {
    const before = await liveRows();
    const { platform, calls } = fakePlatform();
    await expectCode(prepare(platform, failAfterPrepared), 'RESTORE_FAILED');
    expect(calls.slice(-2)).toEqual(['abort', 'release']);
    expect(calls).not.toContain('swap');
    expect(fs.existsSync(restoreDir())).toBe(false);
    const after = await liveRows();
    expect(after.notes).toEqual(before.notes);
    expect(after.settings).toEqual(before.settings);
    expect(after.attachments).toEqual(before.attachments);
  });

  test('invalid backed-up settings are dropped, and an unreadable live database inserts none', async () => {
    await source.execute(
      "UPDATE settings SET value = '\"blue\"' WHERE key = 'theme.preference'",
    );
    await source.execute(
      "UPDATE settings SET value = '\"yes\"' WHERE key = 'notifications.showDetails'",
    );
    await liveRaw.execute('DROP TABLE settings');
    const { platform, calls } = fakePlatform();
    let settings: unknown;
    const run = prepare(platform, {
      firedOnceIds: async () => [],
      onPrepared: async () => {
        const db = openFake({
          name: 'trezor.db',
          location: restoreDir(),
          encryptionKey: rawKey(DEVICE_KEY),
          failOnCreate: true,
        });
        settings = await db.execute('SELECT key FROM settings');
        db.close();
      },
    });
    await untilRestarted(run, calls);
    expect(settings).toEqual([]);
  });

  test('from the error screen (no live database): no gate on a connection, no step 9', async () => {
    const { platform, calls } = fakePlatform();
    let liveSeen: unknown = 'unset';
    let completed: unknown;
    const run = prepare(platform, {
      database: undefined,
      onPrepared: async (p, l) => {
        liveSeen = l;
        completed = p.completedFired;
      },
    });
    await untilRestarted(run, calls);
    expect(liveSeen).toBeUndefined();
    expect(completed).toEqual([]);
    expect(calls.slice(-2)).toEqual(['swap', 'restart']);
  });

  test('database work queued behind the gate runs after a pre-swap failure, never after the swap', async () => {
    for (const swap of [false, true]) {
      const order: string[] = [];
      const { platform, calls } = fakePlatform({
        purgeCaches: async () => {
          order.push('caches');
        },
      });
      let queued: Promise<unknown> | undefined;
      const run = prepare(platform, {
        ...(swap ? {} : failAfterPrepared),
        firedOnceIds: async () => {
          queued = live
            .execute(
              "UPDATE notes SET body = 'later' WHERE item_id = 'live-note'",
            )
            .then(() => order.push('queued write'));
          return [];
        },
      });
      if (swap) {
        await untilRestarted(run, calls);
        expect(order).toEqual(['caches']);
      } else {
        await run.catch(() => undefined);
        await queued;
        expect(order).toEqual(['caches', 'queued write']);
      }
    }
  });

  test('a reconcile requested during the restore runs after a pre-swap failure, never after the swap (L1)', async () => {
    for (const swap of [false, true]) {
      resetReconcileGateForTests();
      const order: string[] = [];
      let reconcile: Promise<unknown> | undefined;
      const { platform, calls } = fakePlatform({
        saveAndClearSchedule: async () => {
          reconcile = runReconcile(async () => {
            order.push('reconcile');
          });
          await tick(10);
          order.push('schedule cleared');
          return 'saved';
        },
      });
      const run = prepare(platform, swap ? {} : failAfterPrepared);
      if (swap) {
        await untilRestarted(run, calls);
        expect(order).toEqual(['schedule cleared']);
      } else {
        await run.catch(() => undefined);
        await reconcile;
        expect(order).toEqual(['schedule cleared', 'reconcile']);
      }
    }
  });

  test('a failing swap or restart call still ends in the restart, holding every gate', async () => {
    const failing = async () => {
      throw Object.assign(new Error(), { code: 'RESTORE_STATE_UNKNOWN' });
    };
    for (const override of [
      { swapRestore: failing },
      { restartProcess: failing },
    ]) {
      resetReconcileGateForTests();
      // The fake swap moves nothing: staging from the last run is still there.
      fs.rmSync(restoreDir(), { recursive: true, force: true });
      const { platform, calls } = fakePlatform({
        ...override,
        ...(override.restartProcess
          ? {
              restartProcess: async () => {
                calls.push('restart');
                await failing();
              },
            }
          : {}),
      });
      const run = prepare(platform, { database: anotherLive() });
      await untilRestarted(run, calls);
      expect(calls).not.toContain('abort');
      expect(calls).not.toContain('release');
      const reconcile = jest.fn(async () => undefined);
      runReconcile(reconcile);
      await tick(20);
      expect(reconcile).not.toHaveBeenCalled();
    }
  });

  test('active shares: wait until none, or cancel before anything is staged', async () => {
    const waiting = fakePlatform();
    waiting.setShares(1);
    const asked: number[] = [];
    const run = prepare(waiting.platform, {
      whileSharesActive: async active => {
        asked.push(active);
        waiting.setShares(0);
        return 'wait';
      },
    });
    await untilRestarted(run, waiting.calls);
    expect(asked).toEqual([1]);
    resetReconcileGateForTests();

    const cancelled = fakePlatform();
    cancelled.setShares(2);
    await expectCode(
      prepare(cancelled.platform, { database: anotherLive() }),
      'RESTORE_CANCELLED',
    );
    expect(cancelled.calls).toEqual(['begin', 'gate', 'abort', 'release']);
  });

  test('a failure at any step takes the pre-swap failure path and releases the gate', async () => {
    const failing = (code: string) => async () => {
      throw Object.assign(new Error('x'), { code });
    };
    const cases: [Partial<RestorePlatform>, string][] = [
      [{ stageRestore: failing('BACKUP_CHANGED') }, 'BACKUP_CHANGED'],
      [{ stageRestore: failing('BACKUP_CORRUPT') }, 'BACKUP_CORRUPT'],
      [{ deleteIncoming: failing('RESTORE_FAILED') }, 'RESTORE_FAILED'],
      [{ preserveRetained: failing('STORAGE_ERROR') }, 'STORAGE_ERROR'],
      [{ saveAndClearSchedule: failing('RESTORE_FAILED') }, 'RESTORE_FAILED'],
      [{ purgeCaches: failing('RESTORE_FAILED') }, 'RESTORE_FAILED'],
      [{ acquireGate: failing('INVALID_STATE') }, 'INVALID_STATE'],
      [failAfterPrepared as never, 'RESTORE_FAILED'],
    ];
    for (const [override, code] of cases) {
      const { platform, calls } = fakePlatform(override);
      const e = await expectCode(
        prepare(
          platform,
          override === (failAfterPrepared as never) ? failAfterPrepared : {},
        ),
        code,
      );
      expect(e.cleanedUp).toBe(true);
      expect(calls).toContain('abort');
      expect(calls[calls.length - 1]).toBe(
        override.acquireGate ? 'abort' : 'release',
      );
      expect(fs.existsSync(restoreDir())).toBe(false);
      // Not blocked: the queue and the reconcile gate are free again.
      expect(await live.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
      await runReconcile(async () => undefined);
    }
  });

  test('a staged artifact with another schema stops in step 6', async () => {
    await source.execute('CREATE TABLE extra (x INTEGER)');
    const { platform, calls } = fakePlatform();
    await expectCode(prepare(platform), 'BACKUP_INCONSISTENT');
    expect(calls).not.toContain('retained');
    expect(calls).toContain('abort');
  });

  test('a manifest that differs from the staged rows stops in step 6', async () => {
    const base = fakePlatform();
    const { platform } = fakePlatform({
      stageRestore: async (id, expected) => ({
        ...(await base.platform.stageRestore(id, expected)),
        attachments: [],
      }),
    });
    await expectCode(prepare(platform), 'BACKUP_INCONSISTENT');
  });

  test('a failed cleanup keeps both gates held and starts no reconcile; a retry releases them only once it succeeds', async () => {
    let abortFails = 2;
    const { platform, calls } = fakePlatform({
      saveAndClearSchedule: async () => {
        calls.push('schedule');
        throw Object.assign(new Error(), { code: 'RESTORE_FAILED' });
      },
      abortRestore: async () => {
        calls.push('abort');
        if (abortFails-- > 0) {
          // e.g. restoreAndRearm failing: the native side keeps journal and files.
          throw Object.assign(new Error(), { code: 'RESTORE_RECOVERY_RETRY' });
        }
        fs.rmSync(restoreDir(), { recursive: true, force: true });
      },
    });
    const released: ReconcileRelease[] = [];
    onReconcileReleased(r => released.push(r));
    const reloaded: string[][] = [];
    onCompletedElsewhere(ids => reloaded.push(ids));

    const e = await expectCode(prepare(platform), 'RESTORE_RECOVERY_RETRY');
    expect(e.cleanedUp).toBe(false);
    expect(restoreCleanupPending()).toBe(true);
    // Review L-C: step 9's completion is announced for a reload, gate still held.
    expect(reloaded).toEqual([['fired']]);
    // Native gate never released, reconcile gate never released.
    expect(calls).not.toContain('release');
    expect(released).toEqual([]);
    const reconcile = jest.fn(async () => undefined);
    const waiting = runReconcile(reconcile);
    await new Promise<void>(r => setTimeout(() => r(), 20));
    expect(reconcile).not.toHaveBeenCalled();
    // The database queue is free (the live database was never touched).
    expect(await live.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    // No new preparation while the cleanup is pending.
    await expectCode(
      prepare(fakePlatform().platform),
      'RESTORE_RECOVERY_RETRY',
    );

    // A retry that fails again keeps everything held.
    await expect(retryRestoreCleanup()).rejects.toMatchObject({
      code: 'RESTORE_RECOVERY_RETRY',
      cleanedUp: false,
    });
    expect(calls.filter(c => c === 'release')).toEqual([]);
    expect(reconcile).not.toHaveBeenCalled();

    // A successful retry: native gate, then reconcile gate, then one reconcile.
    await retryRestoreCleanup();
    expect(calls.slice(-2)).toEqual(['abort', 'release']);
    expect(restoreCleanupPending()).toBe(false);
    await waiting;
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(released).toEqual([{ completed: ['fired'] }]);
    // Nothing left to retry.
    await expect(retryRestoreCleanup()).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  test('a native gate that fails to release is retried without repeating the cleanup', async () => {
    let releaseFails = true;
    const { platform, calls } = fakePlatform({
      releaseGate: async () => {
        calls.push('release');
        if (releaseFails) {
          releaseFails = false;
          throw Object.assign(new Error(), { code: 'RESTORE_FAILED' });
        }
      },
    });
    const e = await expectCode(
      prepare(platform, failAfterPrepared),
      'RESTORE_FAILED',
    );
    expect(e.cleanedUp).toBe(false);
    await retryRestoreCleanup();
    expect(calls.filter(c => c === 'abort')).toEqual(['abort']);
    expect(calls.filter(c => c === 'release')).toEqual(['release', 'release']);
  });

  test('releasing after a cleanup reports the reminders step 9 completed', async () => {
    const released: ReconcileRelease[] = [];
    onReconcileReleased(r => released.push(r));
    await expectCode(
      prepare(fakePlatform().platform, failAfterPrepared),
      'RESTORE_FAILED',
    );
    expect(released).toEqual([{ completed: ['fired'] }]);
    // And after a failure past step 9 too.
    released.length = 0;
    await expectCode(
      prepare(
        fakePlatform({
          purgeCaches: async () => {
            throw Object.assign(new Error(), { code: 'RESTORE_FAILED' });
          },
        }).platform,
        { firedOnceIds: async () => [] },
      ),
      'RESTORE_FAILED',
    );
    expect(released).toEqual([{ completed: [] }]);
  });

  test('restore files left without a journal are refused in step 1, holding nothing (review M-A)', async () => {
    // RestoreService.begin refuses them natively (RestoreServiceTest covers the files).
    const { platform, calls } = fakePlatform({
      beginRestore: async () => {
        calls.push('begin');
        throw Object.assign(new Error(), { code: 'RESTORE_STATE_UNKNOWN' });
      },
    });
    const e = await expectCode(prepare(platform), 'RESTORE_STATE_UNKNOWN');
    expect(e.cleanedUp).toBe(true);
    expect(calls).toEqual(['begin']);
    expect(restoreCleanupPending()).toBe(false);
    // Nothing held: the database queue, the reconcile gate and a new preparation work.
    expect(await live.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    await expect(runReconcile(async () => 'ran')).resolves.toBe('ran');
    const next = fakePlatform();
    await untilRestarted(prepare(next.platform), next.calls);
  });

  test('a wrong password stops before the gate', async () => {
    const { platform, calls } = fakePlatform({
      beginRestore: async () => {
        throw Object.assign(new Error(), {
          code: 'BACKUP_PASSWORD_OR_HEADER',
        });
      },
    });
    await expectCode(prepare(platform), 'BACKUP_PASSWORD_OR_HEADER');
    expect(calls).toEqual([]);
  });

  test('an unsupported schema version from the file stops in step 6', async () => {
    const base = fakePlatform();
    const { platform } = fakePlatform({
      stageRestore: async (id, expected) => ({
        ...(await base.platform.stageRestore(id, expected)),
        schemaVersion: 4,
      }),
    });
    const e = await expectCode(prepare(platform), 'BACKUP_UNSUPPORTED');
    expect(e).not.toBeInstanceOf(BackupError);
  });
});

describe('settleRestore (v2.5 §5.2, before startup recovery)', () => {
  test('waits for a restore of this runtime; after a swap it never settles', async () => {
    let failStage: (() => void) | undefined;
    const { platform } = fakePlatform({
      stageRestore: () =>
        new Promise((_, reject) => {
          failStage = () =>
            reject(Object.assign(new Error(), { code: 'BACKUP_CORRUPT' }));
        }),
    });
    const run = prepare(platform).catch(() => undefined);
    let settled = false;
    const waiting = settleRestore().then(() => (settled = true));
    for (let i = 0; i < 100 && !failStage; i++) {
      await tick();
    }
    await tick(20);
    expect(settled).toBe(false);
    failStage!();
    await run;
    await waiting;
    expect(settled).toBe(true);

    const swapped = fakePlatform();
    await untilRestarted(prepare(swapped.platform), swapped.calls);
    let after = false;
    settleRestore().then(() => (after = true));
    await tick(20);
    expect(after).toBe(false);
  });

  test('resumes a failed pre-swap cleanup first', async () => {
    let abortFails = 1;
    const { platform, calls } = fakePlatform({
      abortRestore: async () => {
        calls.push('abort');
        if (abortFails-- > 0) {
          throw Object.assign(new Error(), { code: 'RESTORE_RECOVERY_RETRY' });
        }
      },
    });
    await expectCode(
      prepare(platform, failAfterPrepared),
      'RESTORE_RECOVERY_RETRY',
    );
    expect(restoreCleanupPending()).toBe(true);
    await settleRestore();
    expect(restoreCleanupPending()).toBe(false);
    expect(calls.slice(-2)).toEqual(['abort', 'release']);
  });
});

describe('restoreEntryFor (§8.1 storage-error screen)', () => {
  test('maps every code', () => {
    const expected: Record<StorageErrorCode, string> = {
      DATABASE_UNREADABLE: 'restore',
      DATABASE_CORRUPT: 'restore',
      MIGRATION_FAILED: 'restore',
      SNAPSHOT_FAILED: 'restore',
      KEY_MISSING_FOR_DATABASE: 'unavailable',
      MASTER_KEY_MISSING: 'unavailable',
      UNWRAP_FAILED: 'unavailable',
      KEY_INVALIDATED: 'unavailable',
      KEY_NOT_FOUND: 'unavailable',
      INVALID_KEY_FORMAT: 'unavailable',
      NEWER_SCHEMA: 'update',
      ENVELOPE_UNSUPPORTED: 'update',
      KEYSTORE_UNAVAILABLE: 'retry',
      STORAGE_ERROR: 'retry',
      DATABASE_STATE_UNKNOWN: 'retry',
      WRITE_FAILED: 'retry',
      KEY_ALREADY_EXISTS: 'retry',
      INVALID_ARGUMENT: 'retry',
      RESTORE_STATE_UNKNOWN: 'retry',
      RESTORE_RECOVERY_RETRY: 'retry',
      RESTORE_VERIFY_RETRY: 'retry',
      RESTORE_UNAVAILABLE: 'retry',
      RESTORE_IN_PROGRESS: 'retry',
      UNKNOWN: 'retry',
    };
    for (const [code, entry] of Object.entries(expected)) {
      expect([code, restoreEntryFor(code as StorageErrorCode)]).toEqual([
        code,
        entry,
      ]);
    }
  });
});
