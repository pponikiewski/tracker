import { getDb } from '@/lib/db/connection';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { lwwMerge } from './merge';
import { enqueue } from './outbox';
import { recalcCachedMinutesForResource } from '@/lib/db/queries';
import type { Resource, TimeEvent, Workspace, WorkspaceMembership } from '@/lib/db/types';
import { ltreeToPath } from '@/lib/utils/ltree';
import { tick } from './worker';

const pulledForUser = new Set<string>();

const toMs = (v: unknown): number =>
  typeof v === 'string' ? Date.parse(v) : (v as number);

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
    parent_id: (c.parent_id as string | null) ?? null,
    name: c.name as string,
    type: c.type as Resource['type'],
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
    resource_id: c.resource_id as string,
    date: c.date as string,
    minutes: c.minutes as number,
    goal: (c.goal as string | null) ?? null,
    topics: (c.topics as string | null) ?? null,
    notes: (c.notes as string | null) ?? null,
    report: (c.report as string | null) ?? null,
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
    role: c.role as WorkspaceMembership['role'],
    joined_at: toMs(c.joined_at),
  };
}

/**
 * Ensures a Personal_Workspace exists in Supabase for the given user.
 * If one already exists, returns its id.
 * If none exists, creates one (with owner membership) and returns the new id.
 * Throws on creation failure — caller should set error status.
 * Requirements: 2.1, 2.6
 */
export async function ensurePersonalWorkspace(userId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');

  // Check if user already has a workspace
  const { data: existing, error: fetchErr } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .limit(1);

  if (fetchErr) throw new Error(fetchErr.message);

  if (existing && existing.length > 0 && existing[0]) {
    return existing[0].id as string;
  }

  // No workspace found — create Personal_Workspace
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: wsErr } = await supabase.from('workspaces').insert({
    id: newId,
    name: 'My workspace',
    owner_id: userId,
    created_at: now,
    updated_at: now,
  });

  if (wsErr) throw new Error(wsErr.message);

  const { error: memErr } = await supabase.from('workspace_memberships').insert({
    workspace_id: newId,
    user_id: userId,
    role: 'owner',
    joined_at: now,
  });

  if (memErr) throw new Error(memErr.message);

  return newId;
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
    await db.execute(
      `UPDATE resources SET path = $1 WHERE id = $2 AND path != $1`,
      [correctPath, r.id],
    );
  }
}

