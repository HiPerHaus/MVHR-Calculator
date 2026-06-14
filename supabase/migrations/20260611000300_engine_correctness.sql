-- ============================================================
-- HiPer Studio Phase 1 — Engine Correctness
-- Adds:
--   project_rooms.ceiling_height_m           (P1.3 ACH check)
--   airflow_designs.extract_demand_m3h       (P1.2 design-flow basis)
--   airflow_designs.boost_flow_m3h           (P1.2 — replaces wet_room_flow_m3h for boost)
--   airflow_designs.total_volume_m3          (P1.3)
--   airflow_designs.ach_at_design            (P1.3)
--   airflow_designs.ach_passes               (P1.3)
--   airflow_designs.engine_version           (P1.1 — stamps every design row)
--   airflow_designs.ph_override_justification(P1.4 — required when selecting non-PH unit)
-- Run after: 20260610_add_boost_extract_to_airflow_rooms.sql
-- Idempotent.
-- ============================================================

-- ── project_rooms ─────────────────────────────────────────────
alter table public.project_rooms
  add column if not exists ceiling_height_m numeric(4,2)
    default null
    check (ceiling_height_m is null or (ceiling_height_m >= 2.0 and ceiling_height_m <= 6.0));

-- ── airflow_designs — design-flow basis ──────────────────────
-- P1.2: store extract demand separately from boost (wet_room_flow_m3h kept for backward compat)
alter table public.airflow_designs
  add column if not exists extract_demand_m3h numeric(8,2);

-- P1.2: explicit boost demand column so GET can use correct value for unit scoring
alter table public.airflow_designs
  add column if not exists boost_flow_m3h numeric(8,2);

-- P1.3: ACH compliance
alter table public.airflow_designs
  add column if not exists total_volume_m3 numeric(10,2);

alter table public.airflow_designs
  add column if not exists ach_at_design numeric(5,3);

alter table public.airflow_designs
  add column if not exists ach_passes boolean;

-- P1.1: engine version stamp
alter table public.airflow_designs
  add column if not exists engine_version text;

-- P1.4: PH compliance override justification
alter table public.airflow_designs
  add column if not exists ph_override_justification text;

-- Keep balance_status consistent — add 'manual_review' to the check constraint
-- (old constraint only included 'balanced', 'minor_adjustment', 'major_imbalance')
alter table public.airflow_designs
  drop constraint if exists airflow_designs_balance_status_check;
alter table public.airflow_designs
  add constraint airflow_designs_balance_status_check
    check (balance_status in ('balanced','minor_adjustment','major_imbalance','manual_review'));

COMMENT ON COLUMN public.airflow_designs.extract_demand_m3h IS 'Sum of continuous extract rates (m3/h) - wet-side demand criterion.';

COMMENT ON COLUMN public.airflow_designs.boost_flow_m3h IS 'Sum of peak/boost extract rates (m3/h) - used for MVHR boost capacity check.';

COMMENT ON COLUMN public.airflow_designs.total_volume_m3 IS 'Treated volume = sum(area x ceiling_height) for habitable rooms (m3).';

COMMENT ON COLUMN public.airflow_designs.ach_at_design IS 'Air changes per hour at the chosen design airflow. Must be >= 0.30 for PHI compliance.';

COMMENT ON COLUMN public.airflow_designs.ach_passes IS 'true when ach_at_design >= 0.30. NULL when no volume data available.';

COMMENT ON COLUMN public.airflow_designs.engine_version IS 'Version of @hiper/engine that produced this design row.';

COMMENT ON COLUMN public.airflow_designs.ph_override_justification IS 'Designer-provided justification for selecting a non-PHI-compliant MVHR unit.';
