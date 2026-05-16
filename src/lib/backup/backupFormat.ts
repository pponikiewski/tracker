import type {
  ActivityLogEntry,
  Assignment,
  CachedProfile,
  OutboxEntity,
  OutboxOp,
  Resource,
  ResourceType,
  TimeEvent,
  Workspace,
  WorkspaceMembership,
} from "@/lib/db/types";

export const BACKUP_FORMAT = "tracker.offline-backup";
export const BACKUP_VERSION = 1;

export interface KvStoreRow {
  key: string;
  value: string;
}

export interface BackupOutboxRow {
  id: number;
  entity: OutboxEntity;
  entity_id: string;
  op: OutboxOp;
  payload: string;
  enqueued_at: number;
  attempts: number;
  last_error: string | null;
  next_retry_at: number | null;
  user_id: string | null;
}

export interface BackupTables {
  kv_store: KvStoreRow[];
  workspaces: Workspace[];
  workspace_memberships: WorkspaceMembership[];
  resources: Resource[];
  events: TimeEvent[];
  assignments: Assignment[];
  profiles_cache: CachedProfile[];
  activity_log: ActivityLogEntry[];
  sync_outbox: BackupOutboxRow[];
}

export interface TrackerBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  app_version: string;
  tables: BackupTables;
}

export type AuditSeverity = "info" | "warning" | "error";

export interface AuditIssue {
  severity: AuditSeverity;
  code: string;
  message: string;
  entity?: string;
  entity_id?: string;
}

export interface AuditSummary {
  workspaces: number;
  resources: number;
  events: number;
  pendingOutbox: number;
  syncErrors: number;
}

export interface AuditReport {
  generatedAt: string;
  summary: AuditSummary;
  issues: AuditIssue[];
}

const RESOURCE_TYPES: ResourceType[] = ["project", "stage", "substage", "task"];
const OUTBOX_ENTITIES: OutboxEntity[] = [
  "resource",
  "event",
  "workspace",
  "workspace_membership",
  "assignment",
  "activity_log",
];
const OUTBOX_OPS: OutboxOp[] = ["upsert", "delete"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(row: Record<string, unknown>, key: string, context: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}: ${key} must be a non-empty string`);
  }
  return value;
}

function nullableString(row: Record<string, unknown>, key: string, context: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${context}: ${key} must be a string or null`);
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string, context: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context}: ${key} must be an integer`);
  }
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string, context: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context}: ${key} must be an integer or null`);
  }
  return value;
}

function rowArray(input: Record<string, unknown>, key: keyof BackupTables): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`backup table ${key} must be an array`);
  return value;
}

function parseRows<T>(
  tables: Record<string, unknown>,
  key: keyof BackupTables,
  parse: (row: Record<string, unknown>, context: string) => T,
): T[] {
  return rowArray(tables, key).map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`${key}[${index}] must be an object`);
    return parse(raw, `${key}[${index}]`);
  });
}

function parseWorkspace(row: Record<string, unknown>, context: string): Workspace {
  return {
    id: requiredString(row, "id", context),
    name: requiredString(row, "name", context),
    owner_id: requiredString(row, "owner_id", context),
    created_at: requiredNumber(row, "created_at", context),
    updated_at: requiredNumber(row, "updated_at", context),
    deleted_at: nullableNumber(row, "deleted_at", context),
  };
}

function parseMembership(row: Record<string, unknown>, context: string): WorkspaceMembership {
  const role = requiredString(row, "role", context);
  if (role !== "owner" && role !== "member") {
    throw new Error(`${context}: role must be owner or member`);
  }
  return {
    workspace_id: requiredString(row, "workspace_id", context),
    user_id: requiredString(row, "user_id", context),
    role,
    joined_at: requiredNumber(row, "joined_at", context),
    display_role: nullableString(row, "display_role", context),
    display_role_updated_at: nullableNumber(row, "display_role_updated_at", context),
    deleted_at: nullableNumber(row, "deleted_at", context),
  };
}

