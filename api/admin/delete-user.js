// api/admin/delete-user.js
// POST /api/admin/delete-user { userId }
// Permanently deletes a user from auth + profiles. Admin only.

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

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // Prevent self-deletion
  if (userId === admin.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  // Delete from auth (cascade should handle profiles, but also delete explicitly)
  const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
  if (authErr) {
    console.error('delete-user auth error:', authErr);
    return res.status(500).json({ error: authErr.message });
  }

  // Delete profile row (may already be cascade-deleted, ignore error)
  await supabase.from('profiles').delete().eq('id', userId);

  return res.status(200).json({ deleted: true });
}
