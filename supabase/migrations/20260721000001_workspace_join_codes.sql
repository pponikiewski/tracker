BEGIN;

-- Six-digit workspace join codes. This migration moves the previously manual
-- docs/supabase/workspace-join-codes.sql setup into the normal migration path.

CREATE TABLE IF NOT EXISTS public.workspace_join_codes (
  code         TEXT        PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_join_codes_workspace
  ON public.workspace_join_codes(workspace_id);

CREATE INDEX IF NOT EXISTS idx_join_codes_active
  ON public.workspace_join_codes(expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.workspace_join_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_insert" ON public.workspace_join_codes;
DROP POLICY IF EXISTS "owner_select" ON public.workspace_join_codes;
DROP POLICY IF EXISTS "owner_delete" ON public.workspace_join_codes;

CREATE POLICY "owner_insert" ON public.workspace_join_codes
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'owner'
        AND wm.deleted_at IS NULL
    )
  );

CREATE POLICY "owner_select" ON public.workspace_join_codes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'owner'
        AND wm.deleted_at IS NULL
    )
  );

CREATE POLICY "owner_delete" ON public.workspace_join_codes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workspace_join_codes.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'owner'
        AND wm.deleted_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.redeem_workspace_join_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_row public.workspace_join_codes%ROWTYPE;
  v_user_id  UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Invalid code format' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_code_row
    FROM public.workspace_join_codes
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

  INSERT INTO public.workspace_memberships
    (workspace_id, user_id, role, joined_at, deleted_at)
  VALUES
    (v_code_row.workspace_id, v_user_id, 'member', now(), NULL)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET
    role = 'member',
    joined_at = COALESCE(public.workspace_memberships.joined_at, excluded.joined_at),
    deleted_at = NULL;

  UPDATE public.workspace_join_codes
    SET used_at = now(),
        used_by = v_user_id
    WHERE code = p_code;

  RETURN v_code_row.workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_workspace_join_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_workspace_join_code(TEXT) TO authenticated;

COMMIT;
