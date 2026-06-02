-- ============================================================
-- Migration A1: pdf_uploads table
-- One row per PDF upload session / job.
-- Run after: 20260602_plan_uploads_bucket.sql
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pdf_uploads (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- job_id is the public identifier used in API paths and Storage paths.
  -- It is separate from id so the internal PK is never exposed in URLs.
  job_id          uuid        NOT NULL UNIQUE DEFAULT uuid_generate_v4(),

  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id      uuid        REFERENCES public.projects(id)          ON DELETE SET NULL,

  -- Storage path of the original PDF file.
  -- Format: plan-uploads/temp/<userId>/<jobId>/original.pdf
  storage_path    text        NOT NULL,

  -- Original filename as uploaded by the client.
  original_name   text        NOT NULL,

  file_size_bytes bigint,

  -- Set after rendering completes.
  page_count      integer,

  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',
                    'rendering',
                    'classifying',
                    'awaiting_confirmation',
                    'confirmed',
                    'analysing',
                    'complete',
                    'error'
                  )),

  error_detail    text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Update updated_at automatically on every row change.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pdf_uploads_updated_at ON public.pdf_uploads;
CREATE TRIGGER pdf_uploads_updated_at
  BEFORE UPDATE ON public.pdf_uploads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS pdf_uploads_user_id_idx
  ON public.pdf_uploads(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pdf_uploads_job_id_idx
  ON public.pdf_uploads(job_id);

CREATE INDEX IF NOT EXISTS pdf_uploads_project_id_idx
  ON public.pdf_uploads(project_id)
  WHERE project_id IS NOT NULL;

-- RLS
ALTER TABLE public.pdf_uploads ENABLE ROW LEVEL SECURITY;

-- Users can see and insert their own rows.
DROP POLICY IF EXISTS "pdf_uploads: own rows select" ON public.pdf_uploads;
CREATE POLICY "pdf_uploads: own rows select"
  ON public.pdf_uploads FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "pdf_uploads: own rows insert" ON public.pdf_uploads;
CREATE POLICY "pdf_uploads: own rows insert"
  ON public.pdf_uploads FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update status on their own rows (e.g. client-side cancel).
DROP POLICY IF EXISTS "pdf_uploads: own rows update" ON public.pdf_uploads;
CREATE POLICY "pdf_uploads: own rows update"
  ON public.pdf_uploads FOR UPDATE
  USING (user_id = auth.uid());

-- Admins can read all.
DROP POLICY IF EXISTS "pdf_uploads: admin read" ON public.pdf_uploads;
CREATE POLICY "pdf_uploads: admin read"
  ON public.pdf_uploads FOR SELECT
  USING (public.is_admin());

-- Comments
COMMENT ON TABLE  public.pdf_uploads       IS 'One row per PDF upload session. Parent of pdf_pages.';
COMMENT ON COLUMN public.pdf_uploads.job_id IS 'Public identifier used in API paths (/job-status/<jobId>) and Storage paths.';
COMMENT ON COLUMN public.pdf_uploads.status IS 'Lifecycle: pending → rendering → classifying → awaiting_confirmation → confirmed → analysing → complete | error';
