// api/admin/invite-user.js
// POST /api/admin/invite-user { email, fullName }
// Sends a Supabase magic-link invite to the given email.
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

  const { email, fullName } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'email required' });

  // Derive redirect URL from the incoming request origin so invite links always
  // point at the real deployed app — with APP_URL as a fallback for local dev.
  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || process.env.APP_URL || '';

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email.trim(), {
    data: { full_name: fullName?.trim() || '' },
    redirectTo: origin,
  });

  if (error) {
    console.error('invite error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ invited: data.user?.email });
}
