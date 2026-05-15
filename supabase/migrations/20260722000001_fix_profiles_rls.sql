BEGIN;

-- Profiles should be visible only to their owner or to users who share an
-- active workspace membership. The original Phase 6 policy allowed every
-- authenticated user to read every profile.

CREATE OR REPLACE FUNCTION public.shares_workspace_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      p_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.workspace_memberships self_membership
        JOIN public.workspace_memberships other_membership
          ON other_membership.workspace_id = self_membership.workspace_id
        JOIN public.workspaces shared_workspace
          ON shared_workspace.id = self_membership.workspace_id
        WHERE self_membership.user_id = auth.uid()
          AND self_membership.deleted_at IS NULL
          AND other_membership.user_id = p_user_id
          AND other_membership.deleted_at IS NULL
          AND shared_workspace.deleted_at IS NULL
      )
    );
$$;

REVOKE ALL ON FUNCTION public.shares_workspace_with(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_workspace_with(UUID) TO authenticated;

DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "shared_workspace_read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_shared_workspace" ON public.profiles;

CREATE POLICY "profiles_select_shared_workspace" ON public.profiles
  FOR SELECT
  USING (public.shares_workspace_with(user_id));

COMMIT;