export async function runInitialPull(userId: string): Promise<void> {
  if (!supabase) return;
  // Req 8.1: only pull once per user per process
  if (pulledForUser.has(userId)) return;

  const auth = useAuthStore.getState();
  auth.setSyncStatus({ kind: 'initial-pull' });

  // Step 1: Ensure Personal_Workspace exists in Supabase (Req 2.1, 2.6)
  try {
    await ensurePersonalWorkspace(userId);
  } catch (e) {
    auth.setSyncStatus({
      kind: 'error',
      message: e instanceof Error ? e.message : 'failed to provision workspace',
    });
    return;
  }

  // Step 2: Fetch workspaces + workspace_memberships in parallel (Req 7.5)
  const [{ data: cloudWS, error: errWS }, { data: cloudMem, error: errMem }] =
    await Promise.all([
      supabase.from('workspaces').select('*'),
      supabase.from('workspace_memberships').select('*'),
    ]);

  // Step 3: If workspace fetch fails — set error and stop (do NOT fetch resources/events)
  if (errWS || errMem) {
    auth.setSyncStatus({ kind: 'error', message: (errWS ?? errMem)!.message });
    return;
  }

  const db = await getDb();

  // Step 4: LWW merge workspaces → write to SQLite (Req 2.2, 7.6)
  const localWS = await db.select<Workspace[]>(`SELECT * FROM workspaces`);
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
      await enqueue(db, 'workspace', w.id, 'upsert', w as unknown as Record<string, unknown>);
    }
  } catch (e) {
    auth.setSyncStatus({
      kind: 'error',
      message: e instanceof Error ? e.message : 'workspace write failed',
    });
    return;
  }

  // Step 5: LWW merge memberships → write to SQLite (Req 2.2)
  const localMem = await db.select<WorkspaceMembership[]>(`SELECT * FROM workspace_memberships`);
  const cloudMemLoc = (cloudMem ?? []).map((c) =>
    cloudToLocalMembership(c as Record<string, unknown>),
  );

  // WorkspaceMembership uses composite key (workspace_id, user_id) — synthesise an id for lwwMerge
  // updated_at is required by MergeRow; we use joined_at as the conflict-resolution timestamp
  type MembershipWithId = WorkspaceMembership & { id: string; updated_at: number };
  const localMemWithId: MembershipWithId[] = localMem.map((m) => ({
    ...m,
    id: `${m.workspace_id}:${m.user_id}`,
    updated_at: m.joined_at,
  }));
  const cloudMemWithId: MembershipWithId[] = cloudMemLoc.map((m) => ({
    ...m,
    id: `${m.workspace_id}:${m.user_id}`,
    updated_at: m.joined_at,
  }));

  const memMerge = lwwMerge<MembershipWithId>(localMemWithId, cloudMemWithId);

  try {
    for (const m of memMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT(workspace_id, user_id) DO UPDATE SET
           role=excluded.role, joined_at=excluded.joined_at`,
        [m.workspace_id, m.user_id, m.role, m.joined_at],
      );
    }
    for (const m of memMerge.pushOutbox) {
      await enqueue(
        db,
        'workspace_membership',
        `${m.workspace_id}:${m.user_id}`,
        'upsert',
        m as unknown as Record<string, unknown>,
      );
    }
  } catch (e) {
    auth.setSyncStatus({
      kind: 'error',
      message: e instanceof Error ? e.message : 'membership write failed',
    });
    return;
  }

  // Step 6: Fetch resources + events (existing logic)
  const [{ data: cloudR, error: errR }, { data: cloudE, error: errE }] = await Promise.all([
    supabase.from('resources').select('*'),
    supabase.from('events').select('*'),
  ]);

  if (errR || errE) {
    // Req 8.9: leave local data unchanged, set error, do NOT mark as pulled (allow retry)
    auth.setSyncStatus({ kind: 'error', message: (errR ?? errE)!.message });
    return;
  }

  // Step 7: LWW merge resources/events → write to SQLite, rebuild paths, recalc, reload
  const localR = await db.select<Resource[]>(`SELECT * FROM resources`);
  const localE = await db.select<TimeEvent[]>(`SELECT * FROM events`);

  const cloudRloc = (cloudR ?? []).map((c) =>
    cloudToLocalResource(c as Record<string, unknown>),
  );
  const cloudEloc = (cloudE ?? []).map((c) =>
    cloudToLocalEvent(c as Record<string, unknown>),
  );

  const rMerge = lwwMerge(localR, cloudRloc);
  const eMerge = lwwMerge(localE, cloudEloc);

  try {
    for (const r of rMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO resources (id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(id) DO UPDATE SET
           parent_id=excluded.parent_id, name=excluded.name, type=excluded.type,
           color=excluded.color, path=excluded.path, cached_minutes=excluded.cached_minutes,
           created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
        [
          r.id, r.parent_id, r.name, r.type, r.color, r.path, r.cached_minutes,
          r.created_at, r.updated_at, r.deleted_at,
        ],
      );
    }
    for (const e of eMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO events (id, resource_id, date, minutes, goal, topics, notes, report, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(id) DO UPDATE SET
           resource_id=excluded.resource_id, date=excluded.date, minutes=excluded.minutes,
           goal=excluded.goal, topics=excluded.topics, notes=excluded.notes, report=excluded.report,
           created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
        [
          e.id, e.resource_id, e.date, e.minutes, e.goal, e.topics, e.notes, e.report,
          e.created_at, e.updated_at, e.deleted_at,
        ],
      );
    }

    // Enqueue local-wins for push to cloud
    for (const r of rMerge.pushOutbox) {
      await enqueue(db, 'resource', r.id, 'upsert', r as unknown as Record<string, unknown>);
    }
    for (const e of eMerge.pushOutbox) {
      await enqueue(db, 'event', e.id, 'upsert', e as unknown as Record<string, unknown>);
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
      kind: 'error',
      message: e instanceof Error ? e.message : 'pull failed',
    });
    return;
  }

  // Req 8.1: mark as pulled for this process session only after success
  pulledForUser.add(userId);
  auth.setSyncStatus({ kind: 'idle' });
  auth.setLastSyncAt(Date.now());

  // Reload UI — lazy import avoids circular dep
  const { useProjects } = await import('@/store/projects');
  await useProjects.getState().refresh();

  // Drain newly enqueued local-wins
  void tick();
}
