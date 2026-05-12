import type Database from '@tauri-apps/plugin-sql';
import type { Entity, Op } from './types';

const MAX_ERR_LEN = 1024;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 300000ms = 5 min

export async function enqueue(
  db: Database,
  entity: Entity,
  entityId: string,
  op: Op,
  data: Record<string, unknown>,
): Promise<void> {
  await db.execute(
    `INSERT INTO sync_outbox (entity, entity_id, op, payload, enqueued_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity, entityId, op, JSON.stringify(data), Date.now()],
  );
}

export async function listReady(
  db: Database,
  now: number,
  limit = 50,
): Promise<
  Array<{ id: number; entity: Entity; entity_id: string; op: Op; payload: string; attempts: number }>
> {
  return db.select(
    `SELECT id, entity, entity_id, op, payload, attempts
     FROM sync_outbox
     WHERE next_retry_at IS NULL OR next_retry_at <= $1
     ORDER BY id LIMIT $2`,
    [now, limit],
  );
}

export async function deleteByIds(db: Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  await db.execute(`DELETE FROM sync_outbox WHERE id IN (${placeholders})`, ids);
}

export async function bumpRetry(
  db: Database,
  ids: number[],
  errMsg: string,
  nowMs: number,
): Promise<void> {
  if (ids.length === 0) return;
  // Req 6.6 / Property 12: truncate error to max 1024 chars
  const truncated = errMsg.slice(0, MAX_ERR_LEN);
  for (const id of ids) {
    const row = await db.select<Array<{ attempts: number }>>(
      `SELECT attempts FROM sync_outbox WHERE id = $1`,
      [id],
    );
    const attempts = (row[0]?.attempts ?? 0) + 1;
    // Req 6.5 / Property 6: min(2^attempts × 1000, 300000)
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await db.execute(
      `UPDATE sync_outbox SET attempts = $1, next_retry_at = $2, last_error = $3 WHERE id = $4`,
      [attempts, nowMs + backoff, truncated, id],
    );
  }
}

export async function countPending(db: Database): Promise<number> {
  const rows = await db.select<Array<{ c: number }>>(
    `SELECT COUNT(*) as c FROM sync_outbox`,
  );
  return rows[0]?.c ?? 0;
}

export async function listRecentErrors(
  db: Database,
  limit = 20,
): Promise<Array<{ id: number; entity: string; entity_id: string; last_error: string | null; attempts: number }>> {
  return db.select(
    `SELECT id, entity, entity_id, last_error, attempts
     FROM sync_outbox
     WHERE last_error IS NOT NULL
     ORDER BY id DESC LIMIT $1`,
    [limit],
  );
}

export async function clearAll(db: Database): Promise<void> {
  await db.execute(`DELETE FROM sync_outbox`);
}

// Req 11.3: "Retry now" — clear next_retry_at for errored rows so they're picked up immediately
export async function resetRetry(db: Database): Promise<void> {
  await db.execute(
    `UPDATE sync_outbox SET next_retry_at = NULL WHERE last_error IS NOT NULL`,
  );
}
