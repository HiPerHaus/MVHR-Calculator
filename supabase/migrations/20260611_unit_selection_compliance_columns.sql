alter table airflow_designs
add column if not exists ph_override_justification text,
add column if not exists ph_override_by uuid,
add column if not exists ph_override_at timestamptz,
add column if not exists selected_unit_compliance jsonb;

notify pgrst, 'reload schema';
