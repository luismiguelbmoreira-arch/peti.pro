// Rate limiter in-memory por IP.
// AVISO: em serverless multi-instância (Vercel produção) cada instância tem seu
// próprio contador. O limite efetivo é por-instância, não global.
// PRÉ-REQUISITO antes de abrir trial público: configurar UPSTASH_REDIS_REST_URL
// e UPSTASH_REDIS_REST_TOKEN (ver docs/SECURITY.md).

const store = new Map();
const MAX_ENTRIES = 10_000;

function cleanup(now) {
  if (store.size < MAX_ENTRIES) return;
  for (const [key, val] of store) {
    if (val.dayReset < now) store.delete(key);
  }
}

/**
 * @param {string} ip
 * @param {string} ns - namespace (ex: 'gerar', 'session') para separar contadores
 * @param {{ hourLimit?: number, dayLimit?: number }} opts
 * @returns {{ allowed: boolean, retryAfter?: number }}
 */
export function checkRateLimit(ip, ns, { hourLimit = 10, dayLimit = 50 } = {}) {
  const now = Date.now();
  const key = `${ns}:${ip}`;

  let e = store.get(key) ?? {
    hourCount: 0,
    hourReset: now + 3_600_000,
    dayCount: 0,
    dayReset: now + 86_400_000,
  };

  if (now > e.hourReset) { e.hourCount = 0; e.hourReset = now + 3_600_000; }
  if (now > e.dayReset)  { e.dayCount = 0;  e.dayReset  = now + 86_400_000; }

  if (e.hourCount >= hourLimit) {
    store.set(key, e);
    return { allowed: false, retryAfter: Math.ceil((e.hourReset - now) / 1000) };
  }
  if (e.dayCount >= dayLimit) {
    store.set(key, e);
    return { allowed: false, retryAfter: Math.ceil((e.dayReset - now) / 1000) };
  }

  e.hourCount++;
  e.dayCount++;
  store.set(key, e);
  cleanup(now);
  return { allowed: true };
}
