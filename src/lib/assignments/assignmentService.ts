import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "@/lib/db/connection";
import { enqueue } from "@/lib/sync/outbox";
import { withTx } from "@/lib/db/tx";
import type { Assignment } from "@/lib/db/types";
import { recordActivity } from "@/lib/activity/activityLog";

const now = () => Date.now();

/**
 * Guards against operations on the Local_Personal_Workspace.
 *
 * The Local_Personal_Workspace is identified by its `owner_id = 'local'` in
 * the workspaces table.  All assignment operations are forbidden for it.
 *
 * Requirement 9.5
 */
async function assertNotLocalWorkspace(
  db: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
): Promise<void> {
  const rows = await db.select<Array<{ owner_id: string }>>(
    "SELECT owner_id FROM workspaces WHERE id = $1 LIMIT 1",
    [workspaceId],
  );
  if (rows[0]?.owner_id === "local") {
    throw new Error("Assignments are not supported in the local workspace.");
  }
}

/**
 * Verifies that `userId` is an active member of `workspaceId`.
 *
 * Requirement 5.4
 */
async function assertWorkspaceMember(
  db: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const rows = await db.select<Array<{ user_id: string }>>(
    "SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 LIMIT 1",
    [workspaceId, userId],
  );
  if (rows.length === 0) {
    throw new Error("User is not a member of this workspace.");
  }
}

// ---- Public API ----

/**
 * Creates an assignment linking `userId` to `resourceId` within `workspaceId`.
 *
 * Idempotent — if an active assignment already exists for the
 * `(resource_id, user_id)` pair, the function returns without error and
 * without creating a duplicate row.
 *
 * If a soft-deleted assignment exists for the same pair, it is restored
 * (deleted_at set to NULL, updated_at refreshed) so the record is active again.
 *
 * Both the SQLite write and the outbox enqueue happen inside a single
 * transaction so they are atomic.
 *
 * Requirements: 5.1, 5.2, 5.4, 5.8, 9.1, 9.5
 */
export async function createAssignment(
  resourceId: string,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await withTx(async (db) => {
    // Guard: Local_Personal_Workspace is not supported
    await assertNotLocalWorkspace(db, workspaceId);

    // Guard: userId must be a workspace member
    await assertWorkspaceMember(db, workspaceId, userId);

    const ts = now();

    // Check for an existing assignment (active or soft-deleted)
    const existing = await db.select<Array<{ id: string; deleted_at: number | null }>>(
      `SELECT id, deleted_at FROM assignments
       WHERE resource_id = $1 AND user_id = $2
       LIMIT 1`,
      [resourceId, userId],
    );

    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.deleted_at === null) {
        // Already active — idempotent no-op
        return;
      }
      // Restore soft-deleted assignment
      await db.execute(
        `UPDATE assignments
         SET deleted_at = NULL, updated_at = $1
         WHERE id = $2`,
        [ts, row.id],
      );

      const updated = await db.select<Assignment[]>("SELECT * FROM assignments WHERE id = $1", [
        row.id,
      ]);
      if (updated[0]) {
        await enqueue(
          db,
          "assignment",
          row.id,
          "upsert",
          updated[0] as unknown as Record<string, unknown>,
        );
        const resources = await db.select<Array<{ name: string }>>(
          "SELECT name FROM resources WHERE id = $1 LIMIT 1",
          [resourceId],
        );
        const resourceName = resources[0]?.name ?? resourceId;
        await recordActivity(db, {
          workspaceId,
          action: "assignment.restore",
          entityType: "assignment",
          entityId: row.id,
          entityName: resourceName,
          summary: `Przywrócono przypisanie do "${resourceName}"`,
          metadata: { resource_id: resourceId, assigned_user_id: userId },
          timestamp: ts,
        });
      }
      return;
    }

    // Insert new assignment
    const id = crypto.randomUUID();
    const assignment: Assignment = {
      id,
      resource_id: resourceId,
      user_id: userId,
      workspace_id: workspaceId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };

    await db.execute(
      `INSERT INTO assignments (id, resource_id, user_id, workspace_id, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
      [id, resourceId, userId, workspaceId, ts, ts],
    );

    await enqueue(db, "assignment", id, "upsert", assignment as unknown as Record<string, unknown>);
    const resources = await db.select<Array<{ name: string }>>(
      "SELECT name FROM resources WHERE id = $1 LIMIT 1",
      [resourceId],
    );
    const resourceName = resources[0]?.name ?? resourceId;
    await recordActivity(db, {
      workspaceId,
      action: "assignment.create",
      entityType: "assignment",
      entityId: id,
      entityName: resourceName,
      summary: `Przypisano osobę do "${resourceName}"`,
      metadata: { resource_id: resourceId, assigned_user_id: userId },
      timestamp: ts,
    });
  });
}

/**
 * Removes an assignment by soft-deleting it.
 *
 * Idempotent — if no active assignment exists for the `(resource_id, user_id)`
 * pair, the function returns without error.
 *
 * Both the SQLite write and the outbox enqueue happen inside a single
 * transaction so they are atomic.
 *
 * Requirements: 5.3, 5.8, 9.1, 9.5
 */
export async function removeAssignment(
  resourceId: string,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await withTx(async (db) => {
    // Guard: Local_Personal_Workspace is not supported
    await assertNotLocalWorkspace(db, workspaceId);

    const ts = now();

    // Find the active assignment
    const existing = await db.select<Array<{ id: string }>>(
      `SELECT id FROM assignments
       WHERE resource_id = $1 AND user_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [resourceId, userId],
    );

    if (existing.length === 0) {
      // No active assignment — idempotent no-op
      return;
    }

    const { id } = existing[0]!;

    await db.execute(
      `UPDATE assignments
       SET deleted_at = $1, updated_at = $1
       WHERE id = $2`,
      [ts, id],
    );

    const updated = await db.select<Assignment[]>("SELECT * FROM assignments WHERE id = $1", [id]);
    if (updated[0]) {
      // Use 'upsert' with deleted_at set — the sync worker uses deleted_at to
      // signal deletion to Supabase (Requirement 8.2)
      await enqueue(
        db,
        "assignment",
        id,
        "upsert",
        updated[0] as unknown as Record<string, unknown>,
      );
      const resources = await db.select<Array<{ name: string }>>(
        "SELECT name FROM resources WHERE id = $1 LIMIT 1",
        [resourceId],
      );
      const resourceName = resources[0]?.name ?? resourceId;
      await recordActivity(db, {
        workspaceId,
        action: "assignment.delete",
        entityType: "assignment",
        entityId: id,
        entityName: resourceName,
        summary: `Usunięto przypisanie z "${resourceName}"`,
        metadata: { resource_id: resourceId, assigned_user_id: userId },
        timestamp: ts,
      });
    }
  });
}

