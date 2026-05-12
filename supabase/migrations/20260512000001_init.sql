BEGIN;

CREATE TABLE IF NOT EXISTS resources (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES resources(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('project','stage','substage','task')),
  color       TEXT,
  path        TEXT NOT NULL,
  cached_minutes INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS resources_user_idx ON resources(user_id);
CREATE INDEX IF NOT EXISTS resources_path_idx ON resources(user_id, path);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  minutes     INTEGER NOT NULL CHECK (minutes > 0),
  goal        TEXT,
  topics      TEXT,
  notes       TEXT,
  report      TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS events_user_date_idx ON events(user_id, date);
CREATE INDEX IF NOT EXISTS events_resource_idx ON events(resource_id);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_resources" ON resources;
CREATE POLICY "own_resources" ON resources
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own_events" ON events;
CREATE POLICY "own_events" ON events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMIT;
