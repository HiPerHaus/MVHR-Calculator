// api/admin/cancel-invite.js
// POST /api/admin/cancel-invite { userId }  → deletes the pending user
// POST /api/admin/cancel-invite { userId, resend: true, email } → resends invite

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
    .from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const { userId, email, resend } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  if (resend) {
    // Resend: delete existing pending user, then re-invite
    await supabase.auth.admin.deleteUser(userId);
    const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: process.env.APP_URL || 'https://your-app.vercel.app',
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ resent: true });
  } else {
    // Cancel: delete the pending user entirely
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ cancelled: true });
  }
}
