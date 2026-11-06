import { SqlDatabase, SqlExecutor, SqlValue, TransactionOptions } from './sql';

export interface SerialDatabase extends SqlDatabase {
  /**
   * Closes the connection once every operation queued before this call has
   * settled (op-sqlite's close() interrupts a running statement). Operations
   * queued later fail as on any closed connection.
   */
  closeWhenIdle(): Promise<void>;
  /**
   * Runs `fn` as one operation of the queue, with the connection itself: work queued
   * before it runs first, and work queued after it waits (it is not refused) until `fn`
   * has settled, success or failure. No transaction is opened, so `fn` may ATTACH.
   * Inside `fn`, use the executor it receives; the outer database would wait for `fn`
   * itself and deadlock. The backup gate (Phase 6 spec v2.4 §6.1).
   */
  exclusive<T>(fn: (db: SqlExecutor) => Promise<T>): Promise<T>;
}

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
export function serializeDatabase(db: SqlDatabase): SerialDatabase {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.then(operation);
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    execute: (sql: string, params?: SqlValue[]) =>
      enqueue(() => db.execute(sql, params)),
    transaction: <T>(
      fn: (tx: SqlExecutor) => Promise<T>,
      options?: TransactionOptions,
    ) => enqueue(() => db.transaction(fn, options)),
    close: () => db.close(),
    closeWhenIdle: () => enqueue(async () => db.close()),
    exclusive: <T>(fn: (raw: SqlExecutor) => Promise<T>) =>
      enqueue(() =>
        fn({
          execute: (sql: string, params?: SqlValue[]) =>
            db.execute(sql, params),
        }),
      ),
  };
}
