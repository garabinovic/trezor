// Test-only stand-in for @op-engineering/op-sqlite built with SQLCipher.
// Real SQLite files (node:sqlite) in a temp directory; "encryption" is
// emulated by remembering which key each file was created with:
// - opening with a different key (or none) fails on the first query with
//   "file is not a database (code 26)", like SQLCipher;
// - failOnCreate, ATTACH … KEY ?, sqlcipher_export(), cipher_version and
//   cipher_integrity_check behave like the real build for our purposes;
// - the cipher_* settings report SQLCipher 4's defaults unless overridden;
// - `location` (absolute, relative to the base directory, or ':memory:')
//   works like op-sqlite's.
// Failures can be injected to test snapshot and backup handling.
// Node built-ins via require: the project has no @types/node (test-only file).
const fs = require('fs');
const os = require('os');
const path = require('path');

type Row = Record<string, string | number | null>;

const NOT_A_DATABASE =
  '[op-sqlite] sqlite query error: file is not a database (code 26, extended code 26)';

const CIPHER_DEFAULTS: Record<string, string> = {
  cipher_version: '4.19.0 fake',
  cipher_page_size: '4096',
  cipher_hmac_algorithm: 'HMAC_SHA512',
  cipher_kdf_algorithm: 'PBKDF2_HMAC_SHA512',
  cipher_use_hmac: '1',
  cipher_plaintext_header_size: '0',
};

export type ExportFault = 'none' | 'midway' | 'corrupt-copy';

export class FakeSqlCipher {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trezor-fake-'));
  /** Key each file was created with (null = created without a key). */
  readonly keys = new Map<string, string | null>();
  /** Every options object passed to open(), kept by reference like op-sqlite. */
  readonly openedParams: Record<string, unknown>[] = [];
  exportFault: ExportFault = 'none';
  /** What PRAGMA cipher_* reports (SQLCipher 4 defaults); tests may change it. */
  cipher: Record<string, string> = { ...CIPHER_DEFAULTS };
  /** Rows PRAGMA cipher_integrity_check returns (none: no damage found). */
  cipherIntegrityRows: Row[] = [];

  pathOf(name: string) {
    return path.join(this.dir, name);
  }

  files(): string[] {
    return fs.readdirSync(this.dir).sort();
  }

  open = (params: {
    name: string;
    encryptionKey?: string;
    failOnCreate?: boolean;
    location?: string;
  }) => {
    this.openedParams.push(params as Record<string, unknown>);
    // Like op-sqlite's native open(): the key is read synchronously, here.
    const key = params.encryptionKey ?? null;
    const { DatabaseSync } = require('node:sqlite');
    if (params.location === ':memory:') {
      return new FakeDb(
        this,
        new DatabaseSync(':memory:'),
        ':memory:',
        true,
        false,
      );
    }
    const file = params.location
      ? path.resolve(this.dir, params.location, params.name)
      : this.pathOf(params.name);
    const existed = fs.existsSync(file);
    if (params.failOnCreate && !existed) {
      throw new Error(
        '[op-sqlite] could not open database: unable to open database file (code 14, extended code 14)',
      );
    }
    const handle = new DatabaseSync(file);
    // node:sqlite enables foreign keys by default; SQLite and op-sqlite don't.
    handle.exec('PRAGMA foreign_keys = OFF');
    if (!existed) {
      this.keys.set(file, key);
    }
    const readable = this.keys.has(file) && this.keys.get(file) === key;
    return new FakeDb(this, handle, file, readable, !!params.failOnCreate);
  };

