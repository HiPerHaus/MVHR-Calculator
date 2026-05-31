// api/admin/transactions.js
// GET /api/admin/transactions?userId=<uuid>&page=0&limit=50
// Returns: { transactions: [...], total: N }

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

  const page   = Math.max(0, parseInt(req.query.page  || '0'));
  const limit  = Math.min(200, parseInt(req.query.limit || '50'));
  const userId = req.query.userId || null;

  let query = supabase
    .from('credit_transactions')
    .select('id, user_id, delta, operation, description, source, stripe_payment_id, project_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (userId) query = query.eq('user_id', userId);

  const { data: transactions, count, error } = await query;
  if (error) return res.status(500).json({ error: 'Query failed' });

  return res.status(200).json({ transactions: transactions || [], total: count ?? 0 });
}
