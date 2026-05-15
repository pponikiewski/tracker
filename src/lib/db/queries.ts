import { getDb } from "./connection";
import { type Resource, type ResourceType, type TimeEvent } from "./types";
import { parentPath } from "../utils/tree";
import { newId } from "../utils/uuid";
import { useAuthStore } from "@/store/auth";
import {
  createEventTx,
  createResourceTx,
  deleteEventTx,
  detachChildrenAsProjectsTx,
  liftChildrenAndDeleteTx,
  moveResourceTx,
  renameResourceTx,
  setResourceColorTx,
  softDeleteSubtreeTx,
  updateEventTx,
} from "@/lib/tauri/domainCommands";

const now = () => Date.now();

export async function listActiveResources(workspaceId: string): Promise<Resource[]> {
  const db = await getDb();
  return db.select<Resource[]>(
    `SELECT * FROM resources
     WHERE workspace_id = $1 AND deleted_at IS NULL
     ORDER BY path, name ASC, created_at ASC`,
    [workspaceId],
  );
}

export async function getResource(id: string): Promise<Resource | null> {
  const db = await getDb();
  const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function listResourcesByIds(ids: string[]): Promise<Resource[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const uniqueIds = [...new Set(ids)];
  const placeholders = uniqueIds.map((_, index) => `$${index + 1}`).join(",");
  return db.select<Resource[]>(
    `SELECT * FROM resources
     WHERE id IN (${placeholders})
     ORDER BY path, name ASC, created_at ASC`,
    uniqueIds,
  );
}

export interface CreateResourceInput {
  id?: string;
  parentId: string | null;
  name: string;
  type: ResourceType;
  color?: string | null;
  workspaceId: string;
  timestamp?: number;
}

export async function createResource(input: CreateResourceInput): Promise<string> {
  const id = input.id ?? newId();
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await createResourceTx({
    id,
    parentId: input.parentId,
    name: input.name,
    type: input.type,
    color: input.color ?? null,
    workspaceId: input.workspaceId,
    timestamp: input.timestamp ?? now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
  return id;
}

export async function renameResource(id: string, name: string): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await renameResourceTx({
    id,
    name,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}

export async function setResourceColor(id: string, color: string | null): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await setResourceColorTx({
    id,
    color,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}

/**
 * Move a node under a new parent. Validates type hierarchy and prevents cycles.
 * Throws if move is illegal.
 *
 * Use newParentId=null to make `id` a top-level project (changes type to 'project').
 */
export async function moveResource(id: string, newParentId: string | null): Promise<void> {
  const authState = useAuthStore.getState().state;
  const userId = authState.kind === "authed" ? authState.user.id : null;
  await moveResourceTx({
    id,
    newParentId,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    userId,
  });
}

/** Soft-delete the resource and all descendants by path prefix. */
export async function softDeleteSubtree(id: string): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await softDeleteSubtreeTx({
    id,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}

/**
 * Re-parent all direct children of `id` to its parent (lifting them one level up),
 * then soft-delete `id` itself (without its descendants further).
 * Validates new parent/child type compatibility — throws if not allowed.
 */
export async function liftChildrenAndDelete(id: string): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await liftChildrenAndDeleteTx({
    id,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}

/**
 * Detach all direct children: each becomes its own root project.
 * Then soft-delete the original.
 */
export async function detachChildrenAsProjects(id: string): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await detachChildrenAsProjectsTx({
    id,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}
// ---- Events ----

export interface CreateEventInput {
  id?: string;
  resourceId: string;
  date: string;
  minutes: number;
  goal?: string;
  topics?: string;
  notes?: string;
  report?: string;
  workspaceId: string;
  userId?: string | null;
  timestamp?: number;
}

export async function createEvent(input: CreateEventInput): Promise<string> {
  const id = input.id ?? newId();
  const ts = input.timestamp ?? now();
  await createEventTx({
    id,
    resourceId: input.resourceId,
    date: input.date,
    minutes: input.minutes,
    goal: input.goal ?? null,
    topics: input.topics ?? null,
    notes: input.notes ?? null,
    report: input.report ?? null,
    workspaceId: input.workspaceId,
    userId: input.userId ?? null,
    timestamp: ts,
    activityId: crypto.randomUUID(),
  });
  return id;
}

export async function getEvent(id: string): Promise<TimeEvent | null> {
  const db = await getDb();
  const rows = await db.select<TimeEvent[]>("SELECT * FROM events WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function listEventsForResource(resourceId: string): Promise<TimeEvent[]> {
  const db = await getDb();
  return db.select<TimeEvent[]>(
    "SELECT * FROM events WHERE resource_id = $1 AND deleted_at IS NULL ORDER BY date DESC, created_at DESC",
    [resourceId],
  );
}

export interface EventWithResource extends TimeEvent {
  resource_name: string;
  resource_path: string;
}

export async function listEventsInRange(
  fromIso: string,
  toIso: string,
  workspaceId: string,
): Promise<EventWithResource[]> {
  const db = await getDb();
  return db.select<EventWithResource[]>(
    `SELECT e.*, r.name AS resource_name, r.path AS resource_path
     FROM events e
     JOIN resources r ON r.id = e.resource_id
     WHERE e.deleted_at IS NULL
       AND r.deleted_at IS NULL
       AND e.workspace_id = $1
       AND e.date >= $2 AND e.date <= $3
     ORDER BY e.date`,
    [workspaceId, fromIso, toIso],
  );
}

export async function listEventsForHistory(
  workspaceId: string,
  fromIso: string,
  toIso: string,
  userId?: string | null,
): Promise<EventWithResource[]> {
  const db = await getDb();
  const base = `SELECT e.*, r.name AS resource_name, r.path AS resource_path
     FROM events e
     JOIN resources r ON r.id = e.resource_id
     WHERE e.deleted_at IS NULL
       AND r.deleted_at IS NULL
       AND e.workspace_id = $1
       AND e.date >= $2 AND e.date <= $3`;

  if (userId) {
    return db.select<EventWithResource[]>(
      `${base} AND e.user_id = $4 ORDER BY e.date DESC, e.created_at DESC`,
      [workspaceId, fromIso, toIso, userId],
    );
  }

  return db.select<EventWithResource[]>(`${base} ORDER BY e.date DESC, e.created_at DESC`, [
    workspaceId,
    fromIso,
    toIso,
  ]);
}

export interface UpdateEventInput {
  id: string;
  date: string;
  minutes: number;
  goal?: string;
  topics?: string;
  notes?: string;
  report?: string;
}

export async function updateEvent(input: UpdateEventInput): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await updateEventTx({
    id: input.id,
    date: input.date,
    minutes: input.minutes,
    goal: input.goal ?? null,
    topics: input.topics ?? null,
    notes: input.notes ?? null,
    report: input.report ?? null,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}

export async function deleteEvent(id: string): Promise<void> {
  const authState = useAuthStore.getState().state;
  const actorUserId = authState.kind === "authed" ? authState.user.id : null;
  await deleteEventTx({
    id,
    timestamp: now(),
    activityId: crypto.randomUUID(),
    actorUserId,
  });
}

/**
 * Recalculate cached_minutes for the given resource and ALL its ancestors.
 * Each row's cached_minutes = sum of minutes for active events in its subtree.
 */
export async function recalcCachedMinutesForResource(resourceId: string): Promise<void> {
  const db = await getDb();
  const r = await getResource(resourceId);
  if (!r) return;

  // Walk path: each ancestor (and self) gets recalculated.
  const ids = r.path.split("/");
  for (const id of ids) {
    const target = await getResource(id);
    if (!target) continue;
    const rows = await db.select<{ total: number | null }[]>(
      `SELECT COALESCE(SUM(e.minutes), 0) as total
       FROM events e
       JOIN resources r ON r.id = e.resource_id
       WHERE (r.path = $1 OR r.path LIKE $2)
         AND e.deleted_at IS NULL
         AND r.deleted_at IS NULL`,
      [target.path, `${target.path}/%`],
    );
    const total = rows[0]?.total ?? 0;
    await db.execute("UPDATE resources SET cached_minutes = $1 WHERE id = $2", [total, id]);
  }
}

// Re-export utility for tests/UI.
export { parentPath };
