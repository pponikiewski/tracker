import type Database from "@tauri-apps/plugin-sql";
import { describe, expect, it } from "vitest";
import { runPhase5Migration, runPhase6Migration } from "@/lib/db/connection";

class FakeDb {
  readonly executed: string[] = [];

  constructor(private readonly columns: Record<string, string[]> = {}) {}

  async select<T>(sql: string): Promise<T> {
    const pragmaMatch = /PRAGMA table_info\('?(?<table>\w+)'?\)/.exec(sql);
    if (pragmaMatch?.groups?.table) {
      const rows = (this.columns[pragmaMatch.groups.table] ?? []).map((name) => ({ name }));
      return rows as T;
    }

    if (sql.includes("SELECT value FROM kv_store")) {
      return [] as T;
    }

    return [] as T;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.executed.push(`${sql} ${JSON.stringify(params)}`);
  }
}

function asDatabase(db: FakeDb): Database {
  return db as unknown as Database;
}

describe("local SQLite migration repairs", () => {
  it("repairs Phase 5 even when resources already has workspace_id", async () => {
    const db = new FakeDb({
      resources: ["id", "workspace_id"],
      events: ["id", "resource_id"],
      workspace_memberships: [],
      workspaces: [],
    });

    await runPhase5Migration(asDatabase(db));

    expect(db.executed.join("\n")).toContain("CREATE TABLE IF NOT EXISTS workspaces");
    expect(db.executed.join("\n")).toContain("CREATE TABLE IF NOT EXISTS workspace_memberships");
    expect(db.executed.join("\n")).toContain("ALTER TABLE events ADD COLUMN workspace_id");
    expect(db.executed.join("\n")).toContain("schema_migrations");
  });

  it("repairs Phase 6 even when assignments table already exists", async () => {
    const db = new FakeDb({
      assignments: ["id", "resource_id", "user_id", "workspace_id"],
      events: ["id", "resource_id", "workspace_id"],
    });

    await runPhase6Migration(asDatabase(db));

    expect(db.executed.join("\n")).toContain("CREATE TABLE IF NOT EXISTS assignments");
    expect(db.executed.join("\n")).toContain("CREATE TABLE IF NOT EXISTS profiles_cache");
    expect(db.executed.join("\n")).toContain("ALTER TABLE events ADD COLUMN user_id");
    expect(db.executed.join("\n")).toContain("20260615000001_phase6_core_repair");
  });
});
