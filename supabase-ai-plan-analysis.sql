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
  -- NULL when called from admin test mode without an associated project
  project_id        uuid        references public.projects(id) on delete set null,
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
  test_mode         boolean     not null default false, -- true = admin test run, not linked to a project
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


-- ── 5. Migration: make project_id nullable on existing tables ─
-- Safe to re-run. Applies only when the table already existed before
-- this script was updated.

-- Drop the old NOT NULL constraint (no-op if already nullable)
alter table public.plan_analysis_log
  alter column project_id drop not null;

-- Replace ON DELETE CASCADE with ON DELETE SET NULL on the FK.
-- Postgres requires dropping and re-adding the constraint to change the action.
do $$
begin
  -- Only act if the old CASCADE constraint still exists
  if exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = rc.constraint_name
    where kcu.table_name   = 'plan_analysis_log'
      and kcu.column_name  = 'project_id'
      and rc.delete_rule   = 'CASCADE'
  ) then
    alter table public.plan_analysis_log
      drop constraint if exists plan_analysis_log_project_id_fkey;
    alter table public.plan_analysis_log
      add constraint plan_analysis_log_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end $$;

-- Add test_mode column if it doesn't exist yet
alter table public.plan_analysis_log
  add column if not exists test_mode boolean not null default false;

comment on column public.plan_analysis_log.project_id is
  'NULL when the row was created by an admin test run (testMode=true) without an associated project.';
comment on column public.plan_analysis_log.test_mode is
  'true = admin test run via /admin-ai-test.html; false = normal production call.';


-- ── Done ─────────────────────────────────────────────────────
-- Verify with:
--   select column_name, is_nullable from information_schema.columns
--     where table_name='plan_analysis_log' and column_name in ('project_id','test_mode');
--   -- project_id should show is_nullable=YES
--   select * from plan_analysis_log limit 0;
--   select * from operation_costs where operation like 'ai_%';
