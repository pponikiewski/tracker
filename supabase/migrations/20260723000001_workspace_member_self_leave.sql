BEGIN;

-- Members can leave a workspace by soft-deleting their own membership row.
-- Owners retain the broader membership management policy.
DROP POLICY IF EXISTS "wm_update" ON public.workspace_memberships;
CREATE POLICY "wm_update" ON public.workspace_memberships
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm2
      WHERE wm2.workspace_id = workspace_memberships.workspace_id
        AND wm2.user_id = auth.uid()
        AND wm2.role = 'owner'
        AND wm2.deleted_at IS NULL
    )
    OR (
      workspace_memberships.user_id = auth.uid()
      AND workspace_memberships.role = 'member'
      AND workspace_memberships.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm2
      WHERE wm2.workspace_id = workspace_memberships.workspace_id
        AND wm2.user_id = auth.uid()
        AND wm2.role = 'owner'
        AND wm2.deleted_at IS NULL
    )
    OR (
      workspace_memberships.user_id = auth.uid()
      AND workspace_memberships.role = 'member'
      AND workspace_memberships.deleted_at IS NOT NULL
    )
  );

COMMIT;
