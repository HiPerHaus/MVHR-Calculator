// api/stripe/webhook.js
// Vercel serverless function — receives Stripe webhooks
// Configure in Stripe Dashboard → Webhooks → Add endpoint
// Events to listen for: checkout.session.completed

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Maximum credits that can be granted in a single transaction.
// Prevents runaway crediting if metadata is somehow corrupted.
const MAX_CREDITS_PER_TRANSACTION = 10_000;

// Vercel: disable body parsing so we can verify Stripe signature
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // ── 1. Verify Stripe signature — rejects any non-Stripe request ──
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { user_id, credits, package_id, company_id } = session.metadata || {};

    // ── 2. Validate required metadata fields ──
    if (!user_id || !credits || !package_id) {
      console.error('Missing required metadata on session:', session.id, { user_id, credits, package_id });
      return res.status(400).json({ error: 'Missing metadata' });
    }

    // ── 3. Parse and bounds-check credits value ──
    const creditsInt = parseInt(credits, 10);
    if (isNaN(creditsInt) || creditsInt <= 0 || creditsInt > MAX_CREDITS_PER_TRANSACTION) {
      console.error('Invalid credits value in metadata:', credits, 'session:', session.id);
      return res.status(400).json({ error: 'Invalid credits value in metadata' });
    }

    // ── 4. Cross-check credits against the credit_packages table ──
    // Always trust the database value, not what is in Stripe metadata.
    const { data: pkg, error: pkgErr } = await supabase
      .from('credit_packages')
      .select('credits, name')
      .eq('id', package_id)
      .single();

    if (pkgErr || !pkg) {
      console.error('Package not found for package_id:', package_id, 'session:', session.id);
      return res.status(400).json({ error: 'Package not found — cannot verify credit amount' });
    }

    if (pkg.credits !== creditsInt) {
      console.warn(
        `Credit mismatch on session ${session.id}: metadata says ${creditsInt}, package "${pkg.name}" says ${pkg.credits}. Using authoritative DB value.`
      );
    }

    const authoritativeCredits = pkg.credits; // always use DB value
    const idempotencyKey = session.payment_intent || session.id;
    const description = `Credit purchase — ${session.amount_total / 100} AUD (${pkg.name})`;

    // ── 5. Credit the appropriate account (user or company pool) ──
    if (company_id) {
      // Organisation-level purchase — credit the company pool
      const { data, error } = await supabase.rpc('add_credits_to_company', {
        p_company_id:        company_id,
        p_purchased_by:      user_id,
        p_amount:            authoritativeCredits,
        p_stripe_payment_id: idempotencyKey,
        p_description:       description,
      });

      if (error) {
        console.error('add_credits_to_company failed:', error, 'session:', session.id);
        return res.status(500).json({ error: 'Failed to credit company account' });
      }
      console.log(`Credited ${authoritativeCredits} to company ${company_id} (purchased by ${user_id}). New balance: ${data}`);

    } else {
      // Individual purchase — credit the user directly
      const { data, error } = await supabase.rpc('add_credits', {
        p_user_id:           user_id,
        p_amount:            authoritativeCredits,
        p_stripe_payment_id: idempotencyKey,
        p_description:       description,
      });

      if (error) {
        console.error('add_credits failed:', error, 'session:', session.id);
        return res.status(500).json({ error: 'Failed to credit account' });
      }
      console.log(`Credited ${authoritativeCredits} to user ${user_id}. New balance: ${data}`);
    }
  }

  return res.status(200).json({ received: true });
}
