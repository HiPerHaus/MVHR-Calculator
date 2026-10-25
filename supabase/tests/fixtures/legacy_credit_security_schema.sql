-- Test-only transcription of the hosted legacy credit, admin-view and portal
-- authorization surface. It contains synthetic structure only and is never a
-- production migration.

create table public.companies (
  id uuid primary key,
  name text not null,
  credit_balance integer not null default 0,
  pool_credits_enabled boolean not null default false
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  company_name text,
  credit_balance integer not null default 0,
  plan_type text,
  is_admin boolean not null default false,
  company_id uuid references public.companies(id),
  company_role text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id)
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  delta integer not null,
  operation text not null,
  stripe_payment_id text,
  description text,
  project_id uuid,
  source text
);

create table public.company_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  delta integer not null,
  operation text not null,
  description text,
  performed_by uuid,
  stripe_payment_id text,
  project_id uuid,
  source text
);

create table public.portal_users (
  id uuid primary key default gen_random_uuid(),
  last_login_at timestamptz
);

create table public.portal_magic_tokens (
  id uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references public.portal_users(id),
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references public.portal_users(id),
  session_token text not null default gen_random_uuid()::text
);

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.company_credit_transactions enable row level security;

create or replace function public.is_admin() returns boolean
language sql security definer as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_company_id() returns uuid
language sql stable security definer as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_company_role() returns text
language sql stable security definer as $$
  select company_role from public.profiles where id = auth.uid();
$$;

create policy profiles_own on public.profiles for all using (auth.uid() = id);
create policy profiles_admin on public.profiles for select using (public.is_admin());
create policy companies_member on public.companies for select using (id = public.my_company_id());
create policy companies_manager on public.companies for update
  using (id = public.my_company_id() and public.my_company_role() in ('owner', 'admin'));
create policy projects_own on public.projects for all using (auth.uid() = user_id);
create policy credit_transactions_own on public.credit_transactions for select using (auth.uid() = user_id);
create policy credit_transactions_admin on public.credit_transactions for select using (public.is_admin());
create policy company_credit_transactions_member on public.company_credit_transactions for select
  using (company_id = public.my_company_id());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.add_credits(
  p_user_id uuid, p_amount integer, p_stripe_payment_id text, p_description text default null
) returns integer language plpgsql security definer as $$
declare v_balance integer;
begin
  if exists(select 1 from public.credit_transactions where stripe_payment_id = p_stripe_payment_id) then
    select credit_balance into v_balance from public.profiles where id = p_user_id;
    return v_balance;
  end if;
  update public.profiles set credit_balance = credit_balance + p_amount where id = p_user_id
    returning credit_balance into v_balance;
  insert into public.credit_transactions(user_id, delta, operation, stripe_payment_id, description, source)
    values(p_user_id, p_amount, 'purchase', p_stripe_payment_id, p_description, 'user_purchase');
  return v_balance;
end;
$$;

create or replace function public.add_credits_to_company(
  p_company_id uuid, p_purchased_by uuid, p_amount integer, p_stripe_payment_id text,
  p_description text default null
) returns integer language plpgsql security definer as $$
declare v_balance integer;
begin
  update public.companies set credit_balance = credit_balance + p_amount where id = p_company_id
    returning credit_balance into v_balance;
  insert into public.company_credit_transactions(
    company_id, delta, operation, description, performed_by, stripe_payment_id, source
  ) values(
    p_company_id, p_amount, 'purchase', coalesce(p_description, 'Company credit purchase'),
    p_purchased_by, p_stripe_payment_id, 'company_purchase'
  );
  return v_balance;
end;
$$;

create or replace function public.deduct_credits(
  p_user_id uuid, p_amount integer, p_operation text, p_project_id uuid default null
) returns integer language plpgsql security definer as $$
declare v_balance integer;
begin
  select credit_balance into v_balance from public.profiles where id = p_user_id for update;
  if v_balance < p_amount then raise exception 'insufficient_credits'; end if;
  update public.profiles set credit_balance = credit_balance - p_amount where id = p_user_id;
  insert into public.credit_transactions(user_id, delta, operation, project_id, source)
    values(p_user_id, -p_amount, p_operation, p_project_id, 'user_purchase');
  return v_balance - p_amount;
end;
$$;

