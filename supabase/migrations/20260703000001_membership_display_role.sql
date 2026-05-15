-- Descriptive team roles shown in the Team tab.
-- This is separate from workspace_memberships.role, which controls permissions
-- and remains limited to 'owner' / 'member'.

ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS display_role TEXT,
  ADD COLUMN IF NOT EXISTS display_role_updated_at TIMESTAMPTZ;

