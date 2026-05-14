BEGIN;

-- Fix Phase 5/6 membership visibility.
-- The original SELECT policy exposed only the caller's own membership row,
-- which made TeamView, assignment pickers and workspace settings miss the
-- owner or other members. A workspace member should see the member list for
-- every workspace they belong to.

DROP POLICY IF EXISTS "wm_select" ON workspace_memberships;
CREATE POLICY "wm_select" ON workspace_memberships
  FOR SELECT USING (is_workspace_member(workspace_id));

COMMIT;
