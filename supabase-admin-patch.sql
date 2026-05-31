-- ============================================================
-- HiPer Haus MVHR Design Engine — Admin Patch
-- Run this in the Supabase SQL Editor AFTER the main schema
-- ============================================================

-- ── Add is_admin flag to profiles ───────────────────────────
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Mark your own account as admin (replace with your user UUID from Auth → Users)
-- update public.profiles set is_admin = true where email = 'jonathen@adelaidegeoexchange.com.au';


-- ── Admin RLS helper ─────────────────────────────────────────
-- Reusable inline function so all admin policies share one definition
create or replace function public.is_admin()
returns boolean language sql security definer as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;


-- ── Admin RLS policies ───────────────────────────────────────

-- profiles: admins can read ALL profiles (needed for member list)
create policy "profiles: admin read all" on public.profiles
  for select using (public.is_admin());

-- profiles: admins can update any profile (for gifting credits)
create policy "profiles: admin update all" on public.profiles
  for update using (public.is_admin());

-- credit_transactions: admins can read all
create policy "credit_transactions: admin read all" on public.credit_transactions
  for select using (public.is_admin());

-- operation_costs: admins can update costs
create policy "operation_costs: admin update" on public.operation_costs
  for update using (public.is_admin());


-- ══════════════════════════════════════════════════════════════
-- Admin RPC: gift_credits
-- Call from server-side (admin API route) with service_role key.
-- Adds credits to any user and records an admin-source transaction.
-- ══════════════════════════════════════════════════════════════
create or replace function public.gift_credits(
  p_admin_id   uuid,
  p_user_id    uuid,
  p_amount     integer,   -- positive = add, negative = subtract (cannot go below 0)
  p_note       text default null
)
returns integer   -- returns new balance
language plpgsql security definer as $$
declare
  v_balance integer;
  v_admin_email text;
begin
  -- Verify caller is admin
  select is_admin into strict v_admin_email
    from public.profiles where id = p_admin_id and is_admin = true;
  if not found then
    raise exception 'not_admin: caller % is not an admin', p_admin_id;
  end if;

  -- For deductions, ensure balance won't go negative
  select credit_balance into v_balance
    from public.profiles where id = p_user_id for update;

  if p_amount < 0 and (v_balance + p_amount) < 0 then
    raise exception 'insufficient_credits: balance=%, adjustment=%', v_balance, p_amount;
  end if;

  -- Apply
  update public.profiles
    set credit_balance = credit_balance + p_amount
    where id = p_user_id
    returning credit_balance into v_balance;

  -- Record ledger entry
  insert into public.credit_transactions
    (user_id, delta, operation, description, source)
  values
    (p_user_id, p_amount, 'admin_adjustment',
     coalesce(p_note, 'Admin credit adjustment'), 'admin');

  return v_balance;
end;
$$;


-- ══════════════════════════════════════════════════════════════
-- Admin view: enriched member list
-- Joins profiles with auth.users for last_sign_in_at
-- ══════════════════════════════════════════════════════════════
create or replace view public.admin_members as
  select
    p.id,
    p.email,
    p.full_name,
    p.company_name,
    p.credit_balance,
    p.plan_type,
    p.is_admin,
    p.created_at,
    u.last_sign_in_at,
    (select count(*) from public.projects pr where pr.user_id = p.id)     as project_count,
    (select count(*) from public.credit_transactions ct where ct.user_id = p.id) as tx_count
  from public.profiles p
  join auth.users u on u.id = p.id;

-- Only admins can query this view
alter view public.admin_members owner to postgres;
revoke all on public.admin_members from anon, authenticated;
grant select on public.admin_members to authenticated;

create policy "admin_members: admin only" on public.profiles
  for select using (public.is_admin());

-- ── Zehnder unit name patch (run once to fix NULL manufacturer/model) ──────
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Q350 ERV / Comfort Vent Q350 ERV' WHERE phi_cert_id='1006vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Q350 HRV / Comfort Vent Q350 HRV' WHERE phi_cert_id='0956vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Q450 ERV / Comfort Vent Q450 ERV' WHERE phi_cert_id='1007vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Q450 HRV / Comfort Vent Q450 HRV' WHERE phi_cert_id='0954vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Q600 ERV / Comfort Vent Q600 ERV' WHERE phi_cert_id='1008vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Q600 HRV / Comfort Vent Q600 HRV' WHERE phi_cert_id='0975vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir Flex 350'      WHERE phi_cert_id='2069vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir SL 330 E V'    WHERE phi_cert_id='0866vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir SL 330 S V'    WHERE phi_cert_id='0865vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='ComfoAir E 350 V'       WHERE phi_cert_id='1359vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='R+F Optiline RF 350 D KWL' WHERE phi_cert_id='1407vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='focus 200'              WHERE phi_cert_id='0300vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='novus 300'              WHERE phi_cert_id='0302vs03' AND manufacturer IS NULL;
UPDATE public.mvhr_units SET manufacturer='Zehnder', model='novus F 300'            WHERE phi_cert_id='0304vs03' AND manufacturer IS NULL;
