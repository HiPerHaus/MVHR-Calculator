-- Migration: 20260602_hires_image_path
-- Adds hi-res image columns to pdf_pages for two-stage rendering.
--
-- Stage 1 (render-pdf): low-DPI JPEG → image_path (already exists)
-- Stage 2 (render-hires): high-DPI PNG → hires_image_path (new)

ALTER TABLE pdf_pages
  ADD COLUMN IF NOT EXISTS hires_image_path  TEXT,
  ADD COLUMN IF NOT EXISTS hires_render_dpi  INTEGER,
  ADD COLUMN IF NOT EXISTS hires_width_px    INTEGER,
  ADD COLUMN IF NOT EXISTS hires_height_px   INTEGER;

COMMENT ON COLUMN pdf_pages.hires_image_path IS
  'Storage path for the high-DPI PNG used by analyse-plan (e.g. plan-uploads/temp/<uid>/<jobId>/page_01_hires.png). Populated only for floor_plan pages selected for analysis.';

COMMENT ON COLUMN pdf_pages.hires_render_dpi IS
  'DPI used when rendering the hi-res image. Typically 250.';

COMMENT ON COLUMN pdf_pages.hires_width_px IS
  'Pixel width of the hi-res render.';

COMMENT ON COLUMN pdf_pages.hires_height_px IS
  'Pixel height of the hi-res render.';
