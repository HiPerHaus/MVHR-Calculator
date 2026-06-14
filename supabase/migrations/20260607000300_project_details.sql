-- ── Project detail columns ─────────────────────────────────────────────────────
-- Adds structured address + metadata fields to the projects table.
-- "state" here means Australian state/territory (e.g. SA, VIC, NSW).
-- storey_count already exists; we keep it as the canonical storeys column.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists client_name    text,
  add column if not exists site_address   text,
  add column if not exists suburb         text,
  add column if not exists address_state  text,   -- AU state/territory abbreviation
  add column if not exists postcode       text,
  add column if not exists building_type  text,   -- e.g. 'residential', 'commercial'
  add column if not exists notes          text;

-- storey_count already exists (integer not null default 1) — no change needed.

comment on column public.projects.client_name   is 'Name of the client or homeowner';
comment on column public.projects.site_address  is 'Street address of the project site';
comment on column public.projects.suburb        is 'Suburb of the project site';
comment on column public.projects.address_state is 'Australian state/territory abbreviation, e.g. SA';
comment on column public.projects.postcode      is 'Postcode of the project site';
comment on column public.projects.building_type is 'Building type, e.g. residential, commercial';
comment on column public.projects.notes         is 'Free-form notes about the project';
