import Database from "@tauri-apps/plugin-sql";
import { ACTIVITY_LOG_SQL, SCHEMA_SQL, WORKSPACE_QUERY_INDEXES_SQL } from "./schema";

const DB_URL = "sqlite:tracker.db";

let cached: Database | null = null;

type PragmaRow = { name: string };

async function hasColumn(db: Database, tableName: string, columnName: string): Promise<boolean> {
  const cols = await db.select<PragmaRow[]>(`PRAGMA table_info('${tableName}')`);
  return cols.some((c) => c.name === columnName);
}

async function ensureColumn(
  db: Database,
  tableName: string,
  columnName: string,
  definition: string,
): Promise<void> {
  if (await hasColumn(db, tableName, columnName)) return;
  await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

/**
 * Runs the Phase 5 multi-tenant migration idempotently.
 *
 * Checks whether the `workspace_id` column already exists in the `resources`
 * table via PRAGMA table_info. If it does, the migration has already been
 * applied and we skip it. Otherwise we execute every DDL/DML statement
 * sequentially.
 *
 * SCHEMA_V5_SQL contains multiple statements separated by semicolons. Because
 * the Tauri SQL plugin executes one statement per call we split the constant
 * into individual statements and run them one by one.
 */
export async function runPhase5Migration(db: Database): Promise<void> {
  // Check idempotency: does workspace_id already exist in resources?
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
  await ensureColumn(db, "workspaces", "deleted_at", "deleted_at INTEGER");
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces(deleted_at) WHERE deleted_at IS NULL`,
  );

  // Step 1b: Create workspace_memberships table
  await db.execute(`CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at     INTEGER NOT NULL,
    display_role  TEXT,
    display_role_updated_at INTEGER,
    deleted_at    INTEGER,
    PRIMARY KEY (workspace_id, user_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_memberships(user_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_wm_active ON workspace_memberships(deleted_at) WHERE deleted_at IS NULL`,
  );

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
  await db.execute(`UPDATE resources SET workspace_id = ? WHERE workspace_id IS NULL`, [
    localWorkspaceId,
  ]);

  // Step 5: Add workspace_id to events and backfill
  await db.execute(
    `ALTER TABLE events ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE`,
  );
  await db.execute(`UPDATE events SET workspace_id = ? WHERE workspace_id IS NULL`, [
    localWorkspaceId,
  ]);
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_assignments_resource  ON assignments(resource_id)`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_assignments_user      ON assignments(user_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_assignments_workspace ON assignments(workspace_id)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_assignments_active    ON assignments(deleted_at) WHERE deleted_at IS NULL`,
  );

  // Step 2: Create profiles_cache table
  await db.execute(`CREATE TABLE IF NOT EXISTS profiles_cache (
    user_id      TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url   TEXT,
    cached_at    INTEGER NOT NULL
  )`);

  // Step 2b: Add user_id column to events table for team analytics attribution
  // SQLite allows adding a nullable column without a default value restriction.
  // Existing events (created before Phase 6) will have NULL user_id.
  await db.execute(`ALTER TABLE events ADD COLUMN user_id TEXT`);

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

/**
 * One-shot cleanup: removes sync_outbox rows whose payload targets a
 * Local_Personal_Workspace (owner_id = 'local'). Those rows must never reach
 * Supabase — they trigger RLS denials and loop forever in retry.
 *
 * Safe to run on every startup; it is a no-op when the outbox is clean.
 */
async function purgeLocalOutboxRows(db: Database): Promise<void> {
  // Collect workspace ids that are marked as local in the local SQLite copy.
  const localWs = await db.select<Array<{ id: string }>>(
    `SELECT id FROM workspaces WHERE owner_id = 'local'`,
  );
  if (localWs.length === 0) return;

  const localIds = new Set(localWs.map((r) => r.id));

  // Pull all outbox rows with a workspace_id in the payload and delete the
  // ones pointing at a local workspace. We iterate client-side because the
  // payload is TEXT JSON and SQLite's json functions aren't guaranteed to be
  // enabled in every Tauri build.
  const rows = await db.select<Array<{ id: number; payload: string }>>(
    `SELECT id, payload FROM sync_outbox`,
  );
  const toDelete: number[] = [];
  for (const row of rows) {
    try {
      const obj = JSON.parse(row.payload) as { workspace_id?: string };
      if (obj.workspace_id && localIds.has(obj.workspace_id)) {
        toDelete.push(row.id);
      }
    } catch {
      // Ignore malformed payloads — they'll fail elsewhere.
    }
  }

  if (toDelete.length > 0) {
    const placeholders = toDelete.map((_, i) => `$${i + 1}`).join(",");
    await db.execute(`DELETE FROM sync_outbox WHERE id IN (${placeholders})`, toDelete);
    console.info(
      `[sync] purged ${toDelete.length} outbox row(s) targeting Local_Personal_Workspace.`,
    );
  }
}

export async function getDb(): Promise<Database> {
  if (cached) return cached;
  const db = await Database.load(DB_URL);
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute(SCHEMA_SQL);
  await runPhase5Migration(db);
  await runPhase6Migration(db);
  await ensureSchemaMigrationsTable(db);
  await ensurePhase5CoreSchema(db);
  await markSchemaMigration(db, "20260601000001_phase5_core_repair");
  await ensurePhase6CoreSchema(db);
  await markSchemaMigration(db, "20260615000001_phase6_core_repair");
  await ensureMembershipDisplayRoleColumns(db);
  await ensureMembershipDeletedAtColumn(db);
  await ensureOutboxUserIdColumn(db);
  await ensureActivityLogSchema(db);
  await markSchemaMigration(db, "20260715000001_activity_log_repair");
  await ensureOutboxAllowsActivityLog(db);
  await ensureWorkspaceQueryIndexes(db);
  await markSchemaMigration(db, "20260720000002_workspace_query_indexes");
  await purgeLocalOutboxRows(db);
  await purgeLegacyResourceSortOrderFromOutbox(db);
  cached = db;
  return db;
}

async function ensureSchemaMigrationsTable(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
}

async function markSchemaMigration(db: Database, version: string): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ($1, $2)`,
    [version, Date.now()],
  );
}

async function ensureLocalPersonalWorkspace(db: Database): Promise<string> {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );

  const existing = await db.select<Array<{ value: string }>>(
    "SELECT value FROM kv_store WHERE key = 'local_workspace_id' LIMIT 1",
  );
  const now = Date.now();
  const localWorkspaceId = existing[0]?.value ?? crypto.randomUUID();

  await db.execute(
    "INSERT OR IGNORE INTO kv_store (key, value) VALUES ('local_workspace_id', $1)",
    [localWorkspaceId],
  );
  await db.execute(
    `INSERT OR IGNORE INTO workspaces (id, name, owner_id, created_at, updated_at)
     VALUES ($1, 'My workspace', 'local', $2, $2)`,
    [localWorkspaceId, now],
  );
  await db.execute(
    `INSERT OR IGNORE INTO workspace_memberships
       (workspace_id, user_id, role, joined_at, display_role, display_role_updated_at, deleted_at)
     VALUES ($1, 'local', 'owner', $2, NULL, NULL, NULL)`,
    [localWorkspaceId, now],
  );

  return localWorkspaceId;
}

async function ensurePhase5CoreSchema(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    owner_id    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces(deleted_at) WHERE deleted_at IS NULL`,
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at     INTEGER NOT NULL,
    display_role  TEXT,
    display_role_updated_at INTEGER,
    deleted_at    INTEGER,
    PRIMARY KEY (workspace_id, user_id)
  )`);
  await ensureColumn(db, "workspace_memberships", "display_role", "display_role TEXT");
  await ensureColumn(
    db,
    "workspace_memberships",
    "display_role_updated_at",
    "display_role_updated_at INTEGER",
  );
  await ensureColumn(db, "workspace_memberships", "deleted_at", "deleted_at INTEGER");
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_memberships(user_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_wm_active ON workspace_memberships(deleted_at) WHERE deleted_at IS NULL`,
  );

  const localWorkspaceId = await ensureLocalPersonalWorkspace(db);

  await ensureColumn(
    db,
    "resources",
    "workspace_id",
    "workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE",
  );
  await db.execute(`UPDATE resources SET workspace_id = $1 WHERE workspace_id IS NULL`, [
    localWorkspaceId,
  ]);

  await ensureColumn(
    db,
    "events",
    "workspace_id",
    "workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE",
  );
  await db.execute(
    `UPDATE events
        SET workspace_id = (
          SELECT r.workspace_id FROM resources r WHERE r.id = events.resource_id LIMIT 1
        )
      WHERE workspace_id IS NULL`,
  );
  await db.execute(`UPDATE events SET workspace_id = $1 WHERE workspace_id IS NULL`, [
    localWorkspaceId,
  ]);
}

async function ensurePhase6CoreSchema(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS assignments (
    id           TEXT PRIMARY KEY,
    resource_id  TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_assignments_resource  ON assignments(resource_id)`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_assignments_user      ON assignments(user_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_assignments_workspace ON assignments(workspace_id)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_assignments_active    ON assignments(deleted_at) WHERE deleted_at IS NULL`,
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS profiles_cache (
    user_id      TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url   TEXT,
    cached_at    INTEGER NOT NULL
  )`);

  await ensureColumn(db, "events", "user_id", "user_id TEXT");
}

async function ensureActivityLogSchema(db: Database): Promise<void> {
  const statements = ACTIVITY_LOG_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.execute(statement);
  }
}

async function ensureOutboxAllowsActivityLog(db: Database): Promise<void> {
  const rows = await db.select<Array<{ sql: string | null }>>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox' LIMIT 1`,
  );
  const sql = rows[0]?.sql ?? "";
  const requiredEntities = [
    "'resource'",
    "'event'",
    "'workspace'",
    "'workspace_membership'",
    "'assignment'",
    "'activity_log'",
  ];
  if (requiredEntities.every((entity) => sql.includes(entity))) return;

  await db.execute(`CREATE TABLE IF NOT EXISTS sync_outbox_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity        TEXT NOT NULL CHECK (entity IN ('resource','event','workspace','workspace_membership','assignment','activity_log')),
    entity_id     TEXT NOT NULL,
    op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
    payload       TEXT NOT NULL,
    enqueued_at   INTEGER NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    next_retry_at INTEGER,
    user_id       TEXT
  )`);
  await db.execute(`INSERT INTO sync_outbox_new
    (id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at, user_id)
    SELECT id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at, user_id
    FROM sync_outbox`);
  await db.execute(`DROP TABLE sync_outbox`);
  await db.execute(`ALTER TABLE sync_outbox_new RENAME TO sync_outbox`);
  await db.execute(`CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at)`);
}

