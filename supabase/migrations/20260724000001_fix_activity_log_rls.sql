-- Allow activity_log rows with user_id IS NULL (system-generated entries).
-- The original policies required user_id = auth.uid(), blocking upserts for
-- rows recorded by Rust commands where no auth context is available.

BEGIN;

DROP POLICY IF EXISTS "activity_log_insert_workspace_members" ON public.activity_log;
CREATE POLICY "activity_log_insert_workspace_members"
  ON public.activity_log
  FOR INSERT
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

DROP POLICY IF EXISTS "activity_log_update_own_rows" ON public.activity_log;
CREATE POLICY "activity_log_update_own_rows"
  ON public.activity_log
  FOR UPDATE
  USING (
    public.is_workspace_member(workspace_id)
    AND (user_id = auth.uid() OR user_id IS NULL)
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

COMMIT;
