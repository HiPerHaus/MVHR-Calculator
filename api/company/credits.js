// api/company/credits.js
// GET  /api/company/credits              → company balance + recent transactions
// POST /api/company/credits/pool-toggle  → enable/disable shared pool (owner only)
// POST /api/company/credits/checkout     → create Stripe checkout for company pool top-up

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const checkoutLimiter = rateLimit({ windowMs: 60_000, max: 10 });

async function getCallerProfile(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { user: null, profile: null };
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, company_id, company_role')
    .eq('id', user.id)
    .single();
  return { user, profile: profile || null };
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { user, profile } = await getCallerProfile(token);
  if (!user || !profile) return res.status(401).json({ error: 'Invalid token' });
  if (!profile.company_id) return res.status(403).json({ error: 'Not a company member' });

  // ── GET — company balance and transaction history ────────────
  if (req.method === 'GET') {
    const { data: company, error: compErr } = await supabase
      .from('companies')
      .select('id, name, credit_balance, pool_credits_enabled, billing_email')
      .eq('id', profile.company_id)
      .single();

    if (compErr || !company) return res.status(404).json({ error: 'Company not found' });

    const page  = Math.max(0, parseInt(req.query.page  || '0'));
    const limit = Math.min(100, parseInt(req.query.limit || '50'));

    const { data: transactions, count } = await supabase
      .from('company_credit_transactions')
      .select('id, delta, operation, description, source, performed_by, stripe_payment_id, created_at', { count: 'exact' })
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1);

    return res.status(200).json({ company, transactions: transactions || [], total: count ?? 0 });
  }

  if (req.method === 'POST') {
    const { action } = req.body;

    // ── pool-toggle — enable or disable shared credit pool ────
    if (action === 'pool-toggle') {
      if (profile.company_role !== 'owner') {
        return res.status(403).json({ error: 'Only the company owner can change pool settings' });
      }

      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled (boolean) required' });
      }

      const { data, error } = await supabase
        .from('companies')
        .update({ pool_credits_enabled: enabled })
        .eq('id', profile.company_id)
        .select('pool_credits_enabled')
        .single();

      if (error) return res.status(500).json({ error: 'Failed to update pool setting' });
      return res.status(200).json({ pool_credits_enabled: data.pool_credits_enabled });
    }

    // ── checkout — Stripe checkout for company pool top-up ────
    if (action === 'checkout') {
      if (!['owner', 'admin'].includes(profile.company_role)) {
        return res.status(403).json({ error: 'Only company owners and admins can purchase credits' });
      }
      if (!applyRateLimit(req, res, { limiter: checkoutLimiter })) return;

      const { packageId } = req.body;
      if (!packageId) return res.status(400).json({ error: 'packageId required' });

      const { data: pkg, error: pkgErr } = await supabase
        .from('credit_packages')
        .select('*')
        .eq('id', packageId)
        .eq('active', true)
        .single();

      if (pkgErr || !pkg) return res.status(404).json({ error: 'Package not found' });
      if (!pkg.stripe_price_id) return res.status(400).json({ error: 'Package not yet configured in Stripe' });

      const origin = req.headers.origin || process.env.APP_URL;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
        customer_email: user.email,
        metadata: {
          user_id:    profile.id,
          company_id: profile.company_id,  // signals webhook to credit the company pool
          package_id: pkg.id,
          credits:    pkg.credits,
        },
        success_url: `${origin}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${origin}?payment=cancelled`,
      });

      return res.status(200).json({ url: session.url });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).end();
}
