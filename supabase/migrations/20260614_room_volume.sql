-- ============================================================
-- HiPer Studio — Room volume for the ACH check
-- Builds on 20260611_engine_correctness.sql (which added ceiling_height_m).
--   - project_rooms.ceiling_height_m: default 2.4 (was NULL)
--   - backfill existing NULL ceiling heights to 2.4
--   - generated project_rooms.volume_m3 = area × ceiling_height_m
-- Editable per room later; 2.4 m is the engine default.
-- Idempotent.
-- ============================================================

-- Default ceiling height → 2.4 m (engine default), keep the 2.0–6.0 check.
alter table public.project_rooms
  alter column ceiling_height_m set default 2.4;

-- Backfill rooms created before this default existed.
update public.project_rooms
  set ceiling_height_m = 2.4
  where ceiling_height_m is null;

-- Generated treated volume (m³). NULL when area is NULL (surfaced as a warning in the UI).
alter table public.project_rooms
  add column if not exists volume_m3 numeric(10,2)
    generated always as (area * coalesce(ceiling_height_m, 2.4)) stored;

comment on column public.project_rooms.volume_m3 is
  'Generated: treated room volume (m³) = area × ceiling_height_m (default 2.4). NULL when area is NULL.';
