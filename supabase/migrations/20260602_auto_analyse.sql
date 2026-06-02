-- ============================================================
-- Migration: Auto-analysis and email notification fields
-- Run after: 20260602_pdf_pipeline_hardening.sql
-- Idempotent.
-- ============================================================

-- ── 1. Add auto-analysis tracking columns to pdf_uploads ─────────────────────
-- auto_analysis: true when the pipeline auto-selects and analyses pages
--   without user confirmation (fire-and-forget background mode).
-- analysed_page_count: number of pages successfully analysed by analyse-plan.
-- email_sent_at: timestamp when the "analysis ready" email was dispatched.
-- completed_at: timestamp when status moved to 'complete'.

ALTER TABLE public.pdf_uploads
  ADD COLUMN IF NOT EXISTS auto_analysis       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analysed_page_count integer,
  ADD COLUMN IF NOT EXISTS email_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz;

COMMENT ON COLUMN public.pdf_uploads.auto_analysis
  IS 'true = pipeline runs fully in background (no user page-selection step).';
COMMENT ON COLUMN public.pdf_uploads.analysed_page_count
  IS 'Number of pages successfully analysed by analyse-plan in auto mode.';
COMMENT ON COLUMN public.pdf_uploads.email_sent_at
  IS 'Timestamp when the analysis-complete notification email was dispatched.';
COMMENT ON COLUMN public.pdf_uploads.completed_at
  IS 'Timestamp when the job reached status = complete.';
