import { stripe } from './_lib/stripe.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { getUserFromRequest } from './_lib/auth.js';

const PRICE_MAP = {
  basico:     () => process.env.STRIPE_PRICE_BASICO,
  pro:        () => process.env.STRIPE_PRICE_PRO,
  escritorio: () => process.env.STRIPE_PRICE_ESCRITORIO,
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NODE_ENV !== 'production' ? '*' : (process.env.ALLOWED_ORIGIN || '*'));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ erro: 'Sessão inválida.' });

  const { plan } = req.body || {};
  const priceIdFn = PRICE_MAP[plan];
  if (!priceIdFn) return res.status(400).json({ erro: 'Plano inválido.' });
  const priceId = priceIdFn();
  if (!priceId) return res.status(503).json({ erro: 'Plano não configurado.' });

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (sub && ['active', 'past_due'].includes(sub.status)) {
    return res.status(409).json({ erro: 'Assinatura já ativa. Use o portal para gerenciar.', code: 'ALREADY_SUBSCRIBED' });
  }

  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_customer_id: customerId })
      .eq('user_id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_collection: 'always',
    locale: 'pt-BR',
    allow_promotion_codes: true,
    success_url: `${process.env.APP_URL}/?checkout=success&sid={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.APP_URL}/`,
  });

  return res.status(200).json({ url: session.url });
}
