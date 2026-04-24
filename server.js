import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

try {
  const env = readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn('[server] Arquivo .env não encontrado — usando variáveis de ambiente do sistema.');
}

process.env.NODE_ENV ??= 'development';

const { default: gerarHandler }    = await import('./api/gerar.js');
const { default: configHandler }   = await import('./api/config.js');
const { default: checkoutHandler } = await import('./api/checkout.js');
const { default: portalHandler }   = await import('./api/portal.js');
const { default: meHandler }       = await import('./api/me.js');
const { default: webhookHandler }  = await import('./api/webhook.js');

const indexHtml = readFileSync('./index.html');

function makeReq(native, body) {
  return Object.assign(native, { body, socket: native.socket });
}

function makeRes(native) {
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; native.statusCode = code; return res; },
    setHeader(k, v) { native.setHeader(k, v); return res; },
    getHeader(k) { return native.getHeader(k); },
    json(obj) {
      native.statusCode = statusCode;
      if (!native.getHeader('Content-Type')) native.setHeader('Content-Type', 'application/json');
      native.end(JSON.stringify(obj));
    },
    write(chunk) { return native.write(chunk); },
    end(data)   { return native.end(data); },
    send(data)  { native.statusCode = statusCode; native.end(data); },
  };
  return res;
}

const PORT = process.env.PORT || 3000;

createServer(async (req, res) => {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
    return;
  }

  const adaptedRes = makeRes(res);

  // Webhook precisa do raw body — roteia antes do body parser
  if (path === '/api/webhook') {
    return webhookHandler(makeReq(req, {}), adaptedRes);
  }

  // Config — GET, sem body
  if (req.method === 'GET' && path === '/api/config') {
    return configHandler(makeReq(req, {}), adaptedRes);
  }

  // Parse JSON body
  let body = {};
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    body = await new Promise(resolve => {
      let raw = '';
      req.on('data', d => raw += d);
      req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
  }

  const adaptedReq = makeReq(req, body);

  if (path === '/api/gerar')    return gerarHandler(adaptedReq, adaptedRes);
  if (path === '/api/checkout') return checkoutHandler(adaptedReq, adaptedRes);
  if (path === '/api/portal')   return portalHandler(adaptedReq, adaptedRes);
  if (path === '/api/me')       return meHandler(adaptedReq, adaptedRes);

  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => {
  console.log(`\n  Peti.PRO rodando em http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn('  ⚠  ANTHROPIC_API_KEY não definida\n');
  if (!process.env.SUPABASE_URL)      console.warn('  ⚠  SUPABASE_URL não definida\n');
});
