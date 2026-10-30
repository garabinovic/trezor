// Development-only on-device checks for the native SQLCipher layer, which
// Jest cannot load. Registered in the React Native dev menu (debug builds
// only). Uses throwaway `selftest-*` databases; never touches trezor.db.
import { isSQLCipher, open } from '@op-engineering/op-sqlite';
import { openTrezorDatabase } from './database';
import { databaseFiles } from './databaseFiles';
import { getUserVersion, Migration, migrations } from './migrations';
import { adaptOpSqlite } from './opSqliteAdapter';
import { snapshotNames, snapshotProblem } from './snapshot';
import { vault } from './vault';

const PREFIX = 'selftest';
const hex = (n: number) =>
  Array.from(vault.randomBytes(n), b => b.toString(16).padStart(2, '0')).join(
    '',
  );
const rawKey = (h: string) => `x'${h}'`;

function remove(name: string, key?: string) {
  try {
    open(key ? { name, encryptionKey: key } : { name }).delete();
  } catch {
    // Not present.
  }
}

async function queryError(name: string, key?: string): Promise<string | null> {
  const db = open(key ? { name, encryptionKey: key } : { name });
  try {
    await db.execute('SELECT count(*) FROM sqlite_master');
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    db.close();
  }
}

const additive: Migration = {
  version: 2,
  description: 'self-test: additive',
  async up(tx) {
    await tx.execute("ALTER TABLE notes ADD COLUMN extra TEXT DEFAULT 'x'");
  },
};
const failing: Migration = {
  version: 2,
  description: 'self-test: fails',
  async up(tx) {
    await tx.execute('ALTER TABLE notes ADD COLUMN extra TEXT');
    await tx.execute('NOT VALID SQL');
  },
};
const rebuildItems: Migration = {
  version: 2,
  description: 'self-test: rebuild items (DROP + RENAME)',
  async up(tx) {
    await tx.execute(`CREATE TABLE items_new (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('note','reminder','card','document')),
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    ) STRICT`);
    await tx.execute(
      'INSERT INTO items_new (id, type, title, pinned, created_at, updated_at) SELECT id, type, title, pinned, created_at, updated_at FROM items',
    );
    await tx.execute('DROP TABLE items');
    await tx.execute('ALTER TABLE items_new RENAME TO items');
  },
};
const orphan: Migration = {
  version: 2,
  description: 'self-test: foreign key violation',
  async up(tx) {
    await tx.execute("INSERT INTO notes VALUES ('no-parent', 'orphan')");
  },
};

