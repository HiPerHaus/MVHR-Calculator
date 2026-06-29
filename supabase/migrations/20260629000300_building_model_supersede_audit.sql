-- ============================================================
-- HiPer Studio — F3A: Building Model supersede audit fields
--
-- Adds explicit supersede provenance so the DBM lifecycle is auditable:
--   approved_by / approved_at already exist (F1).
--   superseded_by / superseded_at added here.
--
-- Additive + idempotent. No data backfilled; existing models keep NULLs.
-- ============================================================

alter table public.building_models
  add column if not exists superseded_by uuid references public.building_models(id) on delete set null,
  add column if not exists superseded_at timestamptz;

comment on column public.building_models.superseded_by is
  'The model that replaced this one (set when a newer model is approved, or on manual supersede). NULL if still live or auto-replaced by a draft.';
comment on column public.building_models.superseded_at is
  'When this model was superseded/retired. NULL while live.';

notify pgrst, 'reload schema';
