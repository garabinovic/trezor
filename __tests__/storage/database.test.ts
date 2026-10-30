// Node built-in via require: the project has no @types/node.
const fs = require('fs');
import { FakeSqlCipher } from '../../test-utils/fakeSqlCipher';

// --- Fakes for op-sqlite (SQLCipher) and both native modules -----------------

let mockFake: FakeSqlCipher;
const mockKeys = new Map<string, string>();
let mockKeyOverride: unknown;
let mockFileStateFailure: Error | null = null;

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (params: never) => mockFake.open(params),
  isSQLCipher: () => true,
  get ANDROID_DATABASE_PATH() {
    return `${mockFake.dir}/`;
  },
}));

jest.mock('../../src/native/NativeTrezorVault', () => ({
  __esModule: true,
  default: {
    hasKey: jest.fn(async (id: string) => mockKeys.has(id)),
    createKey: jest.fn(async (id: string) => {
      if (mockKeys.has(id)) {
        throw Object.assign(new Error('exists'), {
          code: 'KEY_ALREADY_EXISTS',
        });
      }
      mockKeys.set(id, require('crypto').randomBytes(32).toString('hex'));
      return mockKeyOverride ?? mockKeys.get(id);
    }),
    getKey: jest.fn(async (id: string) => mockKeyOverride ?? mockKeys.get(id)),
    randomBytesHex: (n: number) =>
      require('crypto').randomBytes(n).toString('hex'),
    getMasterKeySecurityLevel: jest.fn(async () => 'software'),
  },
}));

jest.mock('../../src/native/NativeTrezorDatabaseFiles', () => {
  const nodeFs = require('fs');
  const nodePath = require('path');
  const at = (name: string) => nodePath.join(mockFake.dir, name);
  return {
    __esModule: true,
    default: {
      fileState: jest.fn(async (name: string) => {
        if (mockFileStateFailure) {
          throw mockFileStateFailure;
        }
        return nodeFs.existsSync(at(name)) ? 'present' : 'absent';
      }),
      renameNoReplace: jest.fn(async (from: string, to: string) => {
        if (nodeFs.existsSync(at(to))) {
          throw Object.assign(new Error('exists'), { code: 'STORAGE_ERROR' });
        }
        nodeFs.renameSync(at(from), at(to));
        // The emulated "encryption" travels with the file.
        mockFake.keys.set(at(to), mockFake.keys.get(at(from)) ?? null);
        mockFake.keys.delete(at(from));
      }),
      deleteTemporary: jest.fn(async (name: string) => {
        if (!name.endsWith('.partial.db')) {
          throw new Error('refused');
        }
        for (const s of ['', '-journal', '-wal', '-shm']) {
          nodeFs.rmSync(at(name + s), { force: true });
        }
      }),
    },
  };
});

// Imported after the mocks.
import NativeTrezorVault from '../../src/native/NativeTrezorVault';
import { openTrezorDatabase } from '../../src/storage/database';
import { Migration, migrations } from '../../src/storage/migrations';

const v2: Migration = {
  version: 2,
  description: 'test: add a column',
  async up(tx) {
    await tx.execute(
      "ALTER TABLE notes ADD COLUMN format TEXT NOT NULL DEFAULT 'plain'",
    );
  },
};
const failingV2: Migration = {
  version: 2,
  description: 'test: fails',
  async up(tx) {
    await tx.execute('ALTER TABLE notes ADD COLUMN format TEXT');
    await tx.execute('NOT VALID SQL');
  },
};

async function seedV1() {
  const { db } = await openTrezorDatabase();
  await db.execute(
    "INSERT INTO items VALUES ('n1', 'note', 'Kept', 0, 1, 1), ('c1', 'card', 'Card', 1, 2, 2)",
  );
  await db.execute("INSERT INTO notes VALUES ('n1', 'body')");
  await db.execute(
    "INSERT INTO cards VALUES ('c1', '1234', 'qr', 'Holder', '')",
  );
  db.close();
}

const snapshotsAndTemps = () =>
  mockFake.files().filter(f => f.includes('pre-migration'));

beforeEach(() => {
  mockFake = new FakeSqlCipher();
  mockKeys.clear();
  mockKeyOverride = undefined;
  mockFileStateFailure = null;
  jest.clearAllMocks();
});

afterEach(() => mockFake.cleanup());

