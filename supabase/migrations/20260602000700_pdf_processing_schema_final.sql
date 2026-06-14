
alter table public.pdf_uploads

add column if not exists error_detail text,

add column if not exists error_code text,

add column if not exists completed_at timestamptz,

add column if not exists failed_at timestamptz;

alter table public.pdf_pages

add column if not exists is_temporary boolean default false,

add column if not exists page_width_mm numeric,

add column if not exists page_height_mm numeric,

add column if not exists storage_path text,

add column if not exists image_storage_path text,

add column if not exists thumbnail_path text,

add column if not exists page_type text,

add column if not exists sheet_number text,

add column if not exists sheet_title text,

add column if not exists confidence numeric,

add column if not exists render_width_px integer,

add column if not exists render_height_px integer,

add column if not exists image_format text,

add column if not exists image_size_bytes bigint,

add column if not exists thumb_path text,

add column if not exists thumb_width_px integer,

add column if not exists thumb_height_px integer,

add column if not exists thumb_size_bytes bigint,

add column if not exists classification_reason text,

add column if not exists classification_model text,

add column if not exists classification_raw jsonb default '{}'::jsonb,

add column if not exists floor_level text,

add column if not exists floor_name text,

add column if not exists floor_number integer,

add column if not exists detected_floor text,

add column if not exists building_section text,

add column if not exists floor_plan_type text,

add column if not exists has_floor_levels boolean,

add column if not exists has_ceiling_heights boolean,

add column if not exists has_room_labels boolean,

add column if not exists has_dimensions boolean,

add column if not exists has_scale boolean,

add column if not exists has_roof_geometry boolean,

add column if not exists has_elevation_data boolean,

add column if not exists has_sections boolean,

add column if not exists has_schedules boolean,

add column if not exists has_site_plan boolean;

create unique index if not exists pdf_pages_pdf_upload_page_unique_idx

on public.pdf_pages (pdf_upload_id, page_number);

notify pgrst, 'reload schema';

