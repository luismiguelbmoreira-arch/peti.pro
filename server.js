// Local dev server — substitui o Vercel CLI para testar localmente
// Uso: node server.js  (requer .env com ANTHROPIC_API_KEY e SESSION_SECRET)

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

// Carrega .env manualmente (sem dependência externa)
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

const { default: gerarHandler } = await import('./api/gerar.js');
const { default: sessionHandler } = await import('./api/session.js');

// Adapta o IncomingMessage/ServerResponse nativo para a interface Express-like dos handlers
function makeReq(native, body) {
  return Object.assign(native, {
    body,
    socket: native.socket,
  });
}

function makeRes(native) {
  let statusCode = 200;
  const res = Object.assign(native, {
    status(code) { statusCode = code; native.statusCode = code; return res; },
    setHeader(k, v) { native.setHeader(k, v); return res; },
    json(obj) {
      native.statusCode = statusCode;
      if (!native.getHeader('Content-Type')) native.setHeader('Content-Type', 'application/json');
      native.end(JSON.stringify(obj));
    },
    write(chunk) { return native.write(chunk); },
    end(data) { return native.end(data); },
    writableEnded: false,
    getHeader(k) { return native.getHeader(k); },
  });
  return res;
}

const PORT = process.env.PORT || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Serve index.html
  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    const html = readFileSync('./index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Parse JSON body
  let body = {};
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    body = await new Promise((resolve) => {
      let raw = '';
      req.on('data', d => raw += d);
      req.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
  }

  const adaptedReq = makeReq(req, body);
  const adaptedRes = makeRes(res);

  if (path === '/api/session') return sessionHandler(adaptedReq, adaptedRes);
  if (path === '/api/gerar')   return gerarHandler(adaptedReq, adaptedRes);

  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => {
  console.log(`\n  Peti.PRO rodando em http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠  ANTHROPIC_API_KEY não definida — crie o arquivo .env\n');
  }
});
