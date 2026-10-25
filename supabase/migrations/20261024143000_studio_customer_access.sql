-- Proposed customer-access layer. Apply only after production auth configuration review.
alter table public.studio_memberships drop constraint if exists studio_memberships_role_check;
alter table public.studio_memberships
 add constraint studio_memberships_role_check check(role in ('owner','admin','member'));
alter table public.studio_memberships
 add column status text not null default 'active' check(status in ('active','suspended'));

-- The deployed Studio baseline already has validated workspace-path checks:
-- studio_path_workspace, studio_previous_path_workspace and the inline
-- studio_company_profiles logo_path check. Do not duplicate them here.

create table public.studio_platform_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.studio_access_requests (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null check(length(email) between 3 and 254 and email=lower(email)),
 full_name text not null check(length(full_name) between 1 and 160),
 company_name text not null check(length(company_name) between 1 and 160),
 status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
 email_verified_at timestamptz,
 requested_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id)
);
create index studio_access_requests_status_idx on public.studio_access_requests(status,requested_at);

alter table public.studio_platform_admins enable row level security;
alter table public.studio_access_requests enable row level security;
revoke all on public.studio_platform_admins,public.studio_access_requests from anon,authenticated;
grant select on public.studio_platform_admins,public.studio_access_requests to authenticated;

create function public.studio_is_platform_admin() returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.studio_platform_admins where user_id=(select auth.uid()));
$$;
revoke all on function public.studio_is_platform_admin() from public,anon;
grant execute on function public.studio_is_platform_admin() to authenticated;

create policy studio_platform_admin_self on public.studio_platform_admins for select to authenticated
 using(user_id=(select auth.uid()));
create policy studio_access_request_self_or_platform on public.studio_access_requests for select to authenticated
 using(user_id=(select auth.uid()) or (select public.studio_is_platform_admin()));

-- Auth owns request creation. Client-supplied metadata never controls approval, role or workspace.
create function public.studio_capture_signup_request() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.email is not null and coalesce(new.raw_user_meta_data->>'studio_signup','false')='true' then
  insert into public.studio_access_requests(user_id,email,full_name,company_name,email_verified_at)
  values(
   new.id,
   lower(new.email),
   left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Pending customer'),160),
   left(coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'),''),'Unassigned company'),160),
   new.email_confirmed_at
  )
  on conflict(user_id) do update set
   email=excluded.email,
   email_verified_at=excluded.email_verified_at;
 end if;
 return new;
end $$;
revoke all on function public.studio_capture_signup_request() from public,anon,authenticated;
create trigger studio_capture_signup_request
 after insert or update of email,email_confirmed_at,raw_user_meta_data on auth.users
 for each row execute function public.studio_capture_signup_request();

-- Suspended memberships remain self-visible for an honest access-status message, but grant no workspace data.
drop policy studio_workspace_member on public.studio_workspaces;
create policy studio_workspace_member on public.studio_workspaces for select to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=id and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_projects_read on public.studio_projects;
create policy studio_projects_read on public.studio_projects for select to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_projects_insert on public.studio_projects;
create policy studio_projects_insert on public.studio_projects for insert to authenticated with check (
 updated_by=(select auth.uid()) and save_version=1
 and split_part(object_path,'/',1)=workspace_id::text and split_part(object_path,'/',2)=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_projects_update on public.studio_projects;
create policy studio_projects_update on public.studio_projects for update to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
) with check (
 updated_by=(select auth.uid()) and split_part(object_path,'/',1)=workspace_id::text
 and split_part(object_path,'/',2)=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_company_profile_read on public.studio_company_profiles;
create policy studio_company_profile_read on public.studio_company_profiles for select to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_company_profile_insert on public.studio_company_profiles;
create policy studio_company_profile_insert on public.studio_company_profiles for insert to authenticated with check (
 (logo_path is null or split_part(logo_path,'/',1)=workspace_id::text)
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner' and m.status='active')
);
drop policy studio_company_profile_update on public.studio_company_profiles;
create policy studio_company_profile_update on public.studio_company_profiles for update to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner' and m.status='active')
) with check (
 (logo_path is null or split_part(logo_path,'/',1)=workspace_id::text)
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner' and m.status='active')
);
drop policy studio_files_read on storage.objects;
create policy studio_files_read on storage.objects for select to authenticated using (
 bucket_id='studio-drawings' and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_files_insert on storage.objects;
create policy studio_files_insert on storage.objects for insert to authenticated with check (
 bucket_id='studio-drawings' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.status='active')
);
drop policy studio_files_remove on storage.objects;
create policy studio_files_remove on storage.objects for delete to authenticated using (
 bucket_id='studio-drawings' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.status='active')
);

