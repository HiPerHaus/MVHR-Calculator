-- ============================================================
-- Migration A3: analysis_crops table
-- Schema defined now; populated in Phase 3 (crop re-analysis).
-- Run after: 20260602_pdf_pages.sql
-- Idempotent.
-- ============================================================

-- This table stores the results of crop re-analysis for rooms that
-- could not be confidently classified from a full-page view.
--
-- Workflow (Phase 3):
--   1. analyse-plan returns reviewCandidates[] with boundingBox data.
--   2. User clicks "Reanalyse Room" in the UI.
--   3. Server crops the rendered page image using boundingBox + padding.
--   4. Crop PNG uploaded to Storage: .../crop_<roomName>.png
--   5. Claude analyses the crop (targeted fixture-detection prompt).
--   6. Result stored here; room classification updated.

CREATE TABLE IF NOT EXISTS public.analysis_crops (
  id                  uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The analysis run that generated this review candidate.
  analysis_log_id     uuid        NOT NULL
                      REFERENCES public.plan_analysis_log(id) ON DELETE CASCADE,

  -- The specific page this crop was taken from (nullable for legacy single-image runs).
  pdf_page_id         uuid
                      REFERENCES public.pdf_pages(id) ON DELETE SET NULL,

  -- Matches the 'name' field of the room in reviewCandidates[].
  room_name           text        NOT NULL,

  -- Storage path of the crop image: plan-uploads/temp/<uid>/<jobId>/crop_<room>.png
  -- Temporary — auto-deleted after 24 h by pg_cron.
  crop_storage_path   text,

  -- Pixel coordinates on the rendered page image (before any padding is applied).
  -- { "x": 100, "y": 200, "width": 400, "height": 300 }
  -- Convert to mm using pdf_pages.drawing_scale when available.
  bounding_box        jsonb,

  -- Full AI response for this crop analysis call.
  -- Structure mirrors a single room object from the standard analyse-plan response.
  crop_result_json    jsonb,

  -- Credits charged for this specific crop analysis call.
  credits_deducted    integer     NOT NULL DEFAULT 0,

  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS analysis_crops_log_idx
  ON public.analysis_crops(analysis_log_id);

CREATE INDEX IF NOT EXISTS analysis_crops_page_idx
  ON public.analysis_crops(pdf_page_id)
  WHERE pdf_page_id IS NOT NULL;

-- RLS
ALTER TABLE public.analysis_crops ENABLE ROW LEVEL SECURITY;

-- Users can read crops belonging to their own analysis runs.
DROP POLICY IF EXISTS "analysis_crops: own rows select" ON public.analysis_crops;
CREATE POLICY "analysis_crops: own rows select"
  ON public.analysis_crops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_analysis_log l
      WHERE l.id = analysis_crops.analysis_log_id
        AND l.user_id = auth.uid()
    )
  );

-- Users can insert crops for their own analysis runs.
DROP POLICY IF EXISTS "analysis_crops: own rows insert" ON public.analysis_crops;
CREATE POLICY "analysis_crops: own rows insert"
  ON public.analysis_crops FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_analysis_log l
      WHERE l.id = analysis_crops.analysis_log_id
        AND l.user_id = auth.uid()
    )
  );

-- Admins can read all.
DROP POLICY IF EXISTS "analysis_crops: admin read" ON public.analysis_crops;
CREATE POLICY "analysis_crops: admin read"
  ON public.analysis_crops FOR SELECT
  USING (public.is_admin());

-- Comments
COMMENT ON TABLE  public.analysis_crops                 IS 'Crop re-analysis results for ambiguous rooms. Schema defined Phase 2; populated Phase 3.';
COMMENT ON COLUMN public.analysis_crops.bounding_box    IS 'Pixel coords on rendered page PNG: { x, y, width, height }. Convert to mm via pdf_pages.drawing_scale.';
COMMENT ON COLUMN public.analysis_crops.crop_result_json IS 'AI output for this crop: spaceType, ventilationClassification, fixtures (with visibility states), confidence.';
