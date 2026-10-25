begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

select ok(not has_function_privilege('anon','public.add_credits(uuid,integer,text,text)','execute'));
select ok(not has_function_privilege('authenticated','public.add_credits_to_company(uuid,uuid,integer,text,text)','execute'));
select ok(not has_function_privilege('anon','public.deduct_credits(uuid,integer,text,uuid)','execute'));
select ok(not has_function_privilege('authenticated','public.deduct_credits(uuid,integer,text,uuid,text)','execute'));
select ok(not has_function_privilege('anon','public.gift_credits(uuid,uuid,integer,text)','execute'));
select ok(not has_function_privilege('authenticated','public.get_credit_balance(uuid)','execute'));

select ok(not has_table_privilege('authenticated','public.admin_members','select'));
select ok(has_table_privilege('service_role','public.admin_members','select'));

select ok(has_function_privilege('authenticated','public.is_admin()','execute'));
select ok(has_function_privilege('authenticated','public.my_company_id()','execute'));
select ok(has_function_privilege('authenticated','public.my_company_role()','execute'));
select ok(not has_function_privilege('anon','public.is_admin()','execute'));
select ok(not has_function_privilege('anon','public.my_company_id()','execute'));
select ok(not has_function_privilege('anon','public.my_company_role()','execute'));

select ok(not has_function_privilege('anon','public.handle_new_user()','execute'));
select ok(not has_function_privilege('authenticated','public.handle_new_user()','execute'));
select ok(has_function_privilege('anon','public.portal_consume_magic_token(text)','execute'));
select ok(has_function_privilege('authenticated','public.portal_consume_magic_token(text)','execute'));
select ok(not has_function_privilege('public','public.portal_consume_magic_token(text)','execute'));

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname=any(array['add_credits','add_credits_to_company','deduct_credits','gift_credits',
       'get_credit_balance','is_admin','my_company_id','my_company_role','handle_new_user','portal_consume_magic_token'])
     and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%'),
  11,
  'every reviewed security-definer function has a fixed search path'
);

select ok(
  (select coalesce(c.reloptions,'{}'::text[]) @> array['security_invoker=true']
   from pg_class c where c.oid='public.admin_members'::regclass),
  'admin_members runs with invoker rather than owner privileges'
);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000201','authenticated','authenticated','hardened-admin@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000202','authenticated','authenticated','hardened-user@example.test','',now(),'{}','{}',now(),now());
select is((select count(*)::integer from public.profiles where id in(
  '00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202')),2,
  'auth trigger still creates profiles after direct execute is revoked');

insert into public.companies(id,name) values('20000000-0000-0000-0000-000000000201','Synthetic company');
update public.profiles set is_admin=true where id='00000000-0000-0000-0000-000000000201';
update public.profiles set company_id='20000000-0000-0000-0000-000000000201',company_role='member',credit_balance=12
 where id='00000000-0000-0000-0000-000000000202';
insert into public.portal_users(id) values('30000000-0000-0000-0000-000000000201');
insert into public.portal_magic_tokens(portal_user_id,token,expires_at)
values('30000000-0000-0000-0000-000000000201','hardened-single-use-token',now()+interval '5 minutes');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}',true);
set local role authenticated;
select is(public.is_admin(),false,'caller-bound admin helper still works for authenticated users');
select is(public.my_company_id(),'20000000-0000-0000-0000-000000000201'::uuid,
  'caller-bound company helper still returns only the caller company');
select is(public.my_company_role(),'member','caller-bound role helper still returns only the caller role');
reset role;

set local role anon;
select is((select count(*)::integer from public.portal_consume_magic_token('hardened-single-use-token')),1,
  'intentional anonymous portal exchange remains available');
select is((select count(*)::integer from public.portal_consume_magic_token('hardened-single-use-token')),0,
  'portal exchange remains single use');
reset role;

set local role service_role;
select is((public.get_credit_balance('00000000-0000-0000-0000-000000000202')->>'balance')::integer,12,
  'server role retains balance access');
select is((select count(*)::integer from public.admin_members),2,
  'server role retains admin view access under invoker security');
reset role;

select * from finish();
rollback;
