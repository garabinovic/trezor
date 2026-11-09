// Node built-ins via require: the project has no @types/node.
const fs = require('fs');
const path = require('path');
import { exportDatabase } from '../../src/backup/artifact';
import { BackupError } from '../../src/backup/platform';
import {
  prepareRestore,
  PrepareOptions,
  resetRestoreForTests,
  restoreCleanupPending,
  restoreEntryFor,
  retryRestoreCleanup,
} from '../../src/backup/restore';
import {
  RestoreError,
  RestorePlatform,
  RestoreStaged,
} from '../../src/backup/restorePlatform';
import {
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

// Restore preparation (spec v2.4 §8.2 steps 1–12, without the swap): the real
// step 6 (export to the device key, settings rewrite, Annex B checks) and step 9
// on the SQLCipher fake, with a recording fake of the native platform.
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
  extra: Partial<PrepareOptions> = {},
) =>
  prepareRestore({
    uri: 'content://backup',
    password: 'correct horse battery',
    database: live,
    firedOnceIds: async () => ['fired', 'missing-id'],
    platform,
    deviceKey: async () => DEVICE_KEY,
    ...extra,
  });

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

describe('prepareRestore (steps 1–12, then the pre-swap failure path)', () => {
  test('runs every step in order, stages S_db correctly and undoes the preparation', async () => {
    const before = await liveRows();
    const { platform, calls } = fakePlatform();
    let stagedDb: Record<string, unknown> | undefined;
    const result = await prepare(platform, {
      expected: { backupId: 'b'.repeat(32), trailer: 'f'.repeat(64) },
      onPrepared: async () => {
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
    expect(calls).toEqual([
      'begin',
      'gate',
      'stage:expected',
      'deleteIncoming',
      'retained',
      'schedule',
      'caches',
      'abort',
      'release',
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
    expect(result).toMatchObject({
      restoreId: 'e'.repeat(32),
      attachments: 1,
      schedule: 'saved',
      completedFired: ['fired'],
    });
    // S_db was created under the device key, never the artifact key.
    expect(mockFake.keys.get(path.join(restoreDir(), 'trezor.db'))).toBe(
      rawKey(DEVICE_KEY),
    );
    // Undone: staging gone. The live data is the live data (step 9 completed the
    // fired ONCE reminder, as a reconcile would).
    expect(fs.existsSync(restoreDir())).toBe(false);
    expect(
      await liveRaw.execute(
        "SELECT completed FROM reminders WHERE item_id = 'fired'",
      ),
    ).toEqual([{ completed: 1 }]);
    expect(
      (await liveRaw.execute('SELECT id FROM items ORDER BY id')).map(
        r => r.id,
      ),
    ).toEqual(['fired', 'live-note']);
    const after = await liveRows();
    expect(after.notes).toEqual(before.notes);
    expect(after.settings).toEqual(before.settings);
    expect(after.attachments).toEqual(before.attachments);
    // Nothing is left attached to the live connection.
    expect(
      (await live.execute('PRAGMA database_list')).map(r => r.name),
    ).not.toContain('staged');
  });

  test('invalid backed-up settings are dropped, and an unreadable live database inserts none', async () => {
    await source.execute(
      "UPDATE settings SET value = '\"blue\"' WHERE key = 'theme.preference'",
    );
    await source.execute(
      "UPDATE settings SET value = '\"yes\"' WHERE key = 'notifications.showDetails'",
    );
    await liveRaw.execute('DROP TABLE settings');
    const { platform } = fakePlatform();
    let settings: unknown;
    await prepare(platform, {
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
    expect(settings).toEqual([]);
  });

  test('from the error screen (no live database): no gate on a connection, no step 9', async () => {
    const { platform, calls } = fakePlatform();
    let liveSeen: unknown = 'unset';
    const result = await prepare(platform, {
      database: undefined,
      onPrepared: async (_, l) => {
        liveSeen = l;
      },
    });
    expect(liveSeen).toBeUndefined();
    expect(result.completedFired).toEqual([]);
    expect(calls).toContain('abort');
  });

  test('database work queued during the preparation waits and runs after it', async () => {
    const order: string[] = [];
    const { platform } = fakePlatform({
      purgeCaches: async () => {
        order.push('caches');
      },
    });
    let queued: Promise<unknown> | undefined;
    const run = prepare(platform, {
      firedOnceIds: async () => {
        queued = live
          .execute(
            "UPDATE notes SET body = 'later' WHERE item_id = 'live-note'",
          )
          .then(() => order.push('queued write'));
        return [];
      },
    });
    await run;
    await queued;
    expect(order).toEqual(['caches', 'queued write']);
  });

  test('a reconcile requested during the preparation runs only afterwards', async () => {
    const order: string[] = [];
    let reconcile: Promise<unknown> | undefined;
    const { platform } = fakePlatform({
      saveAndClearSchedule: async () => {
        reconcile = runReconcile(async () => {
          order.push('reconcile');
        });
        await new Promise<void>(r => setTimeout(() => r(), 10));
        order.push('schedule cleared');
        return 'saved';
      },
    });
    await prepare(platform);
    await reconcile;
    expect(order).toEqual(['schedule cleared', 'reconcile']);
  });

  test('active shares: wait until none, or cancel before anything is staged', async () => {
    const waiting = fakePlatform();
    waiting.setShares(1);
    const asked: number[] = [];
    await prepare(waiting.platform, {
      whileSharesActive: async active => {
        asked.push(active);
        waiting.setShares(0);
        return 'wait';
      },
    });
    expect(asked).toEqual([1]);

    const cancelled = fakePlatform();
    cancelled.setShares(2);
    await expectCode(prepare(cancelled.platform), 'RESTORE_CANCELLED');
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
    ];
    for (const [override, code] of cases) {
      const { platform, calls } = fakePlatform(override);
      const e = await expectCode(prepare(platform), code);
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

    const e = await expectCode(prepare(platform), 'RESTORE_RECOVERY_RETRY');
    expect(e.cleanedUp).toBe(false);
    expect(restoreCleanupPending()).toBe(true);
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
    const e = await expectCode(prepare(platform), 'RESTORE_FAILED');
    expect(e.cleanedUp).toBe(false);
    await retryRestoreCleanup();
    expect(calls.filter(c => c === 'abort')).toEqual(['abort']);
    expect(calls.filter(c => c === 'release')).toEqual(['release', 'release']);
  });

  test('releasing after a cleanup reports the reminders step 9 completed', async () => {
    const released: ReconcileRelease[] = [];
    onReconcileReleased(r => released.push(r));
    await prepare(fakePlatform().platform);
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
