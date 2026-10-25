begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(47);

-- Stable synthetic identities. No real addresses or customer data are used.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000001','authenticated','authenticated','platform@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000002','authenticated','authenticated','owner-a@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000003','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000004','authenticated','authenticated','member-a@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000005','authenticated','authenticated','member-a2@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000006','authenticated','authenticated','owner-b@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000007','authenticated','authenticated','verified-pending@example.test','',now(),
  '{"studio_signup":"true","full_name":"Verified Person","company_name":"Example Seven","role":"owner","workspace_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}',
  '{"studio_platform_admin":true}',now(),now()),
 ('00000000-0000-0000-0000-000000000008','authenticated','authenticated','unverified-pending@example.test','',null,
  '{"studio_signup":"true","full_name":"Unverified Person","company_name":"Example Eight","role":"admin"}',
  '{}',now(),now());

select is((select status from studio_access_requests where user_id='00000000-0000-0000-0000-000000000007'),'pending','signup metadata creates only a pending request');
select is((select count(*)::integer from studio_platform_admins where user_id='00000000-0000-0000-0000-000000000007'),0,'user metadata cannot create a platform administrator');
select is((select count(*)::integer from studio_memberships where user_id='00000000-0000-0000-0000-000000000007'),0,'user metadata cannot create a workspace membership');
select ok((select email_verified_at is not null from studio_access_requests where user_id='00000000-0000-0000-0000-000000000007'),'confirmed signup captures verification time');
select ok((select email_verified_at is null from studio_access_requests where user_id='00000000-0000-0000-0000-000000000008'),'unconfirmed signup remains unverified');

insert into studio_workspaces(id,name) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Workspace A'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Workspace B');
insert into studio_memberships(workspace_id,user_id,role,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000002','owner','active'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000003','admin','active'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000004','member','active'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000005','member','active'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000006','owner','active');
insert into studio_platform_admins(user_id) values ('00000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','project-a','Project A','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000002/project-a.json','00000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values
 ('10000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','project-b','Project B','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/00000000-0000-0000-0000-000000000006/project-b.json','00000000-0000-0000-0000-000000000006');
insert into storage.objects(id,bucket_id,name,owner) values
 ('20000000-0000-0000-0000-000000000001','studio-drawings','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000005/member-a2.json','00000000-0000-0000-0000-000000000005'),
 ('20000000-0000-0000-0000-000000000002','studio-drawings','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/00000000-0000-0000-0000-000000000006/owner-b.json','00000000-0000-0000-0000-000000000006');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from studio_access_requests where status='pending'),2,'platform administrator can list pending requests');
select is((select count(*)::integer from studio_admin_pending_access()),2,'platform pending-request RPC is available to the platform administrator');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from studio_admin_pending_access()$$);
select is((select count(*)::integer from studio_projects),1,'member sees only projects in their active workspace');
select is((select count(*)::integer from studio_projects where workspace_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),0,'member cannot read another workspace project');
select is((select count(*)::integer from studio_workspaces where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),0,'member cannot list another workspace');
select lives_ok($$insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values('10000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','member-project','Member Project','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000004/member-project.json','00000000-0000-0000-0000-000000000004')$$,'member can create a correctly scoped project');
select throws_ok($$insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values('10000000-0000-0000-0000-000000000004','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cross-project','Cross Project','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/00000000-0000-0000-0000-000000000004/cross-project.json','00000000-0000-0000-0000-000000000004')$$);
select throws_ok($$insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values('10000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','wrong-owner','Wrong Owner','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000005/wrong-owner.json','00000000-0000-0000-0000-000000000004')$$);
select throws_ok($$insert into studio_memberships(workspace_id,user_id,role,status) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000008','owner','active')$$);
select lives_ok($$insert into storage.objects(id,bucket_id,name,owner) values('20000000-0000-0000-0000-000000000003','studio-drawings','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000004/member-a.json','00000000-0000-0000-0000-000000000004')$$,'member can write their own path in their active workspace');
select throws_ok($$insert into storage.objects(id,bucket_id,name,owner) values('20000000-0000-0000-0000-000000000004','studio-drawings','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000005/not-mine.json','00000000-0000-0000-0000-000000000004')$$);
select throws_ok($$insert into storage.objects(id,bucket_id,name,owner) values('20000000-0000-0000-0000-000000000005','studio-drawings','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/00000000-0000-0000-0000-000000000004/cross-workspace.json','00000000-0000-0000-0000-000000000004')$$);
select is((select count(*)::integer from storage.objects),2,'member can read objects in their workspace but not another workspace');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$insert into studio_company_profiles(workspace_id,details) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"companyName":"A"}')$$,'workspace owner can create company details');
select lives_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','suspended')$$,'owner can suspend a workspace administrator while another manager remains');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$update studio_company_profiles set details='{"companyName":"Escalated"}' where workspace_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,'blocked RLS update safely affects no row');
select is((select details->>'companyName' from studio_company_profiles where workspace_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),'A','ordinary member cannot change owner-only company details');
select throws_ok($$select * from studio_admin_workspace_members('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$);
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from studio_projects),0,'suspended administrator old JWT cannot read workspace projects');
select is((select count(*)::integer from storage.objects),0,'suspended administrator old JWT cannot read workspace storage');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','suspended')$$);
select throws_ok($$select studio_admin_approve_access('00000000-0000-0000-0000-000000000008','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','member')$$);
select lives_ok($$select studio_admin_approve_access('00000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','member')$$,'verified pending signup can be approved');
select is((select role from studio_admin_workspace_members('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') where user_id='00000000-0000-0000-0000-000000000007'),'member','approval grants only the explicitly requested safe role');
select is((select count(*)::integer from studio_platform_admins where user_id='00000000-0000-0000-0000-000000000007'),0,'approval never grants platform administration');
select lives_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active')$$,'platform administrator can reactivate a workspace administrator');
select lives_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','suspended')$$,'platform administrator can suspend an owner when another manager remains');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from studio_projects),0,'suspended owner old JWT cannot read workspace projects');
select throws_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','suspended')$$);
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from studio_admin_workspace_members('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),5,'active administrator can list only their workspace members');
select throws_ok($$select * from studio_admin_workspace_members('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$);
select throws_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active')$$);
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select studio_admin_set_member_status('00000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active')$$,'platform administrator can reactivate the owner');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from studio_projects),1,'second workspace owner sees only their own project');
select is((select count(*)::integer from storage.objects),1,'second workspace owner sees only their own storage object');
reset role;

select ok(not has_function_privilege('anon','public.studio_admin_pending_access()','execute'),'anonymous role cannot execute pending-request administration');
select ok(not has_function_privilege('anon','public.studio_admin_approve_access(uuid,uuid,text)','execute'),'anonymous role cannot execute approval administration');
select ok(not has_function_privilege('public','public.studio_capture_signup_request()','execute'),'signup trigger function is not callable by PUBLIC');
select ok((select not public from storage.buckets where id='studio-drawings'),'Studio storage bucket is private');
select throws_ok($$insert into studio_projects(id,workspace_id,project_id,name,object_path,updated_by) values('10000000-0000-0000-0000-000000000099','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bad-path','Bad Path','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/00000000-0000-0000-0000-000000000002/bad.json','00000000-0000-0000-0000-000000000002')$$);
select throws_ok($$update studio_company_profiles set logo_path='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/logo.png' where workspace_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$);

select * from finish();
rollback;
