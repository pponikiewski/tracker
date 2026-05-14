BEGIN;

-- Phase 6: minimum team visibility for a small workspace.
-- Adds profiles, assignments and event attribution needed for team reports.

-- Members must be able to see every member in their workspace; otherwise the
-- local app can only render "me" and team reports miss owners/members.
DROP POLICY IF EXISTS "wm_select" ON workspace_memberships;
CREATE POLICY "wm_select" ON workspace_memberships
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE TABLE IF NOT EXISTS profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  avatar_url   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_authenticated" ON profiles;
CREATE POLICY "profiles_select_authenticated" ON profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "profiles_self_insert" ON profiles;
CREATE POLICY "profiles_self_insert" ON profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "profiles_self_update" ON profiles;
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Existing Phase 4 installs already have events.user_id. Keep this idempotent
-- for databases created directly from later migrations.
ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS events_workspace_user_date_idx ON events(workspace_id, user_id, date);

CREATE TABLE IF NOT EXISTS assignments (
  id           UUID PRIMARY KEY,
  resource_id  UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ,
  UNIQUE (resource_id, user_id)
);

CREATE INDEX IF NOT EXISTS assignments_resource_idx ON assignments(resource_id);
CREATE INDEX IF NOT EXISTS assignments_user_idx ON assignments(user_id);
CREATE INDEX IF NOT EXISTS assignments_workspace_idx ON assignments(workspace_id);
CREATE INDEX IF NOT EXISTS assignments_active_idx ON assignments(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_assignments" ON assignments;
CREATE POLICY "workspace_assignments" ON assignments
  FOR ALL USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- Optional avatar storage used by the current profile UI.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_own_insert" ON storage.objects;
CREATE POLICY "avatars_own_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_own_update" ON storage.objects;
CREATE POLICY "avatars_own_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_own_delete" ON storage.objects;
CREATE POLICY "avatars_own_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
