-- ============================================================
-- HiPer Studio — Email Templates
-- Run in Supabase SQL Editor
-- ============================================================

create table public.email_templates (
  id          uuid primary key default uuid_generate_v4(),
  slug        text not null unique,   -- e.g. 'invite', 'welcome', 'password_reset'
  label       text not null,          -- display name, e.g. 'Invite Email'
  subject     text not null default '',
  body_html   text not null default '',
  variables   text[] not null default '{}',  -- variable names available in this template
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

-- Admin-only RLS
alter table public.email_templates enable row level security;

create policy "Admin full access"
  on public.email_templates
  for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

create trigger email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

-- Seed the invite template
insert into public.email_templates (slug, label, subject, body_html, variables) values (
  'invite',
  'User Invite',
  'You''ve been invited to HiPer Studio',
  '<p>Hi {{name}},</p>
<p>You have been invited to <strong>HiPer Studio</strong> — the Passivhaus-aligned MVHR sizing and documentation tool.</p>
<p>Click the button below to set your password and get started.</p>
<p style="text-align:center;margin:28px 0">
  <a href="{{link}}" style="background:#1a4731;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Accept Invitation →</a>
</p>
<p style="color:#6b7280;font-size:13px">If you did not expect this invitation, you can safely ignore this email.</p>',
  ARRAY['{{name}}', '{{email}}', '{{link}}']
);
