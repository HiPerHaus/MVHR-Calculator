-- ============================================================
-- Duct Design migration (Stage 6)
-- Tables: duct_designs, duct_nodes, duct_runs
-- ============================================================

-- duct_designs: one per project (draft or saved)
create table if not exists duct_designs (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  airflow_design_id uuid references airflow_designs(id),
  selected_unit_id  text,
  status            text not null default 'draft',
  design_json       jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- duct_nodes
create table if not exists duct_nodes (
  id               uuid primary key default gen_random_uuid(),
  duct_design_id   uuid not null references duct_designs(id) on delete cascade,
  node_type        text not null,
  -- node_type values: mvhr_unit | supply_manifold | extract_manifold |
  --                   supply_terminal | extract_terminal | transfer_zone |
  --                   external_intake | external_exhaust
  project_room_id  uuid references project_rooms(id),
  room_name        text,
  floor_index      integer,
  x                numeric not null default 0,
  y                numeric not null default 0,
  airflow_m3h      numeric,
  duct_diameter_mm numeric,
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- duct_runs
create table if not exists duct_runs (
  id               uuid primary key default gen_random_uuid(),
  duct_design_id   uuid not null references duct_designs(id) on delete cascade,
  from_node_id     uuid not null references duct_nodes(id) on delete cascade,
  to_node_id       uuid not null references duct_nodes(id) on delete cascade,
  run_type         text not null,
  -- run_type values: supply | extract | intake | exhaust
  duct_type        text not null default 'semi_rigid_90',
  -- duct_type values: semi_rigid_90 | epp_160 | epp_180 | custom
  diameter_mm      numeric not null default 90,
  length_m         numeric,
  pressure_drop_pa numeric,
  route_points     jsonb,
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Updated_at trigger function (create or replace — idempotent)
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_duct_designs_updated_at on duct_designs;
create trigger trg_duct_designs_updated_at
  before update on duct_designs
  for each row execute function update_updated_at_column();

drop trigger if exists trg_duct_nodes_updated_at on duct_nodes;
create trigger trg_duct_nodes_updated_at
  before update on duct_nodes
  for each row execute function update_updated_at_column();

drop trigger if exists trg_duct_runs_updated_at on duct_runs;
create trigger trg_duct_runs_updated_at
  before update on duct_runs
  for each row execute function update_updated_at_column();

-- RLS
alter table duct_designs enable row level security;
alter table duct_nodes   enable row level security;
alter table duct_runs    enable row level security;

-- duct_designs policies
create policy "duct_designs_select" on duct_designs for select using (
  exists (select 1 from projects where projects.id = duct_designs.project_id and projects.user_id = auth.uid())
);
create policy "duct_designs_insert" on duct_designs for insert with check (
  exists (select 1 from projects where projects.id = duct_designs.project_id and projects.user_id = auth.uid())
);
create policy "duct_designs_update" on duct_designs for update using (
  exists (select 1 from projects where projects.id = duct_designs.project_id and projects.user_id = auth.uid())
);
create policy "duct_designs_delete" on duct_designs for delete using (
  exists (select 1 from projects where projects.id = duct_designs.project_id and projects.user_id = auth.uid())
);

-- duct_nodes policies
create policy "duct_nodes_select" on duct_nodes for select using (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_nodes.duct_design_id and p.user_id = auth.uid()
  )
);
create policy "duct_nodes_insert" on duct_nodes for insert with check (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_nodes.duct_design_id and p.user_id = auth.uid()
  )
);
create policy "duct_nodes_update" on duct_nodes for update using (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_nodes.duct_design_id and p.user_id = auth.uid()
  )
);
create policy "duct_nodes_delete" on duct_nodes for delete using (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_nodes.duct_design_id and p.user_id = auth.uid()
  )
);

-- duct_runs policies
create policy "duct_runs_select" on duct_runs for select using (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_runs.duct_design_id and p.user_id = auth.uid()
  )
);
create policy "duct_runs_insert" on duct_runs for insert with check (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_runs.duct_design_id and p.user_id = auth.uid()
  )
);
create policy "duct_runs_update" on duct_runs for update using (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_runs.duct_design_id and p.user_id = auth.uid()
  )
);
create policy "duct_runs_delete" on duct_runs for delete using (
  exists (
    select 1 from duct_designs dd join projects p on p.id = dd.project_id
    where dd.id = duct_runs.duct_design_id and p.user_id = auth.uid()
  )
);
