import { getDb } from "@/lib/db/connection";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import { useProjects } from "@/store/projects";
import { useWorkspaceStore } from "@/store/workspace";
import { lwwMerge } from "./merge";
import { enqueue } from "./outbox";
import { recalcCachedMinutesForResource } from "@/lib/db/queries";
import type {
  ActivityLogEntry,
  Assignment,
  Resource,
  TimeEvent,
  Workspace,
  WorkspaceMembership,
} from "@/lib/db/types";
import { ltreeToPath } from "@/lib/utils/ltree";

const pulledForUser = new Set<string>();

/**
 * Forgets that initial pull has run for any user. Call this after wiping the
 * local SQLite cache (e.g. on user switch) so the next authenticated user
 * triggers a fresh pull instead of being short-circuited by the in-memory
 * "already pulled" guard.
 */
export function resetInitialPullState(): void {
  pulledForUser.clear();
}

export function hasRunInitialPull(userId: string): boolean {
  return pulledForUser.has(userId);
}

const toMs = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : (v as number));

function cloudToLocalResource(c: Record<string, unknown>): Resource {
  // path may be in ltree format (dots + underscores) or legacy TEXT format (slashes + hyphens)
  // Try ltree conversion first; fall back to using the value as-is if it fails
  let path: string;
  try {
    path = ltreeToPath(c.path as string);
  } catch {
    // Legacy TEXT format or already a materialized path — use as-is
    path = c.path as string;
  }
  return {
    id: c.id as string,
    workspace_id: c.workspace_id as string,
    parent_id: (c.parent_id as string | null) ?? null,
    name: c.name as string,
    type: c.type as Resource["type"],
    color: (c.color as string | null) ?? null,
    path,
    cached_minutes: (c.cached_minutes as number) ?? 0,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

function cloudToLocalEvent(c: Record<string, unknown>): TimeEvent {
  return {
    id: c.id as string,
    workspace_id: c.workspace_id as string,
    resource_id: c.resource_id as string,
    date: c.date as string,
    minutes: c.minutes as number,
    goal: (c.goal as string | null) ?? null,
    topics: (c.topics as string | null) ?? null,
    notes: (c.notes as string | null) ?? null,
    report: (c.report as string | null) ?? null,
    user_id: (c.user_id as string | null) ?? null,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

// Req 2.1, 2.2: convert cloud workspace row (ISO timestamps) to local Workspace (Unix ms)
function cloudToLocalWorkspace(c: Record<string, unknown>): Workspace {
  return {
    id: c.id as string,
    name: c.name as string,
    owner_id: c.owner_id as string,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

// Req 2.2: convert cloud membership row (ISO timestamps) to local WorkspaceMembership (Unix ms)
function cloudToLocalMembership(c: Record<string, unknown>): WorkspaceMembership {
  return {
    workspace_id: c.workspace_id as string,
    user_id: c.user_id as string,
    role: c.role as WorkspaceMembership["role"],
    joined_at: toMs(c.joined_at),
    display_role: (c.display_role as string | null) ?? null,
    display_role_updated_at: c.display_role_updated_at ? toMs(c.display_role_updated_at) : null,
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

// Req 8.4: convert cloud assignment row (ISO timestamps) to local Assignment (Unix ms)
function cloudToLocalAssignment(c: Record<string, unknown>): Assignment {
  return {
    id: c.id as string,
    resource_id: c.resource_id as string,
    user_id: c.user_id as string,
    workspace_id: c.workspace_id as string,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

function cloudToLocalActivity(c: Record<string, unknown>): ActivityLogEntry {
  return {
    id: c.id as string,
    workspace_id: c.workspace_id as string,
    user_id: (c.user_id as string | null) ?? null,
    action: c.action as string,
    entity_type: c.entity_type as string,
    entity_id: (c.entity_id as string | null) ?? null,
    entity_name: (c.entity_name as string | null) ?? null,
    summary: c.summary as string,
    metadata: (c.metadata as string | null) ?? null,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

function resourceDepth(resource: Resource): number {
  return resource.path.split("/").length;
}

/**
 * Returns an existing workspace visible to the user, if any.
 * New workspaces are created only from explicit UI actions.
 */
export async function findAccessibleWorkspace(): Promise<string | null> {
  if (!supabase) throw new Error("Supabase not configured");

  const { data: accessible, error: accessibleErr } = await supabase
    .from("workspaces")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (accessibleErr) throw new Error(accessibleErr.message);

  if (accessible && accessible.length > 0 && accessible[0]) {
    return accessible[0].id as string;
  }

  return null;
}

// Req 8.7: rebuild materialized paths from parent_id chains
async function rebuildAllPaths(): Promise<void> {
  const db = await getDb();
  const all = await db.select<Array<{ id: string; parent_id: string | null }>>(
    `SELECT id, parent_id FROM resources`,
  );
  const byId = new Map(all.map((r) => [r.id, r]));
  const pathCache = new Map<string, string>();

  const computePath = (id: string, visiting = new Set<string>()): string => {
    if (pathCache.has(id)) return pathCache.get(id)!;
    if (visiting.has(id)) throw new Error(`cycle detected in parent_id chain at ${id}`);
    visiting.add(id);
    const r = byId.get(id);
    if (!r) return id;
    const path = r.parent_id ? `${computePath(r.parent_id, visiting)}/${id}` : id;
    pathCache.set(id, path);
    return path;
  };

  for (const r of all) {
    const correctPath = computePath(r.id);
    await db.execute(`UPDATE resources SET path = $1 WHERE id = $2 AND path != $1`, [
      correctPath,
      r.id,
    ]);
  }
}

async function resourceExists(resourceId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM resources WHERE id = $1 LIMIT 1`,
    [resourceId],
  );
  return rows.length > 0;
}

async function fetchAndWriteMissingResource(
  resourceId: string,
  visiting: Set<string> = new Set(),
): Promise<boolean> {
  if (!supabase) return false;
  if (visiting.has(resourceId)) return false; // cycle guard
  visiting.add(resourceId);
  const db = await getDb();
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .eq("id", resourceId)
    .maybeSingle();

  if (error || !data) return false;

  const resource = await normalizeResourceForLocalWrite(
    cloudToLocalResource(data as Record<string, unknown>),
    visiting,
  );
  await db.execute(
    `INSERT INTO resources (id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(id) DO UPDATE SET
       workspace_id=excluded.workspace_id,
       parent_id=excluded.parent_id, name=excluded.name, type=excluded.type,
       color=excluded.color, path=excluded.path, cached_minutes=excluded.cached_minutes,
       created_at=excluded.created_at, updated_at=excluded.updated_at,
       deleted_at=excluded.deleted_at`,
    [
      resource.id,
      resource.workspace_id,
      resource.parent_id,
      resource.name,
      resource.type,
      resource.color,
      resource.path,
      resource.cached_minutes,
      resource.created_at,
      resource.updated_at,
      resource.deleted_at,
    ],
  );
  return true;
}

async function normalizeResourceForLocalWrite(
  resource: Resource,
  visiting: Set<string> = new Set(),
): Promise<Resource> {
  if (resource.parent_id === null) return resource;
  if (await resourceExists(resource.parent_id)) return resource;

  // Parent missing locally — try to fetch it from cloud before falling back to detach.
  // Symmetric with the event → resource recovery path.
  const recovered = await fetchAndWriteMissingResource(resource.parent_id, visiting);
  if (recovered && (await resourceExists(resource.parent_id))) {
    return resource;
  }

  console.warn(
    `[sync] detaching resource ${resource.id}: parent ${resource.parent_id} is not present locally`,
  );

  // Preserve original type (invariant: type is fixed at creation; moveResource never mutates it).
  // Local-only orphan state — next pull may reattach if parent becomes visible.
  return {
    ...resource,
    parent_id: null,
    path: resource.id,
  };
}

export async function runInitialPull(userId: string): Promise<void> {
  if (!supabase) return;
  // Req 8.1: only pull once per user per process
  if (pulledForUser.has(userId)) return;
  await runPull(userId, /* isInitial */ true);
}

/**
 * Lighter pull used to refresh local SQLite from cloud changes made by team
 * members. Re-runs the full LWW merge — safe because merging is idempotent.
 *
 * Skips the personal-workspace provisioning step (already done at first login)
 * and uses sync status 'syncing' instead of 'initial-pull' so the badge does
 * not flash "Syncing initial..." every 30 seconds.
 */
export async function runIncrementalPull(userId: string): Promise<void> {
  if (!supabase) return;
  await runPull(userId, /* isInitial */ false);
}

async function runPull(userId: string, isInitial: boolean): Promise<void> {
  if (!supabase) return;

  const auth = useAuthStore.getState();
  if (isInitial) {
    auth.setSyncStatus({ kind: "initial-pull" });
  }

  // Step 1: Check whether the user already has a workspace. Do not create one
  // implicitly; new accounts should see the explicit create/join screen.
  if (isInitial) {
    try {
      await findAccessibleWorkspace();
    } catch (e) {
      auth.setSyncStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "failed to check workspaces",
      });
      return;
    }
  }

  // Step 2: Fetch workspaces + workspace_memberships in parallel (Req 7.5)
  const [{ data: cloudWS, error: errWS }, { data: cloudMem, error: errMem }] = await Promise.all([
    supabase.from("workspaces").select("*"),
    supabase.from("workspace_memberships").select("*"),
  ]);

  // Step 3: If workspace fetch fails — set error and stop (do NOT fetch resources/events)
  if (errWS || errMem) {
    auth.setSyncStatus({ kind: "error", message: (errWS ?? errMem)!.message });
    return;
  }

  const db = await getDb();

  // Step 4: LWW merge workspaces → write to SQLite (Req 2.2, 7.6)
  // Exclude Local_Personal_Workspace (owner_id = 'local') — it must never be synced to Supabase
  const localWS = (await db.select<Workspace[]>(`SELECT * FROM workspaces`)).filter(
    (w) => w.owner_id !== "local",
  );
  const cloudWSLoc = (cloudWS ?? []).map((c) =>
    cloudToLocalWorkspace(c as Record<string, unknown>),
  );
  const wsMerge = lwwMerge(localWS, cloudWSLoc);

  try {
    for (const w of wsMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, owner_id=excluded.owner_id,
           created_at=excluded.created_at, updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at`,
        [w.id, w.name, w.owner_id, w.created_at, w.updated_at, w.deleted_at],
      );
    }
    for (const w of wsMerge.pushOutbox) {
      await enqueue(db, "workspace", w.id, "upsert", w as unknown as Record<string, unknown>);
    }
  } catch (e) {
    auth.setSyncStatus({
      kind: "error",
      message: e instanceof Error ? e.message : "workspace write failed",
    });
    return;
  }

  // Step 5: LWW merge memberships → write to SQLite (Req 2.2)
  // Exclude local memberships (user_id = 'local') — they must never be synced
  const localMem = (
    await db.select<WorkspaceMembership[]>(`SELECT * FROM workspace_memberships`)
  ).filter((m) => m.user_id !== "local");
  const cloudMemLoc = (cloudMem ?? []).map((c) =>
    cloudToLocalMembership(c as Record<string, unknown>),
  );

  // WorkspaceMembership uses composite key (workspace_id, user_id) — synthesise an id for lwwMerge.
  // updated_at is required by MergeRow; role labels use display_role_updated_at, otherwise joined_at.
  type MembershipWithId = WorkspaceMembership & { id: string; updated_at: number };
  const membershipUpdatedAt = (m: WorkspaceMembership): number =>
    Math.max(m.joined_at, m.display_role_updated_at ?? 0, m.deleted_at ?? 0);
  const localMemWithId: MembershipWithId[] = localMem.map((m) => ({
    ...m,
    id: `${m.workspace_id}:${m.user_id}`,
    updated_at: membershipUpdatedAt(m),
  }));
  const cloudMemWithId: MembershipWithId[] = cloudMemLoc.map((m) => ({
    ...m,
    id: `${m.workspace_id}:${m.user_id}`,
    updated_at: membershipUpdatedAt(m),
  }));

  const memMerge = lwwMerge<MembershipWithId>(localMemWithId, cloudMemWithId);

  try {
    for (const m of memMerge.writeSqlite) {
      const local = localMem.find(
        (candidate) => candidate.workspace_id === m.workspace_id && candidate.user_id === m.user_id,
      );
      const localDisplayRoleTs = local?.display_role_updated_at ?? 0;
      const cloudDisplayRoleTs = m.display_role_updated_at ?? 0;
      const displayRole =
        local && localDisplayRoleTs > cloudDisplayRoleTs ? local.display_role : m.display_role;
      const displayRoleUpdatedAt =
        local && localDisplayRoleTs > cloudDisplayRoleTs
          ? local.display_role_updated_at
          : m.display_role_updated_at;

      await db.execute(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at, display_role, display_role_updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(workspace_id, user_id) DO UPDATE SET
           role=excluded.role, joined_at=excluded.joined_at,
           display_role=excluded.display_role,
           display_role_updated_at=excluded.display_role_updated_at,
           deleted_at=excluded.deleted_at`,
        [
          m.workspace_id,
          m.user_id,
          m.role,
          m.joined_at,
          displayRole ?? null,
          displayRoleUpdatedAt ?? null,
          m.deleted_at,
        ],
      );
    }
    for (const m of memMerge.pushOutbox) {
      if (
        m.user_id === userId &&
        cloudMemLoc.some(
          (cloud) => cloud.workspace_id === m.workspace_id && cloud.user_id === m.user_id,
        )
      ) {
        continue;
      }
      // Strip synthetic id and updated_at (added only for lwwMerge) before enqueue —
      // Supabase workspace_memberships table has no 'id' column (composite PK)
      // and no 'updated_at' column.
      const payload = {
        workspace_id: m.workspace_id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        display_role: m.display_role ?? null,
        display_role_updated_at: m.display_role_updated_at ?? null,
        deleted_at: m.deleted_at,
      };
      await enqueue(
        db,
        "workspace_membership",
        `${m.workspace_id}:${m.user_id}`,
        "upsert",
        payload as unknown as Record<string, unknown>,
      );
    }
  } catch (e) {
    auth.setSyncStatus({
      kind: "error",
      message: e instanceof Error ? e.message : "membership write failed",
    });
    return;
  }

  // Treat "table not found" / "relation does not exist" errors as benign and
  // return an empty result set so Phase 5 users (without the Phase 6 tables
  // `assignments` and `profiles`) are not blocked by initial-pull failures.
  type SbError = { code?: string; message?: string } | null;
  function isMissingTable(err: SbError): boolean {
    if (!err) return false;
    return (
      err.code === "PGRST205" ||
      err.code === "42P01" ||
      (err.message?.toLowerCase().includes("could not find the table") ?? false)
    );
  }

  // Step 6: Fetch resources + events + assignments (Req 8.4)
  const [
    { data: cloudR, error: errR },
    { data: cloudE, error: errE },
    { data: cloudA, error: errA },
    { data: cloudAct, error: errAct },
  ] = await Promise.all([
    supabase.from("resources").select("*"),
    supabase.from("events").select("*"),
    supabase.from("assignments").select("*"),
    supabase.from("activity_log").select("*"),
  ]);

  // assignments is optional — degrade gracefully when the Phase 6 table is
  // missing instead of aborting the whole pull.
  const assignmentsMissing = isMissingTable(errA);
  const activityLogMissing = isMissingTable(errAct);
  if (assignmentsMissing) {
    console.warn(
      "[sync] `assignments` table not found in Supabase — skipping assignment sync. " +
        "Run the Phase 6 migration to enable team assignments.",
    );
  }
  if (activityLogMissing) {
    console.warn(
      "[sync] `activity_log` table not found in Supabase - skipping activity log sync. " +
        "Run the activity-log migration to enable the shared team activity feed.",
    );
  }

  const errRWithoutMissing = isMissingTable(errR) ? null : errR;
  const errEWithoutMissing = isMissingTable(errE) ? null : errE;
  const errAWithoutMissing = assignmentsMissing ? null : errA;
  const errActWithoutMissing = activityLogMissing ? null : errAct;

  if (errRWithoutMissing || errEWithoutMissing || errAWithoutMissing || errActWithoutMissing) {
    auth.setSyncStatus({
      kind: "error",
      message: (errRWithoutMissing ??
        errEWithoutMissing ??
        errAWithoutMissing ??
        errActWithoutMissing)!.message,
    });
    return;
  }

  // Step 7: LWW merge resources/events/assignments → write to SQLite, rebuild paths, recalc, reload
  const localR = await db.select<Resource[]>(`SELECT * FROM resources`);
  const localE = await db.select<TimeEvent[]>(`SELECT * FROM events`);
  const localA = await db.select<Assignment[]>(`SELECT * FROM assignments`);
  const localAct = await db.select<ActivityLogEntry[]>(`SELECT * FROM activity_log`);

  const cloudRloc = (cloudR ?? []).map((c) => cloudToLocalResource(c as Record<string, unknown>));
  const cloudEloc = (cloudE ?? []).map((c) => cloudToLocalEvent(c as Record<string, unknown>));
  const cloudAloc = assignmentsMissing
    ? []
    : (cloudA ?? []).map((c) => cloudToLocalAssignment(c as Record<string, unknown>));
  const cloudActLoc = activityLogMissing
    ? []
    : (cloudAct ?? []).map((c) => cloudToLocalActivity(c as Record<string, unknown>));

  const rMerge = lwwMerge(localR, cloudRloc);
  const eMerge = lwwMerge(localE, cloudEloc);
  // When the cloud `assignments` table is missing, skip the merge entirely so
  // we don't enqueue local-wins that would all fail with 404 on push.
  const aMerge = assignmentsMissing
    ? { writeSqlite: [] as Assignment[], pushOutbox: [] as Assignment[] }
    : lwwMerge(localA, cloudAloc);
  const actMerge = activityLogMissing
    ? { writeSqlite: [] as ActivityLogEntry[], pushOutbox: [] as ActivityLogEntry[] }
    : lwwMerge(localAct, cloudActLoc);
  const hasPulledUiChanges =
    wsMerge.writeSqlite.length > 0 ||
    memMerge.writeSqlite.length > 0 ||
    rMerge.writeSqlite.length > 0 ||
    eMerge.writeSqlite.length > 0 ||
    aMerge.writeSqlite.length > 0 ||
    actMerge.writeSqlite.length > 0;

  try {
    const resourcesToWrite = [...rMerge.writeSqlite].sort(
      (a, b) => resourceDepth(a) - resourceDepth(b),
    );

    for (const r of resourcesToWrite) {
      const localResource = await normalizeResourceForLocalWrite(r);
      try {
        await db.execute(
          `INSERT INTO resources (id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(id) DO UPDATE SET
             workspace_id=excluded.workspace_id,
             parent_id=excluded.parent_id, name=excluded.name, type=excluded.type,
             color=excluded.color, path=excluded.path, cached_minutes=excluded.cached_minutes,
              created_at=excluded.created_at, updated_at=excluded.updated_at,
              deleted_at=excluded.deleted_at`,
          [
            localResource.id,
            localResource.workspace_id,
            localResource.parent_id,
            localResource.name,
            localResource.type,
            localResource.color,
            localResource.path,
            localResource.cached_minutes,
            localResource.created_at,
            localResource.updated_at,
            localResource.deleted_at,
          ],
        );
      } catch (error) {
        const wrapped = new Error(
          `resource ${localResource.id} (${localResource.name}) write failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        (wrapped as Error & { cause?: unknown }).cause = error;
        throw wrapped;
      }
    }
    for (const e of eMerge.writeSqlite) {
      if (!(await resourceExists(e.resource_id))) {
        const recovered = await fetchAndWriteMissingResource(e.resource_id);
        if (!recovered) {
          console.warn(
            `[sync] skipping event ${e.id}: resource ${e.resource_id} is not present locally`,
          );
          continue;
        }
      }
      try {
        await db.execute(
          `INSERT INTO events (id, workspace_id, resource_id, date, minutes, goal, topics, notes, report, user_id, created_at, updated_at, deleted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT(id) DO UPDATE SET
             workspace_id=excluded.workspace_id,
             resource_id=excluded.resource_id, date=excluded.date, minutes=excluded.minutes,
             goal=excluded.goal, topics=excluded.topics, notes=excluded.notes, report=excluded.report,
             user_id=excluded.user_id,
             created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
          [
            e.id,
            e.workspace_id,
            e.resource_id,
            e.date,
            e.minutes,
            e.goal,
            e.topics,
            e.notes,
            e.report,
            e.user_id,
            e.created_at,
            e.updated_at,
            e.deleted_at,
          ],
        );
      } catch (error) {
        const wrapped = new Error(
          `event ${e.id} for resource ${e.resource_id} write failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        (wrapped as Error & { cause?: unknown }).cause = error;
        throw wrapped;
      }
    }

    // Enqueue local-wins for push to cloud
    for (const r of rMerge.pushOutbox) {
      await enqueue(db, "resource", r.id, "upsert", r as unknown as Record<string, unknown>);
    }
    for (const e of eMerge.pushOutbox) {
      await enqueue(db, "event", e.id, "upsert", e as unknown as Record<string, unknown>);
    }

    // Req 8.4: write cloud-wins assignments to SQLite
    for (const a of aMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO assignments (id, resource_id, user_id, workspace_id, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO UPDATE SET
           resource_id=excluded.resource_id, user_id=excluded.user_id,
           workspace_id=excluded.workspace_id,
           created_at=excluded.created_at, updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at`,
        [a.id, a.resource_id, a.user_id, a.workspace_id, a.created_at, a.updated_at, a.deleted_at],
      );
    }
    // Req 9.4: enqueue local-wins assignments for push to cloud
    for (const a of aMerge.pushOutbox) {
      await enqueue(db, "assignment", a.id, "upsert", a as unknown as Record<string, unknown>);
    }

    for (const entry of actMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO activity_log
           (id, workspace_id, user_id, action, entity_type, entity_id, entity_name, summary, metadata, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id=excluded.workspace_id,
           user_id=excluded.user_id,
           action=excluded.action,
           entity_type=excluded.entity_type,
           entity_id=excluded.entity_id,
           entity_name=excluded.entity_name,
           summary=excluded.summary,
           metadata=excluded.metadata,
           created_at=excluded.created_at,
           updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at`,
        [
          entry.id,
          entry.workspace_id,
          entry.user_id,
          entry.action,
          entry.entity_type,
          entry.entity_id,
          entry.entity_name,
          entry.summary,
          entry.metadata,
          entry.created_at,
          entry.updated_at,
          entry.deleted_at,
        ],
      );
    }
    for (const entry of actMerge.pushOutbox) {
      await enqueue(
        db,
        "activity_log",
        entry.id,
        "upsert",
        entry as unknown as Record<string, unknown>,
      );
    }

    // Req 8.7: rebuild materialized paths from parent_id chains
    await rebuildAllPaths();

    // Req 8.8: recalc cached_minutes for all resources touched by the merge
    const touchedResourceIds = new Set<string>();
    for (const r of rMerge.writeSqlite) touchedResourceIds.add(r.id);
    for (const e of eMerge.writeSqlite) touchedResourceIds.add(e.resource_id);
    for (const rid of touchedResourceIds) {
      await recalcCachedMinutesForResource(rid);
    }
  } catch (e) {
    // Req 8.9: on failure, set error status, do NOT mark as pulled (allow retry)
    auth.setSyncStatus({
      kind: "error",
      message: e instanceof Error ? `pull failed: ${e.message}` : "pull failed",
    });
    return;
  }

  // Req 8.1: mark as pulled for this process session only after success
  if (isInitial) pulledForUser.add(userId);

  if (isInitial || hasPulledUiChanges) {
    // Reload UI only after real local changes. Incremental pulls with no new
    // cloud data should be invisible to the user. Refresh per-entity so a
    // workspace-only change does not re-render the resource tree (and vice
    // versa), and so no-op refreshes don't churn array references.
    const wsChanged =
      isInitial || wsMerge.writeSqlite.length > 0 || memMerge.writeSqlite.length > 0;
    const projectsChanged =
      isInitial ||
      rMerge.writeSqlite.length > 0 ||
      eMerge.writeSqlite.length > 0 ||
      aMerge.writeSqlite.length > 0;

    if (wsChanged) {
      await useWorkspaceStore.getState().refresh();
      const workspaceState = useWorkspaceStore.getState();
      const activeWorkspaceStillExists =
        workspaceState.activeWorkspaceId !== null &&
        workspaceState.userWorkspaces().some((w) => w.id === workspaceState.activeWorkspaceId);
      if (!activeWorkspaceStillExists) {
        await workspaceState.restoreActiveWorkspace(userId);
      }
    }
    if (projectsChanged) {
      await useProjects.getState().refresh({ showLoading: false });
    }
    if (actMerge.writeSqlite.length > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tracker:activity-log-changed"));
    }
  }

  auth.setSyncStatus({ kind: "idle" });
  auth.setLastSyncAt(Date.now());

  // Drain newly enqueued local-wins
  const { tick } = await import("./worker");
  void tick();
}