export async function runStorageSelfTest(): Promise<boolean> {
  const results: [string, boolean, string?][] = [];
  const check = (name: string, ok: boolean, detail?: string) =>
    results.push([name, ok, detail]);

  // 1. SQLCipher compiled in and wrong keys rejected
  const enc = `${PREFIX}-enc.db`;
  const keyA = rawKey(hex(32));
  const keyB = rawKey(hex(32));
  remove(enc, keyA);
  check('isSQLCipher()', isSQLCipher());
  const a = open({ name: enc, encryptionKey: keyA });
  const version = (await a.execute('PRAGMA cipher_version')).rows[0]
    ?.cipher_version;
  check('cipher_version present', !!version, String(version));
  await a.execute('CREATE TABLE t (v TEXT)');
  await a.execute("INSERT INTO t VALUES ('marker')");
  a.close();
  check('correct key opens', (await queryError(enc, keyA)) === null);
  const wrong = await queryError(enc, keyB);
  check(
    'wrong key rejected (code 26)',
    !!wrong?.includes('code 26'),
    wrong ?? '',
  );
  const none = await queryError(enc);
  check(
    'missing key rejected (code 26)',
    !!none?.includes('code 26'),
    none ?? '',
  );
  remove(enc, keyA);

  // 2. Native file module guards (L1)
  check(
    'fileState: absent file reported absent',
    (await databaseFiles.state(`${PREFIX}-nothing.db`)) === 'absent',
  );
  const badName = await databaseFiles.state('../escape.db').catch(e => e);
  check('fileState: path rejected', badName?.code === 'INVALID_ARGUMENT');
  const refused = await databaseFiles
    .deleteTemporary(`${PREFIX}-keep.db`)
    .catch(e => e);
  check(
    'deleteTemporary: non-temporary name refused',
    refused?.code === 'INVALID_ARGUMENT',
  );

  // 3. Migrations, snapshots and foreign keys on real SQLCipher
  const dbKey = rawKey(await vault.getKey('database'));
  const mig = `${PREFIX}-migrate.db`;
  const [snap1, snap2] = snapshotNames(mig, 1);
  const cleanup = () => {
    for (const n of [mig, snap1, snap2]) {
      remove(n, dbKey);
    }
  };
  cleanup();

  const seed = async () => {
    const first = await openTrezorDatabase({ name: mig });
    await first.db.execute(
      "INSERT INTO items VALUES ('id-1', 'note', 'Kept', 0, 1, 1)",
    );
    await first.db.execute("INSERT INTO notes VALUES ('id-1', 'body')");
    return first;
  };
  const first = await seed();
  check(
    'fresh database created at v1',
    first.created && first.schemaVersion === 1,
  );
  const fkFresh = (await first.db.execute('PRAGMA foreign_keys'))[0];
  check('foreign keys ON after open', fkFresh?.foreign_keys === 1);
  first.db.close();

  const failed = await openTrezorDatabase({
    name: mig,
    migrationList: [...migrations, failing],
  }).catch(e => e);
  check(
    'failed migration reported',
    failed?.code === 'MIGRATION_FAILED',
    failed?.code,
  );
  const afterFail = adaptOpSqlite(open({ name: mig, encryptionKey: dbKey }));
  check('failed migration left v1', (await getUserVersion(afterFail)) === 1);
  check(
    'verified snapshot written before the failed migration',
    (await databaseFiles.state(snap1)) === 'present' &&
      (await snapshotProblem(afterFail, snap1, 1, dbKey.slice(2, -1))) === null,
  );
  afterFail.close();

  const upgraded = await openTrezorDatabase({
    name: mig,
    migrationList: [...migrations, additive],
  });
  const rows = await upgraded.db.execute('SELECT body, extra FROM notes');
  check(
    'retry reused the same verified snapshot',
    upgraded.snapshot === snap1 &&
      (await databaseFiles.state(snap2)) === 'absent',
    String(upgraded.snapshot),
  );
  check(
    'migration to v2 kept data',
    upgraded.schemaVersion === 2 &&
      rows[0]?.body === 'body' &&
      rows[0]?.extra === 'x',
  );
  upgraded.db.close();
  check(
    'snapshot unreadable without key',
    !!(await queryError(snap1))?.includes('code 26'),
  );

  // 4. Invalid existing snapshot: kept untouched, a new verified one is used
  cleanup();
  (await seed()).db.close();
  const junk = open({ name: snap1 }); // unencrypted file with the snapshot's name
  await junk.execute('CREATE TABLE junk (v TEXT)');
  await junk.execute("INSERT INTO junk VALUES ('j')");
  junk.close();
  const withJunk = await openTrezorDatabase({
    name: mig,
    migrationList: [...migrations, additive],
  });
  withJunk.db.close();
  const junkStill = await queryError(snap1);
  check(
    'invalid snapshot kept; new snapshot used',
    withJunk.snapshot === snap2 && junkStill === null,
    String(withJunk.snapshot),
  );

  // 5. Table rebuild keeps relationships; violations roll back (M3)
  cleanup();
  (await seed()).db.close();
  const rebuilt = await openTrezorDatabase({
    name: mig,
    migrationList: [...migrations, rebuildItems],
  });
  const notes = await rebuilt.db.execute('SELECT * FROM notes');
  const fk = (await rebuilt.db.execute('PRAGMA foreign_keys'))[0];
  check(
    'table rebuild kept dependent rows; foreign keys ON',
    notes.length === 1 && fk?.foreign_keys === 1,
    `notes=${notes.length}`,
  );
  rebuilt.db.close();

  cleanup();
  (await seed()).db.close();
  const violation = await openTrezorDatabase({
    name: mig,
    migrationList: [...migrations, orphan],
  }).catch(e => e);
  const afterViolation = adaptOpSqlite(
    open({ name: mig, encryptionKey: dbKey }),
  );
  const orphans = await afterViolation.execute(
    "SELECT * FROM notes WHERE item_id = 'no-parent'",
  );
  check(
    'foreign key violation rolled back',
    violation?.code === 'MIGRATION_FAILED' &&
      (await getUserVersion(afterViolation)) === 1 &&
      orphans.length === 0,
  );
  afterViolation.close();

  // 6. Newer schema refused
  const newer = adaptOpSqlite(open({ name: mig, encryptionKey: dbKey }));
  await newer.execute('PRAGMA user_version = 99');
  newer.close();
  const tooNew = await openTrezorDatabase({ name: mig }).catch(e => e);
  check('newer schema refused', tooNew?.code === 'NEWER_SCHEMA', tooNew?.code);
  cleanup();

  // 7. Keystore
  check(
    'master key security level',
    true,
    await vault.masterKeySecurityLevel(),
  );

  let allPassed = true;
  for (const [name, ok, detail] of results) {
    allPassed &&= ok;
    console.log(
      `[SELFTEST] ${ok ? 'PASS' : 'FAIL'} ${name}${
        detail ? ` (${detail})` : ''
      }`,
    );
  }
  console.log(
    `[SELFTEST] ${allPassed ? 'ALL PASSED' : 'FAILURES'} (${
      results.length
    } checks)`,
  );
  return allPassed;
}
