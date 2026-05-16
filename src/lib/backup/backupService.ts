import { getDb } from "@/lib/db/connection";
import type {
  ActivityLogEntry,
  Assignment,
  CachedProfile,
  Resource,
  TimeEvent,
  Workspace,
  WorkspaceMembership,
} from "@/lib/db/types";
import { cleanupOrphanedOutboxEntries } from "@/lib/sync/outbox";
import { downloadText } from "@/lib/utils/csv";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  auditBackupTables,
  backupFilename,
  parseBackupJson,
  type AuditReport,
  type BackupOutboxRow,
  type BackupTables,
  type KvStoreRow,
  type TrackerBackup,
} from "./backupFormat";

const APP_VERSION = "0.1.4";

interface RestoreResult {
  audit: AuditReport;
  rowsRestored: number;
}

function tableRowCount(tables: BackupTables): number {
  return Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
}

async function readBackupTables(): Promise<BackupTables> {
  const db = await getDb();
  const [
    kvStore,
    workspaces,
    memberships,
    resources,
    events,
    assignments,
    profiles,
    activityLog,
    outbox,
  ] = await Promise.all([
    db.select<KvStoreRow[]>(`SELECT key, value FROM kv_store ORDER BY key`),
    db.select<Workspace[]>(`SELECT * FROM workspaces ORDER BY created_at, id`),
    db.select<WorkspaceMembership[]>(
      `SELECT workspace_id, user_id, role, joined_at, display_role, display_role_updated_at, deleted_at
         FROM workspace_memberships
        ORDER BY workspace_id, user_id`,
    ),
    db.select<Resource[]>(`SELECT * FROM resources ORDER BY path, id`),
    db.select<TimeEvent[]>(`SELECT * FROM events ORDER BY date, created_at, id`),
    db.select<Assignment[]>(
      `SELECT * FROM assignments ORDER BY workspace_id, resource_id, user_id`,
    ),
    db.select<CachedProfile[]>(`SELECT * FROM profiles_cache ORDER BY user_id`),
    db.select<ActivityLogEntry[]>(`SELECT * FROM activity_log ORDER BY created_at, id`),
    db.select<BackupOutboxRow[]>(
      `SELECT id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at, user_id
         FROM sync_outbox
        ORDER BY id`,
    ),
  ]);

  return {
    kv_store: kvStore,
    workspaces,
    workspace_memberships: memberships,
    resources,
    events,
    assignments,
    profiles_cache: profiles,
    activity_log: activityLog,
    sync_outbox: outbox,
  };
}

export async function createBackup(): Promise<TrackerBackup> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    tables: await readBackupTables(),
  };
}

export async function exportBackup(): Promise<string | null> {
  const backup = await createBackup();
  return downloadText(
    backupFilename(new Date(backup.exported_at)),
    JSON.stringify(backup, null, 2),
  );
}

export async function runLocalAudit(): Promise<AuditReport> {
  return auditBackupTables(await readBackupTables());
}

async function deleteLocalWorkspaceOutboxRows(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ id: number; payload: string }>>(
    `SELECT id, payload FROM sync_outbox`,
  );
  const localWorkspaces = await db.select<Array<{ id: string }>>(
    `SELECT id FROM workspaces WHERE owner_id = 'local'`,
  );
  const localWorkspaceIds = new Set(localWorkspaces.map((row) => row.id));
  const ids: number[] = [];

  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { workspace_id?: string };
      if (payload.workspace_id && localWorkspaceIds.has(payload.workspace_id)) {
        ids.push(row.id);
      }
    } catch {
      // Malformed payloads are left visible in the sync error list.
    }
  }

  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
  const result = await db.execute(`DELETE FROM sync_outbox WHERE id IN (${placeholders})`, ids);
  return result.rowsAffected ?? ids.length;
}

