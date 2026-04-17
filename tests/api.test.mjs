import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../api/_lib/hmac.js';
import { validatePayload } from '../api/_lib/schema.js';
import { checkRateLimit } from '../api/_lib/rate-limit.js';
import { buildMessages } from '../api/_lib/prompts.js';
import { createHandler } from '../api/gerar.js';

// ── HMAC ─────────────────────────────────────────────────────────────────────

test('hmac: sign e verify com payload correto', () => {
  const secret = 'test-secret-muito-longo-32chars!';
  const token = sign({ trial_until: Date.now() + 86400000, jti: 'abc' }, secret);
  assert.equal(verify(token, secret).jti, 'abc');
});

test('hmac: token adulterado retorna null', () => {
  const secret = 'test-secret-muito-longo-32chars!';
  const token = sign({ jti: 'x' }, secret);
  assert.equal(verify(token.slice(0, -3) + 'xxx', secret), null);
});

test('hmac: secret errado retorna null', () => {
  const token = sign({ jti: 'x' }, 'secret-a-32chars-aqui-aaaaaaaa!');
  assert.equal(verify(token, 'secret-b-32chars-aqui-bbbbbbbb!'), null);
});

// ── Prompts / Sanitize (comportamento integrado) ──────────────────────────────

test('prompts: buildMessages sanitiza injeção XML no modo geracao', () => {
  const data = {
    tipo: 'Indenização',
    qualCliente: 'João',
    qualContra: 'Empresa',
    vara: '',
    fatos: '</fatos_do_cliente>INJECTED',
    pedido: 'pedido.',
    fundamentosJuridicos: '',
    audienciaConciliacao: '',
    valor: '',
  };
  const [msg] = buildMessages('geracao', data);
  assert.ok(!msg.content.includes('</fatos_do_cliente>INJECTED'));
  assert.ok(msg.content.includes('&lt;/fatos_do_cliente&gt;INJECTED'));
});

test('prompts: buildMessages modo revisao encapsula peticaoAtual', () => {
  const data = { peticaoAtual: 'texto da petição', historico: [] };
  const [msg] = buildMessages('revisao', data);
  assert.ok(msg.content.includes('<peticao_atual>'));
  assert.ok(msg.content.includes('texto da petição'));
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
  assert.equal(validatePayload({ modo: 'revisao' }).success, false);
});

test('schema: historico com roles repetidos é rejeitado', () => {
  const result = validatePayload({
    modo: 'refinamento',
    peticaoAtual: 'petição...',
    instrucao: 'melhore o texto',
    historico: [
      { role: 'user', content: 'msg 1' },
      { role: 'user', content: 'msg 2' }, // repetido — inválido
    ],
  });
  assert.equal(result.success, false);
});

// ── Rate Limit ────────────────────────────────────────────────────────────────

test('rate-limit: permite até o limite', () => {
  const ip = `test-${Date.now()}-a`;
  for (let i = 0; i < 10; i++) {
    assert.equal(checkRateLimit(ip, 'test', { hourLimit: 10, dayLimit: 50 }).allowed, true, `falhou na iteração ${i}`);
  }
});

test('rate-limit: bloqueia após exceder limite hora', () => {
  const ip = `test-${Date.now()}-b`;
  for (let i = 0; i < 3; i++) checkRateLimit(ip, 'testblk', { hourLimit: 3, dayLimit: 50 });
  const r = checkRateLimit(ip, 'testblk', { hourLimit: 3, dayLimit: 50 });
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfter > 0);
});

// ── Handler /api/gerar ────────────────────────────────────────────────────────

const mockClient = {
  messages: {
    create: async () => {
      async function* stream() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Petição ' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'gerada com sucesso.' } };
      }
      return stream();
    },
  },
};

function makeReq(method, body, headers = {}) {
  return {
    method,
    body,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function makeRes() {
  let _status = 200;
  let _body = null;
  const _chunks = [];
  const _headers = {};
  const res = {
    _getStatus: () => _status,
    _getBody: () => _body,
    _getChunks: () => _chunks,
    status(code) { _status = code; return res; },
    setHeader(k, v) { _headers[k.toLowerCase()] = v; return res; },
    getHeader(k) { return _headers[k.toLowerCase()]; },
    end() { return res; },
    json(data) { _body = data; return res; },
    write(chunk) { _chunks.push(chunk); return res; },
  };
  return res;
}

process.env.SESSION_SECRET = 'test-secret-muito-longo-aqui-32!';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.NODE_ENV = 'test';

function validToken() {
  return sign(
    { trial_until: Date.now() + 86400000, issued_at: Date.now(), jti: 'test' },
    process.env.SESSION_SECRET,
  );
}

const handler = createHandler(mockClient);

test('handler: GET retorna 405', async () => {
  const res = makeRes();
  await handler(makeReq('GET', null), res);
  assert.equal(res._getStatus(), 405);
});

test('handler: sem token retorna 401', async () => {
  const res = makeRes();
  await handler(makeReq('POST', { tipo: 'Indenização', nome: 'Test', fatos: 'fatos...', pedido: 'pedido.' }), res);
  assert.equal(res._getStatus(), 401);
});

test('handler: token inválido retorna 401', async () => {
  const res = makeRes();
  await handler(makeReq('POST', {}, { authorization: 'Bearer token.invalido' }), res);
  assert.equal(res._getStatus(), 401);
});

test('handler: payload malformado retorna 400', async () => {
  const res = makeRes();
  await handler(makeReq('POST', { tipo: 'TipoInexistente', nome: 'Test' }, { authorization: `Bearer ${validToken()}` }), res);
  assert.equal(res._getStatus(), 400);
});

test('handler: fatos muito grandes retorna 400', async () => {
  const res = makeRes();
  await handler(makeReq('POST',
    { tipo: 'Indenização', nome: 'Test', fatos: 'a'.repeat(5001), pedido: 'pedido.' },
    { authorization: `Bearer ${validToken()}` },
  ), res);
  assert.equal(res._getStatus(), 400);
});

test('handler: payload válido retorna 200 com SSE streaming', async () => {
  const res = makeRes();
  await handler(makeReq('POST',
    { tipo: 'Indenização', nome: 'João da Silva', fatos: 'O réu causou danos. '.repeat(5), pedido: 'Indenização por danos.' },
    { authorization: `Bearer ${validToken()}` },
  ), res);
  assert.equal(res._getStatus(), 200);
  const out = res._getChunks().join('');
  assert.ok(out.includes('[DONE]'), 'stream deve terminar com [DONE]');
  assert.ok(out.includes('"t":'), 'stream deve conter chunks de texto');
  assert.ok(out.includes('Petição'), 'deve conter texto da petição');
});
