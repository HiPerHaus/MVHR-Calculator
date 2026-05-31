-- ============================================================
-- HiPer Haus MVHR Design Engine — Supabase Schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New Query)
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";


-- ── Profiles ────────────────────────────────────────────────
-- One row per authenticated user. Created automatically via trigger.
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text,
  company_name    text,
  credit_balance  integer not null default 0 check (credit_balance >= 0),
  plan_type       text not null default 'credit_only'
                    check (plan_type in ('credit_only','designer','professional')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ── Credit packages ──────────────────────────────────────────
-- Static reference table — seeded below. Not user-editable.
create table public.credit_packages (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  credits         integer not null,
  price_aud       numeric(8,2) not null,
  stripe_price_id text,                -- filled after Stripe product creation
  active          boolean not null default true,
  sort_order      integer not null default 0
);

-- Seed packages
insert into public.credit_packages (name, credits, price_aud, sort_order) values
  ('Starter',      10,  199.00, 1),
  ('Professional', 50,  799.00, 2),
  ('Business',     150, 1999.00, 3);


-- ── Credit transactions ──────────────────────────────────────
-- Immutable ledger. Never update rows — only insert.
create table public.credit_transactions (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  delta             integer not null,            -- positive = credit, negative = spend
  operation         text not null,               -- 'purchase' | 'basic_design' | 'pressure_loss' | ...
  description       text,
  project_id        uuid,                        -- nullable FK — set after projects table exists
  stripe_payment_id text,                        -- idempotency: prevent double-credit on webhook replay
  source            text not null default 'user_purchase'
                      check (source in ('user_purchase','promotional','sponsor','admin')),
  created_at        timestamptz not null default now()
);

-- Index for balance recalculation and history display
create index credit_transactions_user_id_idx on public.credit_transactions(user_id, created_at desc);
create unique index credit_transactions_stripe_payment_idx
  on public.credit_transactions(stripe_payment_id)
  where stripe_payment_id is not null;           -- prevents duplicate webhook crediting


-- ── Projects ────────────────────────────────────────────────
create table public.projects (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null default 'Untitled Project',
  state_json      jsonb,                         -- full form state (rooms, settings, etc.)
  plan_state_json jsonb,                         -- plan canvas state (rooms, ducts, scale)
  storey_count    integer not null default 1,
  thumbnail_url   text,                          -- optional: small canvas snapshot for project list
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index projects_user_id_idx on public.projects(user_id, updated_at desc);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Now we can add the FK from credit_transactions → projects
alter table public.credit_transactions
  add constraint credit_transactions_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;


-- ── Project images ───────────────────────────────────────────
-- Floor plan images stored in Supabase Storage (bucket: plan-images).
-- This table tracks which bucket paths belong to which project/floor.
create table public.project_images (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  floor_index     integer not null default 0,    -- 0=ground, 1=level 1, etc.
  storage_path    text not null,                 -- e.g. '{user_id}/{project_id}/floor_0.png'
  created_at      timestamptz not null default now(),
  unique (project_id, floor_index)               -- one image per floor per project
);

create index project_images_project_id_idx on public.project_images(project_id);


-- ── Design operations (credit cost reference) ────────────────
-- Reference table for what each operation costs. Editable by admin.
create table public.operation_costs (
  operation       text primary key,
  credits         integer not null,
  label           text not null,
  level           integer not null default 1      -- 1=core, 2=engineering, 3=premium
);

insert into public.operation_costs (operation, credits, label, level) values
  ('basic_design',         5,  'Basic residential MVHR design',  1),
  ('passive_house',        8,  'Passive House design',            2),
  ('commercial',           15, 'Commercial project design',       3),
  ('pressure_loss',        2,  'Pressure loss calculations',      2),
  ('acoustic',             1,  'Acoustic calculations',           2),
  ('commissioning_sheet',  1,  'Commissioning sheet',             2),
  ('detailed_duct_sched',  2,  'Detailed duct schedule',          2),
  ('semi_rigid_layout',    2,  'Semi-rigid duct layout',          2),
  ('auto_duct_routing',    3,  'Auto duct routing',               3),
  ('full_report_pack',     2,  'Full report pack',                2),
  ('revision',             1,  'Revision after issue',            1);


-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles           enable row level security;
alter table public.credit_packages    enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.projects           enable row level security;
alter table public.project_images     enable row level security;
alter table public.operation_costs    enable row level security;

-- profiles: users can read/update their own row only
create policy "profiles: own row" on public.profiles
  for all using (auth.uid() = id);

-- credit_packages: everyone can read (for pricing page)
create policy "credit_packages: public read" on public.credit_packages
  for select using (true);

-- credit_transactions: users see only their own
create policy "credit_transactions: own rows" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- Inserts to credit_transactions must go via server-side functions only
-- (anon/authenticated roles cannot insert directly — use service_role in API routes)

-- projects: full CRUD on own projects
create policy "projects: own rows" on public.projects
  for all using (auth.uid() = user_id);

-- project_images: full CRUD on own images
create policy "project_images: own rows" on public.project_images
  for all using (auth.uid() = user_id);

-- operation_costs: public read
create policy "operation_costs: public read" on public.operation_costs
  for select using (true);


-- ============================================================
-- Supabase Storage bucket
-- Run separately in Storage dashboard or via API:
--   Bucket name: plan-images
--   Public: false
--   File size limit: 10MB
--   Allowed MIME types: image/png, image/jpeg, application/pdf
-- ============================================================

-- Storage RLS (add via Dashboard → Storage → plan-images → Policies)
-- Policy: "Users can manage their own plan images"
--   Allowed operations: SELECT, INSERT, UPDATE, DELETE
--   Target roles: authenticated
--   USING: (storage.foldername(name))[1] = auth.uid()::text


-- ============================================================
-- Helper: atomic credit deduction (call from server-side only)
-- Usage: select deduct_credits(user_id, 5, 'basic_design', project_id)
-- Returns: new balance, or raises exception if insufficient
-- ============================================================
create or replace function public.deduct_credits(
  p_user_id   uuid,
  p_amount    integer,
  p_operation text,
  p_project_id uuid default null
)
returns integer   -- returns new balance
language plpgsql security definer as $$
declare
  v_balance integer;
begin
  -- Lock the profile row to prevent concurrent double-spend
  select credit_balance into v_balance
  from public.profiles
  where id = p_user_id
  for update;

  if v_balance < p_amount then
    raise exception 'insufficient_credits: balance=%, required=%', v_balance, p_amount;
  end if;

  -- Deduct
  update public.profiles
  set credit_balance = credit_balance - p_amount
  where id = p_user_id;

  -- Record transaction
  insert into public.credit_transactions
    (user_id, delta, operation, project_id, source)
  values
    (p_user_id, -p_amount, p_operation, p_project_id, 'user_purchase');

  return v_balance - p_amount;
end;
$$;


-- ============================================================
-- Helper: add credits after successful Stripe payment
-- Idempotent — safe to call twice with same stripe_payment_id
-- ============================================================
create or replace function public.add_credits(
  p_user_id         uuid,
  p_amount          integer,
  p_stripe_payment_id text,
  p_description     text default null
)
returns integer
language plpgsql security definer as $$
declare
  v_balance integer;
begin
  -- Idempotency check
  if exists (
    select 1 from public.credit_transactions
    where stripe_payment_id = p_stripe_payment_id
  ) then
    select credit_balance into v_balance from public.profiles where id = p_user_id;
    return v_balance;  -- already processed
  end if;

  -- Add credits
  update public.profiles
  set credit_balance = credit_balance + p_amount
  where id = p_user_id
  returning credit_balance into v_balance;

  -- Record transaction
  insert into public.credit_transactions
    (user_id, delta, operation, stripe_payment_id, description, source)
  values
    (p_user_id, p_amount, 'purchase', p_stripe_payment_id, p_description, 'user_purchase');

  return v_balance;
end;
$$;
