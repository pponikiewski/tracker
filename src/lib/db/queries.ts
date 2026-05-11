import { getDb } from "./connection";
import type { Resource, ResourceType, TimeEvent } from "./types";
import { buildPath, parentPath } from "../utils/tree";
import { newId } from "../utils/uuid";

const now = () => Date.now();

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
  const db = await getDb();
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

  return id;
}

export async function renameResource(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE resources SET name = $1, updated_at = $2 WHERE id = $3",
    [name, now(), id],
  );
}

export async function setResourceColor(id: string, color: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE resources SET color = $1, updated_at = $2 WHERE id = $3",
    [color, now(), id],
  );
}

/** Soft-delete the resource and all descendants by path prefix. */
export async function softDeleteSubtree(id: string): Promise<void> {
  const db = await getDb();
  const r = await getResource(id);
  if (!r) return;
  const ts = now();
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
}

/**
 * Re-parent all direct children of `id` to its parent (lifting them one level up),
 * then soft-delete `id` itself (without its descendants further).
 * Validates new parent/child type compatibility — throws if not allowed.
 */
export async function liftChildrenAndDelete(id: string): Promise<void> {
  const db = await getDb();
  const node = await getResource(id);
  if (!node) return;
  const newParentId = node.parent_id;
  const children = await db.select<Resource[]>(
    "SELECT * FROM resources WHERE parent_id = $1 AND deleted_at IS NULL",
    [id],
  );
  const ts = now();
  const newParentPathPrefix = newParentId === null ? "" : `${(await getResource(newParentId))!.path}/`;

  for (const c of children) {
    const newPath = `${newParentPathPrefix}${c.id}`;
    await db.execute(
      "UPDATE resources SET parent_id = $1, path = $2, updated_at = $3 WHERE id = $4",
      [newParentId, newPath, ts, c.id],
    );
    // Update all descendants of c (replace c.path prefix → newPath).
    await rewriteDescendantPaths(c.path, newPath);
  }

  await db.execute(
    "UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE id = $2",
    [ts, id],
  );
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
  const db = await getDb();
  const children = await db.select<Resource[]>(
    "SELECT * FROM resources WHERE parent_id = $1 AND deleted_at IS NULL",
    [id],
  );
  const ts = now();
  for (const c of children) {
    await db.execute(
      "UPDATE resources SET parent_id = NULL, type = 'project', path = $1, updated_at = $2 WHERE id = $3",
      [c.id, ts, c.id],
    );
    await rewriteDescendantPaths(c.path, c.id);
  }
  await db.execute(
    "UPDATE resources SET deleted_at = $1, updated_at = $1 WHERE id = $2",
    [ts, id],
  );
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
  const db = await getDb();
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
  return id;
}

export async function listEventsForResource(resourceId: string): Promise<TimeEvent[]> {
  const db = await getDb();
  return db.select<TimeEvent[]>(
    "SELECT * FROM events WHERE resource_id = $1 AND deleted_at IS NULL ORDER BY date DESC, created_at DESC",
    [resourceId],
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
