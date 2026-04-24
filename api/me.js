import { supabaseAdmin } from './_lib/supabase.js';
import { getUserFromRequest } from './_lib/auth.js';
import { QUOTA, currentMonth } from './_lib/quota.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NODE_ENV !== 'production' ? '*' : (process.env.ALLOWED_ORIGIN || '*'));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ erro: 'Sessão inválida.' });

  const month = currentMonth();

  const [{ data: sub }, { data: use }] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle(),
    supabaseAdmin.from('usage').select('count').eq('user_id', user.id).eq('month', month).maybeSingle(),
  ]);

  const plan = sub?.status === 'trialing' ? 'trial' : (sub?.plan || null);
  const limit = plan ? QUOTA[plan] : 0;

  return res.status(200).json({
    email:               user.email,
    plan,
    status:              sub?.status || 'none',
    trial_end:           sub?.trial_end,
    current_period_end:  sub?.current_period_end,
    cancel_at_period_end: sub?.cancel_at_period_end,
    usage: {
      used:  use?.count || 0,
      limit: Number.isFinite(limit) ? limit : null,
    },
  });
}
