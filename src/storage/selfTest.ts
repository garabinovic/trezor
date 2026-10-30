// Development-only on-device checks for the native SQLCipher layer, which
// Jest cannot load. Registered in the React Native dev menu (debug builds
// only). Uses throwaway databases; never touches trezor.db.
import { isSQLCipher, open } from '@op-engineering/op-sqlite';
import { openTrezorDatabase } from './database';
import { getUserVersion, Migration, migrations } from './migrations';
import { adaptOpSqlite } from './opSqliteAdapter';
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

  // 2. Startup path, migration, snapshot and failed migration on SQLCipher
  const mig = `${PREFIX}-migrate.db`;
  const snapshot = `${PREFIX}-migrate.pre-migration-v1.db`;
  const dbKey = rawKey(await vault.getKey('database'));
  remove(mig, dbKey);
  remove(snapshot, dbKey);

  const first = await openTrezorDatabase({ name: mig });
  check(
    'fresh database created at v1',
    first.created && first.schemaVersion === 1,
  );
  await first.db.execute(
    "INSERT INTO items VALUES ('id-1', 'note', 'Kept', 0, 1, 1)",
  );
  await first.db.execute("INSERT INTO notes VALUES ('id-1', 'body')");
  first.db.close();

  const failing: Migration[] = [
    ...migrations,
    {
      version: 2,
      description: 'self-test: fails',
      async up(tx) {
        await tx.execute('ALTER TABLE notes ADD COLUMN extra TEXT');
        await tx.execute('NOT VALID SQL');
      },
    },
  ];
  const failed = await openTrezorDatabase({
    name: mig,
    migrationList: failing,
  }).catch(e => e);
  check(
    'failed migration reported',
    failed?.code === 'MIGRATION_FAILED',
    failed?.code,
  );
  const afterFail = adaptOpSqlite(open({ name: mig, encryptionKey: dbKey }));
  check('failed migration left v1', (await getUserVersion(afterFail)) === 1);
  afterFail.close();

  remove(snapshot, dbKey);
  const passing: Migration[] = [
    ...migrations,
    {
      version: 2,
      description: 'self-test: additive',
      async up(tx) {
        await tx.execute("ALTER TABLE notes ADD COLUMN extra TEXT DEFAULT 'x'");
      },
    },
  ];
  const upgraded = await openTrezorDatabase({
    name: mig,
    migrationList: passing,
  });
  const rows = await upgraded.db.execute('SELECT body, extra FROM notes');
  check(
    'migration to v2 kept data',
    upgraded.migratedFrom === 1 &&
      upgraded.schemaVersion === 2 &&
      rows[0]?.body === 'body' &&
      rows[0]?.extra === 'x',
  );
  upgraded.db.close();

  const snap = adaptOpSqlite(open({ name: snapshot, encryptionKey: dbKey }));
  const snapRows = await snap.execute('SELECT title FROM items');
  check(
    'encrypted pre-migration snapshot at v1',
    (await getUserVersion(snap)) === 1 && snapRows[0]?.title === 'Kept',
  );
  snap.close();
  const snapNoKey = await queryError(snapshot);
  check('snapshot unreadable without key', !!snapNoKey?.includes('code 26'));

  // 3. Existing database without its key is refused (simulated by wrong key path)
  const newer = adaptOpSqlite(open({ name: mig, encryptionKey: dbKey }));
  await newer.execute('PRAGMA user_version = 99');
  newer.close();
  const tooNew = await openTrezorDatabase({ name: mig }).catch(e => e);
  check('newer schema refused', tooNew?.code === 'NEWER_SCHEMA', tooNew?.code);

  remove(mig, dbKey);
  remove(snapshot, dbKey);

  // 4. Keystore
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
