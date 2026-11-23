-- Short-lived receipts contain no drawings, prices or credentials.
create table public.studio_os_takeoff_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  sender uuid not null references auth.users(id) on delete cascade,
  design_id uuid not null,
  payload jsonb not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index studio_os_receipts_expiry on public.studio_os_takeoff_receipts(expires_at);
alter table public.studio_os_takeoff_receipts enable row level security;
revoke all on public.studio_os_takeoff_receipts from public, anon, authenticated;

create function public.studio_issue_os_takeoff(p_project uuid, p_version bigint, p_design uuid, p_schedule jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare receipt uuid;
begin
  if not exists (
    select 1 from public.studio_projects p
    join public.studio_workspace_integrations i on i.workspace_id = p.workspace_id and i.hiper_os_enabled
    join public.studio_memberships m on m.workspace_id = p.workspace_id
    where p.id = p_project and p.save_version = p_version
      and m.user_id = auth.uid() and m.status = 'active'
  ) then raise exception 'Workspace integration unavailable or drawing version changed.'; end if;
  if p_design is null or p_schedule is null or jsonb_typeof(p_schedule) <> 'object'
    or octet_length(p_schedule::text) > 500000 then raise exception 'Invalid parts schedule.'; end if;
  delete from public.studio_os_takeoff_receipts where expires_at <= now();
  insert into public.studio_os_takeoff_receipts(project_id, sender, design_id, payload)
    values (p_project, auth.uid(), p_design, p_schedule) returning id into receipt;
  return receipt;
end;
$$;
revoke all on function public.studio_issue_os_takeoff(uuid,bigint,uuid,jsonb) from public,anon;
grant execute on function public.studio_issue_os_takeoff(uuid,bigint,uuid,jsonb) to authenticated;

-- Possession of the opaque receipt and destination revision authorises retrieval.
-- Recheck membership and the setting even if a receipt was issued before a change.
create function public.studio_read_os_takeoff(p_receipt uuid, p_design uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select r.payload from public.studio_os_takeoff_receipts r
  join public.studio_projects p on p.id = r.project_id
  join public.studio_workspace_integrations i on i.workspace_id = p.workspace_id and i.hiper_os_enabled
  join public.studio_memberships m on m.workspace_id = p.workspace_id and m.user_id = r.sender and m.status = 'active'
  where r.id = p_receipt and r.design_id = p_design and r.expires_at > now()
$$;
revoke all on function public.studio_read_os_takeoff(uuid,uuid) from public;
grant execute on function public.studio_read_os_takeoff(uuid,uuid) to anon,authenticated;
