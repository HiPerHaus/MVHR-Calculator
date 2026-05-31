// api/admin/users.js
// GET /api/admin/users?page=0&limit=50&q=email_search
// Returns: { users: [...], pending: [...], total: N }

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

  // Fetch all auth users to get invite/sign-in status
  let authUsers = [];
  try {
    let authPage = 1;
    while (true) {
      const { data: authData } = await supabase.auth.admin.listUsers({ page: authPage, perPage: 1000 });
      if (!authData?.users?.length) break;
      authUsers = authUsers.concat(authData.users);
      if (authData.users.length < 1000) break;
      authPage++;
    }
  } catch(e) { /* non-fatal */ }

  // Build auth lookup map
  const authMap = {};
  authUsers.forEach(u => { authMap[u.id] = u; });

  // Pending = invited but never signed in (email_confirmed_at null OR last_sign_in_at null)
  const pending = authUsers
    .filter(u => u.invited_at && !u.last_sign_in_at)
    .map(u => ({
      id:         u.id,
      email:      u.email,
      invited_at: u.invited_at,
    }))
    .filter(u => !q || u.email?.toLowerCase().includes(q));

  // Active profiles
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

  const enriched = (users || []).map(u => ({
    ...u,
    last_sign_in_at: authMap[u.id]?.last_sign_in_at || null,
  }));

  return res.status(200).json({ users: enriched, pending, total: count ?? 0 });
}
