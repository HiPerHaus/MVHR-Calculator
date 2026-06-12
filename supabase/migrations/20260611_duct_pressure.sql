-- ============================================================
-- P2.1: Duct pressure analysis
-- Adds flow_m3h to duct_runs so the pressure engine has
-- an explicit flow value without deriving from velocity.
-- pressure_drop_pa already exists (from 20260608_duct_design.sql).
-- ============================================================

alter table public.duct_runs
  add column if not exists flow_m3h numeric(8,2);

comment on column public.duct_runs.flow_m3h is
  'Air volume flow on this run at generation time (m³/h). '
  'Stamped by the duct-design API alongside velocity_m_s. '
  'NULL on runs created before P2.1 or on manually-drawn runs.';

comment on column public.duct_runs.pressure_drop_pa is
  'Darcy-Weisbach friction pressure drop (Pa) including 50% fitting '
  'allowance. Stamped at generation time. Re-run layout to update.';