describe('opening', () => {
  test('first launch creates the key and the database; foreign keys end up ON', async () => {
    const { db, created, schemaVersion, snapshot } = await openTrezorDatabase();
    expect(created).toBe(true);
    expect(schemaVersion).toBe(1);
    expect(snapshot).toBeNull();
    expect(mockKeys.has('database')).toBe(true);
    expect((await db.execute('PRAGMA foreign_keys'))[0].foreign_keys).toBe(1);
    db.close();
  });

  test('M1: the key is removed from every options object op-sqlite retains', async () => {
    await seedV1();
    const { db } = await openTrezorDatabase({
      migrationList: [...migrations, v2],
    });
    db.close();
    expect(mockFake.openedParams.length).toBeGreaterThan(2);
    for (const params of mockFake.openedParams) {
      expect(params).not.toHaveProperty('encryptionKey');
    }
  });

  test('L1: an undeterminable file state never leads to key creation', async () => {
    mockFileStateFailure = Object.assign(new Error('EACCES'), {
      code: 'DATABASE_STATE_UNKNOWN',
    });
    await expect(openTrezorDatabase()).rejects.toMatchObject({
      code: 'DATABASE_STATE_UNKNOWN',
    });
    expect(NativeTrezorVault.createKey).not.toHaveBeenCalled();
    expect(mockFake.files()).toEqual([]);
  });

  test('an existing database without its key is refused, no key created', async () => {
    fs.writeFileSync(mockFake.pathOf('trezor.db'), 'existing data');
    await expect(openTrezorDatabase()).rejects.toMatchObject({
      code: 'KEY_MISSING_FOR_DATABASE',
    });
    expect(NativeTrezorVault.createKey).not.toHaveBeenCalled();
    expect(fs.readFileSync(mockFake.pathOf('trezor.db'), 'utf8')).toBe(
      'existing data',
    );
  });

  test.each([
    ['empty', ''],
    ['too short', 'abcd'],
    ['uppercase', 'A'.repeat(64)],
    ['not hex', 'g'.repeat(64)],
    ['too long', 'a'.repeat(66)],
    ['not a string', 42],
  ])('L5: a %s key is rejected before anything is opened', async (_, bad) => {
    mockKeyOverride = bad;
    await expect(openTrezorDatabase()).rejects.toMatchObject({
      code: 'INVALID_KEY_FORMAT',
    });
    expect(mockFake.openedParams).toEqual([]);
    expect(mockFake.files()).toEqual([]);
  });

  test('a wrong key is reported and the file is left untouched', async () => {
    await seedV1();
    const before = fs.readFileSync(mockFake.pathOf('trezor.db'));
    mockKeyOverride = 'b'.repeat(64);
    await expect(openTrezorDatabase()).rejects.toMatchObject({
      code: 'DATABASE_UNREADABLE',
    });
    expect(fs.readFileSync(mockFake.pathOf('trezor.db'))).toEqual(before);
  });

  test('a newer schema is refused without a snapshot or writes', async () => {
    await seedV1();
    const { db } = await openTrezorDatabase();
    await db.execute('PRAGMA user_version = 9');
    db.close();
    await expect(openTrezorDatabase()).rejects.toMatchObject({
      code: 'NEWER_SCHEMA',
    });
    expect(snapshotsAndTemps()).toEqual([]);
  });
});

