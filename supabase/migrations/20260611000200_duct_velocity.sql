-- ============================================================
-- P2.3: Duct velocity analysis
-- Adds velocity_m_s to duct_runs so the engine can stamp
-- computed velocity on every run at generation time.
-- run_category is stored in existing metadata jsonb column.
-- ============================================================

alter table public.duct_runs
  add column if not exists velocity_m_s numeric(4,2);

comment on column public.duct_runs.velocity_m_s is
  'Air velocity computed at generation time (m/s). '
  'Compared against PH limits: main ≤ 3.0, branch ≤ 2.5, terminal ≤ 2.0 m/s. '
  'NULL on runs created before P2.3 or on manually-drawn runs until regenerated.';