/**
 * Returns all active (non-soft-deleted) assignments for a workspace from the
 * local SQLite database.
 *
 * Offline-safe — reads only from local SQLite.
 *
 * Requirements: 5.6, 9.1
 */
export async function listAssignments(workspaceId: string): Promise<Assignment[]> {
  const db = await getDb();
  return db.select<Assignment[]>(
    `SELECT * FROM assignments
     WHERE workspace_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [workspaceId],
  );
}

/**
 * Soft-deletes all active assignments for a given resource.
 *
 * Designed to be called within an existing transaction (e.g. when
 * soft-deleting a resource subtree) — accepts a `db` instance and a
 * timestamp `ts` so the caller controls the transaction boundary.
 *
 * Does NOT enqueue outbox entries — the caller is responsible for enqueueing
 * the resource soft-delete, which implicitly covers cascading assignment
 * soft-deletes via the sync worker's pull/merge logic.
 *
 * Requirements: 5.7
 */
export async function softDeleteAssignmentsForResource(
  db: Database,
  resourceId: string,
  ts: number,
): Promise<void> {
  await db.execute(
    `UPDATE assignments
     SET deleted_at = $1, updated_at = $1
     WHERE resource_id = $2 AND deleted_at IS NULL`,
    [ts, resourceId],
  );
}

/**
 * Soft-deletes all active assignments for a user within a workspace.
 *
 * Called when a user's workspace membership is removed.
 *
 * Each soft-deleted assignment is enqueued in the outbox so the deletion
 * propagates to Supabase.
 *
 * Requirements: 5.5
 */
export async function softDeleteAssignmentsForUser(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await withTx(async (db) => {
    const ts = now();

    // Find all active assignments for this user in the workspace
    const active = await db.select<Array<{ id: string }>>(
      `SELECT id FROM assignments
       WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [workspaceId, userId],
    );

    if (active.length === 0) return;

    // Soft-delete them all
    await db.execute(
      `UPDATE assignments
       SET deleted_at = $1, updated_at = $1
       WHERE workspace_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [ts, workspaceId, userId],
    );

    // Enqueue each soft-deleted assignment for sync
    for (const { id } of active) {
      const updated = await db.select<Assignment[]>("SELECT * FROM assignments WHERE id = $1", [
        id,
      ]);
      if (updated[0]) {
        await enqueue(
          db,
          "assignment",
          id,
          "upsert",
          updated[0] as unknown as Record<string, unknown>,
        );
      }
    }
  });
}
