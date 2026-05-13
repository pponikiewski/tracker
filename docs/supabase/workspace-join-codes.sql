-- ============================================================================
-- Workspace join codes — replaces the email-invite flow.
-- Run this once in the Supabase SQL Editor.
-- ============================================================================

-- Drop legacy invites table if you want to clean up (optional — safe to skip).
-- DROP TABLE IF EXISTS invites;

-- ---------------------------------------------------------------------------
-- 1. Table
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

-- ---------------------------------------------------------------------------
-- 2. RLS — only the workspace OWNER can create / list / revoke codes.
--    Regular members CANNOT read codes; redemption is done through an RPC
--    with SECURITY DEFINER below, which bypasses RLS.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "owner_insert"  ON workspace_join_codes;
DROP POLICY IF EXISTS "owner_select"  ON workspace_join_codes;
DROP POLICY IF EXISTS "owner_delete"  ON workspace_join_codes;

CREATE POLICY "owner_insert" ON workspace_join_codes
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id      = auth.uid()
        AND wm.role         = 'owner'
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
    )
  );

-- ---------------------------------------------------------------------------
-- 3. RPC — redeem a code and join the workspace atomically.
--    SECURITY DEFINER lets the function bypass RLS on workspace_join_codes
--    and workspace_memberships so a non-member can join themselves.
-- ---------------------------------------------------------------------------
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

  -- Lock the code row for update so concurrent redeems serialise cleanly.
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

  -- Insert membership (idempotent: if the user is already a member, skip).
  INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
  VALUES (v_code_row.workspace_id, v_user_id, 'member', now())
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Mark the code as consumed.
  UPDATE workspace_join_codes
    SET used_at = now(),
        used_by = v_user_id
    WHERE code = p_code;

  RETURN v_code_row.workspace_id;
END;
$$;

-- Allow every authenticated user to call the RPC (it internally guards access).
REVOKE ALL ON FUNCTION redeem_workspace_join_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_workspace_join_code(TEXT) TO authenticated;
