BEGIN;

-- Workspace memberships are now soft-deleted. This keeps a tombstone that
-- delayed clients can merge with LWW instead of recreating a removed member.

ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS wm_active_idx
  ON public.workspace_memberships(deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS wm_workspace_active_idx
  ON public.workspace_memberships(workspace_id, deleted_at);

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL
  ) AND auth.uid() IS NOT NULL;
$$;

DROP POLICY IF EXISTS "wm_select" ON public.workspace_memberships;
CREATE POLICY "wm_select" ON public.workspace_memberships
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "workspace_select" ON public.workspaces;
CREATE POLICY "workspace_select" ON public.workspaces
  FOR SELECT USING (
    public.is_workspace_member(id)
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "wm_insert" ON public.workspace_memberships;
CREATE POLICY "wm_insert" ON public.workspace_memberships
  FOR INSERT WITH CHECK (
    deleted_at IS NULL
    AND (
      (
        user_id = auth.uid()
        AND role = 'owner'
        AND EXISTS (
          SELECT 1
          FROM public.workspaces w
          WHERE w.id = workspace_id
            AND w.owner_id = auth.uid()
        )
      )
      OR
      EXISTS (
        SELECT 1
        FROM public.workspace_memberships wm2
        WHERE wm2.workspace_id = workspace_memberships.workspace_id
          AND wm2.user_id = auth.uid()
          AND wm2.role = 'owner'
          AND wm2.deleted_at IS NULL
      )
    )
  );

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
  );

-- Hard deletes are intentionally no longer exposed to clients. Owners remove
-- members by setting deleted_at; service-role maintenance can still delete.
DROP POLICY IF EXISTS "wm_delete" ON public.workspace_memberships;

COMMIT;
