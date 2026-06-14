-- ============================================================
-- HiPer Studio — Single-MVHR policy
-- Multi-storey projects use ONE MVHR + ONE ComfoWell/manifold set;
-- every floor routes back to that single unit. Per-floor distribution
-- assemblies are only allowed when a project is explicitly marked
-- multi-unit / multi-MVHR.
-- Idempotent.
-- ============================================================

alter table public.projects
  add column if not exists multi_mvhr boolean not null default false;

comment on column public.projects.multi_mvhr is
  'false (default): single MVHR + single ComfoWell/manifold set; every floor routes back to the one unit. '
  'true: allow per-floor distribution assemblies for multi-unit / multi-MVHR designs.';
