// api/credits/consume.js
// Vercel serverless function — atomically deducts credits for an operation
// Called by: POST /api/credits/consume  { operation: 'basic_design', projectId: '...' }
// Returns: { success: true, new_balance: 42 }
//       or: { error: 'insufficient_credits', balance: 3, required: 5 }

import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 30 consume attempts per user per minute (per instance — see lib/rate-limit.js)
const limiter = rateLimit({ windowMs: 60_000, max: 30 });

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP before auth to prevent enumeration
  if (!applyRateLimit(req, res, { limiter })) return;

  // Verify JWT
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { operation, projectId } = req.body;
  if (!operation || typeof operation !== 'string') {
    return res.status(400).json({ error: 'operation required' });
  }

  // Guard against local/unsynced project IDs (e.g. "proj_...") which are not UUIDs
  const safeProjectId = isUuid(projectId) ? projectId : null;

  // Look up cost server-side — clients cannot specify an arbitrary amount
  const { data: opCost, error: opErr } = await supabase
    .from('operation_costs')
    .select('credits, label')
    .eq('operation', operation)
    .single();

  if (opErr || !opCost) return res.status(404).json({ error: 'Unknown operation' });

  // Atomic deduction via DB function (uses SELECT FOR UPDATE — race-condition safe)
  const { data: newBalance, error: deductErr } = await supabase.rpc('deduct_credits', {
    p_user_id:    user.id,
    p_amount:     opCost.credits,
    p_operation:  operation,
    p_project_id: safeProjectId,
    p_description: opCost.label,
  });

  if (deductErr) {
    if (deductErr.message?.includes('insufficient_credits')) {
      // Fetch current balance for the error response
      const { data: profile } = await supabase
        .from('profiles')
        .select('credit_balance')
        .eq('id', user.id)
        .single();
      return res.status(402).json({
        error:    'insufficient_credits',
        balance:  profile?.credit_balance ?? 0,
        required: opCost.credits,
      });
    }
    console.error('deduct_credits error:', deductErr);
    return res.status(500).json({ error: 'Credit deduction failed' });
  }

  return res.status(200).json({ success: true, new_balance: newBalance });
}
