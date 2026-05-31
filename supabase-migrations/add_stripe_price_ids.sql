-- Migration: set Stripe product/price IDs on credit_packages
-- Run once in Supabase SQL editor (or via supabase db push)

update public.credit_packages
set stripe_price_id = 'price_1Td5yvLXwyKSOp0hI5otpSco'
where name = 'Single Design';

update public.credit_packages
set stripe_price_id = 'price_1Td5zQLXwyKSOp0hneoHcGPB'
where name = 'Design Pack';

update public.credit_packages
set stripe_price_id = 'price_1Td6D3LXwyKSOp0hXMbyW0fN'
where name = 'Studio Pack';