async function recalcAllCachedMinutes(): Promise<number> {
  const db = await getDb();
  const resources = await db.select<Array<{ id: string; path: string; deleted_at: number | null }>>(
    `SELECT id, path, deleted_at FROM resources ORDER BY length(path) DESC`,
  );

  for (const resource of resources) {
    if (resource.deleted_at !== null) {
      await db.execute(`UPDATE resources SET cached_minutes = 0 WHERE id = $1`, [resource.id]);
      continue;
    }
    const rows = await db.select<Array<{ total: number | null }>>(
      `SELECT SUM(e.minutes) AS total
         FROM events e
         JOIN resources event_resource ON event_resource.id = e.resource_id
        WHERE e.deleted_at IS NULL
          AND event_resource.deleted_at IS NULL
          AND (event_resource.path = $1 OR event_resource.path LIKE $2)`,
      [resource.path, `${resource.path}/%`],
    );
    await db.execute(`UPDATE resources SET cached_minutes = $1 WHERE id = $2`, [
      rows[0]?.total ?? 0,
      resource.id,
    ]);
  }

  return resources.length;
}

async function promoteOrphanRootsToProject(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE resources
        SET type = 'project'
      WHERE parent_id IS NULL
        AND type <> 'project'
        AND deleted_at IS NULL`,
  );
  return result.rowsAffected ?? 0;
}

async function deleteOrphanAssignmentsLocal(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `DELETE FROM assignments
       WHERE id IN (
         SELECT a.id FROM assignments a
         LEFT JOIN workspace_memberships m
           ON m.workspace_id = a.workspace_id
          AND m.user_id = a.user_id
          AND m.deleted_at IS NULL
         WHERE m.user_id IS NULL
       )`,
  );
  return result.rowsAffected ?? 0;
}

async function cascadeWorkspaceFromParent(): Promise<number> {
  const db = await getDb();
  let totalFixed = 0;
  for (let i = 0; i < 16; i++) {
    const result = await db.execute(
      `UPDATE resources
          SET workspace_id = (
            SELECT p.workspace_id FROM resources p WHERE p.id = resources.parent_id
          )
        WHERE parent_id IS NOT NULL
          AND workspace_id <> (
            SELECT p.workspace_id FROM resources p WHERE p.id = resources.parent_id
          )`,
    );
    const fixed = result.rowsAffected ?? 0;
    if (fixed === 0) break;
    totalFixed += fixed;
  }
  if (totalFixed > 0) {
    await db.execute(
      `UPDATE events
          SET workspace_id = (
            SELECT r.workspace_id FROM resources r WHERE r.id = events.resource_id
          )
        WHERE workspace_id <> (
          SELECT r.workspace_id FROM resources r WHERE r.id = events.resource_id
        )`,
    );
  }
  return totalFixed;
}

export async function repairLocalData(): Promise<{
  orphanedOutboxRows: number;
  localWorkspaceOutboxRows: number;
  resourcesRecalculated: number;
  orphanAssignments: number;
  resourcesMovedToParentWorkspace: number;
  rootsPromotedToProject: number;
  audit: AuditReport;
}> {
  const db = await getDb();
  const orphanedOutboxRows = await cleanupOrphanedOutboxEntries(db);
  const localWorkspaceOutboxRows = await deleteLocalWorkspaceOutboxRows();
  const resourcesMovedToParentWorkspace = await cascadeWorkspaceFromParent();
  const rootsPromotedToProject = await promoteOrphanRootsToProject();
  const orphanAssignments = await deleteOrphanAssignmentsLocal();
  const resourcesRecalculated = await recalcAllCachedMinutes();
  return {
    orphanedOutboxRows,
    localWorkspaceOutboxRows,
    resourcesRecalculated,
    orphanAssignments,
    resourcesMovedToParentWorkspace,
    rootsPromotedToProject,
    audit: await runLocalAudit(),
  };
}

async function clearCurrentData(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM sync_outbox`);
  await db.execute(`DELETE FROM activity_log`);
  await db.execute(`DELETE FROM profiles_cache`);
  await db.execute(`DELETE FROM assignments`);
  await db.execute(`DELETE FROM events`);
  await db.execute(`DELETE FROM resources`);
  await db.execute(`DELETE FROM workspace_memberships`);
  await db.execute(`DELETE FROM workspaces`);
  await db.execute(`DELETE FROM kv_store`);
}