create or replace function public.deduct_credits(
  p_user_id uuid, p_amount integer, p_operation text, p_project_id uuid default null,
  p_description text default null
) returns integer language plpgsql security definer as $$
declare v_company_id uuid; v_pool_enabled boolean; v_balance integer;
begin
  select p.company_id, c.pool_credits_enabled into v_company_id, v_pool_enabled
    from public.profiles p left join public.companies c on c.id = p.company_id where p.id = p_user_id;
  if v_company_id is not null and v_pool_enabled then
    select credit_balance into v_balance from public.companies where id = v_company_id for update;
    if v_balance < p_amount then raise exception 'insufficient_credits'; end if;
    update public.companies set credit_balance = credit_balance - p_amount where id = v_company_id;
    insert into public.company_credit_transactions(
      company_id, delta, operation, description, project_id, performed_by, source
    ) values(
      v_company_id, -p_amount, p_operation, coalesce(p_description, p_operation),
      p_project_id, p_user_id, 'company_purchase'
    );
  else
    select credit_balance into v_balance from public.profiles where id = p_user_id for update;
    if v_balance < p_amount then raise exception 'insufficient_credits'; end if;
    update public.profiles set credit_balance = credit_balance - p_amount where id = p_user_id;
    insert into public.credit_transactions(user_id, delta, operation, description, project_id, source)
      values(p_user_id, -p_amount, p_operation, coalesce(p_description, p_operation), p_project_id, 'user_spend');
  end if;
  return v_balance - p_amount;
end;
$$;

create or replace function public.gift_credits(
  p_admin_id uuid, p_user_id uuid, p_amount integer, p_note text default null
) returns integer language plpgsql security definer as $$
declare v_balance integer;
begin
  perform 1 from public.profiles where id = p_admin_id and is_admin = true;
  if not found then raise exception 'not_admin'; end if;
  select credit_balance into v_balance from public.profiles where id = p_user_id for update;
  if p_amount < 0 and v_balance + p_amount < 0 then raise exception 'insufficient_credits'; end if;
  update public.profiles set credit_balance = credit_balance + p_amount where id = p_user_id
    returning credit_balance into v_balance;
  insert into public.credit_transactions(user_id, delta, operation, description, source)
    values(p_user_id, p_amount, 'admin_adjustment', coalesce(p_note, 'Admin credit adjustment'), 'admin');
  return v_balance;
end;
$$;

create or replace function public.get_credit_balance(p_user_id uuid) returns jsonb
language plpgsql stable security definer as $$
declare v_company_id uuid; v_pool_enabled boolean; v_company_name text; v_balance integer;
begin
  select p.company_id, c.pool_credits_enabled, c.name, c.credit_balance
    into v_company_id, v_pool_enabled, v_company_name, v_balance
    from public.profiles p left join public.companies c on c.id = p.company_id where p.id = p_user_id;
  if v_company_id is not null and v_pool_enabled then
    return jsonb_build_object('balance', v_balance, 'mode', 'company_pool',
      'company_id', v_company_id, 'company_name', v_company_name);
  end if;
  select credit_balance into v_balance from public.profiles where id = p_user_id;
  return jsonb_build_object('balance', v_balance, 'mode', 'individual');
end;
$$;

create view public.admin_members as
select p.id, p.email, p.full_name, p.company_name, p.credit_balance, p.plan_type, p.is_admin, p.created_at,
  null::timestamptz as last_sign_in_at,
  (select count(*) from public.projects pr where pr.user_id = p.id) as project_count,
  (select count(*) from public.credit_transactions ct where ct.user_id = p.id) as tx_count
from public.profiles p;

create or replace function public.portal_consume_magic_token(p_token text)
returns table(portal_user_id uuid, session_token text)
language plpgsql security definer set search_path = 'public' as $$
declare v_user_id uuid; v_token_id uuid; v_session_tok text;
begin
  select t.id, t.portal_user_id into v_token_id, v_user_id
    from public.portal_magic_tokens t
    where t.token = p_token and t.expires_at > now() and t.used_at is null
    limit 1 for update;
  if v_user_id is null then return; end if;
  update public.portal_magic_tokens set used_at = now() where id = v_token_id;
  update public.portal_users set last_login_at = now() where id = v_user_id;
  insert into public.portal_sessions(portal_user_id) values(v_user_id)
    returning public.portal_sessions.session_token into v_session_tok;
  return query select v_user_id, v_session_tok;
end;
$$;

grant execute on function public.add_credits(uuid, integer, text, text) to anon, authenticated, service_role;
grant execute on function public.add_credits_to_company(uuid, uuid, integer, text, text) to anon, authenticated, service_role;
grant execute on function public.deduct_credits(uuid, integer, text, uuid) to anon, authenticated, service_role;
grant execute on function public.deduct_credits(uuid, integer, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.gift_credits(uuid, uuid, integer, text) to anon, authenticated, service_role;
grant execute on function public.get_credit_balance(uuid) to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.my_company_id() to anon, authenticated, service_role;
grant execute on function public.my_company_role() to anon, authenticated, service_role;
grant execute on function public.handle_new_user() to anon, authenticated, service_role;
grant execute on function public.portal_consume_magic_token(text) to anon, authenticated, service_role;
grant all on public.admin_members to authenticated, service_role;
grant select on public.profiles, public.projects, public.credit_transactions to service_role;