  cleanup() {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

class FakeDb {
  private attached = new Map<string, string>();
  private closed = false;

  constructor(
    private readonly owner: FakeSqlCipher,
    private readonly handle: {
      prepare(sql: string): { all(...p: unknown[]): Row[] };
      exec(sql: string): void;
      close(): void;
    },
    private readonly file: string,
    private readonly readable: boolean,
    // Like SQLite: attached databases inherit the connection's open flags, so
    // a connection opened without SQLITE_OPEN_CREATE cannot ATTACH a new file.
    private readonly noCreate: boolean,
  ) {}

  async execute(sql: string, params: unknown[] = []) {
    return { rows: this.run(sql, params) };
  }

  async transaction(
    fn: (tx: { execute: FakeDb['execute'] }) => Promise<void>,
    options?: { immediate?: boolean },
  ) {
    this.run(options?.immediate ? 'BEGIN IMMEDIATE' : 'BEGIN', []);
    try {
      await fn({ execute: (s, p) => this.execute(s, p) });
      this.run('COMMIT', []);
    } catch (e) {
      this.run('ROLLBACK', []);
      throw e;
    }
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.handle.close();
    }
  }

  delete() {
    this.close();
    fs.rmSync(this.file, { force: true });
  }

  private run(sql: string, params: unknown[]): Row[] {
    if (this.closed) {
      throw new Error('[op-sqlite] database is closed');
    }
    if (!this.readable) {
      throw new Error(NOT_A_DATABASE);
    }
    const trimmed = sql.trim();
    if (/^PRAGMA cipher_integrity_check$/i.test(trimmed)) {
      return this.owner.cipherIntegrityRows;
    }
    const cipher = /^PRAGMA (cipher_\w+)$/i.exec(trimmed);
    if (cipher) {
      const value = this.owner.cipher[cipher[1].toLowerCase()];
      return value === undefined ? [] : [{ [cipher[1]]: value }];
    }
    const attach = /^ATTACH DATABASE \? AS (\w+) KEY \?$/i.exec(trimmed);
    if (attach) {
      const [file, key] = params as [string, string];
      if (this.noCreate && !fs.existsSync(file)) {
        throw new Error(
          `[op-sqlite] statement execution error: unable to open database: ${file} (code 14, extended code 14)`,
        );
      }
      if (!fs.existsSync(file)) {
        this.owner.keys.set(file, key);
      }
      this.handle.prepare(`ATTACH DATABASE ? AS ${attach[1]}`).all(file);
      this.attached.set(attach[1], file);
      return [];
    }
    const exportTo = /^SELECT sqlcipher_export\('(\w+)'\)$/i.exec(trimmed);
    if (exportTo) {
      // Like the real export (and VACUUM): foreign keys are not enforced while copying.
      const fk = this.handle
        .prepare('PRAGMA foreign_keys')
        .all()[0].foreign_keys;
      this.handle.exec('PRAGMA foreign_keys = OFF');
      try {
        this.fakeExport(exportTo[1]);
      } finally {
        this.handle.exec(`PRAGMA foreign_keys = ${fk ? 'ON' : 'OFF'}`);
      }
      return [];
    }
    return this.handle
      .prepare(sql)
      .all(...params)
      .map(r => ({ ...r }));
  }

  /** Copies schema and rows into an attached database, like sqlcipher_export. */
  private fakeExport(alias: string) {
    const objects = this.handle
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      )
      .all();
    // Like the real export: every object first, then the rows, so that tables
    // referenced by foreign keys exist before any insert is prepared.
    for (const o of objects) {
      const ddl = String(o.sql).replace(
        // Renamed tables are stored with a quoted name: CREATE TABLE "x" (…).
        // Unique indexes are copied too (the real export has a separate pass).
        new RegExp(`^CREATE (TABLE|INDEX|UNIQUE INDEX) ("?)${o.name}\\2`),
        `CREATE $1 ${alias}.$2${o.name}$2`,
      );
      this.handle.exec(ddl);
    }
    let copied = 0;
    for (const o of objects) {
      if (o.type === 'table') {
        this.handle.exec(
          `INSERT INTO ${alias}.${o.name} SELECT * FROM main.${o.name}`,
        );
        copied++;
        if (this.owner.exportFault === 'midway' && copied === 1) {
          throw new Error(
            '[op-sqlite] sqlite query error: disk I/O error (code 10)',
          );
        }
      }
    }
    if (this.owner.exportFault === 'corrupt-copy') {
      this.handle.exec(`DELETE FROM ${alias}.notes`);
    }
  }
}
