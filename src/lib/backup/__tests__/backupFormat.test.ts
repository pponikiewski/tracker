import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  auditBackupTables,
  backupFilename,
  parseBackupJson,
  validateBackup,
  type BackupTables,
  type TrackerBackup,
} from "../backupFormat";

const tables: BackupTables = {
  kv_store: [{ key: "local_workspace_id", value: "local-ws" }],
  workspaces: [
    {
      id: "ws-1",
      name: "Workspace",
      owner_id: "user-1",
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    },
  ],
  workspace_memberships: [
    {
      workspace_id: "ws-1",
      user_id: "user-1",
      role: "owner",
      joined_at: 1,
      display_role: null,
      display_role_updated_at: null,
      deleted_at: null,
    },
  ],
  resources: [
    {
      id: "project-1",
      workspace_id: "ws-1",
      parent_id: null,
      name: "Project",
      type: "project",
      color: null,
      path: "project-1",
      cached_minutes: 30,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    },
    {
      id: "task-1",
      workspace_id: "ws-1",
      parent_id: "project-1",
      name: "Task",
      type: "task",
      color: null,
      path: "project-1/task-1",
      cached_minutes: 30,
      created_at: 2,
      updated_at: 2,
      deleted_at: null,
    },
  ],
  events: [
    {
      id: "event-1",
      workspace_id: "ws-1",
      resource_id: "task-1",
      date: "2026-05-16",
      minutes: 30,
      goal: null,
      topics: null,
      notes: null,
      report: null,
      user_id: "user-1",
      created_at: 3,
      updated_at: 3,
      deleted_at: null,
    },
  ],
  assignments: [],
  profiles_cache: [],
  activity_log: [],
  sync_outbox: [],
};

function makeBackup(overrideTables: Partial<BackupTables> = {}): TrackerBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: "2026-05-16T00:00:00.000Z",
    app_version: "0.1.0",
    tables: { ...tables, ...overrideTables },
  };
}

describe("backup format", () => {
  it("validates a complete backup and keeps row data intact", () => {
    const backup = validateBackup(makeBackup());

    expect(backup.tables.workspaces[0]?.id).toBe("ws-1");
    expect(backup.tables.events[0]?.minutes).toBe(30);
  });

  it("parses backup JSON", () => {
    const backup = parseBackupJson(JSON.stringify(makeBackup()));

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
  });

  it("rejects invalid event minutes before restore", () => {
    const [event] = tables.events;
    expect(event).toBeDefined();

    expect(() =>
      validateBackup(
        makeBackup({
          events: [{ ...event!, minutes: 0 }],
        }),
      ),
    ).toThrow(/minutes must be positive/);
  });

  it("creates filesystem-safe backup filenames", () => {
    expect(backupFilename(new Date("2026-05-16T12:34:56.789Z"))).toBe(
      "tracker-backup-2026-05-16T12-34-56-789Z.json",
    );
  });
});

describe("backup audit", () => {
  it("passes a consistent snapshot", () => {
    const report = auditBackupTables(tables, new Date("2026-05-16T00:00:00.000Z"));

    expect(report.issues).toEqual([]);
    expect(report.summary.events).toBe(1);
  });

  it("detects path and workspace consistency issues", () => {
    const report = auditBackupTables({
      ...tables,
      resources: [
        tables.resources[0]!,
        {
          ...tables.resources[1]!,
          workspace_id: "missing-ws",
          path: "task-1",
        },
      ],
      events: [{ ...tables.events[0]!, workspace_id: "ws-1" }],
    });

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "resource_missing_workspace",
        "resource_parent_workspace_mismatch",
        "resource_path_mismatch",
        "event_workspace_mismatch",
      ]),
    );
  });

  it("reports outbox retry errors for sync audit visibility", () => {
    const report = auditBackupTables({
      ...tables,
      sync_outbox: [
        {
          id: 1,
          entity: "event",
          entity_id: "event-1",
          op: "upsert",
          payload: "{}",
          enqueued_at: 10,
          attempts: 3,
          last_error: "network down",
          next_retry_at: 20,
          user_id: "user-1",
        },
      ],
    });

    expect(report.summary.pendingOutbox).toBe(1);
    expect(report.summary.syncErrors).toBe(1);
    expect(report.issues.some((issue) => issue.code === "outbox_retry_error")).toBe(true);
  });
});
