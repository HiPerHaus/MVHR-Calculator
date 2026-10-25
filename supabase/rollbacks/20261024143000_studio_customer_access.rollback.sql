-- Controlled rollback for the customer-access migration.
-- Use only while the outer Vercel gate is still enabled and before accepting
-- real customer access requests. The guards fail closed rather than silently
-- reactivating a suspended member, demoting an administrator or discarding an
-- access request.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
 if exists(select 1 from public.studio_memberships where status <> 'active') then
  raise exception 'Customer-access rollback requires every membership to be active';
 end if;
 if exists(select 1 from public.studio_memberships where role = 'admin') then
  raise exception 'Customer-access rollback cannot silently demote workspace administrators';
 end if;
 if exists(select 1 from public.studio_access_requests) then
  raise exception 'Customer-access rollback cannot discard access requests';
 end if;
end $$;

drop trigger studio_capture_signup_request on auth.users;
drop policy studio_access_request_self_or_platform on public.studio_access_requests;

revoke all on function public.studio_admin_pending_access() from authenticated;
revoke all on function public.studio_admin_workspace_members(uuid) from authenticated;
revoke all on function public.studio_admin_approve_access(uuid,uuid,text) from authenticated;
revoke all on function public.studio_admin_set_member_status(uuid,uuid,text) from authenticated;
revoke all on function public.studio_is_platform_admin() from authenticated;

drop function public.studio_admin_pending_access();
drop function public.studio_admin_workspace_members(uuid);
drop function public.studio_admin_approve_access(uuid,uuid,text);
drop function public.studio_admin_set_member_status(uuid,uuid,text);
drop function public.studio_capture_signup_request();
drop function public.studio_is_platform_admin();

-- Restore the exact pre-customer-access policies. Membership rows remain
-- server-managed, and the original validated path constraints remain in force.
drop policy studio_workspace_member on public.studio_workspaces;
create policy studio_workspace_member on public.studio_workspaces for select to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=id and m.user_id=(select auth.uid()))
);
drop policy studio_projects_read on public.studio_projects;
create policy studio_projects_read on public.studio_projects for select to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
);
drop policy studio_projects_insert on public.studio_projects;
create policy studio_projects_insert on public.studio_projects for insert to authenticated with check (
 updated_by=(select auth.uid()) and save_version=1 and split_part(object_path,'/',2)=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
);
drop policy studio_projects_update on public.studio_projects;
create policy studio_projects_update on public.studio_projects for update to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
) with check (
 updated_by=(select auth.uid()) and split_part(object_path,'/',2)=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
);
drop policy studio_company_profile_read on public.studio_company_profiles;
create policy studio_company_profile_read on public.studio_company_profiles for select to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()))
);
drop policy studio_company_profile_insert on public.studio_company_profiles;
create policy studio_company_profile_insert on public.studio_company_profiles for insert to authenticated with check (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner')
);
drop policy studio_company_profile_update on public.studio_company_profiles;
create policy studio_company_profile_update on public.studio_company_profiles for update to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner')
) with check (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner')
);
drop policy studio_files_read on storage.objects;
create policy studio_files_read on storage.objects for select to authenticated using (
 bucket_id='studio-drawings' and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
);
drop policy studio_files_insert on storage.objects;
create policy studio_files_insert on storage.objects for insert to authenticated with check (
 bucket_id='studio-drawings' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
);
drop policy studio_files_remove on storage.objects;
create policy studio_files_remove on storage.objects for delete to authenticated using (
 bucket_id='studio-drawings' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
);

drop table public.studio_access_requests;
drop table public.studio_platform_admins;

alter table public.studio_memberships drop constraint studio_memberships_role_check;
alter table public.studio_memberships
 add constraint studio_memberships_role_check check(role in ('owner','member'));
alter table public.studio_memberships drop column status;

commit;
