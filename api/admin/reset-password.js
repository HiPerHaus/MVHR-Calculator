// api/admin/reset-password.js
// POST /api/admin/reset-password { userId, password }
// Sets a temporary password and flags the user to change it on next login.
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
    .from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'userId and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  // Update auth password and set must_change_password flag in user metadata
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { must_change_password: true },
  });

  if (error) {
    console.error('reset-password error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ reset: true });
}
