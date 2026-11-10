// Node built-ins via require: the project has no @types/node.
const fs = require('fs');
const path = require('path');
import NativeTrezorVault from '../../src/native/NativeTrezorVault';
import { BackupError } from '../../src/backup/platform';
import {
  cancelRestore,
  canCancelRestore,
  checkPreviousData,
  classifyFailure,
  DatabaseTarget,
  RecoveryPlatform,
  RecoveryRun,
  recoverRestore,
  Verification,
  verifyRestoredDatabase,
} from '../../src/backup/recovery';
import { StorageError } from '../../src/storage/errors';
import { migrations, runMigrations } from '../../src/storage/migrations';
import { adaptOpSqlite } from '../../src/storage/opSqliteAdapter';
import { SqlDatabase } from '../../src/storage/sql';
import { rawKey } from '../../src/storage/sqlcipher';
import { FakeSqlCipher } from '../../test-utils/fakeSqlCipher';

// Restore recovery, JS half (spec v2.5 §1, §2, §7): verification of the
// restored database and the previous one on the SQLCipher fake, and the
// recovery loop against a recording fake of the native half. The real
// SQLCipher harness (scratchpad sqlcipher-check/recovery.check.ts) repeats
// the verification cases on SQLCipher 4.
let mockFake: FakeSqlCipher;

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (params: never) => mockFake.open(params),
  isSQLCipher: () => true,
  get ANDROID_DATABASE_PATH() {
    return `${mockFake.dir}/`;
  },
}));

const KEY = '11'.repeat(32);
const OTHER_KEY = '22'.repeat(32);
const ID = '01a1a0dd-991f-783c-9531-3fab9ef40001';
const SHA = 'ab'.repeat(32);

const openFake = (name: string, key = KEY) =>
  adaptOpSqlite(
    mockFake.open({ name, encryptionKey: rawKey(key) }) as never,
  ) as SqlDatabase;

/** A database at schema `version` with one document and its attachment row. */
async function database(name: string, version = 3, key = KEY) {
  const db = openFake(name, key);
  await runMigrations(
    db,
    migrations.filter(m => m.version <= version),
  );
  await db.execute(
    "INSERT INTO items (id, type, title, pinned, created_at, updated_at) VALUES ('d', 'document', 'Doc', 0, 1, 1)",
  );
  await db.execute(
    "INSERT INTO documents (item_id, kind) VALUES ('d', 'receipt')",
  );
  // The attachments table arrives with migration 3.
  if (version >= 3) {
    await db.execute(
      "INSERT INTO attachments (id, item_id, role, position, file_name, mime_type, size_bytes, sha256, format_version, created_at) VALUES (?, 'd', 'document', 0, 'a.pdf', 'application/pdf', 1, ?, 1, 1)",
      [ID, SHA],
    );
  }
  db.close();
}

const target = (name: string, ids = [ID]): DatabaseTarget => ({
  location: mockFake.dir,
  name,
  attachmentIds: ids,
});

const key = async () => KEY;

beforeEach(() => {
  mockFake = new FakeSqlCipher();
});

afterEach(() => {
  mockFake.cleanup();
});

describe('classifyFailure (v2.5 §1.3)', () => {
  const coded = (code: number) => Object.assign(new Error('x'), { code });
  const message = (code: number) =>
    new Error(
      `[op-sqlite] sqlite query error: x (code ${code}, extended code ${code})`,
    );

  test('NOTADB and CORRUPT, and failed checks, are deterministic', () => {
    for (const e of [
      coded(26),
      coded(11),
      message(26),
      message(11),
      coded(267),
    ]) {
      expect(classifyFailure(e)).toBe('fail');
    }
    for (const code of [
      'BACKUP_CORRUPT',
      'BACKUP_INCONSISTENT',
      'BACKUP_UNSUPPORTED',
    ] as const) {
      expect(classifyFailure(new BackupError(code))).toBe('fail');
    }
  });

  test('every other code, no code and unknown codes are transient (D3)', () => {
    for (const code of [5, 6, 7, 8, 9, 10, 13, 14, 21, 99, 266, 1034]) {
      expect([code, classifyFailure(coded(code))]).toEqual([code, 'retry']);
      expect([code, classifyFailure(message(code))]).toEqual([code, 'retry']);
    }
    expect(classifyFailure(new Error('[op-sqlite] database is closed'))).toBe(
      'retry',
    );
    expect(classifyFailure(undefined)).toBe('retry');
  });
});

