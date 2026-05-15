import type Database from '@tauri-apps/plugin-sql';
import { useAuthStore } from '@/store/auth';
import type { Entity, Op } from './types';

const MAX_ERR_LEN = 1024;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 300000ms = 5 min
const IMMEDIATE_FLUSH_DELAY_MS = 250;

let immediateFlushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleImmediateFlush(): void {
  if (typeof window === 'undefined') return;
  if (immediateFlushTimer) clearTimeout(immediateFlushTimer);
  immediateFlushTimer = setTimeout(() => {
    immediateFlushTimer = null;
    void import('./worker')
      .then(({ tick }) => tick())
      .catch((err) => console.warn('[cloud] immediate save failed:', err));
  }, IMMEDIATE_FLUSH_DELAY_MS);
}

/**
 * Returns the id of the currently authenticated user, or null if anonymous.
 * Used to tag outbox rows so they only get pushed under their owner's session.
 */
function currentUserId(): string | null {
  const s = useAuthStore.getState().state;
  return s.kind === 'authed' ? s.user.id : null;
}

/**
 * Returns true if the given workspace_id belongs to a Local_Personal_Workspace
 * (owner_id = 'local'). Such workspaces are intentionally never synced to
 * Supabase — their rows are handled only in local SQLite.
 */
async function isLocalWorkspaceId(
  db: Database,
  workspaceId: string,
): Promise<boolean> {
  const rows = await db.select<Array<{ owner_id: string }>>(
    `SELECT owner_id FROM workspaces WHERE id = $1 LIMIT 1`,
    [workspaceId],
  );
  return rows[0]?.owner_id === 'local';
}

export async function enqueue(
  db: Database,
  entity: Entity,
  entityId: string,
  op: Op,
  data: Record<string, unknown>,
): Promise<void> {
  // Skip rows owned by Local_Personal_Workspace — they must never reach Supabase
  // (they would hit RLS and spin forever in retry).
  const wsId = data.workspace_id as string | undefined;
  if (wsId && (await isLocalWorkspaceId(db, wsId))) {
    return;
  }

  // Tag the row with the user who enqueued it so worker.tick() can push only
  // rows belonging to the current session.
  const userId = currentUserId();

  await db.execute(
    `INSERT INTO sync_outbox (entity, entity_id, op, payload, enqueued_at, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entity, entityId, op, JSON.stringify(data), Date.now(), userId],
  );

  useAuthStore.getState().setPendingCount(await countPendingForUser(db, userId));
  scheduleImmediateFlush();
}

/**
 * Returns outbox rows that are ready to be flushed by the current session.
 *
 * Filters by `user_id`: only rows tagged with the current user's id (or NULL,
 * for legacy rows enqueued before the column existed) are returned. This
 * prevents user A's pendings from being pushed under user B's session — and
 * keeps user A's pendings around for when they sign back in.
 */
export async function listReady(
  db: Database,
  now: number,
  limit = 50,
  userId: string | null = null,
): Promise<
  Array<{ id: number; entity: Entity; entity_id: string; op: Op; payload: string; attempts: number }>
> {
  if (userId === null) {
    return db.select(
      `SELECT id, entity, entity_id, op, payload, attempts
       FROM sync_outbox
       WHERE (next_retry_at IS NULL OR next_retry_at <= $1)
         AND user_id IS NULL
       ORDER BY id LIMIT $2`,
      [now, limit],
    );
  }
  return db.select(
    `SELECT id, entity, entity_id, op, payload, attempts
     FROM sync_outbox
     WHERE (next_retry_at IS NULL OR next_retry_at <= $1)
       AND (user_id = $2 OR user_id IS NULL)
     ORDER BY id LIMIT $3`,
    [now, userId, limit],
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

export async function countPendingForUser(
  db: Database,
  userId: string | null,
): Promise<number> {
  if (userId === null) {
    const rows = await db.select<Array<{ c: number }>>(
      `SELECT COUNT(*) as c FROM sync_outbox WHERE user_id IS NULL`,
    );
    return rows[0]?.c ?? 0;
  }
  const rows = await db.select<Array<{ c: number }>>(
    `SELECT COUNT(*) as c
       FROM sync_outbox
      WHERE user_id = $1 OR user_id IS NULL`,
    [userId],
  );
  return rows[0]?.c ?? 0;
}

export async function listRecentErrors(
  db: Database,
  limit = 20,
  userId?: string | null,
): Promise<Array<{ id: number; entity: string; entity_id: string; last_error: string | null; attempts: number }>> {
  if (userId !== undefined) {
    if (userId === null) {
      return db.select(
        `SELECT id, entity, entity_id, last_error, attempts
         FROM sync_outbox
         WHERE last_error IS NOT NULL
           AND user_id IS NULL
         ORDER BY id DESC LIMIT $1`,
        [limit],
      );
    }
    return db.select(
      `SELECT id, entity, entity_id, last_error, attempts
       FROM sync_outbox
       WHERE last_error IS NOT NULL
         AND (user_id = $1 OR user_id IS NULL)
       ORDER BY id DESC LIMIT $2`,
      [userId, limit],
    );
  }
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

export async function clearForUser(db: Database, userId: string | null): Promise<void> {
  if (userId === null) {
    await db.execute(`DELETE FROM sync_outbox WHERE user_id IS NULL`);
    return;
  }
  await db.execute(`DELETE FROM sync_outbox WHERE user_id = $1 OR user_id IS NULL`, [userId]);
}

export async function clearLegacyRows(db: Database): Promise<void> {
  await db.execute(`DELETE FROM sync_outbox WHERE user_id IS NULL`);
}

// Req 11.3: "Try again" — clear next_retry_at for errored rows so they're picked up immediately
export async function resetRetry(db: Database): Promise<void> {
  await db.execute(
    `UPDATE sync_outbox SET next_retry_at = NULL WHERE last_error IS NOT NULL`,
  );
}

export async function resetRetryForUser(db: Database, userId: string | null): Promise<void> {
  if (userId === null) {
    await db.execute(
      `UPDATE sync_outbox
          SET next_retry_at = NULL
        WHERE last_error IS NOT NULL
          AND user_id IS NULL`,
    );
    return;
  }
  await db.execute(
    `UPDATE sync_outbox
        SET next_retry_at = NULL
      WHERE last_error IS NOT NULL
        AND (user_id = $1 OR user_id IS NULL)`,
    [userId],
  );
}
