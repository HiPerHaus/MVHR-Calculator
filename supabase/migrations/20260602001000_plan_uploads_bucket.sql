-- ============================================================
-- Migration: plan-uploads Storage bucket + RLS + pg_cron cleanup
-- Run in: Supabase SQL Editor (or supabase db push)
-- ============================================================

-- ── 1. Create the Storage bucket ────────────────────────────
-- If the bucket already exists this is a no-op.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'plan-uploads',
  'plan-uploads',
  false,                           -- private bucket
  52428800,                        -- 50 MB per-file limit
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. RLS policies ─────────────────────────────────────────
-- Allow authenticated users to INSERT (upload) into their own temp folder.
CREATE POLICY "Authenticated users can upload to their temp folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'plan-uploads'
  AND (storage.foldername(name))[1] = 'temp'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow authenticated users to SELECT (download) from their own temp folder.
-- (Used by the server-side download in analyse-plan.js via the service-role key,
--  but included here for completeness / future client-side use.)
CREATE POLICY "Authenticated users can read their own temp files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'plan-uploads'
  AND (storage.foldername(name))[1] = 'temp'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow authenticated users to DELETE their own temp files.
CREATE POLICY "Authenticated users can delete their own temp files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'plan-uploads'
  AND (storage.foldername(name))[1] = 'temp'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Service role can do anything (needed for server-side download + cleanup).
CREATE POLICY "Service role has full access to plan-uploads"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'plan-uploads')
WITH CHECK (bucket_id = 'plan-uploads');


-- ── 3. pg_cron: hourly cleanup of temp files older than 24 h ─
-- Skipped safely when pg_cron is not installed.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cron') THEN
    PERFORM cron.schedule(
      'cleanup-plan-uploads-temp',
      '0 * * * *',
      'DELETE FROM public.plan_uploads
       WHERE is_temporary = true
       AND created_at < now() - interval ''24 hours'''
    );
  END IF;
END;
$$;
