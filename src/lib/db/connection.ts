import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_SQL, SCHEMA_V5_SQL } from "./schema";

const DB_URL = "sqlite:tracker.db";

let cached: Database | null = null;

/**
 * Runs the Phase 5 multi-tenant migration idempotently.
 *
 * Checks whether the `workspace_id` column already exists in the `resources`
 * table via PRAGMA table_info. If it does, the migration has already been
 * applied and we skip it. Otherwise we execute every DDL/DML statement in a
 * single SQLite transaction.
 *
 * SCHEMA_V5_SQL contains multiple statements separated by semicolons. Because
 * the Tauri SQL plugin executes one statement per call we split the constant
 * into individual statements and run them one by one inside the transaction.
 */
export async function runPhase5Migration(db: Database): Promise<void> {
  // Check idempotency: does workspace_id already exist in resources?
  type PragmaRow = { name: string };
  const columns = await db.select<PragmaRow[]>("PRAGMA table_info(resources)");
  const alreadyMigrated = columns.some((col) => col.name === "workspace_id");
  if (alreadyMigrated) return;

  // Generate a stable UUID for Local_Personal_Workspace.
  const localWorkspaceId = crypto.randomUUID();
  const now = Date.now();

  await db.execute("BEGIN");
  try {
    // Step 1: Run SCHEMA_V5_SQL statements (creates workspaces,
    // workspace_memberships, recreates sync_outbox with extended CHECK).
    // Split on semicolons and skip empty/whitespace-only fragments.
    const statements = SCHEMA_V5_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await db.execute(stmt);
    }

    // Step 2: Insert Local_Personal_Workspace (INSERT OR IGNORE — idempotent).
    await db.execute(
      "INSERT OR IGNORE INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, 'My workspace', 'local', ?, ?)",
      [localWorkspaceId, now, now],
    );

    // Step 3: Insert owner membership for Local_Personal_Workspace.
    await db.execute(
      "INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role, joined_at) VALUES (?, 'local', 'owner', ?)",
      [localWorkspaceId, now],
    );

    // Step 4: Add workspace_id column to resources and backfill.
    await db.execute(
      "ALTER TABLE resources ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE",
    );
    await db.execute(
      "UPDATE resources SET workspace_id = ? WHERE workspace_id IS NULL",
      [localWorkspaceId],
    );

    // Step 5: Add workspace_id column to events and backfill.
    await db.execute(
      "ALTER TABLE events ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE",
    );
    await db.execute(
      "UPDATE events SET workspace_id = ? WHERE workspace_id IS NULL",
      [localWorkspaceId],
    );

    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }
}

export async function getDb(): Promise<Database> {
  if (cached) return cached;
  const db = await Database.load(DB_URL);
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute(SCHEMA_SQL);
  await runPhase5Migration(db);
  cached = db;
  return db;
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.close();
  cached = null;
}
