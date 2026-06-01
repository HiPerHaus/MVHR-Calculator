// api/stripe/checkout.js
// Vercel serverless function — creates a Stripe Checkout Session
// Called by: POST /api/stripe/checkout  { packageId, forCompany? }
// forCompany: if true and the user is a company owner/admin, credits the company pool
// Returns: { url: 'https://checkout.stripe.com/...' }

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const limiter = rateLimit({ windowMs: 60_000, max: 10 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(req, res, { limiter })) return;

  // Verify Supabase JWT from Authorization header
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { packageId, forCompany = false } = req.body;
  if (!packageId) return res.status(400).json({ error: 'packageId required' });

  // Look up package
  const { data: pkg, error: pkgErr } = await supabase
    .from('credit_packages')
    .select('*')
    .eq('id', packageId)
    .eq('active', true)
    .single();

  if (pkgErr || !pkg) return res.status(404).json({ error: 'Package not found' });
  if (!pkg.stripe_price_id) return res.status(400).json({ error: 'Package not yet configured in Stripe' });

  // If purchasing for the company pool, verify the user has permission
  let companyId = null;
  if (forCompany) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, company_role')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return res.status(403).json({ error: 'You are not a member of any company' });
    }
    if (!['owner', 'admin'].includes(profile.company_role)) {
      return res.status(403).json({ error: 'Only company owners and admins can purchase credits for the company pool' });
    }
    companyId = profile.company_id;
  }

  const origin = req.headers.origin || process.env.APP_URL;

  const metadata = {
    user_id:    user.id,
    package_id: pkg.id,
    credits:    String(pkg.credits), // Stripe metadata values must be strings
  };

  // Include company_id in metadata so the webhook knows to credit the pool
  if (companyId) metadata.company_id = companyId;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
    customer_email: user.email,
    metadata,
    success_url: `${origin}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}?payment=cancelled`,
  });

  return res.status(200).json({ url: session.url });
}
