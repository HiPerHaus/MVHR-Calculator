// api/stripe/checkout.js
// Vercel serverless function — creates a Stripe Checkout Session
// Called by: POST /api/stripe/checkout  { packageId: '...' }
// Returns: { url: 'https://checkout.stripe.com/...' }

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role — bypasses RLS
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Supabase JWT from Authorization header
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { packageId } = req.body;
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

  const origin = req.headers.origin || process.env.APP_URL;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
    customer_email: user.email,
    metadata: {
      user_id: user.id,
      package_id: pkg.id,
      credits: pkg.credits,
    },
    success_url: `${origin}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}?payment=cancelled`,
  });

  return res.status(200).json({ url: session.url });
}
