import { getDb } from '@/lib/db/connection';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { listReady, deleteByIds, bumpRetry, countPending } from './outbox';
import type { Entity } from './types';

interface ReadyRow {
  id: number;
  entity: Entity;
  entity_id: string;
  op: 'upsert' | 'delete';
  payload: string;
  attempts: number;
}

interface CollapseResult {
  perEntity: Record<Entity, ReadyRow[]>;
  supersededIds: Record<Entity, number[]>;
}

let timer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;

export function collapseDuplicates(rows: ReadyRow[]): CollapseResult {
  const latest = new Map<string, ReadyRow>();
  const perEntity: Record<Entity, ReadyRow[]> = { resource: [], event: [], workspace: [], workspace_membership: [], assignment: [] };
  const supersededIds: Record<Entity, number[]> = { resource: [], event: [], workspace: [], workspace_membership: [], assignment: [] };

  for (const r of rows) {
    const k = `${r.entity}:${r.entity_id}`;
    const prev = latest.get(k);
    if (!prev) {
      latest.set(k, r);
      continue;
    }
    if (r.id > prev.id) {
      supersededIds[prev.entity].push(prev.id);
      latest.set(k, r);
    } else {
      supersededIds[r.entity].push(r.id);
    }
  }
  for (const r of latest.values()) perEntity[r.entity].push(r);
  return { perEntity, supersededIds };
}

