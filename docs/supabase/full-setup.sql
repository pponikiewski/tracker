-- ============================================================================
-- Full Supabase setup for the tracker app.
--
-- Run this once in Supabase Studio → SQL Editor.
--
-- Covers:
--   • workspaces          — Phase 5 (multi-tenant)
--   • workspace_memberships
--   • resources           — Phase 1 cloud mirror
--   • events              — Phase 1 cloud mirror
--   • assignments         — Phase 6 (team features)
--   • profiles            — Phase 6 (display name + avatar)
--   • workspace_join_codes + redeem_workspace_join_code()
--     (the 6-digit invite replacement)
--
-- Each CREATE is idempotent (IF NOT EXISTS) so re-running is safe.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Helper: is_workspace_member(workspace_id, user_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_workspace_member(p_workspace UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE workspace_id = p_workspace
      AND user_id      = p_user
      AND deleted_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION is_workspace_member(UUID, UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 1. workspaces
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  deleted_at  TIMESTAMPTZ
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_select" ON workspaces;
DROP POLICY IF EXISTS "owner_write"    ON workspaces;

CREATE POLICY "members_select" ON workspaces
  FOR SELECT
  USING (is_workspace_member(id, auth.uid()));

CREATE POLICY "owner_write" ON workspaces
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2. workspace_memberships
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE workspace_memberships
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_or_member_select" ON workspace_memberships;
DROP POLICY IF EXISTS "self_insert"           ON workspace_memberships;
DROP POLICY IF EXISTS "self_update"           ON workspace_memberships;
DROP POLICY IF EXISTS "owner_or_self_delete"  ON workspace_memberships;

CREATE POLICY "self_or_member_select" ON workspace_memberships
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_workspace_member(workspace_id, auth.uid())
  );

-- User can add themselves (e.g. on workspace creation); join-code RPC
-- inserts for other users under SECURITY DEFINER.
CREATE POLICY "self_insert" ON workspace_memberships
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Needed so upsert() can UPDATE the row when it already exists.
CREATE POLICY "self_update" ON workspace_memberships
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner_or_self_delete" ON workspace_memberships
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_memberships.workspace_id
        AND w.owner_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 3. resources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resources (
  id             UUID PRIMARY KEY,
  parent_id      UUID REFERENCES resources(id) ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('project','stage','substage','task')),
  color          TEXT,
  path           TEXT NOT NULL,
  cached_minutes INTEGER NOT NULL DEFAULT 0,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL,
  deleted_at     TIMESTAMPTZ
);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_rw" ON resources;
CREATE POLICY "members_rw" ON resources
  FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid()));


-- ---------------------------------------------------------------------------
-- 4. events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           UUID PRIMARY KEY,
  resource_id  UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  date         DATE NOT NULL,
  minutes      INTEGER NOT NULL CHECK (minutes > 0),
  goal         TEXT,
  topics       TEXT,
  notes        TEXT,
  report       TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_rw" ON events;
CREATE POLICY "members_rw" ON events
  FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid()));


-- ---------------------------------------------------------------------------
-- 5. assignments (Phase 6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id           UUID PRIMARY KEY,
  resource_id  UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ
);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_rw" ON assignments;
CREATE POLICY "members_rw" ON assignments
  FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid()));


-- ---------------------------------------------------------------------------
-- 6. profiles (Phase 6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_workspace_read" ON profiles;
DROP POLICY IF EXISTS "owner_insert"          ON profiles;
DROP POLICY IF EXISTS "owner_update"          ON profiles;

CREATE POLICY "owner_insert" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "shared_workspace_read" ON profiles
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM workspace_memberships wm1
      JOIN workspace_memberships wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = auth.uid()
        AND wm2.user_id = profiles.user_id
    )
  );


-- ---------------------------------------------------------------------------
-- 7. workspace_join_codes + redeem RPC
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_join_codes (
  code         TEXT        PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_join_codes_workspace
  ON workspace_join_codes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_join_codes_active
  ON workspace_join_codes(expires_at)
  WHERE used_at IS NULL;

ALTER TABLE workspace_join_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_insert" ON workspace_join_codes;
DROP POLICY IF EXISTS "owner_select" ON workspace_join_codes;
DROP POLICY IF EXISTS "owner_delete" ON workspace_join_codes;

CREATE POLICY "owner_insert" ON workspace_join_codes
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id      = auth.uid()
        AND wm.role         = 'owner'
        AND wm.deleted_at IS NULL
    )
  );

CREATE POLICY "owner_select" ON workspace_join_codes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id      = auth.uid()
        AND wm.role         = 'owner'
        AND wm.deleted_at IS NULL
    )
  );

CREATE POLICY "owner_delete" ON workspace_join_codes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id      = auth.uid()
        AND wm.role         = 'owner'
        AND wm.deleted_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION redeem_workspace_join_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_row workspace_join_codes%ROWTYPE;
  v_user_id  UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Invalid code format' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_code_row
    FROM workspace_join_codes
    WHERE code = p_code
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired code' USING ERRCODE = '22023';
  END IF;

  IF v_code_row.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid or expired code' USING ERRCODE = '22023';
  END IF;

  IF v_code_row.expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid or expired code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at, deleted_at)
  VALUES (v_code_row.workspace_id, v_user_id, 'member', now(), NULL)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET
    role = 'member',
    joined_at = COALESCE(workspace_memberships.joined_at, excluded.joined_at),
    deleted_at = NULL;

  UPDATE workspace_join_codes
    SET used_at = now(),
        used_by = v_user_id
    WHERE code = p_code;

  RETURN v_code_row.workspace_id;
END;
$$;

REVOKE ALL  ON FUNCTION redeem_workspace_join_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_workspace_join_code(TEXT) TO authenticated;
