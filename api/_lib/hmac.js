import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'sha256';

// Assina payload JSON com HMAC-SHA256; retorna "base64url(payload).base64url(mac)"
export function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac(ALGO, secret).update(data).digest('base64url');
  return `${data}.${mac}`;
}

// Verifica token; retorna payload parsed ou null se inválido/adulterado
export function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const data = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = createHmac(ALGO, secret).update(data).digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(mac, 'base64url'), Buffer.from(expected, 'base64url'))) return null;
  } catch {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
