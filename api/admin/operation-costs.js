// api/admin/operation-costs.js
// GET  /api/admin/operation-costs           → { costs: [...] }
// POST /api/admin/operation-costs { operation, credits, label, level }
//                                          → { updated: {...} }

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

  if (req.method === 'GET') {
    const { data: costs, error } = await supabase
      .from('operation_costs')
      .select('*')
      .order('level')
      .order('operation');

    if (error) return res.status(500).json({ error: 'Query failed' });
    return res.status(200).json({ costs });
  }

  if (req.method === 'POST') {
    const { operation, credits, label, level } = req.body;
    if (!operation || credits == null) {
      return res.status(400).json({ error: 'operation and credits required' });
    }

    const update = { credits: parseInt(credits) };
    if (label != null) update.label = label;
    if (level != null) update.level = parseInt(level);

    const { data, error } = await supabase
      .from('operation_costs')
      .update(update)
      .eq('operation', operation)
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Update failed' });
    return res.status(200).json({ updated: data });
  }

  return res.status(405).end();
}
