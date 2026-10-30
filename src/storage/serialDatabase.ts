import { SqlDatabase, SqlExecutor, SqlValue } from './sql';

/**
 * Runs every operation on a shared connection strictly one after another.
 *
 * op-sqlite serialises transaction() calls with each other, but a plain
 * execute() issued while a transaction is open runs *inside* that
 * transaction and commits or rolls back with it. Queuing every execute() and
 * every whole transaction() through one FIFO prevents that.
 *
 * Inside a transaction callback, use the `tx` it receives. Calling the outer
 * database from inside the callback would wait for the transaction to finish
 * and deadlock.
 *
 * Errors are delivered to the caller; a failed operation does not block the
 * ones queued after it.
 */
export function serializeDatabase(db: SqlDatabase): SqlDatabase {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.then(operation);
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    execute: (sql: string, params?: SqlValue[]) =>
      enqueue(() => db.execute(sql, params)),
    transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) =>
      enqueue(() => db.transaction(fn)),
    close: () => db.close(),
  };
}
