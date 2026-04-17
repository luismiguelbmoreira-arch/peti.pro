import { randomUUID } from 'node:crypto';
import { sign } from './_lib/hmac.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { checkRateLimit } from './_lib/rate-limit.js';

const TRIAL_DAYS = 7;

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    console.error({ name: 'ConfigError', firstLine: 'SESSION_SECRET ausente ou muito curto' });
    return res.status(500).json({ erro: 'Erro interno. Nossa equipe já foi notificada.' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';

  const rl = checkRateLimit(ip, 'session', { hourLimit: 5, dayLimit: 10 });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({
      erro: `Muitas requisições. Aguarde ${rl.retryAfter} segundos.`,
    });
  }

  const now = Date.now();
  const payload = {
    trial_until: now + TRIAL_DAYS * 86_400_000,
    issued_at: now,
    jti: randomUUID(),
  };

  const token = sign(payload, secret);
  return res.status(200).json({ token, trial_until: payload.trial_until });
}
