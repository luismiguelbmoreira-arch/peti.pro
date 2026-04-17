import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../api/_lib/hmac.js';
import { sanitizeInput, escapeXmlTags, sanitizeField } from '../api/_lib/sanitize.js';
import { validatePayload } from '../api/_lib/schema.js';
import { checkRateLimit } from '../api/_lib/rate-limit.js';
import { createHandler } from '../api/gerar.js';

// ── HMAC ─────────────────────────────────────────────────────────────────────

test('hmac: sign e verify com payload correto', () => {
  const secret = 'test-secret-muito-longo-32chars!';
  const payload = { trial_until: Date.now() + 86400000, jti: 'abc' };
  const token = sign(payload, secret);
  const result = verify(token, secret);
  assert.equal(result.jti, 'abc');
});

test('hmac: token adulterado retorna null', () => {
  const secret = 'test-secret-muito-longo-32chars!';
  const token = sign({ jti: 'x' }, secret);
  const tampered = token.slice(0, -3) + 'xxx';
  assert.equal(verify(tampered, secret), null);
});

test('hmac: secret errado retorna null', () => {
  const token = sign({ jti: 'x' }, 'secret-a-32chars-aqui-aaaaaaaa!');
  assert.equal(verify(token, 'secret-b-32chars-aqui-bbbbbbbb!'), null);
});

// ── Sanitize ──────────────────────────────────────────────────────────────────

test('sanitize: remove caracteres de controle', () => {
  const result = sanitizeInput('hello\x00world\x1Ftest');
  assert.equal(result, 'helloworldtest');
});

test('sanitize: preserva \\n e \\t', () => {
  const result = sanitizeInput('linha1\nlinha2\ttab');
  assert.equal(result, 'linha1\nlinha2\ttab');
});

test('sanitize: escapeXmlTags substitui < e >', () => {
  const result = escapeXmlTags('</fatos_do_cliente>');
  assert.equal(result, '&lt;/fatos_do_cliente&gt;');
});

test('sanitize: sanitizeField combina sanitize e escape', () => {
  const result = sanitizeField('<script>\x00alert(1)</script>');
  assert.equal(result, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

// ── Schema / Validação ────────────────────────────────────────────────────────

test('schema: payload geracao válido passa', () => {
  const result = validatePayload({
    tipo: 'Indenização',
    nome: 'João Silva',
    fatos: 'O réu causou danos materiais ao autor.',
    pedido: 'Indenização por danos materiais.',
  });
  assert.equal(result.success, true);
});

test('schema: payload geracao sem nome retorna erro', () => {
  const result = validatePayload({
    tipo: 'Indenização',
    fatos: 'fatos suficientes aqui para passar validação.',
    pedido: 'pedido aqui.',
  });
  assert.equal(result.success, false);
});

test('schema: tipo inválido retorna erro', () => {
  const result = validatePayload({
    tipo: 'Divórcio',
    nome: 'Test',
    fatos: 'fatos suficientes aqui para passar validação.',
    pedido: 'pedido.',
  });
  assert.equal(result.success, false);
});

test('schema: fatos excedendo 5000 chars retorna erro', () => {
  const result = validatePayload({
    tipo: 'Indenização',
    nome: 'Test',
    fatos: 'a'.repeat(5001),
    pedido: 'pedido.',
  });
  assert.equal(result.success, false);
});

test('schema: modo revisao sem peticaoAtual retorna erro', () => {
  const result = validatePayload({ modo: 'revisao' });
  assert.equal(result.success, false);
});

// ── Rate Limit ────────────────────────────────────────────────────────────────

test('rate-limit: permite até o limite', () => {
  const ip = `test-${Date.now()}-a`;
  for (let i = 0; i < 10; i++) {
    const r = checkRateLimit(ip, 'test', { hourLimit: 10, dayLimit: 50 });
    assert.equal(r.allowed, true, `falhou na iteração ${i}`);
  }
});

test('rate-limit: bloqueia após exceder limite hora', () => {
  const ip = `test-${Date.now()}-b`;
  for (let i = 0; i < 3; i++) checkRateLimit(ip, 'test2', { hourLimit: 3, dayLimit: 50 });
  const r = checkRateLimit(ip, 'test2', { hourLimit: 3, dayLimit: 50 });
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfter > 0);
});

// ── Handler /api/gerar ────────────────────────────────────────────────────────

// Mock do cliente Anthropic
const mockClient = {
  messages: {
    create: async () => ({ content: [{ text: 'Petição gerada com sucesso.' }] }),
  },
};

function makeReq(method, body, headers = {}) {
  return {
    method,
    body,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `127.${Math.floor(Math.random() * 255)}.0.1`,
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function makeRes() {
  let _status = 200;
  let _body = null;
  const res = {
    _getStatus: () => _status,
    _getBody: () => _body,
    status(code) { _status = code; return res; },
    setHeader() { return res; },
    end() { return res; },
    json(data) { _body = data; return res; },
  };
  return res;
}

function validToken() {
  const secret = process.env.SESSION_SECRET || 'test-secret-muito-longo-aqui-32!';
  return sign({ trial_until: Date.now() + 86400000, issued_at: Date.now(), jti: 'test' }, secret);
}

// Define SESSION_SECRET para os testes do handler
process.env.SESSION_SECRET = 'test-secret-muito-longo-aqui-32!';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.NODE_ENV = 'test';

const handler = createHandler(mockClient);

test('handler: GET retorna 405', async () => {
  const req = makeReq('GET', null);
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._getStatus(), 405);
});

test('handler: sem token retorna 401', async () => {
  const req = makeReq('POST', { tipo: 'Indenização', nome: 'Test', fatos: 'fatos...', pedido: 'pedido.' });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._getStatus(), 401);
});

test('handler: token inválido retorna 401', async () => {
  const req = makeReq('POST', { tipo: 'Indenização', nome: 'Test', fatos: 'fatos...', pedido: 'pedido.' }, {
    authorization: 'Bearer token.invalido',
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._getStatus(), 401);
});

test('handler: payload malformado retorna 400', async () => {
  const req = makeReq('POST', { tipo: 'TipoInexistente', nome: 'Test' }, {
    authorization: `Bearer ${validToken()}`,
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._getStatus(), 400);
});

test('handler: fatos muito grandes retorna 400', async () => {
  const req = makeReq('POST', {
    tipo: 'Indenização',
    nome: 'Test',
    fatos: 'a'.repeat(5001),
    pedido: 'pedido.',
  }, {
    authorization: `Bearer ${validToken()}`,
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._getStatus(), 400);
});

test('handler: payload válido retorna 200 com petição', async () => {
  const req = makeReq('POST', {
    tipo: 'Indenização',
    nome: 'João da Silva',
    fatos: 'O réu causou danos materiais ao autor ao... '.repeat(5),
    pedido: 'Indenização por danos materiais e morais.',
  }, {
    authorization: `Bearer ${validToken()}`,
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._getStatus(), 200);
  assert.ok(res._getBody()?.peticao);
});