async function ensureWorkspaceQueryIndexes(db: Database): Promise<void> {
  const statements = WORKSPACE_QUERY_INDEXES_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.execute(statement);
  }
}

async function ensureMembershipDisplayRoleColumns(db: Database): Promise<void> {
  type PragmaRow = { name: string };
  const cols = await db.select<PragmaRow[]>("PRAGMA table_info('workspace_memberships')");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("display_role")) {
    await db.execute("ALTER TABLE workspace_memberships ADD COLUMN display_role TEXT");
  }
  if (!names.has("display_role_updated_at")) {
    await db.execute(
      "ALTER TABLE workspace_memberships ADD COLUMN display_role_updated_at INTEGER",
    );
  }
}

async function ensureMembershipDeletedAtColumn(db: Database): Promise<void> {
  type PragmaRow = { name: string };
  const cols = await db.select<PragmaRow[]>("PRAGMA table_info('workspace_memberships')");
  if (!cols.some((c) => c.name === "deleted_at")) {
    await db.execute("ALTER TABLE workspace_memberships ADD COLUMN deleted_at INTEGER");
  }
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_wm_active ON workspace_memberships(deleted_at) WHERE deleted_at IS NULL`,
  );
}

/**
 * One-shot cleanup for dev builds that briefly had a local resources.sort_order
 * column before the Supabase schema did. Old outbox payloads with that field
 * fail PostgREST schema-cache validation forever until retried with a cleaned
 * payload.
 */
async function purgeLegacyResourceSortOrderFromOutbox(db: Database): Promise<void> {
  const rows = await db.select<Array<{ id: number; payload: string }>>(
    `SELECT id, payload
       FROM sync_outbox
      WHERE entity = 'resource'
        AND payload LIKE '%"sort_order"%'`,
  );
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(payload, "sort_order")) continue;
      delete payload.sort_order;
      await db.execute(
        `UPDATE sync_outbox
            SET payload = $1,
                attempts = 0,
                last_error = NULL,
                next_retry_at = NULL
          WHERE id = $2`,
        [JSON.stringify(payload), row.id],
      );
    } catch {
      // Leave malformed payloads alone; normal sync error handling will report them.
    }
  }
}

/**
 * Idempotent: adds a `user_id` column to sync_outbox so each queued operation
 * remembers which authenticated user enqueued it. Worker.tick() then pushes
 * only the rows belonging to the currently-signed-in user, so pendings
 * created by user A never get rejected (or worse, dropped) while user B is
 * signed in on the same machine.
 */
async function ensureOutboxUserIdColumn(db: Database): Promise<void> {
  type PragmaRow = { name: string };
  const cols = await db.select<PragmaRow[]>("PRAGMA table_info('sync_outbox')");
  if (cols.some((c) => c.name === "user_id")) return;
  await db.execute("ALTER TABLE sync_outbox ADD COLUMN user_id TEXT");
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.close();
  cached = null;
}

/**
 * Wipes all user-scoped data from local SQLite.
 *
 * Preserves:
 *   • Local_Personal_Workspace row and its membership (owner_id / user_id = 'local')
 *   • kv_store entries (e.g. local_workspace_id)
 *   • sync_outbox — each row is tagged with its user_id, so pending pushes
 *     from another user are kept around for when they sign back in.
 *
 * Called when the authenticated user changes so we don't leak another user's
 * projects / events / memberships across accounts on the same machine.
 */
export async function resetUserScopedData(): Promise<void> {
  const db = await getDb();

  await db.execute(`DELETE FROM activity_log`);
  await db.execute(`DELETE FROM profiles_cache`);
  await db.execute(`DELETE FROM assignments`);
  await db.execute(`DELETE FROM events`);
  await db.execute(`DELETE FROM resources`);
  // Drop memberships for every user except the local pseudo-user.
  await db.execute(`DELETE FROM workspace_memberships WHERE user_id != 'local'`);
  // Drop workspaces that are not Local_Personal_Workspace.
  await db.execute(`DELETE FROM workspaces WHERE owner_id != 'local'`);
  await db.execute(`DELETE FROM sync_outbox WHERE user_id IS NULL`);
  console.info("[db] resetUserScopedData: cleared non-local data for user switch");
}
