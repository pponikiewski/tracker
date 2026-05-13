import { getDb } from './connection';

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Runs `fn` serialised against every other caller of `withTx`. This is
 * intentionally NOT wrapped in BEGIN/COMMIT.
 *
 * Rationale: the Tauri SQL plugin uses a connection pool. Manually issuing
 * BEGIN/COMMIT via separate `db.execute` calls is unreliable — a BEGIN on
 * connection A followed by a statement on connection B breaks transaction
 * semantics and produces errors like "cannot commit - no transaction is
 * active" or "cannot start a transaction within a transaction".
 *
 * Instead we rely on SQLite's per-statement autocommit, and we serialise
 * multi-step operations through this chain so no two write flows interleave
 * on the same connection at once.
 *
 * Trade-off: a multi-step operation that fails halfway leaves partial state
 * (e.g. workspace inserted but membership missing). This is acceptable for
 * our data shapes — the UI tolerates missing rows, sync is idempotent via
 * LWW, and retries can heal leftover inconsistency.
 */
let chain: Promise<unknown> = Promise.resolve();

export async function withTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const db = await getDb();
    return fn(db);
  });
  chain = next.catch(() => undefined);
  return next;
}
