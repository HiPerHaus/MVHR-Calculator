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

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { user_id, credits, package_id } = session.metadata;

    if (!user_id || !credits) {
      console.error('Missing metadata on session:', session.id);
      return res.status(400).json({ error: 'Missing metadata' });
    }

    // add_credits is idempotent — safe if Stripe retries
    const { data, error } = await supabase.rpc('add_credits', {
      p_user_id:           user_id,
      p_amount:            parseInt(credits),
      p_stripe_payment_id: session.payment_intent || session.id,
      p_description:       `Credit purchase — ${session.amount_total / 100} AUD`,
    });

    if (error) {
      console.error('add_credits failed:', error);
      return res.status(500).json({ error: 'Failed to credit account' });
    }

    console.log(`Credited ${credits} to user ${user_id}. New balance: ${data}`);
  }

  return res.status(200).json({ received: true });
}
