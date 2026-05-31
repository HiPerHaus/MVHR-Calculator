// api/credits/consume.js
// Vercel serverless function — atomically deducts credits for an operation
// Called by: POST /api/credits/consume  { operation: 'basic_design', projectId: '...' }
// Returns: { success: true, new_balance: 42 }
//       or: { error: 'insufficient_credits', balance: 3, required: 5 }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify JWT
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { operation, projectId } = req.body;
  if (!operation) return res.status(400).json({ error: 'operation required' });

  // Look up cost
  const { data: opCost, error: opErr } = await supabase
    .from('operation_costs')
    .select('credits')
    .eq('operation', operation)
    .single();

  if (opErr || !opCost) return res.status(404).json({ error: 'Unknown operation' });

  // Atomic deduction via DB function
  const { data: newBalance, error: deductErr } = await supabase.rpc('deduct_credits', {
    p_user_id:    user.id,
    p_amount:     opCost.credits,
    p_operation:  operation,
    p_project_id: projectId || null,
  });

  if (deductErr) {
    if (deductErr.message?.includes('insufficient_credits')) {
      // Get current balance for the error response
      const { data: profile } = await supabase
        .from('profiles')
        .select('credit_balance')
        .eq('id', user.id)
        .single();
      return res.status(402).json({
        error: 'insufficient_credits',
        balance:  profile?.credit_balance ?? 0,
        required: opCost.credits,
      });
    }
    console.error('deduct_credits error:', deductErr);
    return res.status(500).json({ error: 'Credit deduction failed' });
  }

  return res.status(200).json({ success: true, new_balance: newBalance });
}
