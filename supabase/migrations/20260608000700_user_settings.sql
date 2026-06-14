-- ── user_settings ────────────────────────────────────────────────────────────
-- Per-user design preferences for HiPer Studio.
-- Primary key = user_id (one row per user).

create table if not exists public.user_settings (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  preferred_unit_load_percent numeric  not null default 60
    check (preferred_unit_load_percent >= 45 and preferred_unit_load_percent <= 75),
  default_design_method      text     not null default 'passive_house'
    check (default_design_method in ('passive_house', 'as1668')),
  room_airflow_defaults      jsonb    not null default '{}',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Row Level Security: each user can only read/write their own row.
alter table public.user_settings enable row level security;

drop policy if exists "Users can manage own settings" on public.user_settings;
create policy "Users can manage own settings"
  on public.user_settings
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-update updated_at on any change.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();
