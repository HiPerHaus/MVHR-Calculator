-- REVIEWED PROPOSAL ONLY. This file is deliberately outside migrations.
-- It must not be applied until the legacy application owner confirms the
-- compatibility impacts recorded in docs/15-legacy-shared-schema-security-review.md.

-- Credit mutation and cross-account balance reads become server-only. These
-- functions do not bind their target identifiers to auth.uid().
revoke all on function public.add_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.add_credits_to_company(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.deduct_credits(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.deduct_credits(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.gift_credits(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.get_credit_balance(uuid) from public, anon, authenticated;

grant execute on function public.add_credits(uuid, integer, text, text) to service_role;
grant execute on function public.add_credits_to_company(uuid, uuid, integer, text, text) to service_role;
grant execute on function public.deduct_credits(uuid, integer, text, uuid) to service_role;
grant execute on function public.deduct_credits(uuid, integer, text, uuid, text) to service_role;
grant execute on function public.gift_credits(uuid, uuid, integer, text) to service_role;
grant execute on function public.get_credit_balance(uuid) to service_role;

alter function public.add_credits(uuid, integer, text, text) set search_path = '';
alter function public.add_credits_to_company(uuid, uuid, integer, text, text) set search_path = '';
alter function public.deduct_credits(uuid, integer, text, uuid) set search_path = '';
alter function public.deduct_credits(uuid, integer, text, uuid, text) set search_path = '';
alter function public.gift_credits(uuid, uuid, integer, text) set search_path = '';
alter function public.get_credit_balance(uuid) set search_path = '';

-- The existing admin view runs with its owner privileges and bypasses the RLS
-- policies on profiles, projects and credit_transactions. Keep it available to
-- server code only until a separately reviewed admin endpoint replaces direct
-- browser access.
revoke all on public.admin_members from public, anon, authenticated;
grant select on public.admin_members to service_role;
alter view public.admin_members set (security_invoker = true);

-- These helpers are used by existing RLS policies and correctly bind lookups to
-- auth.uid(). Retain authenticated execution while removing anonymous/PUBLIC
-- access and the mutable search path.
revoke all on function public.is_admin() from public, anon;
revoke all on function public.my_company_id() from public, anon;
revoke all on function public.my_company_role() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.my_company_id() to authenticated, service_role;
grant execute on function public.my_company_role() to authenticated, service_role;
alter function public.is_admin() set search_path = '';
alter function public.my_company_id() set search_path = '';
alter function public.my_company_role() set search_path = '';

-- Trigger execution is not controlled by a client's EXECUTE grant. Preserve the
-- active auth.users trigger while preventing direct API exposure.
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
alter function public.handle_new_user() set search_path = '';

-- This is an intentionally anonymous, possession-token exchange. Remove only
-- the broad PUBLIC grant and retain the roles currently used by the portal.
revoke all on function public.portal_consume_magic_token(text) from public;
grant execute on function public.portal_consume_magic_token(text) to anon, authenticated, service_role;
alter function public.portal_consume_magic_token(text) set search_path = '';
