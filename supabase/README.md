# Supabase Migrations

## Apply manually (MVP)

1. Open Supabase dashboard → project → SQL Editor.
2. Paste contents of latest `migrations/*.sql` file.
3. Run. Wrapped in BEGIN/COMMIT — failure rolls back.
4. Verify: Table editor shows `resources` and `events` with RLS enabled (lock icon).

## RLS sanity check

In SQL Editor (as authenticated user):
```sql
SELECT * FROM resources;  -- should return only rows where user_id = auth.uid()
```

Verify isolation:
```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('resources','events');
-- Both rows should show relrowsecurity = true
```

## Adding new migration

Filename pattern: `YYYYMMDDHHMMSS_description.sql`. Always wrap in `BEGIN; ... COMMIT;`. Make idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before create).
