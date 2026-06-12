-- ============================================================
-- Task #35: Configurable MVHR boost methodology + fan speed
--
-- Adds boost/fan-speed settings columns to:
--   1. user_settings   — company-level defaults
--   2. projects        — per-project overrides (nullable; NULL = inherit from user_settings)
--   3. airflow_designs — persisted engine output for these fields
-- ============================================================

-- ── 1. user_settings ─────────────────────────────────────────
alter table user_settings
  add column if not exists boost_method             text    check (boost_method in ('percentage','room_based')),
  add column if not exists boost_airflow_offset_pct integer,
  add column if not exists low_airflow_offset_pct   integer;

comment on column user_settings.boost_method             is 'Boost airflow methodology: percentage (default) or room_based';
comment on column user_settings.boost_airflow_offset_pct is '+% above design airflow for boost speed (default 30 → +30%)';
comment on column user_settings.low_airflow_offset_pct   is '−% below design airflow for low speed (default -30 → −30%)';

-- ── 2. projects ───────────────────────────────────────────────
alter table projects
  add column if not exists boost_method             text    check (boost_method in ('percentage','room_based')),
  add column if not exists boost_airflow_offset_pct integer,
  add column if not exists low_airflow_offset_pct   integer;

comment on column projects.boost_method             is 'Per-project boost methodology override (NULL = inherit from user_settings)';
comment on column projects.boost_airflow_offset_pct is 'Per-project boost offset override (NULL = inherit from user_settings)';
comment on column projects.low_airflow_offset_pct   is 'Per-project low-speed offset override (NULL = inherit from user_settings)';

-- ── 3. airflow_designs ────────────────────────────────────────
alter table airflow_designs
  add column if not exists low_flow_m3h               numeric(8,1),
  add column if not exists room_boost_demand_m3h       numeric(8,1),
  add column if not exists boost_method               text    check (boost_method in ('percentage','room_based')),
  add column if not exists boost_airflow_offset_pct   integer,
  add column if not exists low_airflow_offset_pct     integer,
  add column if not exists boost_warning              boolean default false;

comment on column airflow_designs.low_flow_m3h             is 'Low fan-speed target (m³/h) = design × (1 + low_airflow_offset_pct/100)';
comment on column airflow_designs.room_boost_demand_m3h    is 'Room-based boost demand (m³/h) — always computed, used for boost_warning validation';
comment on column airflow_designs.boost_method             is 'Methodology used to derive boost_flow_m3h for this design';
comment on column airflow_designs.boost_airflow_offset_pct is 'Boost offset % used in this design calculation';
comment on column airflow_designs.low_airflow_offset_pct   is 'Low-speed offset % used in this design calculation';
comment on column airflow_designs.boost_warning            is 'True when room_boost_demand_m3h > boost_flow_m3h (boost capacity may be insufficient)';

-- Notify PostgREST to reload its schema cache
notify pgrst, 'reload schema';
