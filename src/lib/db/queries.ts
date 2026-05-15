import { getDb } from "./connection";
import { type Resource, type ResourceType, type TimeEvent } from "./types";
import { buildPath, parentPath } from "../utils/tree";
import { newId } from "../utils/uuid";
import { enqueue } from "@/lib/sync/outbox";
import { withTx } from "./tx";
import { recordActivity } from "@/lib/activity/activityLog";
import { useAuthStore } from "@/store/auth";
import { createEventTx, moveResourceTx } from "@/lib/tauri/domainCommands";
import { softDeleteAssignmentsForResource } from "@/lib/assignments/assignmentService";

const now = () => Date.now();

const RESOURCE_LABEL: Record<ResourceType, string> = {
  project: "projekt",
  stage: "etap",
  substage: "podetap",
  task: "zadanie",
};

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
  return withTx(async (db) => {
    const id = input.id ?? newId();
    const ts = input.timestamp ?? now();

    let path: string;
    if (input.parentId === null) {
      path = id;
    } else {
      const parent = await getResource(input.parentId);
      if (!parent) throw new Error(`Parent ${input.parentId} not found`);
      path = buildPath(parent.path.split("/"), id);
    }

    await db.execute(
      `INSERT INTO resources
         (id, parent_id, name, type, color, path, cached_minutes, workspace_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $8)`,
      [
        id,
        input.parentId,
        input.name,
        input.type,
        input.color ?? null,
        path,
        input.workspaceId,
        ts,
      ],
    );

    const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [id]);
    if (rows[0])
      await enqueue(db, "resource", id, "upsert", rows[0] as unknown as Record<string, unknown>);

    await recordActivity(db, {
      workspaceId: input.workspaceId,
      action: "resource.create",
      entityType: "resource",
      entityId: id,
      entityName: input.name,
      summary: `Dodano ${RESOURCE_LABEL[input.type]} "${input.name}"`,
      metadata: { type: input.type, parent_id: input.parentId },
      timestamp: ts,
    });

    return id;
  });
}

export async function renameResource(id: string, name: string): Promise<void> {
  await withTx(async (db) => {
    const previous = await getResource(id);
    await db.execute("UPDATE resources SET name = $1, updated_at = $2 WHERE id = $3", [
      name,
      now(),
      id,
    ]);
    const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [id]);
    if (rows[0])
      await enqueue(db, "resource", id, "upsert", rows[0] as unknown as Record<string, unknown>);
    if (rows[0]) {
      await recordActivity(db, {
        workspaceId: rows[0].workspace_id,
        action: "resource.rename",
        entityType: "resource",
        entityId: id,
        entityName: name,
        summary: `Zmieniono nazwę "${previous?.name ?? id}" na "${name}"`,
        metadata: { from: previous?.name ?? null, to: name },
      });
    }
  });
}

