-- ============================================================
-- HiPer Studio — Room geometry for terminal auto-placement
-- Stores a normalized bounding box per room, captured during AI
-- plan extraction, so supply/extract terminals can be auto-placed
-- inside the room (box centroid) instead of needing manual review.
--   bbox = { "x":0..1, "y":0..1, "w":0..1, "h":0..1 }
--   Origin top-left, fractions of the rendered page image.
--   NULL when geometry is unavailable (room falls back to review).
-- Idempotent.
-- ============================================================

alter table public.project_rooms
  add column if not exists bbox jsonb;

comment on column public.project_rooms.bbox is
  'Normalized room bounding box on the page image: {x,y,w,h} as 0-1 fractions, '
  'origin top-left. Captured during AI extraction. NULL = no geometry (manual placement).';
