-- Add requires_manual_review to project_rooms.
-- Set by the AI pipeline (seed-rooms) when a room was created from assumptions,
-- has a personal label, ambiguous name, or was reclassified from a misidentified type.
-- Exposed in the Room Schedule UI as a "Needs Review" indicator.
alter table public.project_rooms
  add column if not exists requires_manual_review boolean not null default false;

comment on column public.project_rooms.requires_manual_review is
  'True when the room was created from assumptions, personal labels, ambiguous names, '
  'inferred classifications, or low-confidence AI extractions. Prompts the user to '
  'verify the room before proceeding to airflow calculations.';
