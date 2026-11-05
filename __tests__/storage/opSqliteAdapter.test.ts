import type { DB } from '@op-engineering/op-sqlite';
import { adaptOpSqlite } from '../../src/storage/opSqliteAdapter';

/** An op-sqlite connection that records statements; `failing` ones throw. */
function recordingDb(failing: string[] = []) {
  const statements: string[] = [];
  const transactions: unknown[] = [];
  const db = {
    execute: async (sql: string) => {
      statements.push(sql);
      if (failing.includes(sql)) {
        throw new Error(`failed: ${sql}`);
      }
      return { rows: [] };
    },
    transaction: async (fn: unknown) => {
      transactions.push(fn);
    },
    close: () => undefined,
  };
  return { db: db as unknown as DB, statements, transactions };
}

describe('op-sqlite adapter: immediate transactions', () => {
  test('takes the write lock first, then commits', async () => {
    const { db, statements, transactions } = recordingDb();
    const result = await adaptOpSqlite(db).transaction(
      async tx => {
        await tx.execute('PRAGMA user_version');
        return 'done';
      },
      { immediate: true },
    );
    expect(result).toBe('done');
    expect(statements).toEqual([
      'BEGIN IMMEDIATE',
      'PRAGMA user_version',
      'COMMIT',
    ]);
    // op-sqlite's own transaction() would start with a deferred BEGIN.
    expect(transactions).toEqual([]);
  });

  test('rolls back and reports the original error, even if ROLLBACK fails', async () => {
    const { db, statements } = recordingDb(['ROLLBACK']);
    await expect(
      adaptOpSqlite(db).transaction(
        async () => {
          throw new Error('step failed');
        },
        { immediate: true },
      ),
    ).rejects.toThrow('step failed');
    expect(statements).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
  });

  test('a failed COMMIT (e.g. busy) rolls back and fails', async () => {
    const { db, statements } = recordingDb(['COMMIT']);
    await expect(
      adaptOpSqlite(db).transaction(async () => undefined, { immediate: true }),
    ).rejects.toThrow('failed: COMMIT');
    expect(statements).toEqual(['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK']);
  });

  test('a lock that cannot be taken runs nothing', async () => {
    const { db, statements } = recordingDb(['BEGIN IMMEDIATE']);
    const fn = jest.fn();
    await expect(
      adaptOpSqlite(db).transaction(fn, { immediate: true }),
    ).rejects.toThrow('failed: BEGIN IMMEDIATE');
    expect(fn).not.toHaveBeenCalled();
    expect(statements).toEqual(['BEGIN IMMEDIATE']);
  });

  test('without the option, op-sqlite runs the transaction as before', async () => {
    const { db, statements, transactions } = recordingDb();
    await adaptOpSqlite(db).transaction(async () => undefined);
    expect(transactions).toHaveLength(1);
    expect(statements).toEqual([]);
  });
});
