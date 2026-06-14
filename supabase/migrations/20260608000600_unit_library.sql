-- ============================================================
-- Unit Library migration
-- 1. user_unit_library  — user's curated list of preferred units
-- 2. mvhr_units.user_id — nullable; set for custom user-uploaded units
-- 3. airflow_designs.selected_unit_id — the unit chosen at Stage 5
-- ============================================================

-- 1. Custom unit support: allow user-owned rows in mvhr_units
alter table public.mvhr_units
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Index for efficient custom-unit lookup
create index if not exists mvhr_units_user_id_idx on public.mvhr_units(user_id);

-- RLS: standard units (user_id IS NULL) readable by everyone;
--      custom units readable only by the owning user
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'mvhr_units' and policyname = 'mvhr_units_read'
  ) then
    create policy "mvhr_units_read" on public.mvhr_units
      for select using (user_id is null or auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'mvhr_units' and policyname = 'mvhr_units_owner'
  ) then
    create policy "mvhr_units_owner" on public.mvhr_units
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- 2. user_unit_library junction table
create table if not exists public.user_unit_library (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  unit_id    uuid not null references public.mvhr_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, unit_id)
);

alter table public.user_unit_library enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'user_unit_library' and policyname = 'user_unit_library_self'
  ) then
    create policy "user_unit_library_self" on public.user_unit_library
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists user_unit_library_user_idx on public.user_unit_library(user_id);

-- 3. Selected unit on airflow designs
alter table public.airflow_designs
  add column if not exists selected_unit_id uuid references public.mvhr_units(id) on delete set null;
