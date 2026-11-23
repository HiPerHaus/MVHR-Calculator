create table public.studio_workspace_integrations (
  workspace_id uuid primary key references public.studio_workspaces(id) on delete cascade,
  hiper_os_enabled boolean not null default false
);

alter table public.studio_workspace_integrations enable row level security;
revoke all on public.studio_workspace_integrations from public, anon, authenticated;
grant select, insert on public.studio_workspace_integrations to authenticated;
grant update (hiper_os_enabled) on public.studio_workspace_integrations to authenticated;

create policy studio_integrations_read on public.studio_workspace_integrations
  for select to authenticated using (exists (
    select 1 from public.studio_memberships m
    where m.workspace_id = studio_workspace_integrations.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create policy studio_integrations_insert on public.studio_workspace_integrations
  for insert to authenticated with check (exists (
    select 1 from public.studio_memberships m
    where m.workspace_id = studio_workspace_integrations.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('owner', 'admin')
  ));

create policy studio_integrations_update on public.studio_workspace_integrations
  for update to authenticated using (exists (
    select 1 from public.studio_memberships m
    where m.workspace_id = studio_workspace_integrations.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('owner', 'admin')
  ));
