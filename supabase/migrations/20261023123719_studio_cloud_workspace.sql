-- Separate hosted drawing records; legacy projects and uploads are untouched.
create table public.studio_workspaces (
 id uuid primary key,
 name text not null check (length(name) between 1 and 160),
 created_at timestamptz not null default now()
);
create table public.studio_memberships (
 workspace_id uuid not null references public.studio_workspaces(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(workspace_id,user_id)
);
create index studio_memberships_user_idx on public.studio_memberships(user_id);
create table public.studio_projects (
 id uuid primary key,
 workspace_id uuid not null references public.studio_workspaces(id),
 project_id text not null check(length(project_id) between 3 and 250),
 name text not null check(length(name) between 1 and 120),
 object_path text not null,
 previous_object_path text,
 save_version bigint not null default 1 check(save_version>0),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 constraint studio_path_workspace check (split_part(object_path,'/',1)=workspace_id::text),
 constraint studio_previous_path_workspace check (previous_object_path is null or split_part(previous_object_path,'/',1)=workspace_id::text)
);
create index studio_projects_workspace_idx on public.studio_projects(workspace_id,updated_at desc);
alter table public.studio_workspaces enable row level security;
alter table public.studio_memberships enable row level security;
alter table public.studio_projects enable row level security;
revoke all on public.studio_workspaces,public.studio_memberships,public.studio_projects from anon,authenticated;
grant select on public.studio_workspaces,public.studio_memberships to authenticated;
grant select,insert,update on public.studio_projects to authenticated;
create policy studio_membership_self on public.studio_memberships for select to authenticated using (user_id=(select auth.uid()));
create policy studio_workspace_member on public.studio_workspaces for select to authenticated using (exists(select 1 from public.studio_memberships m where m.workspace_id=id and m.user_id=(select auth.uid())));
create policy studio_projects_read on public.studio_projects for select to authenticated using (exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid())));
create policy studio_projects_insert on public.studio_projects for insert to authenticated with check (
 updated_by=(select auth.uid()) and save_version=1 and split_part(object_path,'/',2)=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
);
create policy studio_projects_update on public.studio_projects for update to authenticated using (
 exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
) with check (
 updated_by=(select auth.uid()) and split_part(object_path,'/',2)=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id=studio_projects.workspace_id and m.user_id=(select auth.uid()))
);
create function public.studio_project_stamp() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if NEW.id<>OLD.id or NEW.workspace_id<>OLD.workspace_id or NEW.project_id<>OLD.project_id then
   raise exception 'Cloud project identity cannot be changed';
  end if;
  NEW.save_version:=OLD.save_version+1;
  NEW.previous_object_path:=OLD.object_path;
 else
  NEW.save_version:=1;
  NEW.previous_object_path:=null;
 end if;
 NEW.updated_by:=auth.uid();
 NEW.updated_at:=now();
 return NEW;
end $$;
revoke all on function public.studio_project_stamp() from public,anon,authenticated;
create trigger studio_project_stamp before insert or update on public.studio_projects for each row execute function public.studio_project_stamp();
-- Bootstrap only accounts already present at rollout. Clients cannot add memberships.
insert into public.studio_workspaces(id,name)
 select distinct p.company_id,c.name from public.profiles p join public.companies c on c.id=p.company_id where p.company_id is not null;
insert into public.studio_workspaces(id,name)
 select p.id,'Private workspace' from public.profiles p where p.company_id is null;
insert into public.studio_memberships(workspace_id,user_id)
 select coalesce(company_id,id),id from public.profiles;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('studio-drawings','studio-drawings',false,50331648,array['application/json']);
create policy studio_files_read on storage.objects for select to authenticated using (
 bucket_id='studio-drawings' and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
);
create policy studio_files_insert on storage.objects for insert to authenticated with check (
 bucket_id='studio-drawings' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
);
create policy studio_files_remove on storage.objects for delete to authenticated using (
 bucket_id='studio-drawings' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.studio_memberships m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
);
