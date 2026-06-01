-- ============================================================
-- HiPer Studio — Phase 1: AI Plan Analysis
-- Run in Supabase SQL Editor AFTER supabase-companies-migration.sql
-- Idempotent: uses IF NOT EXISTS / OR REPLACE throughout.
-- ============================================================

-- ── 1. projects: add ai_analysis_json and climate_zone ──────
alter table public.projects
  add column if not exists ai_analysis_json jsonb,
  add column if not exists climate_zone      text;

comment on column public.projects.ai_analysis_json is
  'Structured output from the AI floor-plan analysis: validated room list, warnings, raw Claude response.';
comment on column public.projects.climate_zone is
  'AS/NZS climate zone string, e.g. "1" … "8" or null if not yet set.';


-- ── 2. plan_analysis_log ────────────────────────────────────
-- Immutable audit log — one row per API call to /api/ai/analyse-plan.
-- Never update rows; only insert.
create table if not exists public.plan_analysis_log (
  id                uuid        primary key default uuid_generate_v4(),
  project_id        uuid        not null references public.projects(id) on delete cascade,
  user_id           uuid        not null references public.profiles(id) on delete cascade,
  floor_index       integer     not null default 0,
  image_storage_path text,                         -- the bucket path that was analysed
  credits_deducted  integer     not null default 0,
  model_used        text        not null,           -- e.g. 'claude-opus-4-5'
  input_tokens      integer,
  output_tokens     integer,
  raw_response      text,                           -- full Claude text response (for debugging)
  parsed_rooms      jsonb,                          -- validated room array written to projects.ai_analysis_json
  climate_zone      text,                           -- climate zone extracted from image, if any
  status            text        not null default 'ok'
                      check (status in ('ok','error','insufficient_credits','invalid_image')),
  error_detail      text,
  created_at        timestamptz not null default now()
);

create index if not exists plan_analysis_log_project_id_idx
  on public.plan_analysis_log(project_id, created_at desc);

create index if not exists plan_analysis_log_user_id_idx
  on public.plan_analysis_log(user_id, created_at desc);

-- RLS: users can read their own analysis log rows; admins can read all
alter table public.plan_analysis_log enable row level security;

drop policy if exists "plan_analysis_log: own rows" on public.plan_analysis_log;
create policy "plan_analysis_log: own rows"
  on public.plan_analysis_log for select
  using (user_id = auth.uid());

drop policy if exists "plan_analysis_log: admin read" on public.plan_analysis_log;
create policy "plan_analysis_log: admin read"
  on public.plan_analysis_log for select
  using (public.is_admin());


-- ── 3. operation_costs: AI analysis operations ──────────────
insert into public.operation_costs (operation, credits, label, level) values
  ('ai_plan_analysis',        3, 'AI floor plan analysis (single storey)',  2),
  ('ai_plan_analysis_storey', 3, 'AI floor plan analysis (per storey)',     2)
on conflict (operation) do update
  set credits = excluded.credits,
      label   = excluded.label,
      level   = excluded.level;


-- ── 4. project_images: ensure floor_index has a comment ─────
comment on column public.project_images.floor_index is
  '0 = ground floor, 1 = level 1, etc. Matches the floor_index used in plan_analysis_log.';


-- ── Done ─────────────────────────────────────────────────────
-- Verify with:
--   select column_name from information_schema.columns
--     where table_name='projects' and column_name in ('ai_analysis_json','climate_zone');
--   select * from plan_analysis_log limit 0;
--   select * from operation_costs where operation like 'ai_%';
