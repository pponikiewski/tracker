import { getDb } from "./connection";
import type { Workspace, WorkspaceMembership } from "./types";
import { enqueue } from "@/lib/sync/outbox";
import { withTx } from "./tx";

const now = () => Date.now();

// ---- Read queries (no transaction needed) ----

export async function listWorkspaces(): Promise<Workspace[]> {
  const db = await getDb();
  return db.select<Workspace[]>(
    "SELECT * FROM workspaces ORDER BY created_at ASC",
  );
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const db = await getDb();
  const rows = await db.select<Workspace[]>(
    "SELECT * FROM workspaces WHERE id = $1 LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

export async function listMemberships(workspaceId: string): Promise<WorkspaceMembership[]> {
  const db = await getDb();
  return db.select<WorkspaceMembership[]>(
    "SELECT * FROM workspace_memberships WHERE workspace_id = $1",
    [workspaceId],
  );
}

export async function getUserMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const db = await getDb();
  return db.select<WorkspaceMembership[]>(
    "SELECT * FROM workspace_memberships WHERE user_id = $1",
    [userId],
  );
}

export async function upsertWorkspaceLocal(workspace: Workspace): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       owner_id=excluded.owner_id,
       created_at=excluded.created_at,
       updated_at=excluded.updated_at,
       deleted_at=excluded.deleted_at`,
    [
      workspace.id,
      workspace.name,
      workspace.owner_id,
      workspace.created_at,
      workspace.updated_at,
      workspace.deleted_at,
    ],
  );
}

// ---- Mutations (each in a single transaction) ----

/**
 * Creates a new workspace and its owner membership in a single transaction.
 * Enqueues both the workspace and the membership for sync.
 * Requirements: 1.9, 3.1, 7.1, 7.2
 */
export async function createWorkspace(input: {
  id: string;
  name: string;
  ownerId: string;
}): Promise<void> {
  await withTx(async (db) => {
    const ts = now();

    await db.execute(
      `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [input.id, input.name, input.ownerId, ts],
    );

    await db.execute(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', $3)`,
      [input.id, input.ownerId, ts],
    );

    const workspaceRow: Workspace = {
      id: input.id,
      name: input.name,
      owner_id: input.ownerId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };

    const membershipRow: WorkspaceMembership = {
      workspace_id: input.id,
      user_id: input.ownerId,
      role: "owner",
      joined_at: ts,
    };

    await enqueue(db, "workspace", input.id, "upsert", workspaceRow as unknown as Record<string, unknown>);
    await enqueue(
      db,
      "workspace_membership",
      `${input.id}:${input.ownerId}`,
      "upsert",
      membershipRow as unknown as Record<string, unknown>,
    );
  });
}

/**
 * Renames a workspace and enqueues the update for sync.
 * Requirements: 3.3, 7.1
 */
