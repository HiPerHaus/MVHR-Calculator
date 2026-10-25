-- Test-only stand-in for the legacy application schema that exists before Studio migrations.
-- This fixture is copied ahead of the production migrations by check-supabase-local.mjs.
create table public.companies (
  id uuid primary key,
  name text not null,
  owner_id uuid references auth.users(id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id)
);
