-- ============================================================
-- HiPer Studio — Pricing Simplification Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. OPERATION COSTS
-- Remove all old operations, keep only basic_design and redesign

DELETE FROM public.operation_costs
WHERE operation NOT IN ('basic_design', 'redesign');

UPDATE public.operation_costs
SET credits = 10,
    label   = 'Residential MVHR design',
    level   = 1
WHERE operation = 'basic_design';

INSERT INTO public.operation_costs (operation, credits, label, level)
VALUES ('redesign', 2, 'Redesign', 1)
ON CONFLICT (operation) DO UPDATE
  SET credits = 2,
      label   = 'Redesign',
      level   = 1;


-- 2. CREDIT PACKAGES
-- Replace Starter / Professional / Business with new pricing

UPDATE public.credit_packages
SET name      = 'Single Design',
    credits   = 10,
    price_aud = 349.00,
    sort_order = 1
WHERE name = 'Starter' OR sort_order = 1;

UPDATE public.credit_packages
SET name      = 'Design Pack',
    credits   = 50,
    price_aud = 1495.00,
    sort_order = 2
WHERE name = 'Professional' OR sort_order = 2;

UPDATE public.credit_packages
SET name      = 'Studio Pack',
    credits   = 150,
    price_aud = 3750.00,
    sort_order = 3
WHERE name = 'Business' OR sort_order = 3;

-- If packages don't exist yet, insert them
INSERT INTO public.credit_packages (name, credits, price_aud, sort_order)
VALUES
  ('Single Design', 10,  349.00,  1),
  ('Design Pack',   50,  1495.00, 2),
  ('Studio Pack',   150, 3750.00, 3)
ON CONFLICT DO NOTHING;


-- 3. VERIFY
SELECT 'operation_costs' AS "table", operation, credits, label FROM public.operation_costs ORDER BY level, operation
UNION ALL
SELECT 'credit_packages', name, credits::integer, '$' || price_aud::text FROM public.credit_packages ORDER BY 1, 3;