describe('verifyRestoredDatabase', () => {
  test('a restored schema-3 database with the same attachment ids passes', async () => {
    await database('trezor.db');
    expect(await verifyRestoredDatabase(target('trezor.db'), key)).toBe('pass');
    // Opened failOnCreate, never created.
    expect(mockFake.openedParams.at(-2)).toMatchObject({
      name: 'trezor.db',
      failOnCreate: true,
    });
  });

  test('deterministic failures: wrong key, other ids, damage, other schema or version', async () => {
    await database('trezor.db', 3, OTHER_KEY);
    expect(await verifyRestoredDatabase(target('trezor.db'), key)).toBe('fail');

    await database('ids.db');
    expect(await verifyRestoredDatabase(target('ids.db', []), key)).toBe(
      'fail',
    );
    expect(
      await verifyRestoredDatabase(target('ids.db', [ID, `${ID}x`]), key),
    ).toBe('fail');

    await database('schema.db');
    const extra = openFake('schema.db');
    await extra.execute('CREATE TABLE extra (x INTEGER)');
    extra.close();
    expect(await verifyRestoredDatabase(target('schema.db'), key)).toBe('fail');

    await database('version.db');
    const v = openFake('version.db');
    await v.execute('PRAGMA user_version = 4');
    v.close();
    expect(await verifyRestoredDatabase(target('version.db'), key)).toBe(
      'fail',
    );

    await database('damaged.db');
    mockFake.cipherIntegrityRows = [{ cipher_integrity_check: 'page 1' }];
    expect(await verifyRestoredDatabase(target('damaged.db'), key)).toBe(
      'fail',
    );
  });

  test('a missing file is transient (never "corrupt"), and no file is created', async () => {
    expect(await verifyRestoredDatabase(target('missing.db'), key)).toBe(
      'retry',
    );
    expect(fs.existsSync(path.join(mockFake.dir, 'missing.db'))).toBe(false);
  });

  test('key errors: gone → unavailable, temporarily unavailable → retry', async () => {
    await database('trezor.db');
    const failing = (code: string) => async () => {
      throw new StorageError(code as never, 'x');
    };
    for (const code of [
      'KEY_NOT_FOUND',
      'MASTER_KEY_MISSING',
      'KEY_INVALIDATED',
      'UNWRAP_FAILED',
      'INVALID_KEY_FORMAT',
    ]) {
      expect(
        await verifyRestoredDatabase(target('trezor.db'), failing(code)),
      ).toBe('unavailable');
    }
    for (const code of ['KEYSTORE_UNAVAILABLE', 'STORAGE_ERROR', 'UNKNOWN']) {
      expect(
        await verifyRestoredDatabase(target('trezor.db'), failing(code)),
      ).toBe('retry');
    }
  });

  test('the default key comes from the vault, and no key is ever created', async () => {
    await database('trezor.db');
    const vault = NativeTrezorVault as jest.Mocked<typeof NativeTrezorVault>;
    vault.hasKey.mockResolvedValueOnce(false);
    expect(await verifyRestoredDatabase(target('trezor.db'))).toBe(
      'unavailable',
    );
    vault.hasKey.mockResolvedValueOnce(true);
    vault.getKey.mockResolvedValueOnce(KEY);
    expect(await verifyRestoredDatabase(target('trezor.db'))).toBe('pass');
    expect(vault.createKey).not.toHaveBeenCalled();
  });

  test('L6: a later migration in this build does not change the schema-3 reference', async () => {
    await database('trezor.db');
    let outcome: Verification | undefined;
    let future: string[] = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/storage/migrations', () => {
        const actual = jest.requireActual('../../src/storage/migrations');
        return {
          ...actual,
          migrations: [
            ...actual.migrations,
            {
              version: 4,
              description: 'A future migration',
              up: async (tx: SqlDatabase) => {
                await tx.execute('CREATE TABLE future (x INTEGER)');
              },
            },
          ],
        };
      });
      const recovery = require('../../src/backup/recovery');
      outcome = await recovery.verifyRestoredDatabase(target('trezor.db'), key);
      // The newer build really has the extra table at its latest version.
      const artifact = require('../../src/backup/artifact');
      future = (await artifact.referenceSchema(4)).map(
        (r: { name: string }) => r.name,
      );
    });
    expect(future).toContain('future');
    expect(outcome).toBe('pass');
  });
});

