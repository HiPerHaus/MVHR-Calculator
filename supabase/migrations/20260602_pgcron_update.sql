-- ============================================================
-- Migration A6: Update pg_cron cleanup job
-- Replace the existing cleanup-plan-uploads-temp job with a
-- version that:
--   1. Never deletes original.pdf files (permanent assets).
--   2. Nulls out stale image_path / thumb_path in pdf_pages.
-- Run after: 20260602_pdf_pages.sql
-- ============================================================

-- Remove the old job if it exists (may have been created by
-- 20260602_plan_uploads_bucket.sql with the old simpler query).
SELECT cron.unschedule('cleanup-plan-uploads-temp')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-plan-uploads-temp'
);

-- Schedule the updated job.
SELECT cron.schedule(
  'cleanup-plan-uploads-temp',   -- job name
  '0 * * * *',                   -- every hour on the hour
  $$
    -- Delete temporary Storage objects older than 24 hours.
    -- NEVER deletes original.pdf — those are permanent.
    DELETE FROM storage.objects
    WHERE
      bucket_id  = 'plan-uploads'
      AND name   LIKE 'temp/%'
      AND name   NOT LIKE '%/original.pdf'
      AND created_at < NOW() - INTERVAL '24 hours';

    -- Null out stale Storage paths in pdf_pages so the UI
    -- shows "image expired" rather than a broken link.
    UPDATE public.pdf_pages
    SET
      image_path = NULL,
      thumb_path = NULL
    WHERE
      is_temporary = true
      AND (image_path IS NOT NULL OR thumb_path IS NOT NULL)
      AND created_at < NOW() - INTERVAL '24 hours';
  $$
);

-- Verify:
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-plan-uploads-temp';
