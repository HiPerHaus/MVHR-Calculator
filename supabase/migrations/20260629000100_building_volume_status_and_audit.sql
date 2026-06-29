-- HiPer Studio — Building volume lifecycle + audit fields
-- Makes saved volume calculations reusable as canonical project geometry.

alter table public.building_volume_calculations
  add column if not exists status text not null default 'draft',
  add column if not exists page_classifications jsonb not null default '[]'::jsonb,
  add column if not exists selected_pdf_pages jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'building_volume_calculations_status_check'
  ) then
    alter table public.building_volume_calculations
      add constraint building_volume_calculations_status_check
      check (status in ('draft', 'needs_review', 'approved', 'superseded'));
  end if;
end $$;

alter table public.building_volume_zones
  add column if not exists height_source text,
  add column if not exists height_method text,
  add column if not exists height_assumed boolean not null default false,
  add column if not exists needs_review boolean not null default false,
  add column if not exists warning text,
  add column if not exists height_zones jsonb not null default '[]'::jsonb;

create index if not exists building_volume_project_status_version_idx
  on public.building_volume_calculations(project_id, status, version desc);

comment on column public.building_volume_calculations.status is
  'Lifecycle state: draft, needs_review, approved, or superseded. MVHR uses the latest approved calculation.';
comment on column public.building_volume_calculations.page_classifications is
  'PDF page classification output used to choose floor/ceiling/section/elevation/schedule pages.';
comment on column public.building_volume_calculations.selected_pdf_pages is
  'PDF pages selected by the user for the current calculation version.';
