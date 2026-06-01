-- ============================================================
-- HiPer Studio — Companies, Multi-User & Shared Credit Pool
-- Run in Supabase SQL Editor in order. Safe to run on an
-- existing database — all changes are additive or guarded.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- PHASE 1: SCHEMA (non-breaking, no data changed)
-- ══════════════════════════════════════════════════════════════

-- ── Extension (already exists but safe to repeat) ────────────
create extension if not exists "uuid-ossp";


-- ── companies table ───────────────────────────────────────────
-- One row per organisation. Individual users have no company row.
create table if not exists public.companies (
  id                    uuid primary key default uuid_generate_v4(),
  name                  text not null,
  -- Shared credit pool — used when pool_credits_enabled = true
  credit_balance        integer not null default 0 check (credit_balance >= 0),
  -- When true, deduct_credits draws from companies.credit_balance
  -- instead of the individual user's profiles.credit_balance
  pool_credits_enabled  boolean not null default false,
  -- The user who owns / created this company account
  owner_id              uuid references public.profiles(id) on delete set null,
  billing_email         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create index if not exists companies_owner_id_idx on public.companies(owner_id);


-- ── Add company relationship to profiles ──────────────────────
-- company_id   : FK to companies; null = individual account
-- company_role : role within the company (only set when company_id is set)
alter table public.profiles
  add column if not exists company_id   uuid references public.companies(id) on delete set null,
  add column if not exists company_role text check (company_role in ('owner', 'admin', 'member'));

-- company_name stays as a denormalised display field (keeps backward compat)
-- The canonical name is companies.name

create index if not exists profiles_company_id_idx on public.profiles(company_id);


-- ── company_credit_transactions ───────────────────────────────
-- Separate ledger for company-pool transactions.
-- Individual user transactions continue going into credit_transactions.
create table if not exists public.company_credit_transactions (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  delta               integer not null,
  operation           text not null,
  description         text,
  project_id          uuid references public.projects(id) on delete set null,
  performed_by        uuid references public.profiles(id) on delete set null,
  stripe_payment_id   text,
  source              text not null default 'company_purchase'
                        check (source in ('company_purchase', 'admin', 'promotional')),
  created_at          timestamptz not null default now()
);

create index if not exists cct_company_id_idx
  on public.company_credit_transactions(company_id, created_at desc);

create unique index if not exists cct_stripe_payment_idx
  on public.company_credit_transactions(stripe_payment_id)
  where stripe_payment_id is not null;


-- ══════════════════════════════════════════════════════════════
-- PHASE 2: ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

alter table public.companies                    enable row level security;
alter table public.company_credit_transactions  enable row level security;

-- Helper: returns the company_id for the current user (or null)
create or replace function public.my_company_id()
returns uuid language sql security definer stable as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- Helper: returns the company_role for the current user (or null)
create or replace function public.my_company_role()
returns text language sql security definer stable as $$
  select company_role from public.profiles where id = auth.uid();
$$;

-- companies: members can read their own company
create policy "companies: members can read own" on public.companies
  for select using (id = public.my_company_id());

-- companies: owner and admin can update (name, billing_email, pool_credits_enabled)
create policy "companies: owner/admin can update" on public.companies
  for update using (
    id = public.my_company_id()
    and public.my_company_role() in ('owner', 'admin')
  );

-- companies: platform admins can do anything
create policy "companies: platform admin all" on public.companies
  for all using (public.is_admin());

-- profiles: members of the same company can read each other's profile
create policy "profiles: company members can read peers" on public.profiles
  for select using (
    company_id is not null
    and company_id = public.my_company_id()
  );

-- company_credit_transactions: company members can read their company's ledger
create policy "cct: company members read" on public.company_credit_transactions
  for select using (company_id = public.my_company_id());

-- company_credit_transactions: platform admins can read all
create policy "cct: admin read all" on public.company_credit_transactions
  for select using (public.is_admin());


-- ══════════════════════════════════════════════════════════════
-- PHASE 3: DB FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- ── deduct_credits (updated) ──────────────────────────────────
-- Now pool-aware. When the user belongs to a company with
-- pool_credits_enabled = true, credits are drawn from the
-- company pool; otherwise from the individual user balance.
create or replace function public.deduct_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid    default null,
  p_description text   default null
)
returns integer   -- returns new balance (user or company depending on mode)
language plpgsql security definer as $$
declare
  v_company_id          uuid;
  v_pool_enabled        boolean;
  v_balance             integer;
  v_description         text;
begin
  v_description := coalesce(p_description, p_operation);

  -- Determine if this user is in a company with pool credits enabled
  select p.company_id, c.pool_credits_enabled
    into v_company_id, v_pool_enabled
    from public.profiles p
    left join public.companies c on c.id = p.company_id
    where p.id = p_user_id;

  if v_company_id is not null and v_pool_enabled then
    -- ── Company pool deduction ──────────────────────────────
    select credit_balance into v_balance
      from public.companies
      where id = v_company_id
      for update;

    if v_balance < p_amount then
      raise exception 'insufficient_credits: balance=%, required=%', v_balance, p_amount;
    end if;

    update public.companies
      set credit_balance = credit_balance - p_amount
      where id = v_company_id;

    insert into public.company_credit_transactions
      (company_id, delta, operation, description, project_id, performed_by, source)
    values
      (v_company_id, -p_amount, p_operation, v_description, p_project_id, p_user_id, 'company_purchase');

    return v_balance - p_amount;

  else
    -- ── Individual deduction (original behaviour) ───────────
    select credit_balance into v_balance
      from public.profiles
      where id = p_user_id
      for update;

    if v_balance < p_amount then
      raise exception 'insufficient_credits: balance=%, required=%', v_balance, p_amount;
    end if;

    update public.profiles
      set credit_balance = credit_balance - p_amount
      where id = p_user_id;

    insert into public.credit_transactions
      (user_id, delta, operation, description, project_id, source)
    values
      (p_user_id, -p_amount, p_operation, v_description, p_project_id, 'user_spend');

    return v_balance - p_amount;
  end if;