describe('checkPreviousData (decision D4)', () => {
  test('the previous database at its own schema version, with its files, checks out read-only', async () => {
    await database('previous.db');
    expect(await checkPreviousData(target('previous.db'), key)).toBe(true);
    expect(mockFake.openedParams.at(-2)).toMatchObject({
      name: 'previous.db',
      readOnly: true,
    });
    // An older schema is compared with that version's schema; nothing migrates it.
    await database('v2.db', 2);
    expect(await checkPreviousData(target('v2.db'), key)).toBe(true);
    const v2 = openFake('v2.db');
    expect(await v2.execute('PRAGMA user_version')).toEqual([
      { user_version: 2 },
    ]);
    v2.close();
  });

  test('anything wrong withholds Cancel restore', async () => {
    await database('previous.db');
    // A row without its file.
    expect(await checkPreviousData(target('previous.db', []), key)).toBe(false);
    // Wrong key, missing file, key unavailable.
    expect(
      await checkPreviousData(target('previous.db'), async () => OTHER_KEY),
    ).toBe(false);
    expect(await checkPreviousData(target('none.db'), key)).toBe(false);
    expect(
      await checkPreviousData(target('previous.db'), async () => {
        throw new StorageError('KEYSTORE_UNAVAILABLE', 'x');
      }),
    ).toBe(false);
    // Damage, an unknown schema, a newer version.
    mockFake.cipherIntegrityRows = [{ cipher_integrity_check: 'x' }];
    expect(await checkPreviousData(target('previous.db'), key)).toBe(false);
    mockFake.cipherIntegrityRows = [];
    await database('extra.db');
    const extra = openFake('extra.db');
    await extra.execute('CREATE TABLE extra (x INTEGER)');
    extra.close();
    expect(await checkPreviousData(target('extra.db'), key)).toBe(false);
    await database('newer.db');
    const newer = openFake('newer.db');
    await newer.execute('PRAGMA user_version = 99');
    newer.close();
    expect(await checkPreviousData(target('newer.db'), key)).toBe(false);
  });
});

