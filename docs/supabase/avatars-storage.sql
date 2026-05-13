-- ============================================================================
-- Storage setup for user avatars.
-- Run this once in Supabase Studio → SQL Editor.
--
-- Creates a public bucket `avatars` and policies allowing authenticated users
-- to upload / update / delete files inside their own folder (keyed by user_id
-- as the first path segment), and allowing anonymous read access so the
-- public avatar URLs work.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ---------------------------------------------------------------------------
-- 2. Policies on storage.objects scoped to the avatars bucket.
--
-- The app uploads to a path shaped `{user_id}/{uuid}.{ext}`; we enforce that
-- the first path segment matches the caller's auth.uid().
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "avatars_public_read"      ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert"     ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update"     ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"     ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
