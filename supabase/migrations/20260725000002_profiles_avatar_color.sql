-- Add user-customizable avatar background color for the initials fallback.
-- Stored as a hex string ("#3b82f6") or NULL (use deterministic auto-color).

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_color TEXT;

COMMIT;
