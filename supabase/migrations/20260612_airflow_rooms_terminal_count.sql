-- Task #41: Add recommended_terminal_count to airflow_rooms
-- Populated by the engine's balance step; used on the Airflow page and Commissioning schedule.

alter table airflow_rooms
  add column if not exists recommended_terminal_count integer;

comment on column airflow_rooms.recommended_terminal_count
  is 'Engine-recommended terminal count for supply rooms: 1 (≤40), 2 (41-70), 3 (>70 m³/h). NULL for extract/transfer rooms.';

notify pgrst, 'reload schema';
