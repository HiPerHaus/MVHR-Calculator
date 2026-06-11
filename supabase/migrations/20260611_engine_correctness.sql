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

comment on column public.project_rooms.ceiling_height_m is
  'Room ceiling height (m). NULL = use engine default (2.4 m). '
  'Used to compute treated volume for the PHI 0.30 ACH minimum check.';

-- ── airflow_designs — design-flow basis ──────────────────────
-- P1.2: store extract demand separately from boost (wet_room_flow_m3h kept for backward compat)
alter table public.airflow_designs
  add column if not exists extract_demand_m3h numeric(8,2)
    comment 'Sum of continuous extract rates (m³/h) — the wet-side demand criterion. '
            'One of four candidates for design_airflow_m3h per PHI methodology.';

-- P1.2: explicit boost demand column so GET can use correct value for unit scoring
alter table public.airflow_designs
  add column if not exists boost_flow_m3h numeric(8,2)
    comment 'Sum of peak/boost extract rates (m³/h) — used for MVHR boost capacity check.';

-- P1.3: ACH compliance
alter table public.airflow_designs
  add column if not exists total_volume_m3 numeric(10,2)
    comment 'Treated volume = sum(area × ceiling_height) for habitable rooms (m³).';

alter table public.airflow_designs
  add column if not exists ach_at_design numeric(5,3)
    comment 'Air changes per hour at the chosen design airflow. Must be ≥ 0.30 for PHI compliance.';

alter table public.airflow_designs
  add column if not exists ach_passes boolean
    comment 'true when ach_at_design >= 0.30 (PHI minimum). NULL when no volume data available.';

-- P1.1: engine version stamp
alter table public.airflow_designs
  add column if not exists engine_version text
    comment 'Version of @hiper/engine that produced this design row (e.g. "1.0.0").';

-- P1.4: PH compliance override justification
alter table public.airflow_designs
  add column if not exists ph_override_justification text
    comment 'Designer-provided justification for selecting a non-PHI-compliant MVHR unit. '
            'Required when selected unit has ph_compliant=false. '
            'NULL when selected unit is PHI-compliant or no unit selected yet.';

-- Keep balance_status consistent — add 'manual_review' to the check constraint
-- (old constraint only included 'balanced', 'minor_adjustment', 'major_imbalance')
alter table public.airflow_designs
  drop constraint if exists airflow_designs_balance_status_check;
alter table public.airflow_designs
  add constraint airflow_designs_balance_status_check
    check (balance_status in ('balanced','minor_adjustment','major_imbalance','manual_review'));
