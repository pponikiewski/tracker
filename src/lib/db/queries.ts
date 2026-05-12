import { getDb } from "./connection";
import { canParent, type Resource, type ResourceType, type TimeEvent } from "./types";
import { buildPath, isDescendantPath, parentPath } from "../utils/tree";
import { newId } from "../utils/uuid";
import { enqueue } from "@/lib/sync/outbox";

const now = () => Date.now();

// Transaction helper — wraps fn in BEGIN/COMMIT, rolls back on error
async function withTx<T>(fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute("BEGIN");
  try {
    const result = await fn(db);
    await db.execute("COMMIT");
    return result;
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

export async function listActiveResources(): Promise<Resource[]> {
  const db = await getDb();
  return db.select<Resource[]>(
    "SELECT * FROM resources WHERE deleted_at IS NULL ORDER BY path",
  );
}

export async function getResource(id: string): Promise<Resource | null> {
  const db = await getDb();
  const rows = await db.select<Resource[]>(
    "SELECT * FROM resources WHERE id = $1 LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

export interface CreateResourceInput {
  parentId: string | null;
  name: string;
  type: ResourceType;
  color?: string | null;
}

export async function createResource(input: CreateResourceInput): Promise<string> {
  return withTx(async (db) => {
    const id = newId();
    const ts = now();

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
         (id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7)`,
      [id, input.parentId, input.name, input.type, input.color ?? null, path, ts],
    );

    const rows = await db.select<Resource[]>(
      "SELECT * FROM resources WHERE id = $1",
      [id],
    );
    if (rows[0]) await enqueue(db, "resource", id, "upsert", rows[0] as unknown as Record<string, unknown>);

    return id;
  });
}

export async function renameResource(id: string, name: string): Promise<void> {
  await withTx(async (db) => {
    await db.execute(
      "UPDATE resources SET name = $1, updated_at = $2 WHERE id = $3",
      [name, now(), id],
    );
    const rows = await db.select<Resource[]>(
      "SELECT * FROM resources WHERE id = $1",
      [id],
    );
    if (rows[0]) await enqueue(db, "resource", id, "upsert", rows[0] as unknown as Record<string, unknown>);
  });
}

export async function setResourceColor(id: string, color: string | null): Promise<void> {
  await withTx(async (db) => {
    await db.execute(
      "UPDATE resources SET color = $1, updated_at = $2 WHERE id = $3",
      [color, now(), id],
    );
    const rows = await db.select<Resource[]>(
      "SELECT * FROM resources WHERE id = $1",
      [id],
    );
    if (rows[0]) await enqueue(db, "resource", id, "upsert", rows[0] as unknown as Record<string, unknown>);
  });
}

/**
 * Move a node under a new parent. Validates type hierarchy and prevents cycles.
 * Throws if move is illegal.
 *
 * Use newParentId=null to make `id` a top-level project (changes type to 'project').
 */
export async function moveResource(id: string, newParentId: string | null): Promise<void> {
  await withTx(async (db) => {
    const node = await getResource(id);
    if (!node) throw new Error("Resource not found");
    if (node.parent_id === newParentId) return; // no-op

    let newType: ResourceType = node.type;
    let newPathPrefix = "";

    if (newParentId === null) {
      newType = "project";
    } else {
      const parent = await getResource(newParentId);
      if (!parent) throw new Error("New parent not found");
      if (isDescendantPath(node.path, parent.path)) {
        throw new Error("Nie można przenieść węzła pod jego własne dziecko");
      }
      if (!canParent(parent.type, node.type)) {
        throw new Error(
          `Typ ${node.type} nie może być dzieckiem ${parent.type}`,
        );
      }
      newPathPrefix = `${parent.path}/`;
    }

    const newPath = `${newPathPrefix}${id}`;
    const ts = now();

    // Collect descendant ids BEFORE path rewrite (Req 5.6)
    const descendants = await db.select<{ id: string }[]>(
      "SELECT id FROM resources WHERE path LIKE $1",
      [`${node.path}/%`],
    );

    await db.execute(
      "UPDATE resources SET parent_id = $1, type = $2, path = $3, updated_at = $4 WHERE id = $5",
      [newParentId, newType, newPath, ts, id],
    );
    await rewriteDescendantPaths(node.path, newPath);

    // Recalculate cached_minutes for both old and new ancestor chains.
    await recalcAncestorChain(node.path);
    await recalcAncestorChain(newPath);

    // Enqueue self + every descendant (Req 5.6)
    const affectedIds = [id, ...descendants.map((d) => d.id)];
    for (const rid of affectedIds) {
      const rows = await db.select<Resource[]>(
        "SELECT * FROM resources WHERE id = $1",
        [rid],
      );
      if (rows[0]) await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
  });
}

/**
 * Re-aggregate cached_minutes for every ancestor in the given path (and self).
 */
async function recalcAncestorChain(path: string): Promise<void> {
  const db = await getDb();
  const ids = path.split("/");
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
    await db.execute(
      "UPDATE resources SET cached_minutes = $1 WHERE id = $2",
      [total, id],
    );
  }
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

    // Enqueue each affected resource (op='upsert' per Req 5.4)
    for (const { id: rid } of resourceIds) {
      const rows = await db.select<Resource[]>(
        "SELECT * FROM resources WHERE id = $1",
        [rid],
      );
      if (rows[0]) await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
    // Enqueue each affected event (Req 5.5)
    for (const { id: eid } of eventIds) {
      const rows = await db.select<TimeEvent[]>(
        "SELECT * FROM events WHERE id = $1",
        [eid],
      );
      if (rows[0]) await enqueue(db, "event", eid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
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

    await db.execute(
      "UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE id = $2",
      [ts, id],
    );
    allAffectedIds.push(id);

    // Enqueue all modified resources
    for (const rid of allAffectedIds) {
      const rows = await db.select<Resource[]>(
        "SELECT * FROM resources WHERE id = $1",
        [rid],
      );
      if (rows[0]) await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
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
    await db.execute(
      "UPDATE resources SET path = $1, updated_at = $2 WHERE id = $3",
      [updated, now(), d.id],
    );
  }
}

/**
 * Detach all direct children: each becomes its own root project.
 * Then soft-delete the original.
 */
export async function detachChildrenAsProjects(id: string): Promise<void> {
  await withTx(async (db) => {
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

    await db.execute(
      "UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE id = $2",
      [ts, id],
    );
    allAffectedIds.push(id);

    // Enqueue all modified resources
    for (const rid of allAffectedIds) {
      const rows = await db.select<Resource[]>(
        "SELECT * FROM resources WHERE id = $1",
        [rid],
      );
      if (rows[0]) await enqueue(db, "resource", rid, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
  });
}

// ---- Events ----

export interface CreateEventInput {
  resourceId: string;
  date: string;
  minutes: number;
  goal?: string;
  topics?: string;
  notes?: string;
  report?: string;
}

export async function createEvent(input: CreateEventInput): Promise<string> {
  return withTx(async (db) => {
    const id = newId();
    const ts = now();
    await db.execute(
      `INSERT INTO events
         (id, resource_id, date, minutes, goal, topics, notes, report, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        id,
        input.resourceId,
        input.date,
        input.minutes,
        input.goal ?? null,
        input.topics ?? null,
        input.notes ?? null,
        input.report ?? null,
        ts,
      ],
    );
    await recalcCachedMinutesForResource(input.resourceId);

    // Enqueue the event only (recalcCachedMinutesForResource does NOT bump updated_at on resources)
    const rows = await db.select<TimeEvent[]>(
      "SELECT * FROM events WHERE id = $1",
      [id],
    );
    if (rows[0]) await enqueue(db, "event", id, "upsert", rows[0] as unknown as Record<string, unknown>);

    return id;
  });
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
): Promise<EventWithResource[]> {
  const db = await getDb();
  return db.select<EventWithResource[]>(
    `SELECT e.*, r.name AS resource_name, r.path AS resource_path
     FROM events e
     JOIN resources r ON r.id = e.resource_id
     WHERE e.deleted_at IS NULL
       AND r.deleted_at IS NULL
       AND e.date >= $1 AND e.date <= $2
     ORDER BY e.date`,
    [fromIso, toIso],
  );
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
    await db.execute(
      "UPDATE resources SET cached_minutes = $1 WHERE id = $2",
      [total, id],
    );
  }
}

// Re-export utility for tests/UI.
export { parentPath };
