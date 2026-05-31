// api/admin/gift-credits.js
// POST /api/admin/gift-credits { userId, amount, note }
// amount: positive = add, negative = subtract
// Returns: { new_balance: N }

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

  const { userId, amount, note } = req.body;
  if (!userId || amount == null || isNaN(Number(amount))) {
    return res.status(400).json({ error: 'userId and numeric amount required' });
  }

  const { data: newBalance, error } = await supabase.rpc('gift_credits', {
    p_admin_id: admin.id,
    p_user_id:  userId,
    p_amount:   parseInt(amount),
    p_note:     note || null,
  });

  if (error) {
    if (error.message?.includes('insufficient_credits')) {
      return res.status(402).json({ error: 'Cannot reduce below zero' });
    }
    console.error('gift_credits error:', error);
    return res.status(500).json({ error: 'Failed to adjust credits' });
  }

  return res.status(200).json({ new_balance: newBalance });
}
