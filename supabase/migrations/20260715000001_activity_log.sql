-- Shared team activity log.
--
-- Records short, append-only audit entries such as creating projects,
-- logging time, renaming workspaces, and assigning people. Rows are scoped by
-- workspace and visible only to workspace members.

BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_log (
  id           UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  entity_name  TEXT,
  summary      TEXT NOT NULL,
  metadata     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_activity_log_workspace_created
  ON public.activity_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user
  ON public.activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_active
  ON public.activity_log(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_log_select_workspace_members" ON public.activity_log;
CREATE POLICY "activity_log_select_workspace_members"
  ON public.activity_log
  FOR SELECT
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "activity_log_insert_workspace_members" ON public.activity_log;
CREATE POLICY "activity_log_insert_workspace_members"
  ON public.activity_log
  FOR INSERT
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "activity_log_update_own_rows" ON public.activity_log;
CREATE POLICY "activity_log_update_own_rows"
  ON public.activity_log
  FOR UPDATE
  USING (
    public.is_workspace_member(workspace_id)
    AND user_id = auth.uid()
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND user_id = auth.uid()
  );

ALTER TABLE public.activity_log REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
  END IF;
END $$;

COMMIT;
