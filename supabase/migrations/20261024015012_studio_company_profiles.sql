alter table public.studio_memberships add column role text not null default 'member' check(role in ('owner','member'));
update public.studio_memberships m set role='owner' where m.workspace_id=m.user_id or exists(select 1 from public.companies c where c.id=m.workspace_id and c.owner_id=m.user_id);
create table public.studio_company_profiles (
 workspace_id uuid primary key references public.studio_workspaces(id),
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and octet_length(details::text)<=8192),
 logo_path text check(logo_path is null or split_part(logo_path,'/',1)=workspace_id::text),
 version bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.studio_company_profiles enable row level security;
revoke all on public.studio_company_profiles from anon,authenticated;
grant select,insert,update on public.studio_company_profiles to authenticated;
create policy studio_company_profile_read on public.studio_company_profiles for select to authenticated using(exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid())));
create policy studio_company_profile_insert on public.studio_company_profiles for insert to authenticated with check(exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner'));
create policy studio_company_profile_update on public.studio_company_profiles for update to authenticated using(exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner')) with check(exists(select 1 from public.studio_memberships m where m.workspace_id=studio_company_profiles.workspace_id and m.user_id=(select auth.uid()) and m.role='owner'));
create function public.studio_company_profile_stamp() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if NEW.workspace_id<>OLD.workspace_id then raise exception 'Workspace cannot change'; end if;
  NEW.version:=OLD.version+1;
 else NEW.version:=1;
 end if;
 NEW.updated_at:=now(); return NEW;
end $$;
revoke all on function public.studio_company_profile_stamp() from public,anon,authenticated;
create trigger studio_company_profile_stamp before insert or update on public.studio_company_profiles for each row execute function public.studio_company_profile_stamp();
insert into public.studio_company_profiles(workspace_id,details) select id,jsonb_build_object('companyName',case when name='Private workspace' then '' else name end) from public.studio_workspaces;