function parseResource(row: Record<string, unknown>, context: string): Resource {
  const type = requiredString(row, "type", context);
  if (!RESOURCE_TYPES.includes(type as ResourceType)) {
    throw new Error(`${context}: invalid resource type`);
  }
  const cachedMinutes = requiredNumber(row, "cached_minutes", context);
  if (cachedMinutes < 0) throw new Error(`${context}: cached_minutes cannot be negative`);
  return {
    id: requiredString(row, "id", context),
    workspace_id: requiredString(row, "workspace_id", context),
    parent_id: nullableString(row, "parent_id", context),
    name: requiredString(row, "name", context),
    type: type as ResourceType,
    color: nullableString(row, "color", context),
    path: requiredString(row, "path", context),
    cached_minutes: cachedMinutes,
    created_at: requiredNumber(row, "created_at", context),
    updated_at: requiredNumber(row, "updated_at", context),
    deleted_at: nullableNumber(row, "deleted_at", context),
  };
}

function parseEvent(row: Record<string, unknown>, context: string): TimeEvent {
  const minutes = requiredNumber(row, "minutes", context);
  if (minutes <= 0) throw new Error(`${context}: minutes must be positive`);
  return {
    id: requiredString(row, "id", context),
    workspace_id: requiredString(row, "workspace_id", context),
    resource_id: requiredString(row, "resource_id", context),
    date: requiredString(row, "date", context),
    minutes,
    goal: nullableString(row, "goal", context),
    topics: nullableString(row, "topics", context),
    notes: nullableString(row, "notes", context),
    report: nullableString(row, "report", context),
    user_id: nullableString(row, "user_id", context),
    created_at: requiredNumber(row, "created_at", context),
    updated_at: requiredNumber(row, "updated_at", context),
    deleted_at: nullableNumber(row, "deleted_at", context),
  };
}

function parseAssignment(row: Record<string, unknown>, context: string): Assignment {
  return {
    id: requiredString(row, "id", context),
    resource_id: requiredString(row, "resource_id", context),
    user_id: requiredString(row, "user_id", context),
    workspace_id: requiredString(row, "workspace_id", context),
    created_at: requiredNumber(row, "created_at", context),
    updated_at: requiredNumber(row, "updated_at", context),
    deleted_at: nullableNumber(row, "deleted_at", context),
  };
}

function parseProfile(row: Record<string, unknown>, context: string): CachedProfile {
  return {
    user_id: requiredString(row, "user_id", context),
    display_name: requiredString(row, "display_name", context),
    avatar_url: nullableString(row, "avatar_url", context),
    cached_at: requiredNumber(row, "cached_at", context),
  };
}

function parseActivity(row: Record<string, unknown>, context: string): ActivityLogEntry {
  return {
    id: requiredString(row, "id", context),
    workspace_id: requiredString(row, "workspace_id", context),
    user_id: nullableString(row, "user_id", context),
    action: requiredString(row, "action", context),
    entity_type: requiredString(row, "entity_type", context),
    entity_id: nullableString(row, "entity_id", context),
    entity_name: nullableString(row, "entity_name", context),
    summary: requiredString(row, "summary", context),
    metadata: nullableString(row, "metadata", context),
    created_at: requiredNumber(row, "created_at", context),
    updated_at: requiredNumber(row, "updated_at", context),
    deleted_at: nullableNumber(row, "deleted_at", context),
  };
}

function parseOutbox(row: Record<string, unknown>, context: string): BackupOutboxRow {
  const entity = requiredString(row, "entity", context);
  const op = requiredString(row, "op", context);
  if (!OUTBOX_ENTITIES.includes(entity as OutboxEntity)) {
    throw new Error(`${context}: invalid outbox entity`);
  }
  if (!OUTBOX_OPS.includes(op as OutboxOp)) {
    throw new Error(`${context}: invalid outbox op`);
  }
  const payload = requiredString(row, "payload", context);
  try {
    JSON.parse(payload);
  } catch {
    throw new Error(`${context}: payload must be valid JSON`);
  }
  return {
    id: requiredNumber(row, "id", context),
    entity: entity as OutboxEntity,
    entity_id: requiredString(row, "entity_id", context),
    op: op as OutboxOp,
    payload,
    enqueued_at: requiredNumber(row, "enqueued_at", context),
    attempts: requiredNumber(row, "attempts", context),
    last_error: nullableString(row, "last_error", context),
    next_retry_at: nullableNumber(row, "next_retry_at", context),
    user_id: nullableString(row, "user_id", context),
  };
}

