-- Add sheet_title to pdf_pages so classify-pages can store the drawing title
-- extracted from the title block. Used by auto-analyse for secondary page filtering.
alter table public.pdf_pages
  add column if not exists sheet_title text;

-- Extend page_type with granular sub-types introduced in the June 2026 classifier rewrite.
-- These replace the binary floor_plan/unknown with a full taxonomy.
-- No enum used — plain text is more forward-compatible.
comment on column public.pdf_pages.page_type is
  'Drawing type. Values: floor_plan_primary | floor_plan_detail | ceiling_plan | '
  'roof_plan | electrical_plan | lighting_plan | plumbing_plan | slab_plan | '
  'section | elevation | schedule | detail | site_plan | specification | '
  'floor_plan (legacy) | unknown | unclassified | other';
