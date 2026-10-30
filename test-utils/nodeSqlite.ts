// Test-only SqlDatabase backed by Node's built-in SQLite (no SQLCipher).
// Lets Jest run the real migration and repository SQL.
import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from '../src/storage/sql';

export function createNodeSqliteDatabase(): SqlDatabase {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  const exec: SqlExecutor = {
    async execute(sql: string, params: SqlValue[] = []) {
      const rows = db.prepare(sql).all(...params) as SqlRow[];
      return rows.map(r => ({ ...r }));
    },
  };

  return {
    ...exec,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
      db.exec('BEGIN');
      try {
        const result = await fn(exec);
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