function parseKv(row: Record<string, unknown>, context: string): KvStoreRow {
  return {
    key: requiredString(row, "key", context),
    value: requiredString(row, "value", context),
  };
}

export function parseBackupJson(raw: string): TrackerBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Backup file is not valid JSON");
  }
  return validateBackup(parsed);
}

export function validateBackup(input: unknown): TrackerBackup {
  if (!isRecord(input)) throw new Error("Backup root must be an object");
  if (input.format !== BACKUP_FORMAT) throw new Error("Unsupported backup format");
  if (input.version !== BACKUP_VERSION) throw new Error("Unsupported backup version");
  if (typeof input.exported_at !== "string") throw new Error("Backup exported_at is missing");
  if (!isRecord(input.tables)) throw new Error("Backup tables are missing");

  const tables = input.tables;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: input.exported_at,
    app_version: typeof input.app_version === "string" ? input.app_version : "unknown",
    tables: {
      kv_store: parseRows(tables, "kv_store", parseKv),
      workspaces: parseRows(tables, "workspaces", parseWorkspace),
      workspace_memberships: parseRows(tables, "workspace_memberships", parseMembership),
      resources: parseRows(tables, "resources", parseResource),
      events: parseRows(tables, "events", parseEvent),
      assignments: parseRows(tables, "assignments", parseAssignment),
      profiles_cache: parseRows(tables, "profiles_cache", parseProfile),
      activity_log: parseRows(tables, "activity_log", parseActivity),
      sync_outbox: parseRows(tables, "sync_outbox", parseOutbox),
    },
  };
}

export function backupFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `tracker-backup-${stamp}.json`;
}

