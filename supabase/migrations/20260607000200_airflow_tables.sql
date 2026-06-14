-- ============================================================
-- HiPer Studio Stage 3 — Airflow Design
-- Migration: airflow_designs + airflow_rooms tables
-- Run after: 20260606_project_rooms.sql
-- Idempotent.
-- ============================================================

-- ── 1. airflow_designs ───────────────────────────────────────
-- One row per saved airflow design for a project.
-- A project may have multiple designs (e.g. re-runs after edits),
-- but the most recent one is the canonical design for Stage 3.
create table if not exists public.airflow_designs (
  id                      uuid        primary key default uuid_generate_v4(),
  project_id              uuid        not null references public.projects(id) on delete cascade,
  user_id                 uuid        not null references public.profiles(id) on delete cascade,

  -- Design parameters
  design_method           text        not null default 'passive_house'
                            check (design_method in ('passive_house','as1668')),

  -- Totals before balancing
  total_supply_lps        numeric(8,2) not null default 0,
  total_extract_lps       numeric(8,2) not null default 0,

  -- Balancing
  balance_adjustment_lps  numeric(8,2) not null default 0,
  balance_status          text        not null default 'balanced'
                            check (balance_status in ('balanced','minor_adjustment','major_imbalance')),

  -- Final design airflow
  design_airflow_lps      numeric(8,2) not null default 0,
  design_airflow_m3h      numeric(8,2) not null default 0,

  -- Audit
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ── 2. airflow_rooms ─────────────────────────────────────────
-- One row per room in a saved airflow design.
create table if not exists public.airflow_rooms (
  id                  uuid        primary key default uuid_generate_v4(),
  airflow_design_id   uuid        not null references public.airflow_designs(id) on delete cascade,
  project_room_id     uuid        references public.project_rooms(id) on delete set null,

  -- Room identity (denormalised for portability)
  room_name           text        not null,
  room_type           text        not null,
  floor               text,

  -- Airflow rates
  supply_lps          numeric(7,2) not null default 0,
  extract_lps         numeric(7,2) not null default 0,

  -- Metadata
  airflow_driver      text,       -- e.g. "occupancy:2", "ach_0.35", "fixed"
  notes               text,

  sort_order          integer     not null default 0,
  created_at          timestamptz not null default now()
);

-- ── 3. Indexes ────────────────────────────────────────────────
create index if not exists airflow_designs_project_id_idx
  on public.airflow_designs(project_id, created_at desc);

create index if not exists airflow_designs_user_id_idx
  on public.airflow_designs(user_id);

create index if not exists airflow_rooms_design_id_idx
  on public.airflow_rooms(airflow_design_id, sort_order);

-- ── 4. updated_at trigger ─────────────────────────────────────
drop trigger if exists airflow_designs_updated_at on public.airflow_designs;

create trigger airflow_designs_updated_at
  before update on public.airflow_designs
  for each row execute function public.set_updated_at();

-- ── 5. Row Level Security ─────────────────────────────────────
alter table public.airflow_designs enable row level security;
alter table public.airflow_rooms    enable row level security;

-- airflow_designs policies
drop policy if exists "airflow_designs: own rows select" on public.airflow_designs;
create policy "airflow_designs: own rows select"
  on public.airflow_designs for select using (user_id = auth.uid());

drop policy if exists "airflow_designs: own rows insert" on public.airflow_designs;
create policy "airflow_designs: own rows insert"
  on public.airflow_designs for insert with check (user_id = auth.uid());

drop policy if exists "airflow_designs: own rows update" on public.airflow_designs;
create policy "airflow_designs: own rows update"
  on public.airflow_designs for update using (user_id = auth.uid());

drop policy if exists "airflow_designs: own rows delete" on public.airflow_designs;
create policy "airflow_designs: own rows delete"
  on public.airflow_designs for delete using (user_id = auth.uid());

drop policy if exists "airflow_designs: admin read" on public.airflow_designs;
create policy "airflow_designs: admin read"
  on public.airflow_designs for select using (public.is_admin());

-- airflow_rooms policies — scoped via design ownership
drop policy if exists "airflow_rooms: own rows select" on public.airflow_rooms;
create policy "airflow_rooms: own rows select"
  on public.airflow_rooms for select
  using (
    exists (
      select 1 from public.airflow_designs d
      where d.id = airflow_design_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "airflow_rooms: own rows insert" on public.airflow_rooms;
create policy "airflow_rooms: own rows insert"
  on public.airflow_rooms for insert
  with check (
    exists (
      select 1 from public.airflow_designs d
      where d.id = airflow_design_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "airflow_rooms: own rows delete" on public.airflow_rooms;
create policy "airflow_rooms: own rows delete"
  on public.airflow_rooms for delete
  using (
    exists (
      select 1 from public.airflow_designs d
      where d.id = airflow_design_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "airflow_rooms: admin read" on public.airflow_rooms;
create policy "airflow_rooms: admin read"
  on public.airflow_rooms for select using (public.is_admin());

-- ── 6. airflow_confirmed_at column on projects ────────────────
alter table public.projects
  add column if not exists airflow_confirmed_at timestamptz;

comment on column public.projects.airflow_confirmed_at is
  'Timestamp when the designer confirmed the airflow design (Stage 3). NULL = not yet confirmed.';

-- ── Comments ─────────────────────────────────────────────────
comment on table  public.airflow_designs                          is 'Saved airflow design for a project. Produced by Stage 3 calculation engine.';
comment on column public.airflow_designs.design_method           is 'passive_house or as1668.';
comment on column public.airflow_designs.balance_adjustment_lps  is 'l/s applied to living/dining to balance supply vs extract. Positive = added supply.';
comment on column public.airflow_designs.balance_status          is 'balanced | minor_adjustment (≤10%) | major_imbalance (>10%).';
comment on column public.airflow_designs.design_airflow_lps      is 'Final design airflow: max(totalSupply, totalExtract) after balancing.';
comment on column public.airflow_designs.design_airflow_m3h      is 'design_airflow_lps × 3.6.';
comment on table  public.airflow_rooms                           is 'Per-room airflow rates for a saved airflow design.';
comment on column public.airflow_rooms.airflow_driver            is 'Human-readable reason: e.g. occupancy:2, ach_0.35, fixed_30, area_calc.';