export async function setResourceColor(id: string, color: string | null): Promise<void> {
  await withTx(async (db) => {
    const previous = await getResource(id);
    await db.execute("UPDATE resources SET color = $1, updated_at = $2 WHERE id = $3", [
      color,
      now(),
      id,
    ]);
    const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [id]);
    if (rows[0])
      await enqueue(db, "resource", id, "upsert", rows[0] as unknown as Record<string, unknown>);
    if (rows[0]) {
      await recordActivity(db, {
        workspaceId: rows[0].workspace_id,
        action: "resource.color",
        entityType: "resource",
        entityId: id,
        entityName: rows[0].name,
        summary: color
          ? `Zmieniono kolor "${rows[0].name}"`
          : `Wyczyszczono kolor "${rows[0].name}"`,
        metadata: { from: previous?.color ?? null, to: color },
      });
    }
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
  await withTx(async (db) => {
    const r = await getResource(id);
    if (!r) return;
    const ts = now();

    // Collect affected resource ids and event ids BEFORE the UPDATE (Req 5.5)
    const resourceIds = await db.select<{ id: string }[]>(
      "SELECT id FROM resources WHERE path = $1 OR path LIKE $2",
      [r.path, `${r.path}/%`],
    );
    const eventIds = await db.select<{ id: string }[]>(
      `SELECT e.id FROM events e
       JOIN resources res ON res.id = e.resource_id
       WHERE res.path = $1 OR res.path LIKE $2`,
      [r.path, `${r.path}/%`],
    );

    await db.execute(
      "UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE path = $2 OR path LIKE $3",
      [ts, r.path, `${r.path}/%`],
    );
    // Also soft-delete the events under the subtree.
    await db.execute(
      `UPDATE events SET deleted_at = $1, updated_at = $1
       WHERE resource_id IN (
         SELECT id FROM resources WHERE path = $2 OR path LIKE $3
       )`,
      [ts, r.path, `${r.path}/%`],
    );
    for (const { id: rid } of resourceIds) {
      await softDeleteAssignmentsForResource(db, rid, ts);
    }

    // Enqueue each affected resource (op='upsert' per Req 5.4)
    for (const { id: rid } of resourceIds) {
      const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [rid]);
      if (rows[0])
        await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
    // Enqueue each affected event (Req 5.5)
    for (const { id: eid } of eventIds) {
      const rows = await db.select<TimeEvent[]>("SELECT * FROM events WHERE id = $1", [eid]);
      if (rows[0])
        await enqueue(db, "event", eid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }

    await recordActivity(db, {
      workspaceId: r.workspace_id,
      action: "resource.delete_subtree",
      entityType: "resource",
      entityId: id,
      entityName: r.name,
      summary: `Usunięto "${r.name}" i jego zawartość`,
      metadata: { resource_count: resourceIds.length, event_count: eventIds.length },
      timestamp: ts,
    });
  });
}

/**
 * Re-parent all direct children of `id` to its parent (lifting them one level up),
 * then soft-delete `id` itself (without its descendants further).
 * Validates new parent/child type compatibility — throws if not allowed.
 */
export async function liftChildrenAndDelete(id: string): Promise<void> {
  await withTx(async (db) => {
    const node = await getResource(id);
    if (!node) return;
    const newParentId = node.parent_id;
    const children = await db.select<Resource[]>(
      "SELECT * FROM resources WHERE parent_id = $1 AND deleted_at IS NULL",
      [id],
    );
    const ts = now();
    const newParentPathPrefix =
      newParentId === null ? "" : `${(await getResource(newParentId))!.path}/`;

    // Collect all descendant ids that will have their paths rewritten
    const allAffectedIds: string[] = [];
    for (const c of children) {
      const newPath = `${newParentPathPrefix}${c.id}`;
      await db.execute(
        "UPDATE resources SET parent_id = $1, path = $2, updated_at = $3 WHERE id = $4",
        [newParentId, newPath, ts, c.id],
      );
      // Update all descendants of c (replace c.path prefix → newPath).
      const descendants = await db.select<{ id: string }[]>(
        "SELECT id FROM resources WHERE path LIKE $1",
        [`${c.path}/%`],
      );
      await rewriteDescendantPaths(c.path, newPath);
      allAffectedIds.push(c.id, ...descendants.map((d) => d.id));
    }

    await db.execute("UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE id = $2", [
      ts,
      id,
    ]);
    allAffectedIds.push(id);

    // Enqueue all modified resources
    for (const rid of allAffectedIds) {
      const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [rid]);
      if (rows[0])
        await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }

    await recordActivity(db, {
      workspaceId: node.workspace_id,
      action: "resource.lift_delete",
      entityType: "resource",
      entityId: id,
      entityName: node.name,
      summary: `Usunięto "${node.name}" i podniesiono jego dzieci`,
      metadata: { children_count: children.length },
      timestamp: ts,
    });
  });
}

/**
 * Replace path prefix `oldPrefix` with `newPrefix` for all descendant rows.
 */
async function rewriteDescendantPaths(oldPrefix: string, newPrefix: string): Promise<void> {
  const db = await getDb();
  const descendants = await db.select<{ id: string; path: string }[]>(
    "SELECT id, path FROM resources WHERE path LIKE $1",
    [`${oldPrefix}/%`],
  );
  for (const d of descendants) {
    const updated = `${newPrefix}${d.path.slice(oldPrefix.length)}`;
    await db.execute("UPDATE resources SET path = $1, updated_at = $2 WHERE id = $3", [
      updated,
      now(),
      d.id,
    ]);
  }
}

/**
 * Detach all direct children: each becomes its own root project.
 * Then soft-delete the original.
 */
export async function detachChildrenAsProjects(id: string): Promise<void> {
  await withTx(async (db) => {
    const node = await getResource(id);
    if (!node) return;
    const children = await db.select<Resource[]>(
      "SELECT * FROM resources WHERE parent_id = $1 AND deleted_at IS NULL",
      [id],
    );
    const ts = now();
    const allAffectedIds: string[] = [];

    for (const c of children) {
      await db.execute(
        "UPDATE resources SET parent_id = NULL, type = 'project', path = $1, updated_at = $2 WHERE id = $3",
        [c.id, ts, c.id],
      );
      const descendants = await db.select<{ id: string }[]>(
        "SELECT id FROM resources WHERE path LIKE $1",
        [`${c.path}/%`],
      );
      await rewriteDescendantPaths(c.path, c.id);
      allAffectedIds.push(c.id, ...descendants.map((d) => d.id));
    }

    await db.execute("UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE id = $2", [
      ts,
      id,
    ]);
    allAffectedIds.push(id);

    // Enqueue all modified resources
    for (const rid of allAffectedIds) {
      const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [rid]);
      if (rows[0])
        await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }

    await recordActivity(db, {
      workspaceId: node.workspace_id,
      action: "resource.detach_delete",
      entityType: "resource",
      entityId: id,
      entityName: node.name,
      summary: `Usunięto "${node.name}" i zamieniono dzieci na projekty`,
      metadata: { children_count: children.length },
      timestamp: ts,
    });
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
  return withTx(async (db) => {
    const ts = now();
    const existing = await db.select<TimeEvent[]>("SELECT * FROM events WHERE id = $1", [input.id]);
    const prev = existing[0];
    if (!prev) return;

    await db.execute(
      `UPDATE events
         SET date = $1, minutes = $2, goal = $3, topics = $4,
             notes = $5, report = $6, updated_at = $7
       WHERE id = $8`,
      [
        input.date,
        input.minutes,
        input.goal ?? null,
        input.topics ?? null,
        input.notes ?? null,
        input.report ?? null,
        ts,
        input.id,
      ],
    );

    if (prev.minutes !== input.minutes || prev.date !== input.date) {
      await recalcCachedMinutesForResource(prev.resource_id);
    }

    const rows = await db.select<TimeEvent[]>("SELECT * FROM events WHERE id = $1", [input.id]);
    if (rows[0]) {
      await enqueue(db, "event", input.id, "upsert", rows[0] as unknown as Record<string, unknown>);
      const resources = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [
        rows[0].resource_id,
      ]);
      const resourceName = resources[0]?.name ?? rows[0].resource_id;
      await recordActivity(db, {
        workspaceId: rows[0].workspace_id,
        action: "event.update",
        entityType: "event",
        entityId: input.id,
        entityName: resourceName,
        summary: `Edytowano wpis czasu w "${resourceName}"`,
        metadata: {
          resource_id: rows[0].resource_id,
          before: { date: prev.date, minutes: prev.minutes },
          after: { date: rows[0].date, minutes: rows[0].minutes },
        },
        timestamp: ts,
      });
    }
  });
}

export async function deleteEvent(id: string): Promise<void> {
  return withTx(async (db) => {
    const ts = now();
    const existing = await db.select<TimeEvent[]>("SELECT * FROM events WHERE id = $1", [id]);
    const prev = existing[0];
    if (!prev) return;

    await db.execute("UPDATE events SET deleted_at = $1, updated_at = $1 WHERE id = $2", [ts, id]);
    await recalcCachedMinutesForResource(prev.resource_id);

    const rows = await db.select<TimeEvent[]>("SELECT * FROM events WHERE id = $1", [id]);
    if (rows[0]) {
      await enqueue(db, "event", id, "upsert", rows[0] as unknown as Record<string, unknown>);
      const resources = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [
        prev.resource_id,
      ]);
      const resourceName = resources[0]?.name ?? prev.resource_id;
      await recordActivity(db, {
        workspaceId: prev.workspace_id,
        action: "event.delete",
        entityType: "event",
        entityId: id,
        entityName: resourceName,
        summary: `Usunięto wpis ${prev.minutes} min z "${resourceName}"`,
        metadata: { resource_id: prev.resource_id, date: prev.date, minutes: prev.minutes },
        timestamp: ts,
      });
    }
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
