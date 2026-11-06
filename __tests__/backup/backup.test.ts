// Node built-ins via require: the project has no @types/node.
const fs = require('fs');
const path = require('path');
import { checkBackup, createBackup } from '../../src/backup/backup';
import {
  ArtifactAttachment,
  BackupError,
  BackupPlatform,
  Begun,
  Staged,
} from '../../src/backup/platform';
import { migrations, runMigrations } from '../../src/storage/migrations';
import { adaptOpSqlite } from '../../src/storage/opSqliteAdapter';
import {
  SerialDatabase,
  serializeDatabase,
} from '../../src/storage/serialDatabase';
import { rawKey } from '../../src/storage/sqlcipher';
import { FakeSqlCipher } from '../../test-utils/fakeSqlCipher';

// The real export and artifact checks (src/backup/artifact.ts) on the SQLCipher fake;
// the native half is a recording fake platform.
let mockFake: FakeSqlCipher;

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (params: never) => mockFake.open(params),
  isSQLCipher: () => true,
  get ANDROID_DATABASE_PATH() {
    return `${mockFake.dir}/`;
  },
}));

/** A fake connection as op-sqlite's DB (the fake implements what the adapter uses). */
const openFake = (params: Parameters<FakeSqlCipher['open']>[0]) =>
  adaptOpSqlite(mockFake.open(params) as never);

const LIVE_KEY = '11'.repeat(32);
const BACKUP_KEY = '22'.repeat(32);
const SHA = 'ab'.repeat(32);

let live: SerialDatabase;

async function openLive(version = 3) {
  const raw = openFake({ name: 'trezor.db', encryptionKey: rawKey(LIVE_KEY) });
  await runMigrations(
    raw,
    migrations.filter(m => m.version <= version),
  );
  live = serializeDatabase(raw);
}

async function addDocument(id: string, attachments: number) {
  await live.execute(
    "INSERT INTO items (id, type, title, pinned, created_at, updated_at) VALUES (?, 'document', 'Doc', 0, 1, 1)",
    [id],
  );
  await live.execute(
    "INSERT INTO documents (item_id, kind) VALUES (?, 'document')",
    [id],
  );
  for (let i = 0; i < attachments; i++) {
    await addAttachment(`${id}-a${i}`, id, i);
  }
}

async function addAttachment(id: string, itemId: string, position: number) {
  await live.execute(
    "INSERT INTO attachments (id, item_id, role, position, file_name, mime_type, size_bytes, sha256, format_version, created_at) VALUES (?, ?, 'document', ?, 'scan.pdf', 'application/pdf', 1234, ?, 1, 1)",
    [id, itemId, position, SHA],
  );
}

/** Records every call; each step can be replaced per test. */
function fakePlatform(overrides: Partial<BackupPlatform> = {}) {
  const calls: string[] = [];
  const begun: Begun = {
    sessionId: 's1',
    location: path.join(mockFake.dir, 'backup'),
    exportName: 'export.db',
    key: BACKUP_KEY,
  };
  fs.mkdirSync(begun.location, { recursive: true });
  let written: ArtifactAttachment[] | null = null;
  const staged = (): Staged => ({
    checkId: 'c1',
    location: begun.location,
    name: begun.exportName,
    key: BACKUP_KEY,
    backupId: 'b'.repeat(32),
    trailer: 'f'.repeat(64),
    schemaVersion: 3,
    attachments: (written ?? []).map(({ itemId: _, ...a }) => a),
  });
  const platform: BackupPlatform = {
    validatePassword: async () => {},
    beginBackup: async () => {
      calls.push('begin');
      return begun;
    },
    pickDestination: async () => {
      calls.push('pick');
      return 'picked';
    },
    writeBackup: async (_, rows) => {
      calls.push('write');
      written = rows;
      return 4096;
    },
    readBack: async () => {
      calls.push('readBack');
      return staged();
    },
    completeBackup: async () => {
      calls.push('complete');
    },
    abortBackup: async () => {
      calls.push('abort');
      return 'deleted';
    },
    pickBackupFile: async () => {
      calls.push('pickFile');
      return 'content://backup';
    },
    checkBackup: async () => {
      calls.push('check');
      return staged();
    },
    finishCheck: async () => {
      calls.push('finishCheck');
    },
    takeIncompleteNotice: async () => null,
    ...overrides,
  };
  return { platform, calls, begun, written: () => written, staged };
}

const attachedNames = async () =>
  (await live.execute('PRAGMA database_list')).map(d => d.name);

