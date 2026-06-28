-- HiPer Studio — Canonical building volume calculations
-- Stores project-level airtight geometry for blower-door testing and downstream tools.

create table if not exists public.building_volume_calculations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 1,
  is_current boolean not null default true,
  source_type text not null default 'manual'
    check (source_type in ('ai_image', 'manual', 'imported', 'pdf')),
  airtightness_layer text not null default 'plasterboard',
  default_ceiling_height_m numeric(4,2)
    check (default_ceiling_height_m is null or (default_ceiling_height_m >= 1.8 and default_ceiling_height_m <= 8.0)),
  conditioned_floor_area_m2 numeric(10,2) not null default 0
    check (conditioned_floor_area_m2 >= 0),
  building_volume_m3 numeric(10,2) not null default 0
    check (building_volume_m3 >= 0),
  ai_confidence numeric(4,3)
    check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  assumptions jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  original_ai_json jsonb,
  current_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.building_volume_zones (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references public.building_volume_calculations(id) on delete cascade,
  zone_key text,
  name text not null,
  level text,
  area_m2 numeric(10,2) not null default 0 check (area_m2 >= 0),
  height_m numeric(4,2) not null default 2.4 check (height_m >= 1.8 and height_m <= 8.0),
  volume_m3 numeric(10,2) not null default 0 check (volume_m3 >= 0),
  included boolean not null default true,
  ai_confidence numeric(4,3) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  evidence text,
  source_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.building_volume_calculation_events (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references public.building_volume_calculations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'edited', 'superseded')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists building_volume_one_current_per_project
  on public.building_volume_calculations(project_id)
  where is_current;

create index if not exists building_volume_project_created_idx
  on public.building_volume_calculations(project_id, created_at desc);

create index if not exists building_volume_zones_calculation_idx
  on public.building_volume_zones(calculation_id);

alter table public.building_volume_calculations enable row level security;
alter table public.building_volume_zones enable row level security;
alter table public.building_volume_calculation_events enable row level security;

drop policy if exists "Users can read own building volume calculations" on public.building_volume_calculations;
create policy "Users can read own building volume calculations"
  on public.building_volume_calculations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own building volume zones" on public.building_volume_zones;
create policy "Users can read own building volume zones"
  on public.building_volume_zones for select
  using (
    exists (
      select 1 from public.building_volume_calculations c
      where c.id = building_volume_zones.calculation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can read own building volume events" on public.building_volume_calculation_events;
create policy "Users can read own building volume events"
  on public.building_volume_calculation_events for select
  using (auth.uid() = user_id);

comment on table public.building_volume_calculations is
  'Versioned project-level airtight building geometry used for blower-door volume and downstream design tools.';
comment on column public.building_volume_calculations.building_volume_m3 is
  'Current edited airtight building volume in cubic metres.';
comment on column public.building_volume_calculations.original_ai_json is
  'Unedited AI extraction response, retained for audit.';
comment on column public.building_volume_calculations.current_json is
  'Current edited user-facing calculation snapshot.';
