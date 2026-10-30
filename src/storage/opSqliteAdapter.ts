import type { DB, Transaction } from '@op-engineering/op-sqlite';
import { SqlDatabase, SqlExecutor, SqlRow, SqlValue } from './sql';

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
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
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