export function auditBackupTables(
  tables: BackupTables,
  generatedAt = new Date(),
  currentUserId?: string | null,
): AuditReport {
  const issues: AuditIssue[] = [];
  const workspaces = new Map(tables.workspaces.map((w) => [w.id, w]));
  const resources = new Map(tables.resources.map((r) => [r.id, r]));

  for (const membership of tables.workspace_memberships) {
    if (!workspaces.has(membership.workspace_id)) {
      issues.push({
        severity: "error",
        code: "membership_missing_workspace",
        entity: "workspace_membership",
        entity_id: `${membership.workspace_id}:${membership.user_id}`,
        message: "Membership points to a missing workspace.",
      });
    }
  }

  for (const resource of tables.resources) {
    const workspace = workspaces.get(resource.workspace_id);
    if (!workspace) {
      issues.push({
        severity: "error",
        code: "resource_missing_workspace",
        entity: "resource",
        entity_id: resource.id,
        message: "Resource points to a missing workspace.",
      });
    }
    if (resource.parent_id === null) {
      if (resource.path !== resource.id) {
        issues.push({
          severity: "warning",
          code: "root_path_mismatch",
          entity: "resource",
          entity_id: resource.id,
          message: "Top-level resource path should equal its id.",
        });
      }
      if (resource.type !== "project") {
        issues.push({
          severity: "error",
          code: "top_level_not_project",
          entity: "resource",
          entity_id: resource.id,
          message: "Only projects can be top-level resources.",
        });
      }
      continue;
    }

    const parent = resources.get(resource.parent_id);
    if (!parent) {
      issues.push({
        severity: "error",
        code: "resource_missing_parent",
        entity: "resource",
        entity_id: resource.id,
        message: "Resource parent is missing.",
      });
      continue;
    }
    if (parent.workspace_id !== resource.workspace_id) {
      issues.push({
        severity: "error",
        code: "resource_parent_workspace_mismatch",
        entity: "resource",
        entity_id: resource.id,
        message: "Resource parent belongs to another workspace.",
      });
    }
    if (resource.path !== `${parent.path}/${resource.id}`) {
      issues.push({
        severity: "warning",
        code: "resource_path_mismatch",
        entity: "resource",
        entity_id: resource.id,
        message: "Resource materialized path does not match parent chain.",
      });
    }
  }

  for (const event of tables.events) {
    const resource = resources.get(event.resource_id);
    if (!resource) {
      issues.push({
        severity: "error",
        code: "event_missing_resource",
        entity: "event",
        entity_id: event.id,
        message: "Event points to a missing resource.",
      });
      continue;
    }
    if (event.workspace_id !== resource.workspace_id) {
      issues.push({
        severity: "error",
        code: "event_workspace_mismatch",
        entity: "event",
        entity_id: event.id,
        message: "Event workspace does not match its resource workspace.",
      });
    }
  }

  for (const assignment of tables.assignments) {
    if (!resources.has(assignment.resource_id)) {
      issues.push({
        severity: "warning",
        code: "assignment_missing_resource",
        entity: "assignment",
        entity_id: assignment.id,
        message: "Assignment points to a missing resource.",
      });
    }
  }

  for (const entry of tables.activity_log) {
    if (!workspaces.has(entry.workspace_id)) {
      issues.push({
        severity: "warning",
        code: "activity_missing_workspace",
        entity: "activity_log",
        entity_id: entry.id,
        message: "Activity log entry points to a missing workspace.",
      });
    }
  }

  const activeEvents = tables.events.filter((event) => event.deleted_at === null);
  for (const resource of tables.resources.filter((r) => r.deleted_at === null)) {
    const actual = activeEvents.reduce((sum, event) => {
      const eventResource = resources.get(event.resource_id);
      if (!eventResource || eventResource.deleted_at !== null) return sum;
      const inSubtree =
        eventResource.path === resource.path || eventResource.path.startsWith(`${resource.path}/`);
      return inSubtree ? sum + event.minutes : sum;
    }, 0);
    if (resource.cached_minutes !== actual) {
      issues.push({
        severity: "warning",
        code: "cached_minutes_mismatch",
        entity: "resource",
        entity_id: resource.id,
        message: `Cached minutes is ${resource.cached_minutes}, expected ${actual}.`,
      });
    }
  }

  for (const row of tables.sync_outbox) {
    if (row.last_error) {
      issues.push({
        severity: "warning",
        code: "outbox_retry_error",
        entity: "sync_outbox",
        entity_id: String(row.id),
        message: row.last_error,
      });
    }
  }

  const visibleWorkspaceIds = currentUserId
    ? new Set(
        tables.workspace_memberships
          .filter((m) => m.deleted_at === null && m.user_id === currentUserId)
          .map((m) => m.workspace_id),
      )
    : null;

  const summaryWorkspaces = tables.workspaces.filter(
    (w) => w.deleted_at === null && (visibleWorkspaceIds === null || visibleWorkspaceIds.has(w.id)),
  );
  const summaryWorkspaceIds = new Set(summaryWorkspaces.map((w) => w.id));
  const summaryResources = tables.resources.filter(
    (r) => r.deleted_at === null && summaryWorkspaceIds.has(r.workspace_id),
  );
  const summaryEvents = tables.events.filter(
    (e) => e.deleted_at === null && summaryWorkspaceIds.has(e.workspace_id),
  );

  return {
    generatedAt: generatedAt.toISOString(),
    summary: {
      workspaces: summaryWorkspaces.length,
      resources: summaryResources.length,
      events: summaryEvents.length,
      pendingOutbox: tables.sync_outbox.length,
      syncErrors: tables.sync_outbox.filter((r) => r.last_error !== null).length,
    },
    issues,
  };
}
