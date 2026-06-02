-- ============================================================
-- Migration A4 + A5: Foreign key additions to existing tables
-- Run after: 20260602_pdf_pages.sql, 20260602_analysis_crops.sql
-- Idempotent.
-- ============================================================

-- ── A4: plan_analysis_log — link to PDF pipeline ─────────────────────────
ALTER TABLE public.plan_analysis_log
  ADD COLUMN IF NOT EXISTS pdf_upload_id uuid
    REFERENCES public.pdf_uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pdf_page_id   uuid
    REFERENCES public.pdf_pages(id)   ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS plan_analysis_log_pdf_upload_idx
  ON public.plan_analysis_log(pdf_upload_id)
  WHERE pdf_upload_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS plan_analysis_log_pdf_page_idx
  ON public.plan_analysis_log(pdf_page_id)
  WHERE pdf_page_id IS NOT NULL;

COMMENT ON COLUMN public.plan_analysis_log.pdf_upload_id IS
  'Links this analysis call to the PDF upload session it came from. NULL for single-image uploads.';
COMMENT ON COLUMN public.plan_analysis_log.pdf_page_id IS
  'Links this analysis call to the specific page that was analysed. NULL for single-image uploads.';

-- ── A5: projects — pointer to most recent upload job ─────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS current_job_id uuid
    REFERENCES public.pdf_uploads(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.current_job_id IS
  'Most recent pdf_uploads.id for this project. Updated by upload-pdf endpoint.';
