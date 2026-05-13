import { getDb } from './connection';

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Serialises every transaction so that concurrent callers never open nested
 * transactions against the single shared SQLite connection.
 *
 * SQLite on a single connection cannot handle two simultaneous BEGIN calls.
 * Without serialisation, a second caller triggers "cannot start a transaction
 * within a transaction", then its catch ROLLBACKs the first caller's in-flight
 * transaction, which in turn leaves later operations failing with
 * "no transaction is active" or "database is locked".
 */
let txChain: Promise<unknown> = Promise.resolve();

export async function withTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  // Hook into the chain so our critical section waits for any in-flight tx.
  const next = txChain.then(async () => runTx(fn));
  // Silence rejection for the chain itself; each caller still sees its own error.
  txChain = next.catch(() => undefined);
  return next;
}

async function runTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute('BEGIN');
  let result: T;
  try {
    result = await fn(db);
  } catch (err) {
    // Best-effort rollback — ignore the (rare) case where the transaction
    // has already been closed (e.g. by an earlier COMMIT attempt).
    try {
      await db.execute('ROLLBACK');
    } catch {
      /* transaction already closed — nothing to do */
    }
    throw err;
  }
  await db.execute('COMMIT');
  return result;
}
