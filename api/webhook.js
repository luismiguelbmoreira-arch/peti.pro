import { stripe, getRawBody } from './_lib/stripe.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { planFromPriceId } from './_lib/quota.js';

// Vercel: desabilita body parser para leitura do raw body
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      raw,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error({ name: 'StripeSignature', firstLine: String(err.message).slice(0, 120) });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotência: Stripe reentrega eventos em timeout/erro
  const { error: insErr } = await supabaseAdmin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  if (insErr?.code === '23505') return res.status(200).json({ received: true });
  if (insErr) { console.error(insErr); return res.status(500).end(); }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await upsertSubscription(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await markCanceled(event.data.object);
        break;
      case 'invoice.payment_failed':
        await setStatus(event.data.object.customer, 'past_due');
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error({ name: 'WebhookHandler', type: event.type, firstLine: String(err.message).slice(0, 120) });
    // Remove do stripe_events para Stripe poder reentregar
    await supabaseAdmin.from('stripe_events').delete().eq('id', event.id);
    return res.status(500).end();
  }
}

async function onCheckoutCompleted(session) {
  const userId = session.client_reference_id;
  if (!userId || !session.subscription) return;
  const sub = await stripe.subscriptions.retrieve(session.subscription);
  await writeSubscription(userId, session.customer, sub);
}

async function upsertSubscription(sub) {
  const userId = sub.metadata?.supabase_user_id || await findUserIdByCustomer(sub.customer);
  if (!userId) return;
  await writeSubscription(userId, sub.customer, sub);
}

async function writeSubscription(userId, customerId, sub) {
  const item = sub.items?.data?.[0];
  await supabaseAdmin.from('subscriptions').upsert({
    user_id:               userId,
    stripe_customer_id:    customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id:       item?.price?.id,
    plan:                  planFromPriceId(item?.price?.id),
    status:                sub.status,
    current_period_end:    new Date(sub.current_period_end * 1000).toISOString(),
    trial_end:             sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end:  sub.cancel_at_period_end,
    updated_at:            new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

async function markCanceled(sub) {
  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: false, updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
}

async function setStatus(customerId, status) {
  await supabaseAdmin
    .from('subscriptions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('stripe_customer_id', customerId);
}

async function findUserIdByCustomer(customerId) {
  const { data } = await supabaseAdmin
    .from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  return data?.user_id || null;
}
