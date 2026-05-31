// api/admin/invite-user.js
// POST /api/admin/invite-user { email, fullName, templateSlug }
// Sends a Supabase magic-link invite to the given email using the specified email template.
// Admin only.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function requireAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  return profile?.is_admin ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const { email, fullName, companyName, templateSlug } = req.body;
  if (!email?.trim())        return res.status(400).json({ error: 'email required' });
  if (!templateSlug?.trim()) return res.status(400).json({ error: 'templateSlug required' });

  // Fetch the chosen email template
  const { data: tpl, error: tplErr } = await supabase
    .from('email_templates')
    .select('slug, label, subject, body_html')
    .eq('slug', templateSlug.trim())
    .single();

  if (tplErr || !tpl) return res.status(400).json({ error: `Template '${templateSlug}' not found` });

  // Derive redirect URL from the incoming request origin so invite links always
  // point at the real deployed app — with APP_URL as a fallback for local dev.
  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || process.env.APP_URL || '';

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email.trim(), {
    data: {
      full_name:     fullName?.trim() || '',
      company_name:  companyName?.trim() || '',
      email_subject: tpl.subject,
      email_html:    tpl.body_html
        .replace(/\{\{name\}\}/g,    fullName?.trim() || email.trim())
        .replace(/\{\{email\}\}/g,   email.trim())
        .replace(/\{\{company\}\}/g, companyName?.trim() || ''),
    },
    redirectTo: origin,
  });

  if (error) {
    console.error('invite error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ invited: data.user?.email, template: tpl.slug });
}
