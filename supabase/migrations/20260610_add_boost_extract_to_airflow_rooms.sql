alter table airflow_rooms
add column if not exists boost_extract_m3h numeric;

notify pgrst, 'reload schema';
