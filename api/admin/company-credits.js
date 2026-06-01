// api/admin/company-credits.js
// POST /api/admin/company-credits { companyId, amount, note }
// Admin-only: directly add/subtract credits from a company pool.
// amount: positive = add, negative = subtract.
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
    .select('is_admin, id')
    .eq('id', user.id)
    .single();
  return profile?.is_admin ? { ...user, adminProfileId: profile.id } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const { companyId, amount, note } = req.body;
  if (!companyId || amount == null || isNaN(Number(amount))) {
    return res.status(400).json({ error: 'companyId and numeric amount required' });
  }

  // Handle pool-toggle piggyback (amount=0, poolEnabled flag set)
  if (amount === 0 && req.body.hasOwnProperty('poolEnabled')) {
    const { poolEnabled } = req.body;
    const { error } = await supabase.from('companies')
      .update({ pool_credits_enabled: !!poolEnabled })
      .eq('id', companyId);
    if (error) return res.status(500).json({ error: 'Failed to update pool setting' });
    return res.status(200).json({ pool_credits_enabled: !!poolEnabled });
  }

  const delta = parseInt(amount, 10);

  // Fetch current balance
  const { data: company, error: fetchErr } = await supabase
    .from('companies')
    .select('credit_balance, name')
    .eq('id', companyId)
    .single();

  if (fetchErr || !company) return res.status(404).json({ error: 'Company not found' });

  const newBalance = (company.credit_balance || 0) + delta;
  if (newBalance < 0) return res.status(402).json({ error: 'Cannot reduce below zero' });

  // Apply update
  const { error: updateErr } = await supabase
    .from('companies')
    .update({ credit_balance: newBalance })
    .eq('id', companyId);

  if (updateErr) {
    console.error('company credit update error:', updateErr);
    return res.status(500).json({ error: 'Failed to adjust company credits' });
  }

  // Log the transaction
  await supabase.from('company_credit_transactions').insert({
    company_id:       companyId,
    delta,
    operation:        delta >= 0 ? 'admin_gift' : 'admin_deduct',
    description:      note || (delta >= 0 ? 'Admin credit grant' : 'Admin credit deduction'),
    source:           'admin',
    performed_by:     admin.id,
  });

  return res.status(200).json({ new_balance: newBalance });
}