/** The native half, scripted: each recoveryRun answer in turn. */
function fakeRecovery(
  runs: (RecoveryRun | Error)[],
  overrides: Partial<RecoveryPlatform> = {},
) {
  const calls: string[] = [];
  const platform: RecoveryPlatform = {
    recoveryBegin: async () => {
      calls.push('begin');
    },
    recoveryRun: async () => {
      calls.push('run');
      const next = runs.shift();
      if (!next) {
        throw new Error('no more runs');
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    finishVerification: async outcome => {
      calls.push(`finish:${outcome}`);
    },
    previousData: async () => {
      calls.push('previous');
      return target('previous.db');
    },
    cancelRestore: async () => {
      calls.push('cancel');
    },
    recoveryEnd: async () => {
      calls.push('end');
    },
    ...overrides,
  };
  return { platform, calls };
}

const coded = (code: string) => Object.assign(new Error('x'), { code });

async function expectStorageCode(run: Promise<unknown>, code: string) {
  await expect(run).rejects.toBeInstanceOf(StorageError);
  await expect(run).rejects.toMatchObject({ code });
}

describe('recoverRestore (v2.5 §7.2)', () => {
  test('nothing to recover: done', async () => {
    const { platform, calls } = fakeRecovery([{ status: 'done' }]);
    await recoverRestore(platform, key);
    expect(calls).toEqual(['begin', 'run', 'end']);
  });

  test('verifying: a passing database is reported and recovery continues to cleanup', async () => {
    await database('trezor.db');
    const { platform, calls } = fakeRecovery([
      { status: 'verify', ...target('trezor.db') },
      { status: 'done' },
    ]);
    await recoverRestore(platform, key);
    expect(calls).toEqual(['begin', 'run', 'finish:pass', 'run', 'end']);
  });

  test('a deterministic failure is reported, and recovery continues with the rollback', async () => {
    await database('trezor.db', 3, OTHER_KEY);
    const { platform, calls } = fakeRecovery([
      { status: 'verify', ...target('trezor.db') },
      { status: 'done' },
    ]);
    await recoverRestore(platform, key);
    expect(calls).toEqual(['begin', 'run', 'finish:fail', 'run', 'end']);
  });

  test('transient and key failures keep everything and stop with their codes', async () => {
    const transient = fakeRecovery([
      { status: 'verify', ...target('missing.db') },
    ]);
    await expectStorageCode(
      recoverRestore(transient.platform, key),
      'RESTORE_VERIFY_RETRY',
    );
    expect(transient.calls).toEqual(['begin', 'run', 'finish:retry', 'end']);

    await database('trezor.db');
    const gone = fakeRecovery([{ status: 'verify', ...target('trezor.db') }]);
    await expectStorageCode(
      recoverRestore(gone.platform, async () => {
        throw new StorageError('KEY_INVALIDATED', 'x');
      }),
      'RESTORE_UNAVAILABLE',
    );
    expect(gone.calls).toEqual(['begin', 'run', 'finish:unavailable', 'end']);
  });

  test('native codes pass through; anything else is a recovery retry; the lock is always released', async () => {
    for (const code of [
      'RESTORE_STATE_UNKNOWN',
      'RESTORE_RECOVERY_RETRY',
      'RESTORE_VERIFY_RETRY',
    ]) {
      const { platform, calls } = fakeRecovery([coded(code)]);
      await expectStorageCode(recoverRestore(platform, key), code);
      expect(calls.at(-1)).toBe('end');
    }
    const odd = fakeRecovery([coded('RESTORE_FAILED')]);
    await expectStorageCode(
      recoverRestore(odd.platform, key),
      'RESTORE_RECOVERY_RETRY',
    );
    // Another actor holds the lock: nothing ran, nothing to release.
    const busy = fakeRecovery([], {
      recoveryBegin: async () => {
        throw coded('RESTORE_IN_PROGRESS');
      },
    });
    await expectStorageCode(
      recoverRestore(busy.platform, key),
      'RESTORE_IN_PROGRESS',
    );
    expect(busy.calls).toEqual([]);
  });

  test('a native side that keeps asking for verification is stopped', async () => {
    await database('trezor.db');
    const runs = Array.from({ length: 10 }, () => ({
      status: 'verify' as const,
      ...target('trezor.db'),
    }));
    const { platform, calls } = fakeRecovery(runs);
    await expectStorageCode(
      recoverRestore(platform, key),
      'RESTORE_RECOVERY_RETRY',
    );
    expect(calls.at(-1)).toBe('end');
  });
});

describe('Cancel restore (v2.5 §2)', () => {
  test('offered only when native allows it and the previous data checks out', async () => {
    await database('previous.db');
    const ok = fakeRecovery([]);
    expect(await canCancelRestore(ok.platform, key)).toBe(true);
    expect(ok.calls).toEqual(['begin', 'previous', 'end']);

    const refused = fakeRecovery([], {
      previousData: async () => {
        throw coded('RESTORE_CANCEL_UNAVAILABLE');
      },
    });
    expect(await canCancelRestore(refused.platform, key)).toBe(false);
    expect(refused.calls).toEqual(['begin', 'end']);

    const busy = fakeRecovery([], {
      recoveryBegin: async () => {
        throw coded('RESTORE_IN_PROGRESS');
      },
    });
    expect(await canCancelRestore(busy.platform, key)).toBe(false);

    const damaged = fakeRecovery([], {
      previousData: async () => target('previous.db', []),
    });
    expect(await canCancelRestore(damaged.platform, key)).toBe(false);
  });

  test('cancelling checks everything again and only then asks native to roll back', async () => {
    await database('previous.db');
    const ok = fakeRecovery([]);
    await cancelRestore(ok.platform, key);
    expect(ok.calls).toEqual(['begin', 'previous', 'cancel', 'end']);

    const damaged = fakeRecovery([], {
      previousData: async () => target('previous.db', []),
    });
    await expectStorageCode(
      cancelRestore(damaged.platform, key),
      'RESTORE_VERIFY_RETRY',
    );
    expect(damaged.calls).not.toContain('cancel');
    expect(damaged.calls.at(-1)).toBe('end');
  });
});
