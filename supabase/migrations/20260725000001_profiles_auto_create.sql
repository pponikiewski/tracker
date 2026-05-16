-- Auto-create profiles row for every auth.users signup + backfill existing users.
--
-- Problem: signUp() in the client may not call ensureProfile() reliably (e.g. before
-- email confirmation completes), leaving the user without a profiles row. Other
-- members then see their UUID instead of a display name.
--
-- Fix: server-side trigger on auth.users INSERT that always creates a profiles
-- row with display_name set to the email prefix. Plus a one-time backfill for
-- existing users.

BEGIN;

-- Backfill: insert profiles for any auth.users without one.
INSERT INTO public.profiles (user_id, display_name, avatar_url, updated_at)
SELECT
  u.id,
  COALESCE(NULLIF(split_part(u.email, '@', 1), ''), u.id::text),
  NULL,
  NOW()
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

-- Trigger function: runs after a new auth.users row is inserted.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), NEW.id::text),
    NULL,
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

COMMIT;