const create = (platform: BackupPlatform) =>
  createBackup({
    database: live,
    password: 'correct horse battery',
    confirmation: 'correct horse battery',
    suggestedName: 'trezor.tzbk',
    platform,
  });

async function expectCode(run: Promise<unknown>, code: string) {
  const e = await run.then(
    () => {
      throw new Error('expected a failure');
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(BackupError);
  expect((e as BackupError).code).toBe(code);
  return e as BackupError;
}

beforeEach(async () => {
  mockFake = new FakeSqlCipher();
  await openLive();
});

afterEach(() => {
  live.close();
  mockFake.cleanup();
});

describe('createBackup', () => {
  test('exports, verifies, writes the export rows, reads back and completes', async () => {
    await addDocument('d1', 2);
    await addDocument('d2', 1);
    const { platform, calls, begun, written } = fakePlatform();
    const result = await create(platform);
    expect(result).toEqual({
      status: 'created',
      bytes: 4096,
      backupId: 'b'.repeat(32),
    });
    expect(calls).toEqual([
      'begin',
      'pick',
      'write',
      'readBack',
      'finishCheck',
      'complete',
    ]);
    expect(written()!.map(r => [r.id, r.itemId])).toEqual([
      ['d1-a0', 'd1'],
      ['d1-a1', 'd1'],
      ['d2-a0', 'd2'],
    ]);
    // The export is a separate file under the backup key, with the schema version.
    const exportFile = path.join(begun.location, begun.exportName);
    expect(mockFake.keys.get(exportFile)).toBe(rawKey(BACKUP_KEY));
    const copy = openFake({
      name: begun.exportName,
      location: begun.location,
      encryptionKey: rawKey(BACKUP_KEY),
    });
    expect(await copy.execute('PRAGMA user_version')).toEqual([
      { user_version: 3 },
    ]);
    expect(await copy.execute('SELECT count(*) AS n FROM attachments')).toEqual(
      [{ n: 3 }],
    );
    copy.close();
    // The live database is detached and unchanged.
    expect(await attachedNames()).toEqual(['main', 'temp']);
    expect(await live.execute('SELECT count(*) AS n FROM attachments')).toEqual(
      [{ n: 3 }],
    );
  });

  test('no attachments: an empty row list', async () => {
    const { platform, written } = fakePlatform();
    expect((await create(platform)).status).toBe('created');
    expect(written()).toEqual([]);
  });

  test('cancelled destination: aborts, nothing exported', async () => {
    const { platform, calls, begun } = fakePlatform({
      pickDestination: async () => 'cancelled',
    });
    expect(await create(platform)).toEqual({ status: 'cancelled' });
    expect(calls).toEqual(['begin', 'abort']);
    expect(fs.readdirSync(begun.location)).toEqual([]);
  });

  test('a password rejected by native code is reported unchanged, nothing else runs', async () => {
    const { platform, calls } = fakePlatform({
      beginBackup: async () => {
        throw Object.assign(new Error('x'), { code: 'PASSWORD_LENGTH' });
      },
    });
    await expectCode(create(platform), 'PASSWORD_LENGTH');
    expect(calls).toEqual([]);
  });

  test('the gate: database work queued during the write waits for it', async () => {
    let release!: () => void;
    const held = new Promise<void>(r => (release = r));
    const order: string[] = [];
    let entered!: () => void;
    const writing = new Promise<void>(r => (entered = r));
    const { platform } = fakePlatform({
      writeBackup: async () => {
        entered();
        await held;
        order.push('write done');
        return 1;
      },
    });
    const backup = create(platform);
    await writing;
    const insert = live
      .execute(
        "INSERT INTO items (id, type, title, pinned, created_at, updated_at) VALUES ('late', 'note', 'Late', 0, 2, 2)",
      )
      .then(() => order.push('insert'));
    await new Promise<void>(r => setTimeout(() => r(), 20));
    expect(order).toEqual([]);
    release();
    await backup;
    await insert;
    expect(order).toEqual(['write done', 'insert']);
    // The late item is live, but not in the export.
    const copy = openFake({
      name: 'export.db',
      location: path.join(mockFake.dir, 'backup'),
      encryptionKey: rawKey(BACKUP_KEY),
    });
    expect(
      await copy.execute("SELECT count(*) AS n FROM items WHERE id = 'late'"),
    ).toEqual([{ n: 0 }]);
    copy.close();
  });

  test('a failed write releases the gate and aborts', async () => {
    const { platform, calls } = fakePlatform({
      writeBackup: async () => {
        throw Object.assign(new Error('x'), {
          code: 'DESTINATION_UNVERIFIED',
        });
      },
    });
    const e = await expectCode(create(platform), 'DESTINATION_UNVERIFIED');
    expect(e.destination).toBe('deleted');
    expect(calls).toContain('abort');
    expect(calls).not.toContain('complete');
    // Not blocked.
    expect(await live.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });

  test('an unreadable attachment: code, attachment, item and reason', async () => {
    await addDocument('d1', 1);
    const { platform } = fakePlatform({
      writeBackup: async () => {
        throw Object.assign(new Error(), {
          code: 'BACKUP_ATTACHMENT_UNREADABLE',
          message: JSON.stringify({
            attachmentId: 'd1-a0',
            itemId: 'd1',
            reason: 'MISSING',
          }),
        });
      },
    });
    const e = await expectCode(
      create(platform),
      'BACKUP_ATTACHMENT_UNREADABLE',
    );
    expect(e.attachment).toEqual({
      attachmentId: 'd1-a0',
      itemId: 'd1',
      reason: 'MISSING',
    });
    expect(e.destination).toBe('deleted');
  });

  test('a file the provider refuses to delete is reported as remaining', async () => {
    const { platform } = fakePlatform({
      readBack: async () => {
        throw Object.assign(new Error(), { code: 'BACKUP_CORRUPT' });
      },
      abortBackup: async () => 'remains',
    });
    const e = await expectCode(create(platform), 'BACKUP_CORRUPT');
    expect(e.destination).toBe('remains');
  });

  test('a failing abort is reported as a file that may remain', async () => {
    const { platform } = fakePlatform({
      readBack: async () => {
        throw new Error('anything');
      },
      abortBackup: async () => {
        throw new Error('gone');
      },
    });
    const e = await expectCode(create(platform), 'BACKUP_FAILED');
    expect(e.destination).toBe('remains');
  });

  test('read back: a manifest that differs from the artifact rejects', async () => {
    await addDocument('d1', 1);
    const helper = fakePlatform();
    const { platform, calls } = fakePlatform({
      readBack: async () => {
        const s = helper.staged();
        return {
          ...s,
          attachments: [{ ...s.attachments[0], sizeBytes: 1 }],
        };
      },
    });
    // The helper's view of the rows is empty; feed the real ones in through write.
    platform.writeBackup = async (_, rows) => {
      await helper.platform.writeBackup('s1', rows);
      return 1;
    };
    await expectCode(create(platform), 'BACKUP_INCONSISTENT');
    // (readBack and write are replaced here, so they don't record themselves.)
    expect(calls).toEqual(['begin', 'pick', 'finishCheck', 'abort']);
  });

  test('read back: a missing manifest entry rejects', async () => {
    await addDocument('d1', 1);
    const { platform } = fakePlatform({
      readBack: async () => ({
        checkId: 'c1',
        location: path.join(mockFake.dir, 'backup'),
        name: 'export.db',
        key: BACKUP_KEY,
        backupId: 'b'.repeat(32),
        trailer: '0'.repeat(64),
        schemaVersion: 3,
        attachments: [],
      }),
    });
    await expectCode(create(platform), 'BACKUP_INCONSISTENT');
  });

  test('read back under the wrong key is corrupt', async () => {
    const helper = fakePlatform();
    const { platform } = fakePlatform({
      readBack: async () => ({ ...helper.staged(), key: '33'.repeat(32) }),
    });
    await expectCode(create(platform), 'BACKUP_CORRUPT');
  });

  test('export failure: DETACHed, aborted, live unchanged', async () => {
    await addDocument('d1', 1);
    mockFake.exportFault = 'midway';
    const { platform, calls } = fakePlatform();
    await expectCode(create(platform), 'BACKUP_FAILED');
    expect(calls).toEqual(['begin', 'pick', 'abort']);
    expect(await attachedNames()).toEqual(['main', 'temp']);
    expect(await live.execute('SELECT count(*) AS n FROM items')).toEqual([
      { n: 1 },
    ]);
  });

  test('the export is the source of truth: the manifest is built from it', async () => {
    // corrupt-copy empties `notes` in the export: still a valid artifact, and the manifest
    // (built from the export, not the live database) agrees with it. Documents that the
    // backup holds exactly what sqlcipher_export produced.
    mockFake.exportFault = 'corrupt-copy';
    const { platform } = fakePlatform();
    expect((await create(platform)).status).toBe('created');
  });

  test('a foreign-key violation in the export is inconsistent', async () => {
    // A damaged live database: written with enforcement off.
    await live.execute('PRAGMA foreign_keys = OFF');
    await addAttachment('orphan', 'no-such-item', 0);
    await live.execute('PRAGMA foreign_keys = ON');
    const { platform, calls } = fakePlatform();
    await expectCode(create(platform), 'BACKUP_INCONSISTENT');
    expect(calls).not.toContain('write');
  });

  test('other cipher settings are unsupported', async () => {
    mockFake.cipher.cipher_page_size = '1024';
    const { platform, calls } = fakePlatform();
    await expectCode(create(platform), 'BACKUP_UNSUPPORTED');
    expect(calls).not.toContain('write');
  });

  test('a SQLCipher 3 artifact is unsupported', async () => {
    mockFake.cipher.cipher_version = '3.4.2';
    await expectCode(create(fakePlatform().platform), 'BACKUP_UNSUPPORTED');
  });

  test('cipher integrity damage is corrupt', async () => {
    mockFake.cipherIntegrityRows = [{ cipher_integrity_check: 'page 2' }];
    await expectCode(create(fakePlatform().platform), 'BACKUP_CORRUPT');
  });

  test('a schema differing from the app’s is inconsistent', async () => {
    await live.execute('CREATE TABLE extra (x INTEGER)');
    await expectCode(create(fakePlatform().platform), 'BACKUP_INCONSISTENT');
  });

  test('a staged schema version other than 3 is unsupported', async () => {
    const helper = fakePlatform();
    const { platform } = fakePlatform({
      readBack: async () => ({ ...helper.staged(), schemaVersion: 4 }),
    });
    await expectCode(create(platform), 'BACKUP_UNSUPPORTED');
  });
});

describe('checkBackup', () => {
  async function stageExport() {
    await addDocument('d1', 2);
    // A real export to check, as Check backup would stage it.
    const { platform } = fakePlatform();
    await create(platform);
  }

  test('valid backup: result, staged files finished, live untouched', async () => {
    await stageExport();
    const before = await live.execute('SELECT * FROM attachments ORDER BY id');
    const helper = fakePlatform();
    const rows = (await live.execute(
      'SELECT id FROM attachments ORDER BY id',
    )) as { id: string }[];
    const { platform, calls } = fakePlatform({
      checkBackup: async () => ({
        ...helper.staged(),
        attachments: rows.map(r => ({
          id: r.id,
          fileName: 'scan.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1234,
          sha256: SHA,
          formatVersion: 1,
        })),
      }),
    });
    expect(
      await checkBackup({ password: 'correct horse battery', platform }),
    ).toEqual({
      status: 'valid',
      backupId: 'b'.repeat(32),
      trailer: 'f'.repeat(64),
      attachments: 2,
    });
    // (check is replaced here, so it doesn't record itself.)
    expect(calls).toEqual(['pickFile', 'finishCheck']);
    expect(await live.execute('SELECT * FROM attachments ORDER BY id')).toEqual(
      before,
    );
  });

  test('cancelled picker', async () => {
    const { platform, calls } = fakePlatform({
      pickBackupFile: async () => null,
    });
    expect(await checkBackup({ password: 'x', platform })).toEqual({
      status: 'cancelled',
    });
    expect(calls).toEqual([]);
  });

  test('wrong password from native code', async () => {
    const { platform, calls } = fakePlatform({
      checkBackup: async () => {
        throw Object.assign(new Error(), {
          code: 'BACKUP_PASSWORD_OR_HEADER',
        });
      },
    });
    await expectCode(
      checkBackup({ password: 'x', platform }),
      'BACKUP_PASSWORD_OR_HEADER',
    );
    expect(calls).toEqual(['pickFile']);
  });

  test('manifest mismatch: rejected, staged files still finished', async () => {
    await stageExport();
    const helper = fakePlatform();
    const { platform, calls } = fakePlatform({
      checkBackup: async () => ({ ...helper.staged(), attachments: [] }),
    });
    await expectCode(
      checkBackup({ password: 'x', platform }),
      'BACKUP_INCONSISTENT',
    );
    expect(calls).toEqual(['pickFile', 'finishCheck']);
  });

  test('an unknown native error carries no detail', async () => {
    const { platform } = fakePlatform({
      checkBackup: async () => {
        throw Object.assign(new Error('secret text'), { code: 'WHATEVER' });
      },
    });
    const e = await expectCode(
      checkBackup({ password: 'x', platform }),
      'BACKUP_FAILED',
    );
    expect(e.message).toBe('BACKUP_FAILED');
  });
});