// Exported for property tests (Property 8)
export function isValidTimestamp(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

// Exported for property tests (Property 7)
export function mapToCloud(data: Record<string, unknown>, userId: string): Record<string, unknown> {
  const toIso = (v: number) => new Date(v).toISOString();
  return {
    ...data,
    user_id: userId,
    created_at: toIso(data.created_at as number),
    updated_at: toIso(data.updated_at as number),
    deleted_at: data.deleted_at != null ? toIso(data.deleted_at as number) : null,
  };
}

// Exported for property tests (Property 10)
// Workspace has owner_id, NOT user_id — do not inject user_id
export function mapWorkspaceToCloud(data: Record<string, unknown>): Record<string, unknown> {
  const toIso = (v: number) => new Date(v).toISOString();
  return {
    ...data,
    created_at: toIso(data.created_at as number),
    updated_at: toIso(data.updated_at as number),
    deleted_at: data.deleted_at != null ? toIso(data.deleted_at as number) : null,
  };
}

function validateRowTimestamps(data: Record<string, unknown>): string | null {
  if (!isValidTimestamp(data.created_at)) return `invalid created_at: ${String(data.created_at)}`;
  if (!isValidTimestamp(data.updated_at)) return `invalid updated_at: ${String(data.updated_at)}`;
  if (data.deleted_at != null && !isValidTimestamp(data.deleted_at)) {
    return `invalid deleted_at: ${String(data.deleted_at)}`;
  }
  return null;
}

function validateMembershipTimestamps(data: Record<string, unknown>): string | null {
  if (!isValidTimestamp(data.joined_at)) return `invalid joined_at: ${String(data.joined_at)}`;
  return null;
}

interface FlushOutcome {
  deletableIds: number[];
  failedIds: number[];
  invalidIds: number[];
  errorMessage?: string;
}

async function flushEntity(
  entity: Entity,
  latestRows: ReadyRow[],
  supersededIds: number[],
  userId: string,
): Promise<FlushOutcome> {
  const outcome: FlushOutcome = { deletableIds: [], failedIds: [], invalidIds: [] };
  if (latestRows.length === 0) {
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }
  if (!supabase) return outcome;

  const db = await getDb();

  // Handle workspace_membership separately (composite key delete, joined_at conversion)
  if (entity === 'workspace_membership') {
    for (const row of latestRows) {
      const data = JSON.parse(row.payload) as Record<string, unknown>;

      if (row.op === 'delete') {
        const { error } = await supabase
          .from('workspace_memberships')
          .delete()
          .match({ workspace_id: data.workspace_id, user_id: data.user_id });
        if (error) {
          await bumpRetry(db, [row.id], error.message, Date.now());
          outcome.failedIds.push(row.id);
          outcome.errorMessage = error.message;
        } else {
          outcome.deletableIds.push(row.id);
        }
      } else {
        // upsert — validate joined_at
        const err = validateMembershipTimestamps(data);
        if (err) {
          await bumpRetry(db, [row.id], err, Date.now());
          outcome.invalidIds.push(row.id);
          continue;
        }
        const mapped = {
          ...data,
          joined_at: new Date(data.joined_at as number).toISOString(),
        };
        const { error } = await supabase
          .from('workspace_memberships')
          .upsert(mapped, { onConflict: 'workspace_id,user_id' });
        if (error) {
          await bumpRetry(db, [row.id], error.message, Date.now());
          outcome.failedIds.push(row.id);
          outcome.errorMessage = error.message;
        } else {
          outcome.deletableIds.push(row.id);
        }
      }
    }
    // Superseded can be deleted regardless of individual row outcomes
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }

  // Handle workspace, resource, event (upsert-only entities)
  const toPush: Array<{ row: ReadyRow; mapped: Record<string, unknown> }> = [];

  for (const row of latestRows) {
    const data = JSON.parse(row.payload) as Record<string, unknown>;
    const err = validateRowTimestamps(data);
    if (err) {
      // Req 7.5: skip invalid row, record error
      await bumpRetry(db, [row.id], err, Date.now());
      outcome.invalidIds.push(row.id);
      continue;
    }
    const mapped =
      entity === 'workspace'
        ? mapWorkspaceToCloud(data)
        : mapToCloud(data, userId);
    toPush.push({ row, mapped });
  }

  if (toPush.length === 0) {
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }

  const table =
    entity === 'resource' ? 'resources' :
    entity === 'event' ? 'events' :
    'workspaces';

  const { error } = await supabase
    .from(table)
    .upsert(toPush.map((x) => x.mapped), { onConflict: 'id' });

  if (error) {
    // Req 6.7: failure — bump retry on latest ids only, do NOT delete superseded
    outcome.failedIds = toPush.map((x) => x.row.id);
    outcome.errorMessage = error.message;
    return outcome;
  }

  // Success — delete latest + superseded
  outcome.deletableIds = [...toPush.map((x) => x.row.id), ...supersededIds];
  return outcome;
}

export async function tick(): Promise<void> {
  const auth = useAuthStore.getState();
  if (auth.state.kind !== 'authed') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    auth.setSyncStatus({ kind: 'offline' });
    return;
  }
  const db = await getDb();
  const now = Date.now();
  const rows = (await listReady(db, now, 50)) as ReadyRow[];
  if (rows.length === 0) {
    auth.setPendingCount(await countPending(db));
    return;
  }
  auth.setSyncStatus({ kind: 'syncing' });
  const { perEntity, supersededIds } = collapseDuplicates(rows);
  const userId = auth.state.user.id;

  // Req 6.7: flush each entity independently
  const resOutcome = await flushEntity('resource', perEntity.resource, supersededIds.resource, userId);
  const evtOutcome = await flushEntity('event', perEntity.event, supersededIds.event, userId);
  const wsOutcome = await flushEntity('workspace', perEntity.workspace, supersededIds.workspace, userId);
  const wsmOutcome = await flushEntity('workspace_membership', perEntity.workspace_membership, supersededIds.workspace_membership, userId);

  // Delete successfully flushed rows
  await deleteByIds(db, [
    ...resOutcome.deletableIds,
    ...evtOutcome.deletableIds,
    ...wsOutcome.deletableIds,
    ...wsmOutcome.deletableIds,
  ]);

  // Bump retry only on failed latest rows (invalid rows already had bumpRetry called per-row)
  if (resOutcome.failedIds.length > 0) {
    await bumpRetry(db, resOutcome.failedIds, resOutcome.errorMessage ?? 'unknown', Date.now());
  }
  if (evtOutcome.failedIds.length > 0) {
    await bumpRetry(db, evtOutcome.failedIds, evtOutcome.errorMessage ?? 'unknown', Date.now());
  }
  if (wsOutcome.failedIds.length > 0) {
    await bumpRetry(db, wsOutcome.failedIds, wsOutcome.errorMessage ?? 'unknown', Date.now());
  }
  if (wsmOutcome.failedIds.length > 0) {
    await bumpRetry(db, wsmOutcome.failedIds, wsmOutcome.errorMessage ?? 'unknown', Date.now());
  }

  const anyFailed =
    resOutcome.failedIds.length + evtOutcome.failedIds.length +
    wsOutcome.failedIds.length + wsmOutcome.failedIds.length +
    resOutcome.invalidIds.length + evtOutcome.invalidIds.length +
    wsOutcome.invalidIds.length + wsmOutcome.invalidIds.length > 0;

  if (anyFailed) {
    const msg =
      [resOutcome.errorMessage, evtOutcome.errorMessage, wsOutcome.errorMessage, wsmOutcome.errorMessage]
        .filter(Boolean).join('; ') || 'sync error';
    auth.setSyncStatus({ kind: 'error', message: msg });
  } else {
    auth.setSyncStatus({ kind: 'idle' });
    auth.setLastSyncAt(Date.now());
  }
  auth.setPendingCount(await countPending(db));
}

export function startWorker(): void {
  if (timer) return; // Req 15.3: idempotent
  timer = setInterval(() => { void tick(); }, 10_000);
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

export function stopWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}
