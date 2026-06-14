-- ============================================================
-- Migration: PDF pipeline hardening
-- Run after: 20260602_pgcron_update.sql
-- Idempotent.
-- ============================================================

-- ── 1. Add render dimension columns to pdf_pages ─────────────────────────────
-- Required for crop analysis, bounding box coordinate systems,
-- and future house volume calculations.
ALTER TABLE public.pdf_pages
  ADD COLUMN IF NOT EXISTS render_width_px  integer,
  ADD COLUMN IF NOT EXISTS render_height_px integer,
  ADD COLUMN IF NOT EXISTS render_dpi       integer;

COMMENT ON COLUMN public.pdf_pages.render_width_px  IS 'Width of the rendered PNG in pixels. Used to convert bounding-box coords to real-world mm via drawing_scale.';
COMMENT ON COLUMN public.pdf_pages.render_height_px IS 'Height of the rendered PNG in pixels.';
COMMENT ON COLUMN public.pdf_pages.render_dpi       IS 'DPI at which this page was rendered (typically 150 for classification pass, 300+ for crop analysis).';


-- ── 2. Add max_pages guard column to pdf_uploads ─────────────────────────────
-- Stores the total pages accepted for rendering (may be less than PDF page_count
-- if the file exceeds MAX_PAGES and pages were truncated).
ALTER TABLE public.pdf_uploads
  ADD COLUMN IF NOT EXISTS pages_accepted integer;

COMMENT ON COLUMN public.pdf_uploads.pages_accepted IS 'Pages actually rendered (may be less than page_count if MAX_PAGES cap was applied).';


-- ── 2b. Add pipeline timing columns to pdf_uploads ───────────────────────────
-- Populated by render-pdf.js and classify-pages.js for performance monitoring.
ALTER TABLE public.pdf_uploads
  ADD COLUMN IF NOT EXISTS render_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS render_completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS classify_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS classify_completed_at timestamptz;

COMMENT ON COLUMN public.pdf_uploads.render_started_at    IS 'Timestamp when render-pdf.js began processing pages.';
COMMENT ON COLUMN public.pdf_uploads.render_completed_at  IS 'Timestamp when all pages were rendered and uploaded to Storage.';
COMMENT ON COLUMN public.pdf_uploads.classify_started_at  IS 'Timestamp when classify-pages.js began the AI classification pass.';
COMMENT ON COLUMN public.pdf_uploads.classify_completed_at IS 'Timestamp when AI classification completed and status moved to awaiting_confirmation.';


-- ── 3. Increase Storage bucket file size limit to 200 MB ─────────────────────
-- Default 50 MB limit is too small for large architectural PDFs (100 MB+).
UPDATE storage.buckets
SET file_size_limit = 209715200   -- 200 MB
WHERE id = 'plan-uploads'
  AND (file_size_limit IS NULL OR file_size_limit < 209715200);


-- ── 4. Fix pg_cron cleanup job ────────────────────────────────────────────────
-- The previous pgcron_update.sql used invalid syntax:
--   SELECT cron.unschedule(...) WHERE EXISTS (...)
-- cron.unschedule() returns void and cannot be used in a conditional SELECT.
-- This block safely replaces the job using a PL/pgSQL DO block.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-plan-uploads-temp') THEN
      PERFORM cron.unschedule('cleanup-plan-uploads-temp');
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cron') THEN
    PERFORM cron.schedule(
      'cleanup-plan-uploads-temp',
      '0 3 * * *',
      'DELETE FROM public.plan_uploads WHERE is_temporary = true AND created_at < now() - interval ''7 days'''
    );
  END IF;
END;
$$;

-- Verify: SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-plan-uploads-temp';