export async function renameWorkspace(id: string, name: string): Promise<void> {
  await withTx(async (db) => {
    const ts = now();

    await db.execute(
      "UPDATE workspaces SET name = $1, updated_at = $2 WHERE id = $3",
      [name, ts, id],
    );

    const rows = await db.select<Workspace[]>(
      "SELECT * FROM workspaces WHERE id = $1",
      [id],
    );
    if (rows[0]) {
      await enqueue(db, "workspace", id, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
  });
}

/**
 * Soft-deletes a workspace by setting deleted_at and enqueues the update for sync.
 * Requirements: 3.4, 7.1
 */
export async function softDeleteWorkspace(id: string): Promise<void> {
  await withTx(async (db) => {
    const ts = now();

    await db.execute(
      "UPDATE workspaces SET deleted_at = $1, updated_at = $1 WHERE id = $2",
      [ts, id],
    );

    const rows = await db.select<Workspace[]>(
      "SELECT * FROM workspaces WHERE id = $1",
      [id],
    );
    if (rows[0]) {
      await enqueue(db, "workspace", id, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
  });
}

/**
 * Inserts a workspace membership and enqueues it for sync.
 * Requirements: 7.2
 */
export async function insertMembership(m: WorkspaceMembership): Promise<void> {
  await withTx(async (db) => {
    await db.execute(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, $4)`,
      [m.workspace_id, m.user_id, m.role, m.joined_at],
    );

    await enqueue(
      db,
      "workspace_membership",
      `${m.workspace_id}:${m.user_id}`,
      "upsert",
      m as unknown as Record<string, unknown>,
    );
  });
}

/**
 * Deletes a workspace membership and enqueues a delete op for sync.
 * Requirements: 7.2
 */
export async function deleteMembership(workspaceId: string, userId: string): Promise<void> {
  await withTx(async (db) => {
    await db.execute(
      "DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );

    await enqueue(
      db,
      "workspace_membership",
      `${workspaceId}:${userId}`,
      "delete",
      { workspace_id: workspaceId, user_id: userId },
    );
  });
}

/**
 * Returns the stable UUID for the Local_Personal_Workspace.
 * Reads from the kv_store table (creating it if needed). If no UUID is stored,
 * generates a new UUID v4, persists it, and returns it.
 * NEVER enqueues — Local_Personal_Workspace is never synced to Supabase.
 * Requirements: 2.5
 */
export async function getOrCreateLocalWorkspace(): Promise<string> {
  const db = await getDb();

  // Ensure kv_store table exists
  await db.execute(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );

  // Try to read existing UUID
  const rows = await db.select<Array<{ value: string }>>(
    "SELECT value FROM kv_store WHERE key = 'local_workspace_id'",
  );

  if (rows[0]) {
    return rows[0].value;
  }

  // Generate and persist a new UUID v4
  const id = crypto.randomUUID();
  await db.execute(
    "INSERT OR IGNORE INTO kv_store (key, value) VALUES ('local_workspace_id', $1)",
    [id],
  );

  // Re-read to handle the race where INSERT OR IGNORE was a no-op
  const persisted = await db.select<Array<{ value: string }>>(
    "SELECT value FROM kv_store WHERE key = 'local_workspace_id'",
  );
  return persisted[0]?.value ?? id;
}

/**
 * Lists every Local_Personal_Workspace (owner_id = 'local') currently stored
 * locally. Returns only non-deleted entries.
 */
export async function listLocalWorkspaces(): Promise<Workspace[]> {
  const db = await getDb();
  return db.select<Workspace[]>(
    "SELECT * FROM workspaces WHERE owner_id = 'local' AND deleted_at IS NULL",
  );
}

/**
 * Promotes a Local_Personal_Workspace to a cloud workspace owned by the given
 * authenticated user, preserving all existing resources and events.
 *
 * Steps performed in-place on SQLite:
 *   1. workspaces.owner_id: 'local' → userId
 *   2. workspace_memberships.user_id: 'local' → userId
 *   3. resources/events keep their workspace_id (unchanged)
 *   4. Enqueue workspace + membership + every resource + every event for push.
 *
 * After this runs, the workspace becomes a regular cloud workspace:
 * the user can rename it, generate join codes, invite members, etc.
 */
export async function claimLocalWorkspace(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await withTx(async (db) => {
    const ts = now();

    // 1. workspace row: flip owner_id and bump updated_at
    await db.execute(
      `UPDATE workspaces
         SET owner_id = $1, updated_at = $2
       WHERE id = $3 AND owner_id = 'local'`,
      [userId, ts, workspaceId],
    );

    // 2. membership row: replace 'local' with real userId
    // We cannot UPDATE the PK column in-place cleanly; delete + insert instead.
    await db.execute(
      `DELETE FROM workspace_memberships
         WHERE workspace_id = $1 AND user_id = 'local'`,
      [workspaceId],
    );
    await db.execute(
      `INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', $3)`,
      [workspaceId, userId, ts],
    );

    // 3. Enqueue the workspace for push.
    const ws = await db.select<Workspace[]>(
      "SELECT * FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    if (ws[0]) {
      await enqueue(db, "workspace", workspaceId, "upsert", ws[0] as unknown as Record<string, unknown>);
    }

    // 4. Enqueue the new owner membership.
    const membership: WorkspaceMembership = {
      workspace_id: workspaceId,
      user_id: userId,
      role: "owner",
      joined_at: ts,
    };
    await enqueue(
      db,
      "workspace_membership",
      `${workspaceId}:${userId}`,
      "upsert",
      membership as unknown as Record<string, unknown>,
    );

    // 5. Enqueue every resource and every event belonging to this workspace
    //    so they land in the cloud copy.
    const resources = await db.select<Array<Record<string, unknown>>>(
      "SELECT * FROM resources WHERE workspace_id = $1",
      [workspaceId],
    );
    for (const r of resources) {
      await enqueue(db, "resource", r.id as string, "upsert", r);
    }

    const events = await db.select<Array<Record<string, unknown>>>(
      "SELECT * FROM events WHERE workspace_id = $1",
      [workspaceId],
    );
    for (const e of events) {
      await enqueue(db, "event", e.id as string, "upsert", e);
    }
  });
}