async function insertBackupTables(tables: BackupTables): Promise<void> {
  const db = await getDb();

  for (const row of tables.kv_store) {
    await db.execute(`INSERT INTO kv_store (key, value) VALUES ($1, $2)`, [row.key, row.value]);
  }

  for (const row of tables.workspaces) {
    await db.execute(
      `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.name, row.owner_id, row.created_at, row.updated_at, row.deleted_at],
    );
  }

  for (const row of tables.workspace_memberships) {
    await db.execute(
      `INSERT INTO workspace_memberships
         (workspace_id, user_id, role, joined_at, display_role, display_role_updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.workspace_id,
        row.user_id,
        row.role,
        row.joined_at,
        row.display_role ?? null,
        row.display_role_updated_at ?? null,
        row.deleted_at,
      ],
    );
  }

  for (const row of tables.resources.sort((a, b) => a.path.length - b.path.length)) {
    await db.execute(
      `INSERT INTO resources
         (id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.workspace_id,
        row.parent_id,
        row.name,
        row.type,
        row.color,
        row.path,
        row.cached_minutes,
        row.created_at,
        row.updated_at,
        row.deleted_at,
      ],
    );
  }

  for (const row of tables.events) {
    await db.execute(
      `INSERT INTO events
         (id, workspace_id, resource_id, date, minutes, goal, topics, notes, report, user_id, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.id,
        row.workspace_id,
        row.resource_id,
        row.date,
        row.minutes,
        row.goal,
        row.topics,
        row.notes,
        row.report,
        row.user_id,
        row.created_at,
        row.updated_at,
        row.deleted_at,
      ],
    );
  }

  for (const row of tables.assignments) {
    await db.execute(
      `INSERT INTO assignments
         (id, resource_id, user_id, workspace_id, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id,
        row.resource_id,
        row.user_id,
        row.workspace_id,
        row.created_at,
        row.updated_at,
        row.deleted_at,
      ],
    );
  }

  for (const row of tables.profiles_cache) {
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
       VALUES ($1, $2, $3, $4)`,
      [row.user_id, row.display_name, row.avatar_url, row.cached_at],
    );
  }

  for (const row of tables.activity_log) {
    await db.execute(
      `INSERT INTO activity_log
         (id, workspace_id, user_id, action, entity_type, entity_id, entity_name, summary, metadata, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        row.id,
        row.workspace_id,
        row.user_id,
        row.action,
        row.entity_type,
        row.entity_id,
        row.entity_name,
        row.summary,
        row.metadata,
        row.created_at,
        row.updated_at,
        row.deleted_at,
      ],
    );
  }

  for (const row of tables.sync_outbox) {
    await db.execute(
      `INSERT INTO sync_outbox
         (id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.entity,
        row.entity_id,
        row.op,
        row.payload,
        row.enqueued_at,
        row.attempts,
        row.last_error,
        row.next_retry_at,
        row.user_id,
      ],
    );
  }
}

export async function restoreBackupFromText(raw: string): Promise<RestoreResult> {
  const backup = parseBackupJson(raw);
  const preflight = auditBackupTables(backup.tables);
  const blockingIssues = preflight.issues.filter((issue) => issue.severity === "error");
  if (blockingIssues.length > 0) {
    throw new Error(`Backup has ${blockingIssues.length} blocking audit issue(s).`);
  }

  const db = await getDb();
  await db.execute(`PRAGMA foreign_keys = OFF`);
  await db.execute(`BEGIN IMMEDIATE`);
  try {
    await clearCurrentData();
    await insertBackupTables(backup.tables);
    await db.execute(`COMMIT`);
  } catch (error) {
    await db.execute(`ROLLBACK`).catch(() => undefined);
    throw error;
  } finally {
    await db.execute(`PRAGMA foreign_keys = ON`);
  }

  await recalcAllCachedMinutes();
  return {
    audit: await runLocalAudit(),
    rowsRestored: tableRowCount(backup.tables),
  };
}
