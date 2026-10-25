begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000101','authenticated','authenticated','legacy-admin@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000102','authenticated','authenticated','legacy-user@example.test','',now(),'{}','{}',now(),now());

update public.profiles set is_admin = true, credit_balance = 100 where id = '00000000-0000-0000-0000-000000000101';
update public.profiles set credit_balance = 10 where id = '00000000-0000-0000-0000-000000000102';
insert into public.portal_users(id) values('10000000-0000-0000-0000-000000000101');
insert into public.portal_magic_tokens(portal_user_id,token,expires_at)
values('10000000-0000-0000-0000-000000000101','synthetic-single-use-token',now()+interval '5 minutes');

select ok(has_function_privilege('anon','public.add_credits(uuid,integer,text,text)','execute'),
  'hosted-equivalent fixture exposes add_credits to anon');
select ok(has_function_privilege('anon','public.deduct_credits(uuid,integer,text,uuid)','execute'),
  'hosted-equivalent fixture exposes deduct_credits to anon');
select ok(has_table_privilege('authenticated','public.admin_members','select'),
  'hosted-equivalent fixture exposes admin_members to authenticated');

set local role anon;
select lives_ok(
  $$select public.add_credits('00000000-0000-0000-0000-000000000102',25,'synthetic-payment','fixture')$$,
  'anonymous caller can target another user in the synthetic vulnerable fixture'
);
reset role;
select is((select credit_balance from public.profiles where id='00000000-0000-0000-0000-000000000102'),35,
  'synthetic anonymous call changed the target balance');

set local role anon;
select lives_ok(
  $$select public.gift_credits('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102',7,'spoofed admin id')$$,
  'synthetic caller can spoof a known administrator id'
);
reset role;
select is((select credit_balance from public.profiles where id='00000000-0000-0000-0000-000000000102'),42,
  'synthetic spoofed gift changed the target balance');

set local role anon;
select lives_ok(
  $$select public.deduct_credits('00000000-0000-0000-0000-000000000102',-8,'negative amount',null::uuid,null::text)$$,
  'synthetic negative deduction is accepted by the extended overload'
);
reset role;
select is((select credit_balance from public.profiles where id='00000000-0000-0000-0000-000000000102'),50,
  'synthetic negative deduction increased the target balance');

set local role anon;
select is((public.get_credit_balance('00000000-0000-0000-0000-000000000102')->>'balance')::integer,50,
  'anonymous caller can read an arbitrary synthetic balance');
select throws_ok($$select public.handle_new_user()$$);
select is((select count(*)::integer from public.portal_consume_magic_token('synthetic-single-use-token')),1,
  'anonymous portal token exchange succeeds once');
select is((select count(*)::integer from public.portal_consume_magic_token('synthetic-single-use-token')),0,
  'anonymous portal token exchange rejects reuse');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.admin_members),2,
  'ordinary authenticated caller sees every synthetic admin view row');
reset role;

select * from finish();
rollback;
