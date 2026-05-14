-- Faza 7 — Realtime + Collaboration
--
-- Enables Supabase Realtime (postgres_changes) on every synced table so team
-- members receive each other's edits near-instantly instead of waiting for the
-- client poll. RLS still applies to realtime payloads, so each member only
-- receives changes for rows in workspaces they belong to.
--
-- REPLICA IDENTITY FULL makes UPDATE/DELETE events carry the full old row,
-- which is required for RLS filtering of those events to work correctly.
--
-- Idempotent: safe to re-run. Run in the Supabase SQL Editor after the Phase 6
-- migration.

BEGIN;

-- Ensure UPDATE/DELETE realtime payloads include the full row (needed for RLS).
ALTER TABLE public.resources             REPLICA IDENTITY FULL;
ALTER TABLE public.events                REPLICA IDENTITY FULL;
ALTER TABLE public.workspaces            REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_memberships REPLICA IDENTITY FULL;
ALTER TABLE public.assignments           REPLICA IDENTITY FULL;
ALTER TABLE public.profiles              REPLICA IDENTITY FULL;

-- Add each table to the realtime publication only if not already a member.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'resources',
    'events',
    'workspaces',
    'workspace_memberships',
    'assignments',
    'profiles'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
