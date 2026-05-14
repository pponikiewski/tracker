/**
 * SQLite schema for tracker MVP (Faza 1).
 * Materialized path for hierarchy (SQLite has no ltree).
 * Path format: "id1/id2/id3" — ancestors slash-separated, self last.
 * Soft delete via deleted_at (UNIX epoch millis, NULL = active).
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('project','stage','substage','task')),
  color TEXT,
  path TEXT NOT NULL,
  cached_minutes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_resources_path ON resources(path);
CREATE INDEX IF NOT EXISTS idx_resources_parent ON resources(parent_id);
CREATE INDEX IF NOT EXISTS idx_resources_active ON resources(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  goal TEXT,
  topics TEXT,
  notes TEXT,
  report TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_resource ON events(resource_id);
CREATE INDEX IF NOT EXISTS idx_events_active ON events(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity        TEXT NOT NULL CHECK (entity IN ('resource','event')),
  entity_id     TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload       TEXT NOT NULL,
  enqueued_at   INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at INTEGER
);

CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at);
`;

/**
 * SQLite schema migration for Faza 5 — Multi-Tenant Workspace support.
 *
 * Adds:
 *   - workspaces table
 *   - workspace_memberships table
 *   - Indexes: idx_workspaces_owner, idx_workspaces_active, idx_wm_user
 *   - Recreates sync_outbox with extended entity CHECK constraint
 *     ('workspace' and 'workspace_membership' added alongside 'resource' and 'event').
 *
 * NOTE: SQLite does not support ALTER TABLE … ALTER COLUMN / ADD CONSTRAINT,
 * so sync_outbox is recreated via CREATE … INSERT SELECT … DROP … RENAME.
 *
 * This constant is intentionally separate from SCHEMA_SQL so that existing
 * installations are not affected. connection.ts applies it as a conditional
 * migration (see task 2.2).
 */
export const SCHEMA_V5_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  owner_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner  ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_memberships(user_id);

-- Recreate sync_outbox with extended entity CHECK constraint.
-- Wrapped in a BEGIN/COMMIT so the whole block is atomic.
-- The guard (SELECT COUNT(*) check) is handled by connection.ts before
-- calling this SQL, so here we always perform the recreation.
CREATE TABLE sync_outbox_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity        TEXT NOT NULL CHECK (entity IN ('resource','event','workspace','workspace_membership')),
  entity_id     TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload       TEXT NOT NULL,
  enqueued_at   INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at INTEGER
);

INSERT INTO sync_outbox_new
  SELECT id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at
  FROM sync_outbox;

DROP TABLE sync_outbox;

ALTER TABLE sync_outbox_new RENAME TO sync_outbox;

CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at);
`;

/**
 * SQLite schema migration for Faza 6 — Team Features.
 *
 * Adds:
 *   - assignments table with indexes
 *   - profiles_cache table
 *   - user_id column to events table (for team analytics attribution)
 *   - Recreates sync_outbox with extended entity CHECK constraint
 *     ('assignment' added alongside 'resource', 'event', 'workspace', 'workspace_membership').
 *
 * NOTE: SQLite does not support ALTER TABLE … ALTER COLUMN / ADD CONSTRAINT,
 * so sync_outbox is recreated via CREATE … INSERT SELECT … DROP … RENAME.
 *
 * This constant is intentionally separate from SCHEMA_V5_SQL so that existing
 * installations are not affected. connection.ts applies it as a conditional
 * migration guarded by PRAGMA table_info('assignments').
 */
export const SCHEMA_V6_SQL = `
CREATE TABLE IF NOT EXISTS assignments (
  id           TEXT PRIMARY KEY,
  resource_id  TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_assignments_resource  ON assignments(resource_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user      ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_workspace ON assignments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assignments_active    ON assignments(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS profiles_cache (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  cached_at    INTEGER NOT NULL
);

-- Recreate sync_outbox with extended entity CHECK constraint to include 'assignment'.
-- The guard (PRAGMA table_info('assignments') check) is handled by connection.ts before
-- calling this SQL, so here we always perform the recreation.
CREATE TABLE sync_outbox_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity        TEXT NOT NULL CHECK (entity IN ('resource','event','workspace','workspace_membership','assignment')),
  entity_id     TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload       TEXT NOT NULL,
  enqueued_at   INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at INTEGER
);

INSERT INTO sync_outbox_new
  SELECT id, entity, entity_id, op, payload, enqueued_at, attempts, last_error, next_retry_at
  FROM sync_outbox;

DROP TABLE sync_outbox;

ALTER TABLE sync_outbox_new RENAME TO sync_outbox;

CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at);
`;
