// api/admin/users.js
// GET /api/admin/users?page=0&limit=50&q=email_search
// Returns: { users: [...], total: N }
// Admin only — verified via is_admin flag in profiles table.

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
  if (req.method !== 'GET') return res.status(405).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const page  = Math.max(0, parseInt(req.query.page  || '0'));
  const limit = Math.min(100, parseInt(req.query.limit || '50'));
  const q     = (req.query.q || '').trim().toLowerCase();

  // Fetch from profiles (service role bypasses RLS)
  let query = supabase
    .from('profiles')
    .select('id, email, full_name, company_name, credit_balance, plan_type, is_admin, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (q) {
    query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,company_name.ilike.%${q}%`);
  }

  const { data: users, count, error } = await query;
  if (error) {
    console.error('admin/users error:', error);
    return res.status(500).json({ error: 'Query failed' });
  }

  // Enrich: last sign-in from auth.users via admin API
  // Supabase Admin API: listUsers (paginates by 50 default)
  // We batch-match by IDs to avoid N+1
  let lastSignIn = {};
  try {
    const ids = (users || []).map(u => u.id);
    // Use auth.admin.listUsers and match
    const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    (authData?.users || []).forEach(u => {
      if (ids.includes(u.id)) lastSignIn[u.id] = u.last_sign_in_at;
    });
  } catch(e) { /* non-fatal */ }

  const enriched = (users || []).map(u => ({
    ...u,
    last_sign_in_at: lastSignIn[u.id] || null,
  }));

  return res.status(200).json({ users: enriched, total: count ?? 0 });
}
