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
`;
