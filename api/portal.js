import { stripe } from './_lib/stripe.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { getUserFromRequest } from './_lib/auth.js';

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

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!sub?.stripe_customer_id) return res.status(404).json({ erro: 'Sem assinatura paga.' });

  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${process.env.APP_URL}/`,
    ...(process.env.STRIPE_PORTAL_CONFIG_ID && { configuration: process.env.STRIPE_PORTAL_CONFIG_ID }),
  });

  return res.status(200).json({ url: portal.url });
}
