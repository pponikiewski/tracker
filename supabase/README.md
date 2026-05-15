# Supabase Migrations

## Fresh Project Setup

1. Open Supabase dashboard -> project -> SQL Editor.
2. Run every file from `supabase/migrations/` in filename order, oldest first.
3. Run each migration as its own SQL Editor execution. Migrations are wrapped in `BEGIN`/`COMMIT`, so a failure rolls back that migration.
4. Verify that the latest objects exist:
   - `resources`, `events`, `workspaces`, `workspace_memberships`
   - `profiles`, `assignments`, `activity_log`
   - `workspace_join_codes`
   - RPC `redeem_workspace_join_code(TEXT)`

For a one-shot local/dev setup you can also paste `docs/supabase/full-setup.sql`, which mirrors the migration state for a fresh database.

## Apply One Migration

Use this only for an existing project that already has all previous migrations applied:

1. Open Supabase dashboard -> project -> SQL Editor.
2. Paste the next unapplied file from `supabase/migrations/`.
3. Run it and verify the objects touched by that migration.

## RLS Sanity Check

In SQL Editor as an authenticated user:

```sql
SELECT * FROM resources;  -- should return only rows in workspaces visible to auth.uid()
```

Verify isolation:

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'resources',
  'events',
  'workspaces',
  'workspace_memberships',
  'profiles',
  'workspace_join_codes'
);
-- All rows should show relrowsecurity = true
```

Verify join codes:

```sql
SELECT to_regclass('public.workspace_join_codes') AS join_codes_table;

SELECT proname
FROM pg_proc
WHERE proname = 'redeem_workspace_join_code';
```

## Adding New Migration

Filename pattern: `YYYYMMDDHHMMSS_description.sql`. Always wrap in `BEGIN; ... COMMIT;`. Make idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before create).
