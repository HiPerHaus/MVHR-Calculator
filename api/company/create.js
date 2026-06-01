// api/company/create.js
// POST /api/company/create { name, billingEmail }
// Creates a new company and sets the calling user as owner.
// Returns: { company: { id, name, ... } }

import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const limiter = rateLimit({ windowMs: 3_600_000, max: 5 }); // 5 companies/hour per IP

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(req, res, { limiter })) return;

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { name, billingEmail } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Company name required' });

  // Check the user isn't already in a company
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single();

  if (profile?.company_id) {
    return res.status(409).json({ error: 'You are already a member of a company. Leave it first.' });
  }

  // Create company
  const { data: company, error: createErr } = await supabase
    .from('companies')
    .insert({
      name:          name.trim(),
      billing_email: billingEmail?.trim() || user.email,
      owner_id:      user.id,
    })
    .select()
    .single();

  if (createErr) {
    console.error('company create error:', createErr);
    return res.status(500).json({ error: 'Failed to create company' });
  }

  // Assign the creating user as owner
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({
      company_id:   company.id,
      company_role: 'owner',
      company_name: name.trim(), // keep denormalised field in sync
    })
    .eq('id', user.id);

  if (profileErr) {
    console.error('profile update error:', profileErr);
    // Rollback — delete the company we just created
    await supabase.from('companies').delete().eq('id', company.id);
    return res.status(500).json({ error: 'Failed to assign company owner' });
  }

  return res.status(201).json({ company });
}
