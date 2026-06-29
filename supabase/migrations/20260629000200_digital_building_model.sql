-- ============================================================
-- HiPer Studio — F1: Digital Building Model (DBM) foundation
--
-- Canonical, versioned, per-project building geometry that engineering
-- modules will consume. This migration is ADDITIVE ONLY: it creates new
-- tables and does NOT touch project_rooms or building_volume_* tables.
-- Nothing consumes these tables yet (read API lands alongside; derivation
-- in F2). MVHR and Building Volume behaviour are unchanged.
--
-- Pattern generalised from building_volume_calculations:
--   version + is_current + status lifecycle + source provenance +
--   original (immutable) vs current (edited) JSON + audit events.
--
-- Idempotent: create table/index if not exists; drop+create policies.
-- ============================================================

-- ── 1. building_models (root) ───────────────────────────────
create table if not exists public.building_models (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Versioning + lifecycle (mirrors building_volume_calculations)
  version       integer not null default 1,
  is_current    boolean not null default true,
  status        text not null default 'draft'
                  check (status in ('draft','needs_review','approved','superseded')),

  -- Provenance: how this model was produced
  source_type   text not null default 'derived'
                  check (source_type in ('pdf','cad','manual','imported','derived')),
  schema_version text not null default 'dbm-1',
  -- Pointers to the inputs this model was derived/imported from (F2 fills this).
  derived_from  jsonb not null default '{}'::jsonb,

  -- Rollups (kept on the root for cheap module reads; children hold detail)
  conditioned_floor_area_m2 numeric(10,2) not null default 0 check (conditioned_floor_area_m2 >= 0),
  building_volume_m3        numeric(10,2) not null default 0 check (building_volume_m3 >= 0),
  airtightness_layer        text,
  storey_count              integer,

  -- Confidence / provenance / audit payloads
  ai_confidence numeric(4,3) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  assumptions   jsonb not null default '[]'::jsonb,
  warnings      jsonb not null default '[]'::jsonb,
  original_ai_json jsonb,                          -- unedited import; never overwritten
  current_json     jsonb not null default '{}'::jsonb,

  -- Approval
  approved_at   timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One current model per project.
create unique index if not exists building_models_one_current_per_project
  on public.building_models(project_id)
  where is_current;

create index if not exists building_models_project_created_idx
  on public.building_models(project_id, created_at desc);

create index if not exists building_models_project_status_version_idx
  on public.building_models(project_id, status, version desc);

drop trigger if exists building_models_updated_at on public.building_models;
create trigger building_models_updated_at
  before update on public.building_models
  for each row execute function public.set_updated_at();


-- ── 2. building_model_levels (storeys / floor levels) ───────
create table if not exists public.building_model_levels (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.building_models(id) on delete cascade,
  level_index   integer not null default 0,        -- 0 = ground, 1 = first, …
  name          text not null default 'Ground Floor',
  elevation_m   numeric(7,3),                       -- finished floor level, optional
  default_ceiling_height_m numeric(4,2)
                  check (default_ceiling_height_m is null or (default_ceiling_height_m >= 1.8 and default_ceiling_height_m <= 8.0)),
  source        text not null default 'derived',
  created_at    timestamptz not null default now()
);

create index if not exists building_model_levels_model_idx
  on public.building_model_levels(model_id, level_index);


-- ── 3. building_model_rooms ─────────────────────────────────
-- The shared room geometry MVHR (and others) will read. Populated in F2
-- from project_rooms; CAD/PDF pipelines repoint here in F3/F4.
create table if not exists public.building_model_rooms (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.building_models(id) on delete cascade,
  level_index   integer not null default 0,

  name          text not null,
  room_type     text not null default 'other',
  classification text not null default 'supply'
                  check (classification in ('supply','extract','transfer','ignore')),

  -- Geometry: polygon is CAD-first (jsonb array of [x,y]); may be null for PDF.
  polygon       jsonb,
  bbox          jsonb,
  area_m2       numeric(10,2),
  ceiling_height_m numeric(4,2)
                  check (ceiling_height_m is null or (ceiling_height_m >= 1.8 and ceiling_height_m <= 8.0)),
  volume_m3     numeric(10,2),

  -- Envelope membership (consumed by Building Volume / airtightness)
  included_in_envelope boolean not null default true,
  exclusion_reason text,
  bed_spaces    integer not null default 0,

  -- Provenance
  confidence    numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence      text,
  source        text not null default 'derived'
                  check (source in ('ai_pdf','ai_cad','manual','derived','imported')),
  source_room_id uuid,                              -- traceability → project_rooms.id (no FK; soft link)
  manually_edited boolean not null default false,
  sort_order    integer not null default 0,
  source_json   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists building_model_rooms_model_idx
  on public.building_model_rooms(model_id, sort_order);


-- ── 4. building_model_zones (envelope / excluded groupings) ──
create table if not exists public.building_model_zones (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.building_models(id) on delete cascade,
  zone_key      text,
  name          text not null,
  kind          text not null default 'envelope'
                  check (kind in ('envelope','excluded')),
  category      text,                               -- garage|alfresco|verandah|roof_void|plant|wet|kitchen|…
  level         text,
  area_m2       numeric(10,2) not null default 0 check (area_m2 >= 0),
  height_m      numeric(4,2) not null default 2.4 check (height_m >= 1.8 and height_m <= 8.0),
  volume_m3     numeric(10,2) not null default 0 check (volume_m3 >= 0),
  included      boolean not null default true,
  confidence    numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence      text,
  source        text not null default 'derived',
  source_zone_id uuid,                              -- traceability → building_volume_zones.id (soft link)
  source_json   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists building_model_zones_model_idx
  on public.building_model_zones(model_id);


-- ── 5. building_model_walls (CAD-first; optional for PDF) ────
create table if not exists public.building_model_walls (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.building_models(id) on delete cascade,
  level_index   integer not null default 0,
  kind          text not null default 'internal'
                  check (kind in ('external','internal')),
  polyline      jsonb,                              -- array of [x,y]
  thickness_mm  numeric(7,1),
  source        text not null default 'derived',
  created_at    timestamptz not null default now()
);

create index if not exists building_model_walls_model_idx
  on public.building_model_walls(model_id, level_index);


-- ── 6. building_model_openings (CAD-first; optional for PDF) ─
create table if not exists public.building_model_openings (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.building_models(id) on delete cascade,
  wall_id       uuid references public.building_model_walls(id) on delete set null,
  level_index   integer not null default 0,
  kind          text not null default 'window'
                  check (kind in ('window','door')),
  width_mm      numeric(8,1),
  height_mm     numeric(8,1),
  sill_mm       numeric(8,1),
  source        text not null default 'derived',
  created_at    timestamptz not null default now()
);

create index if not exists building_model_openings_model_idx
  on public.building_model_openings(model_id, level_index);


-- ── 7. building_model_events (audit + manual-edit log) ──────
create table if not exists public.building_model_events (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.building_models(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  event_type    text not null
                  check (event_type in ('created','derived','edited','approved','superseded','imported')),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists building_model_events_model_idx
  on public.building_model_events(model_id, created_at desc);


-- ── 8. Row Level Security ───────────────────────────────────
-- API routes use the service role (bypass RLS) and enforce ownership in code
-- via lib/requireProjectOwner.js. These policies guard any direct client read.
-- Select-only, mirroring building_volume_calculations.

alter table public.building_models          enable row level security;
alter table public.building_model_levels    enable row level security;
alter table public.building_model_rooms     enable row level security;
alter table public.building_model_zones     enable row level security;
alter table public.building_model_walls     enable row level security;
alter table public.building_model_openings  enable row level security;
alter table public.building_model_events    enable row level security;

-- Root: owner select + admin read
drop policy if exists "building_models: own select" on public.building_models;
create policy "building_models: own select"
  on public.building_models for select
  using (auth.uid() = user_id);

drop policy if exists "building_models: admin read" on public.building_models;
create policy "building_models: admin read"
  on public.building_models for select
  using (public.is_admin());

-- Child tables: owner select via parent model ownership
do $$
declare t text;
begin
  foreach t in array array[
    'building_model_levels',
    'building_model_rooms',
    'building_model_zones',
    'building_model_walls',
    'building_model_openings',
    'building_model_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || ': own select', t);
    execute format($f$
      create policy %I on public.%I for select
      using (exists (
        select 1 from public.building_models m
        where m.id = %I.model_id and m.user_id = auth.uid()
      ))
    $f$, t || ': own select', t, t);

    execute format('drop policy if exists %I on public.%I', t || ': admin read', t);
    execute format($f$
      create policy %I on public.%I for select
      using (public.is_admin())
    $f$, t || ': admin read', t);
  end loop;
end $$;


-- ── 9. Comments ─────────────────────────────────────────────
comment on table public.building_models is
  'F1 Digital Building Model: canonical, versioned, per-project building geometry consumed by engineering modules. Additive — does not replace project_rooms/building_volume_* yet.';
comment on column public.building_models.status is
  'Lifecycle: draft, needs_review, approved, superseded. Modules will consume the latest approved model.';
comment on column public.building_models.source_type is
  'How the model was produced: pdf, cad, manual, imported, or derived (F2 backfill from existing data).';
comment on column public.building_models.derived_from is
  'Provenance pointers, e.g. {"project_rooms": true, "building_volume_calculation_id": "..."}.';
comment on column public.building_models.original_ai_json is
  'Immutable original import. Never overwritten; edits are layered on children + current_json.';
comment on column public.building_model_rooms.source_room_id is
  'Soft link to project_rooms.id for traceability during the F2 derivation. No FK (project_rooms remains independent).';
comment on column public.building_model_zones.source_zone_id is
  'Soft link to building_volume_zones.id for traceability during the F2 derivation.';

notify pgrst, 'reload schema';