describe('M2: snapshots before migrating', () => {
  test('writes a verified snapshot, renames it into place, then migrates', async () => {
    await seedV1();
    const result = await openTrezorDatabase({
      migrationList: [...migrations, v2],
    });
    expect(result.snapshot).toBe('trezor.pre-migration-v1.db');
    expect(result.schemaVersion).toBe(2);
    result.db.close();
    expect(snapshotsAndTemps()).toEqual(['trezor.pre-migration-v1.db']);

    // The snapshot is the pre-migration state and needs the same key.
    const snap = mockFake.open({
      name: 'trezor.pre-migration-v1.db',
      encryptionKey: `x'${mockKeys.get('database')}'`,
    });
    expect(
      (await snap.execute('PRAGMA user_version')).rows[0].user_version,
    ).toBe(1);
    expect((await snap.execute('SELECT * FROM notes')).rows).toEqual([
      { item_id: 'n1', body: 'body' },
    ]);
    snap.close();
  });

  test('an interrupted export removes only its temporary file and blocks the migration', async () => {
    await seedV1();
    mockFake.exportFault = 'midway';
    await expect(
      openTrezorDatabase({ migrationList: [...migrations, v2] }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_FAILED' });
    expect(snapshotsAndTemps()).toEqual([]);

    // Still v1 and intact.
    mockFake.exportFault = 'none';
    const { db, schemaVersion } = await openTrezorDatabase();
    expect(schemaVersion).toBe(1);
    expect(await db.execute('SELECT id FROM items ORDER BY id')).toEqual([
      { id: 'c1' },
      { id: 'n1' },
    ]);
    db.close();
  });

  test('a copy that fails verification is discarded and blocks the migration', async () => {
    await seedV1();
    mockFake.exportFault = 'corrupt-copy';
    await expect(
      openTrezorDatabase({ migrationList: [...migrations, v2] }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_FAILED' });
    expect(snapshotsAndTemps()).toEqual([]);
  });

  test('retry after a failed migration reuses the verified snapshot', async () => {
    await seedV1();
    await expect(
      openTrezorDatabase({ migrationList: [...migrations, failingV2] }),
    ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    expect(snapshotsAndTemps()).toEqual(['trezor.pre-migration-v1.db']);
    const firstSnapshot = fs.readFileSync(
      mockFake.pathOf('trezor.pre-migration-v1.db'),
    );

    const retry = await openTrezorDatabase({
      migrationList: [...migrations, v2],
    });
    expect(retry.snapshot).toBe('trezor.pre-migration-v1.db');
    expect(retry.schemaVersion).toBe(2);
    retry.db.close();
    expect(snapshotsAndTemps()).toEqual(['trezor.pre-migration-v1.db']);
    expect(
      fs.readFileSync(mockFake.pathOf('trezor.pre-migration-v1.db')),
    ).toEqual(firstSnapshot);
  });

  test('an invalid existing snapshot is never trusted, overwritten or deleted', async () => {
    await seedV1();
    fs.writeFileSync(
      mockFake.pathOf('trezor.pre-migration-v1.db'),
      'partial junk',
    );
    const result = await openTrezorDatabase({
      migrationList: [...migrations, v2],
    });
    result.db.close();
    expect(result.snapshot).toBe('trezor.pre-migration-v1.2.db');
    expect(
      fs.readFileSync(mockFake.pathOf('trezor.pre-migration-v1.db'), 'utf8'),
    ).toBe('partial junk');
    expect(snapshotsAndTemps()).toEqual([
      'trezor.pre-migration-v1.2.db',
      'trezor.pre-migration-v1.db',
    ]);
  });

  test('a valid but stale snapshot is kept and a fresh one is written', async () => {
    await seedV1();
    // First attempt leaves a verified snapshot, then the migration fails.
    await expect(
      openTrezorDatabase({ migrationList: [...migrations, failingV2] }),
    ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    // The data changes afterwards (e.g. an older app version was used).
    const { db } = await openTrezorDatabase();
    await db.execute("UPDATE items SET title = 'Changed' WHERE id = 'n1'");
    db.close();

    const result = await openTrezorDatabase({
      migrationList: [...migrations, v2],
    });
    result.db.close();
    expect(result.snapshot).toBe('trezor.pre-migration-v1.2.db');
    expect(snapshotsAndTemps()).toEqual([
      'trezor.pre-migration-v1.2.db',
      'trezor.pre-migration-v1.db',
    ]);
  });
});

describe('regression: snapshot ATTACH on device', () => {
  test('the fake rejects ATTACH of a new file on a no-create connection, like SQLite', async () => {
    const db = mockFake.open({
      name: 'x.db',
      encryptionKey: `x'${'a'.repeat(64)}'`,
    });
    db.close();
    const noCreate = mockFake.open({
      name: 'x.db',
      encryptionKey: `x'${'a'.repeat(64)}'`,
      failOnCreate: true,
    });
    await expect(
      noCreate.execute('ATTACH DATABASE ? AS snapshot KEY ?', [
        mockFake.pathOf('new.db'),
        'k',
      ]),
    ).rejects.toThrow('code 14');
    noCreate.close();
  });

  test('the main connection is opened so that the snapshot can be attached', async () => {
    await seedV1();
    const result = await openTrezorDatabase({
      migrationList: [...migrations, v2],
    });
    result.db.close();
    expect(result.snapshot).toBe('trezor.pre-migration-v1.db');
    const mainOpens = mockFake.openedParams.filter(p => p.name === 'trezor.db');
    for (const p of mainOpens) {
      expect(p.failOnCreate).toBeUndefined();
    }
  });
});