end;
$$;


-- ── add_credits_to_company ────────────────────────────────────
-- Idempotent — safe to call twice with same stripe_payment_id.
-- Called by the Stripe webhook for company-level purchases.
create or replace function public.add_credits_to_company(
  p_company_id         uuid,
  p_purchased_by       uuid,           -- the user who completed the purchase
  p_amount             integer,
  p_stripe_payment_id  text,
  p_description        text default null
)
returns integer   -- returns new company balance
language plpgsql security definer as $$
declare
  v_balance integer;
begin
  -- Idempotency check
  if exists (
    select 1 from public.company_credit_transactions
    where stripe_payment_id = p_stripe_payment_id
  ) then
    select credit_balance into v_balance from public.companies where id = p_company_id;
    return v_balance;
  end if;

  -- Add credits to the company pool
  update public.companies
    set credit_balance = credit_balance + p_amount
    where id = p_company_id
    returning credit_balance into v_balance;

  -- Record the transaction
  insert into public.company_credit_transactions
    (company_id, delta, operation, description, performed_by, stripe_payment_id, source)
  values
    (p_company_id, p_amount, 'purchase',
     coalesce(p_description, 'Company credit purchase'),
     p_purchased_by, p_stripe_payment_id, 'company_purchase');

  return v_balance;
end;
$$;


-- ── get_credit_balance ────────────────────────────────────────
-- Returns the effective credit balance for a user:
-- company pool balance if pooling is enabled, otherwise individual.
-- Call from server-side to show the correct balance in the UI.
create or replace function public.get_credit_balance(p_user_id uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  v_company_id   uuid;
  v_pool_enabled boolean;
  v_company_name text;
  v_balance      integer;
begin
  select p.company_id, c.pool_credits_enabled, c.name, c.credit_balance
    into v_company_id, v_pool_enabled, v_company_name, v_balance
    from public.profiles p
    left join public.companies c on c.id = p.company_id
    where p.id = p_user_id;

  if v_company_id is not null and v_pool_enabled then
    return jsonb_build_object(
      'balance',       v_balance,
      'mode',          'company_pool',
      'company_id',    v_company_id,
      'company_name',  v_company_name
    );
  else
    select credit_balance into v_balance from public.profiles where id = p_user_id;
    return jsonb_build_object(
      'balance', v_balance,
      'mode',    'individual'
    );
  end if;
end;
$$;


-- ══════════════════════════════════════════════════════════════
-- PHASE 4: DATA MIGRATION (run once — idempotent)
-- Groups existing users by company_name into company accounts.
-- Users whose company_name matches 2+ profiles are assigned to
-- a new companies row. Single-user "companies" are left as-is
-- (they can be migrated on request by toggling the flag).
-- ══════════════════════════════════════════════════════════════
do $$
declare
  rec          record;
  v_company_id uuid;
  v_owner_id   uuid;
begin
  -- Only process company_name values shared by 2+ users
  for rec in
    select company_name, count(*) as user_count
      from public.profiles
      where company_name is not null
        and company_name <> ''
        and company_id is null          -- skip already-migrated users
      group by company_name
      having count(*) >= 2
  loop
    -- Pick the oldest account as the owner
    select id into v_owner_id
      from public.profiles
      where company_name = rec.company_name
        and company_id is null
      order by created_at asc
      limit 1;

    -- Create the company (skip if one already exists with this name)
    insert into public.companies (name, owner_id)
      values (rec.company_name, v_owner_id)
      on conflict do nothing
      returning id into v_company_id;

    -- If it already existed (conflict), fetch the id
    if v_company_id is null then
      select id into v_company_id from public.companies where name = rec.company_name limit 1;
    end if;

    -- Assign all matching users to this company
    update public.profiles
      set company_id   = v_company_id,
          company_role = case when id = v_owner_id then 'owner' else 'member' end
      where company_name = rec.company_name
        and company_id is null;

    raise notice 'Migrated % users to company "%"', rec.user_count, rec.company_name;
  end loop;
end;
$$;


-- ══════════════════════════════════════════════════════════════
-- PHASE 5: UPDATE source CHECK on credit_transactions
-- Adds 'user_spend' as a valid source value (replaces the
-- misleading 'user_purchase' used for deductions)
-- ══════════════════════════════════════════════════════════════
alter table public.credit_transactions
  drop constraint if exists credit_transactions_source_check;

alter table public.credit_transactions
  add constraint credit_transactions_source_check
  check (source in ('user_purchase', 'user_spend', 'promotional', 'sponsor', 'admin'));


-- ══════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════
select
  'companies'                     as "table",
  count(*)::text                  as "rows"
  from public.companies
union all
select
  'profiles with company_id',
  count(*)::text
  from public.profiles where company_id is not null
union all
select
  'company_credit_transactions',
  count(*)::text
  from public.company_credit_transactions;
