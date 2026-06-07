-- ============================================================
-- HiPer Studio Stage 3 — Airflow Design Basis columns
-- Adds whole-house design method breakdown to airflow_designs.
-- Run after: 20260607_airflow_tables.sql
-- Idempotent.
-- ============================================================

alter table public.airflow_designs
  add column if not exists occupancy_count     integer,
  add column if not exists treated_area_m2     numeric(8,2),
  add column if not exists occupancy_flow_m3h  numeric(8,2),
  add column if not exists area_flow_m3h       numeric(8,2),
  add column if not exists wet_room_flow_m3h   numeric(8,2),
  add column if not exists area_data_available boolean not null default false;

comment on column public.airflow_designs.occupancy_count    is 'Total bed-spaces from confirmed room schedule.';
comment on column public.airflow_designs.treated_area_m2    is 'Sum of treated floor area (m²) from confirmed rooms (excludes ignored rooms and rooms with area = 0).';
comment on column public.airflow_designs.occupancy_flow_m3h is 'Occupancy-based design flow: occupancy_count × 30 m³/h.';
comment on column public.airflow_designs.area_flow_m3h      is 'Area-based design flow: treatedVolume × ACH. NULL if no area data available.';
comment on column public.airflow_designs.wet_room_flow_m3h  is 'Sum of extract requirements from all wet rooms, kitchen, and laundry.';
comment on column public.airflow_designs.area_data_available is 'false when all confirmed rooms have area = 0 or NULL; occupancy method used as fallback.';
