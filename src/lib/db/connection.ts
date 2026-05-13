import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_SQL } from "./schema";

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

  // NOTE: We do NOT use an explicit BEGIN/COMMIT here because some statements
  // (DDL like CREATE TABLE, DROP TABLE, ALTER TABLE) cause an implicit commit
  // in SQLite when executed inside a transaction via the Tauri SQL plugin.
  // Instead we execute each step individually. The idempotency guard above
  // ensures we never run this twice.

  // Step 1a: Create workspaces table
  await db.execute(`CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    owner_id    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces(deleted_at) WHERE deleted_at IS NULL`);

  // Step 1b: Create workspace_memberships table
  await db.execute(`CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at     INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_memberships(user_id)`);

  // Step 1c: Recreate sync_outbox with extended entity CHECK constraint
  await db.execute(`CREATE TABLE IF NOT EXISTS sync_outbox_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity        TEXT NOT NULL CHECK (entity IN ('resource','event','workspace','workspace_membership')),
    entity_id     TEXT NOT NULL,
    op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
    payload       TEXT NOT NULL,
    enqueued_at   INTEGER NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    next_retry_at INTEGER
  )`);
  await db.execute(`INSERT INTO sync_outbox_new (id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at)
    SELECT id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at FROM sync_outbox`);
  await db.execute(`DROP TABLE sync_outbox`);
  await db.execute(`ALTER TABLE sync_outbox_new RENAME TO sync_outbox`);
  await db.execute(`CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at)`);

  // Step 2: Insert Local_Personal_Workspace
  await db.execute(
    `INSERT OR IGNORE INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, 'My workspace', 'local', ?, ?)`,
    [localWorkspaceId, now, now],
  );

  // Step 3: Insert owner membership for Local_Personal_Workspace
  await db.execute(
    `INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role, joined_at) VALUES (?, 'local', 'owner', ?)`,
    [localWorkspaceId, now],
  );

  // Step 4: Add workspace_id to resources and backfill
  await db.execute(
    `ALTER TABLE resources ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE`,
  );
  await db.execute(
    `UPDATE resources SET workspace_id = ? WHERE workspace_id IS NULL`,
    [localWorkspaceId],
  );

  // Step 5: Add workspace_id to events and backfill
  await db.execute(
    `ALTER TABLE events ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE`,
  );
  await db.execute(
    `UPDATE events SET workspace_id = ? WHERE workspace_id IS NULL`,
    [localWorkspaceId],
  );
}

/**
 * Runs the Phase 6 team-features migration idempotently.
 *
 * Checks whether the `assignments` table already exists via
 * PRAGMA table_info('assignments'). If it does, the migration has already
 * been applied and we skip it. Otherwise we execute each DDL/DML statement
 * individually (same approach as runPhase5Migration — DDL causes implicit
 * commits in SQLite so we avoid wrapping in an explicit transaction).
 */
export async function runPhase6Migration(db: Database): Promise<void> {
  // Check idempotency: does the assignments table already exist?
  type PragmaRow = { name: string };
  const columns = await db.select<PragmaRow[]>("PRAGMA table_info('assignments')");
  if (columns.length > 0) return;

  // Step 1: Create assignments table and indexes
  await db.execute(`CREATE TABLE IF NOT EXISTS assignments (
    id           TEXT PRIMARY KEY,
    resource_id  TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_assignments_resource  ON assignments(resource_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_assignments_user      ON assignments(user_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_assignments_workspace ON assignments(workspace_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_assignments_active    ON assignments(deleted_at) WHERE deleted_at IS NULL`);

  // Step 2: Create profiles_cache table
  await db.execute(`CREATE TABLE IF NOT EXISTS profiles_cache (
    user_id      TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url   TEXT,
    cached_at    INTEGER NOT NULL
  )`);

  // Step 3: Recreate sync_outbox with extended entity CHECK constraint to include 'assignment'
  await db.execute(`CREATE TABLE IF NOT EXISTS sync_outbox_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity        TEXT NOT NULL CHECK (entity IN ('resource','event','workspace','workspace_membership','assignment')),
    entity_id     TEXT NOT NULL,
    op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
    payload       TEXT NOT NULL,
    enqueued_at   INTEGER NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    next_retry_at INTEGER
  )`);
  await db.execute(`INSERT INTO sync_outbox_new (id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at)
    SELECT id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at FROM sync_outbox`);
  await db.execute(`DROP TABLE sync_outbox`);
  await db.execute(`ALTER TABLE sync_outbox_new RENAME TO sync_outbox`);
  await db.execute(`CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at)`);
}

export async function getDb(): Promise<Database> {
  if (cached) return cached;
  const db = await Database.load(DB_URL);
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute(SCHEMA_SQL);
  await runPhase5Migration(db);
  await runPhase6Migration(db);
  cached = db;
  return db;
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.close();
  cached = null;
}
