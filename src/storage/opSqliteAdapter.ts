import type { DB, Transaction } from '@op-engineering/op-sqlite';
import {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
  TransactionOptions,
} from './sql';

function executor(target: DB | Transaction): SqlExecutor {
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const result = await target.execute(sql, params);
      return (result.rows ?? []) as SqlRow[];
    },
  };
}

export function adaptOpSqlite(db: DB): SqlDatabase {
  return {
    ...executor(db),
    async transaction<T>(
      fn: (tx: SqlExecutor) => Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> {
      if (options?.immediate) {
        return immediateTransaction(db, fn);
      }
      let result: T | undefined;
      await db.transaction(async tx => {
        result = await fn(executor(tx));
      });
      return result as T;
    },
    close() {
      db.close();
    },
  };
}

/**
 * op-sqlite's transaction() always starts with a deferred `BEGIN
 * TRANSACTION;` and has no option for another mode, so an immediate one is
 * issued here. It bypasses op-sqlite's transaction queue: the caller must be
 * the connection's only user while it runs (migrations, before the
 * connection is shared). A transaction already open on the connection makes
 * the BEGIN fail instead of nesting.
 */
async function immediateTransaction<T>(
  db: DB,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  await db.execute('BEGIN IMMEDIATE');
  try {
    const result = await fn(executor(db));
    await db.execute('COMMIT');
    return result;
  } catch (e) {
    // SQLite may already have rolled back on its own; the original error wins.
    await db.execute('ROLLBACK').catch(() => undefined);
    throw e;
  }
}
