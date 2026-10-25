\set ON_ERROR_STOP on

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values
 ('30000000-0000-0000-0000-000000000001','authenticated','authenticated','rollback-owner@example.test','',now(),'{}','{}',now(),now()),
 ('30000000-0000-0000-0000-000000000002','authenticated','authenticated','rollback-member@example.test','',now(),'{}','{}',now(),now());
insert into studio_workspaces(id,name)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','Rollback workspace');
insert into studio_memberships(workspace_id,user_id,role,status)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','30000000-0000-0000-0000-000000000001','owner','active');
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by)
values ('30000000-0000-0000-0000-000000000003','cccccccc-cccc-cccc-cccc-cccccccccccc','rollback-project','Rollback project','cccccccc-cccc-cccc-cccc-cccccccccccc/30000000-0000-0000-0000-000000000001/rollback-project.json','30000000-0000-0000-0000-000000000001');
insert into studio_company_profiles(workspace_id,details,logo_path)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','{"companyName":"Rollback fixture"}','cccccccc-cccc-cccc-cccc-cccccccccccc/logo.png');

-- __CUSTOMER_ACCESS_ROLLBACK__

set search_path = public, extensions;
select plan(25);

select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='studio_memberships' and column_name='status'),'rollback removes the customer-access status column');
select is(to_regclass('public.studio_platform_admins'),null::regclass,'rollback removes the platform-administrator table');
select is(to_regclass('public.studio_access_requests'),null::regclass,'rollback removes the access-request table');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'studio_admin_%'),0,'rollback removes customer administration RPCs');
select is((select count(*)::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users' and t.tgname='studio_capture_signup_request'),0,'rollback removes the signup trigger');
select is((select count(*)::integer from studio_memberships where workspace_id='cccccccc-cccc-cccc-cccc-cccccccccccc'),1,'rollback preserves existing memberships');
select is((select count(*)::integer from studio_projects where project_id='rollback-project'),1,'rollback preserves existing projects');
select is((select count(*)::integer from studio_company_profiles where workspace_id='cccccccc-cccc-cccc-cccc-cccccccccccc'),1,'rollback preserves existing company details');
select ok((select convalidated from pg_constraint where conname='studio_memberships_role_check'),'restored role constraint is validated');
select ok((select convalidated from pg_constraint where conname='studio_path_workspace'),'existing project path constraint remains validated');
select ok((select convalidated from pg_constraint where conname='studio_previous_path_workspace'),'existing previous-project path constraint remains validated');
select ok((select convalidated from pg_constraint where conname='studio_company_profiles_check'),'existing company-logo path constraint remains validated');
select ok((select coalesce(qual,'') not like '%status%' from pg_policies where schemaname='public' and tablename='studio_workspaces' and policyname='studio_workspace_member'),'workspace policy is restored without customer-access status');
select ok((select coalesce(qual,'') not like '%status%' from pg_policies where schemaname='public' and tablename='studio_projects' and policyname='studio_projects_read'),'project read policy is restored without customer-access status');
select ok((select coalesce(with_check,'') not like '%status%' from pg_policies where schemaname='public' and tablename='studio_projects' and policyname='studio_projects_insert'),'project insert policy is restored without customer-access status');
select ok((select coalesce(with_check,'') not like '%status%' from pg_policies where schemaname='public' and tablename='studio_projects' and policyname='studio_projects_update'),'project update policy is restored without customer-access status');
select ok((select coalesce(qual,'') not like '%status%' from pg_policies where schemaname='public' and tablename='studio_company_profiles' and policyname='studio_company_profile_read'),'company policy is restored without customer-access status');
select ok((select coalesce(qual,'') not like '%status%' from pg_policies where schemaname='storage' and tablename='objects' and policyname='studio_files_read'),'storage policy is restored without customer-access status');

set role authenticated;
select is((select count(*)::integer from studio_workspaces),1,'restored workspace policy keeps legacy owner access');
select is((select count(*)::integer from studio_projects),1,'restored project policy keeps legacy owner access');
select is((select count(*)::integer from studio_company_profiles),1,'restored company policy keeps legacy owner access');
reset role;

select throws_ok($$insert into studio_memberships(workspace_id,user_id,role) values('cccccccc-cccc-cccc-cccc-cccccccccccc','30000000-0000-0000-0000-000000000002','admin')$$);
select lives_ok($$insert into studio_memberships(workspace_id,user_id,role) values('cccccccc-cccc-cccc-cccc-cccccccccccc','30000000-0000-0000-0000-000000000002','member')$$,'legacy member role remains valid');
select throws_ok($$insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values('30000000-0000-0000-0000-000000000004','cccccccc-cccc-cccc-cccc-cccccccccccc','bad-path','Bad path','dddddddd-dddd-dddd-dddd-dddddddddddd/30000000-0000-0000-0000-000000000001/bad.json','30000000-0000-0000-0000-000000000001')$$);
select throws_ok($$update studio_company_profiles set logo_path='dddddddd-dddd-dddd-dddd-dddddddddddd/logo.png' where workspace_id='cccccccc-cccc-cccc-cccc-cccccccccccc'$$);

select * from finish();
