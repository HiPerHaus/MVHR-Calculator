// api/admin/company-members.js
// POST /api/admin/company-members { action, ... }
//
// action = 'add'    { companyId, userId, role? }  → add existing user to company
// action = 'remove' { userId }                    → remove user from company
// action = 'list'   { companyId }                 → list all members of company
//
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
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  // ── GET: list companies ──────────────────────────────────────
  if (req.method === 'GET') {
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, credit_balance, pool_credits_enabled, billing_email, owner_id, created_at')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Query failed' });
    return res.status(200).json({ companies: companies || [] });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body;

  // ── add: assign existing user to a company ───────────────────
  if (action === 'add') {
    const { companyId, userId, role = 'member' } = req.body;
    if (!companyId || !userId) return res.status(400).json({ error: 'companyId and userId required' });
    if (!['owner', 'admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    // Verify company exists
    const { data: company } = await supabase.from('companies').select('id, name').eq('id', companyId).single();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Verify user exists
    const { data: profile } = await supabase.from('profiles').select('id, email, company_id').eq('id', userId).single();
    if (!profile) return res.status(404).json({ error: 'User not found' });

    if (profile.company_id && profile.company_id !== companyId) {
      return res.status(409).json({ error: 'User is already a member of another company. Remove them first.' });
    }

    const { error } = await supabase.from('profiles')
      .update({ company_id: companyId, company_role: role, company_name: company.name })
      .eq('id', userId);

    if (error) return res.status(500).json({ error: 'Failed to add user to company' });
    return res.status(200).json({ added: true });
  }

  // ── remove: clear user's company membership ──────────────────
  if (action === 'remove') {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const { error } = await supabase.from('profiles')
      .update({ company_id: null, company_role: null, company_name: null })
      .eq('id', userId);

    if (error) return res.status(500).json({ error: 'Failed to remove user from company' });
    return res.status(200).json({ removed: true });
  }

  // ── list: members of a specific company ──────────────────────
  if (action === 'list') {
    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ error: 'companyId required' });

    const { data: members, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, company_role, credit_balance, created_at')
      .eq('company_id', companyId)
      .order('company_role')
      .order('created_at');

    if (error) return res.status(500).json({ error: 'Query failed' });
    return res.status(200).json({ members: members || [] });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