create function public.studio_admin_pending_access()
 returns table(user_id uuid,email text,full_name text,company_name text,status text,email_verified_at timestamptz,requested_at timestamptz)
 language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.studio_platform_admins a where a.user_id=(select auth.uid())) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 return query select r.user_id,r.email,r.full_name,r.company_name,r.status,r.email_verified_at,r.requested_at
  from public.studio_access_requests r where r.status='pending' order by r.requested_at;
end $$;

create function public.studio_admin_workspace_members(p_workspace_id uuid)
 returns table(user_id uuid,email text,role text,status text)
 language plpgsql security definer set search_path='' as $$
declare caller_role text;
begin
 select m.role into caller_role from public.studio_memberships m
  where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.status='active';
 if coalesce(caller_role,'') not in ('owner','admin') and not exists(select 1 from public.studio_platform_admins a where a.user_id=(select auth.uid())) then
  raise exception 'Workspace administrator access required' using errcode='42501';
 end if;
 return query select m.user_id,u.email::text,m.role,m.status from public.studio_memberships m
  join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace_id order by u.email;
end $$;

create function public.studio_admin_approve_access(p_user_id uuid,p_workspace_id uuid,p_role text)
 returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.studio_platform_admins a where a.user_id=(select auth.uid())) then
  raise exception 'Platform administrator access required' using errcode='42501';
 end if;
 if p_role not in ('admin','member') then raise exception 'Approval role is invalid'; end if;
 if not exists(select 1 from public.studio_access_requests r where r.user_id=p_user_id and r.status='pending' and r.email_verified_at is not null) then
  raise exception 'A verified pending request is required';
 end if;
 insert into public.studio_memberships(workspace_id,user_id,role,status)
  values(p_workspace_id,p_user_id,p_role,'active');
 update public.studio_access_requests set status='approved',reviewed_at=now(),reviewed_by=(select auth.uid()) where user_id=p_user_id;
end $$;

create function public.studio_admin_set_member_status(p_user_id uuid,p_workspace_id uuid,p_status text)
 returns void language plpgsql security definer set search_path='' as $$
declare caller_role text; target_role text; platform_admin boolean;
begin
 if p_status not in ('active','suspended') then raise exception 'Membership status is invalid'; end if;
 perform 1 from public.studio_memberships m where m.workspace_id=p_workspace_id for update;
 platform_admin:=exists(select 1 from public.studio_platform_admins a where a.user_id=(select auth.uid()));
 select m.role into caller_role from public.studio_memberships m
  where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.status='active';
 select m.role into target_role from public.studio_memberships m where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if target_role is null then raise exception 'Membership not found'; end if;
 if p_user_id=(select auth.uid()) then raise exception 'Administrators cannot change their own status'; end if;
 if not platform_admin
  and not (coalesce(caller_role,'')='owner' and target_role in ('admin','member'))
  and not (coalesce(caller_role,'')='admin' and target_role='member') then
  raise exception 'Insufficient role to manage this member' using errcode='42501';
 end if;
 if p_status='suspended' and target_role in ('owner','admin') and not exists(
  select 1 from public.studio_memberships m where m.workspace_id=p_workspace_id and m.user_id<>p_user_id
   and m.status='active' and m.role in ('owner','admin')
 ) then
  raise exception 'A workspace must retain at least one active owner or administrator' using errcode='23514';
 end if;
 update public.studio_memberships set status=p_status where workspace_id=p_workspace_id and user_id=p_user_id;
 if p_status='active' then
  update public.studio_access_requests set status='approved',reviewed_at=now(),reviewed_by=(select auth.uid()) where user_id=p_user_id;
 elsif not exists(select 1 from public.studio_memberships m where m.user_id=p_user_id and m.status='active') then
  update public.studio_access_requests set status='suspended',reviewed_at=now(),reviewed_by=(select auth.uid()) where user_id=p_user_id;
 end if;
end $$;

revoke all on function public.studio_admin_pending_access() from public,anon;
revoke all on function public.studio_admin_workspace_members(uuid) from public,anon;
revoke all on function public.studio_admin_approve_access(uuid,uuid,text) from public,anon;
revoke all on function public.studio_admin_set_member_status(uuid,uuid,text) from public,anon;
grant execute on function public.studio_admin_pending_access() to authenticated;
grant execute on function public.studio_admin_workspace_members(uuid) to authenticated;
grant execute on function public.studio_admin_approve_access(uuid,uuid,text) to authenticated;
grant execute on function public.studio_admin_set_member_status(uuid,uuid,text) to authenticated;
