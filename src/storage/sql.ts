/**
 * The small slice of a SQL driver that storage code depends on. Implemented by
 * op-sqlite in the app and by node:sqlite in Jest, so migrations and
 * repositories run the same SQL in both.
 */
export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

export interface SqlExecutor {
  execute(sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
}

export interface TransactionOptions {
  /**
   * BEGIN IMMEDIATE: takes the write lock before `fn` runs, so what `fn` reads
   * can't be changed by another connection before it writes. If another
   * connection holds the lock, the transaction fails ("database is locked").
   * Default: BEGIN (deferred).
   */
  immediate?: boolean;
}

export interface SqlDatabase extends SqlExecutor {
  /** Runs `fn` in a transaction; rolls back if it throws. */
  transaction<T>(
    fn: (tx: SqlExecutor) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  close(): void;
}
