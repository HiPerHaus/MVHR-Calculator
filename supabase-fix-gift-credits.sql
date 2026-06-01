-- ============================================================
-- HiPer Studio — Fix gift_credits SQL type mismatch (C-02)
-- Run in Supabase SQL Editor AFTER supabase-admin-patch.sql
-- ============================================================

-- The original function declared `v_admin_email text` but selected
-- a boolean column into it, causing a runtime type error.
-- This replacement corrects the variable type and improves
-- the error message for clarity.

create or replace function public.gift_credits(
  p_admin_id   uuid,
  p_user_id    uuid,
  p_amount     integer,   -- positive = add, negative = subtract (cannot go below 0)
  p_note       text default null
)
returns integer   -- returns new balance
language plpgsql security definer as $$
declare
  v_is_admin   boolean;          -- FIXED: was incorrectly declared as text
  v_balance    integer;
begin
  -- Verify caller is an admin
  select is_admin into v_is_admin
    from public.profiles
    where id = p_admin_id;

  if not found or v_is_admin is not true then
    raise exception 'not_admin: caller % is not a platform admin', p_admin_id;
  end if;

  -- Lock target user's profile row for update to prevent concurrent modifications
  select credit_balance into v_balance
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    raise exception 'user_not_found: no profile for user %', p_user_id;
  end if;

  -- For deductions, ensure balance won't go negative
  if p_amount < 0 and (v_balance + p_amount) < 0 then
    raise exception 'insufficient_credits: balance=%, adjustment=%', v_balance, p_amount;
  end if;

  -- Apply credit adjustment
  update public.profiles
    set credit_balance = credit_balance + p_amount
    where id = p_user_id
    returning credit_balance into v_balance;

  -- Record immutable ledger entry
  insert into public.credit_transactions
    (user_id, delta, operation, description, source)
  values
    (p_user_id, p_amount, 'admin_adjustment',
     coalesce(p_note, 'Admin credit adjustment'), 'admin');

  return v_balance;
end;
$$;
