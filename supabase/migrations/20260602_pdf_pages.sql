-- ============================================================
-- Migration A2: pdf_pages table
-- One row per page of each uploaded PDF.
-- Run after: 20260602_pdf_uploads.sql
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pdf_pages (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pdf_upload_id   uuid        NOT NULL REFERENCES public.pdf_uploads(id) ON DELETE CASCADE,

  -- 1-based page number within the PDF.
  page_number     integer     NOT NULL,

  -- ── Storage paths ────────────────────────────────────────────────────────
  -- Full-resolution PNG for room analysis (300+ DPI). Null until rendered.
  image_path      text,

  -- JPEG thumbnail for the confirmation UI (≈200 px height). Null until rendered.
  thumb_path      text,

  -- When true this row's image/thumb assets are eligible for the 24h cleanup job.
  -- Set to false to permanently protect an asset (currently not used — originals
  -- are protected by the NOT LIKE '%/original.pdf' guard in pg_cron).
  is_temporary    boolean     NOT NULL DEFAULT true,

  -- ── AI page classification ────────────────────────────────────────────────
  page_type       text        NOT NULL DEFAULT 'unknown'
                  CHECK (page_type IN (
                    'floor_plan',
                    'site_plan',
                    'elevation',
                    'section',
                    'roof_plan',
                    'detail',
                    'schedule',
                    'specification',
                    'unknown'
                  )),

  -- 0.0–1.0 confidence from the AI classification call.
  classification_confidence float,

  -- Brief AI explanation of why this page type was chosen.
  classification_reason     text,

  -- ── Page role ─────────────────────────────────────────────────────────────
  -- Describes how this page will be used in the pipeline.
  -- Set at user confirmation time (confirm-pages endpoint).
  -- Elevation/section pages get volume_calculation automatically.
  page_role       text
                  CHECK (page_role IN (
                    'primary_analysis',
                    'secondary_analysis',
                    'volume_calculation',
                    'reference_only',
                    'ignored'
                  )),

  -- ── User selection ────────────────────────────────────────────────────────
  user_selected   boolean     NOT NULL DEFAULT false,

  -- Legacy floor index (0 = ground). Kept for backwards compat with analyse-plan.
  floor_index     integer,

  -- ── Floor identification ──────────────────────────────────────────────────
  -- Storey number: -1 = basement, 0 = ground, 1 = first, 2 = second, ...
  floor_level     integer,

  -- Human-readable label from the plan title block or user input.
  -- e.g. "Ground Floor Plan", "First Floor Plan", "Basement"
  floor_name      text,

  -- ── Physical page metadata ────────────────────────────────────────────────
  -- Nullable initially; populated by OCR layer (future) or user input.
  page_width_mm   numeric,
  page_height_mm  numeric,

  -- Drawing scale string, e.g. "1:100", "1:200".
  -- Required for converting bounding-box pixel coords to real-world dimensions.
  drawing_scale   text,

  -- ── House volume calculation metadata ────────────────────────────────────
  -- Populated by the AI classification pass. Used by future volume module.
  has_floor_levels    boolean,   -- floor plan shows storey level markers
  has_ceiling_heights boolean,   -- dimensions include ceiling heights
  has_roof_geometry   boolean,   -- roof geometry visible on this page
  has_elevation_data  boolean,   -- page is an elevation projection
  has_section_data    boolean,   -- page is a cross-section cut

  -- ── Analysis linkage ──────────────────────────────────────────────────────
  -- Set after analyse-plan runs for this page.
  analysis_log_id uuid        REFERENCES public.plan_analysis_log(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (pdf_upload_id, page_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS pdf_pages_upload_idx
  ON public.pdf_pages(pdf_upload_id, page_number);

CREATE INDEX IF NOT EXISTS pdf_pages_role_idx
  ON public.pdf_pages(pdf_upload_id, page_role)
  WHERE page_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS pdf_pages_selected_idx
  ON public.pdf_pages(pdf_upload_id, user_selected)
  WHERE user_selected = true;

-- RLS
ALTER TABLE public.pdf_pages ENABLE ROW LEVEL SECURITY;

-- Users can read their own pages via the pdf_uploads join.
DROP POLICY IF EXISTS "pdf_pages: own rows select" ON public.pdf_pages;
CREATE POLICY "pdf_pages: own rows select"
  ON public.pdf_pages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pdf_uploads u
      WHERE u.id = pdf_pages.pdf_upload_id
        AND u.user_id = auth.uid()
    )
  );

-- Users can insert pages for their own uploads.
DROP POLICY IF EXISTS "pdf_pages: own rows insert" ON public.pdf_pages;
CREATE POLICY "pdf_pages: own rows insert"
  ON public.pdf_pages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pdf_uploads u
      WHERE u.id = pdf_pages.pdf_upload_id
        AND u.user_id = auth.uid()
    )
  );

-- Users can update pages for their own uploads (e.g. confirm-pages sets user_selected).
DROP POLICY IF EXISTS "pdf_pages: own rows update" ON public.pdf_pages;
CREATE POLICY "pdf_pages: own rows update"
  ON public.pdf_pages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.pdf_uploads u
      WHERE u.id = pdf_pages.pdf_upload_id
        AND u.user_id = auth.uid()
    )
  );

-- Admins can read all.
DROP POLICY IF EXISTS "pdf_pages: admin read" ON public.pdf_pages;
CREATE POLICY "pdf_pages: admin read"
  ON public.pdf_pages FOR SELECT
  USING (public.is_admin());

-- Comments
COMMENT ON TABLE  public.pdf_pages                  IS 'One row per page of each uploaded PDF.';
COMMENT ON COLUMN public.pdf_pages.page_type        IS 'AI classification: floor_plan | site_plan | elevation | section | roof_plan | detail | schedule | specification | unknown';
COMMENT ON COLUMN public.pdf_pages.page_role        IS 'Pipeline role: primary_analysis | secondary_analysis | volume_calculation | reference_only | ignored. Set at confirm-pages time.';
COMMENT ON COLUMN public.pdf_pages.floor_level      IS '-1=basement, 0=ground, 1=first, 2=second. Drives riser calculations and multi-storey MVHR layouts.';
COMMENT ON COLUMN public.pdf_pages.drawing_scale    IS 'e.g. "1:100". Required for bounding-box px → mm conversion and future floor area calculations.';
COMMENT ON COLUMN public.pdf_pages.has_elevation_data IS 'true when this page is an elevation projection. Used by future house volume module.';
COMMENT ON COLUMN public.pdf_pages.has_section_data   IS 'true when this page is a cross-section cut. Used by future house volume module.';
