-- ============================================================
-- HiPer Studio Stage 2 — Editable Room Schedule
-- Migration: project_rooms table
-- Run after: 20260602_auto_analyse.sql
-- Idempotent.
-- ============================================================

-- ── 1. project_rooms ─────────────────────────────────────────
-- One row per room in a designer's confirmed room schedule.
-- Seeded from AI extraction; fully editable before confirmation.
create table if not exists public.project_rooms (
  id               uuid        primary key default uuid_generate_v4(),
  project_id       uuid        not null references public.projects(id) on delete cascade,
  user_id          uuid        not null references public.profiles(id) on delete cascade,

  -- Room identity
  name             text        not null,
  floor            text,                           -- e.g. "Ground Floor", "First Floor"
  room_type        text        not null default 'other'
                     check (room_type in (
                       'bedroom','living','dining','kitchen','kitchenette',
                       'wet_area','laundry','office','gym','robe',
                       'circulation','service','other'
                     )),

  -- Airflow design
  area             numeric(7,2),                   -- m²
  classification   text        not null default 'supply'
                     check (classification in ('supply','extract','transfer','ignore')),
  bed_spaces       integer     not null default 0,
  optional_supply  boolean     not null default false,
  optional_extract boolean     not null default false,

  -- Metadata
  confidence       numeric(4,3),                   -- 0.00–1.00, null = manual entry
  source           text        not null default 'ai_extraction'
                     check (source in ('ai_extraction','manual')),
  sort_order       integer     not null default 0,

  -- Workflow state
  is_confirmed     boolean     not null default false,  -- true = designer has confirmed this schedule

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 2. Indexes ────────────────────────────────────────────────
create index if not exists project_rooms_project_id_idx
  on public.project_rooms(project_id, sort_order);

create index if not exists project_rooms_user_id_idx
  on public.project_rooms(user_id);

-- ── 3. updated_at trigger ─────────────────────────────────────
drop trigger if exists project_rooms_updated_at on public.project_rooms;

create trigger project_rooms_updated_at
  before update on public.project_rooms
  for each row execute function public.set_updated_at();

-- ── 4. Row Level Security ─────────────────────────────────────
alter table public.project_rooms enable row level security;

-- Users can read their own project rooms
drop policy if exists "project_rooms: own rows select" on public.project_rooms;
create policy "project_rooms: own rows select"
  on public.project_rooms for select
  using (user_id = auth.uid());

-- Users can insert rooms for their own projects
drop policy if exists "project_rooms: own rows insert" on public.project_rooms;
create policy "project_rooms: own rows insert"
  on public.project_rooms for insert
  with check (user_id = auth.uid());

-- Users can update their own rooms
drop policy if exists "project_rooms: own rows update" on public.project_rooms;
create policy "project_rooms: own rows update"
  on public.project_rooms for update
  using (user_id = auth.uid());

-- Users can delete their own rooms
drop policy if exists "project_rooms: own rows delete" on public.project_rooms;
create policy "project_rooms: own rows delete"
  on public.project_rooms for delete
  using (user_id = auth.uid());

-- Admins can read all
drop policy if exists "project_rooms: admin read" on public.project_rooms;
create policy "project_rooms: admin read"
  on public.project_rooms for select
  using (public.is_admin());

-- ── 5. project_schedule_confirmed column on projects ─────────
-- Tracks whether the designer has confirmed the room schedule for this project.
alter table public.projects
  add column if not exists schedule_confirmed_at timestamptz;

comment on column public.projects.schedule_confirmed_at is
  'Timestamp when the designer confirmed the room schedule (Stage 2). NULL = not yet confirmed.';

-- ── Comments ─────────────────────────────────────────────────
comment on table  public.project_rooms                    is 'Editable room schedule for a project. Seeded from AI extraction; confirmed by designer before airflow calculations.';
comment on column public.project_rooms.room_type          is 'spaceType from AI extraction: bedroom, kitchen, wet_area, etc.';
comment on column public.project_rooms.classification     is 'Ventilation classification: supply, extract, transfer, or ignore.';
comment on column public.project_rooms.bed_spaces         is 'Number of occupant bed spaces in this room (bedrooms only).';
comment on column public.project_rooms.optional_supply    is 'true = supply terminal is optional (e.g. WIR ≥ 4m²).';
comment on column public.project_rooms.optional_extract   is 'true = extract terminal is optional (e.g. utility room ≥ 2m²).';
comment on column public.project_rooms.confidence         is 'AI confidence score 0–1. NULL for manually entered rooms.';
comment on column public.project_rooms.source             is 'ai_extraction = seeded from AI; manual = added by designer.';
comment on column public.project_rooms.is_confirmed       is 'true = designer has confirmed this schedule; airflow engine reads only confirmed rows.';
