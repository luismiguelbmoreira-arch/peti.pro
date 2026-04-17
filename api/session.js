import { randomUUID } from 'node:crypto';
import { sign } from './_lib/hmac.js';
import { checkRateLimit } from './_lib/rate-limit.js';

const TRIAL_DAYS = 7;

export default async function handler(req, res) {
  const origin = process.env.NODE_ENV !== 'production' ? '*' : (process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (origin !== '*') res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    console.error({ name: 'ConfigError', firstLine: 'SESSION_SECRET ausente ou muito curto' });
    return res.status(503).json({ erro: 'Serviço temporariamente indisponível. Tente em instantes.' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';

  const rl = checkRateLimit(ip, 'session', { hourLimit: 5, dayLimit: 10 });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ erro: `Muitas requisições. Aguarde ${rl.retryAfter} segundos.` });
  }

  const now = Date.now();
  const payload = { trial_until: now + TRIAL_DAYS * 86_400_000, issued_at: now, jti: randomUUID() };
  return res.status(200).json({ token: sign(payload, secret), trial_until: payload.trial_until });
}
