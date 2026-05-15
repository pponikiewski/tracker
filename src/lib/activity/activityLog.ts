import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "@/lib/db/connection";
import type { ActivityLogEntry } from "@/lib/db/types";
import { enqueue } from "@/lib/sync/outbox";
import { useAuthStore } from "@/store/auth";

export interface ActivityInput {
  workspaceId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  timestamp?: number;
}

function currentUserId(): string | null {
  const state = useAuthStore.getState().state;
  return state.kind === "authed" ? state.user.id : null;
}

export async function recordActivity(db: Database, input: ActivityInput): Promise<void> {
  const ts = input.timestamp ?? Date.now();
  const row: ActivityLogEntry = {
    id: crypto.randomUUID(),
    workspace_id: input.workspaceId,
    user_id: currentUserId(),
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    entity_name: input.entityName ?? null,
    summary: input.summary,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };

  await db.execute(
    `INSERT INTO activity_log
       (id, workspace_id, user_id, action, entity_type, entity_id, entity_name, summary, metadata, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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

  await enqueue(db, "activity_log", row.id, "upsert", row as unknown as Record<string, unknown>);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tracker:activity-log-changed"));
  }
}

export async function recordActivityEntry(input: ActivityInput): Promise<void> {
  const db = await getDb();
  await recordActivity(db, input);
}

export async function listRecentActivity(
  workspaceId: string,
  limit = 30,
): Promise<ActivityLogEntry[]> {
  const db = await getDb();
  return db.select<ActivityLogEntry[]>(
    `SELECT *
       FROM activity_log
      WHERE workspace_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [workspaceId, limit],
  );
}
