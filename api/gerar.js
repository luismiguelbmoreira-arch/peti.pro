import Anthropic from '@anthropic-ai/sdk';
import { verify } from './_lib/hmac.js';
import { checkRateLimit } from './_lib/rate-limit.js';
import { validatePayload } from './_lib/schema.js';
import { getSystemPrompt, buildMessages } from './_lib/prompts.js';

const MODEL = 'claude-sonnet-4-6';

const MODEL_CONFIG = {
  geracao:     { max_tokens: 4000, temperature: 0.3 },
  refinamento: { max_tokens: 1500, temperature: 0.4 },
  simulacao:   { max_tokens: 2000, temperature: 0.5 },
  revisao:     { max_tokens: 2000, temperature: 0.2 },
};

// Formata qualificação das partes (lógica de domínio, não de prompt)
function formatParties(data) {
  const tipoContra = data.tipoParte === 'pj' ? 'Pessoa Jurídica' : 'Pessoa Física';
  const qualCliente = [
    data.nome,
    data.estadoCivil  ? `estado civil: ${data.estadoCivil}` : '',
    data.profissao    ? `profissão: ${data.profissao}` : '',
    data.cpf          ? `CPF: ${data.cpf}` : '',
    data.enderecoCliente ? `endereço: ${data.enderecoCliente}` : '',
  ].filter(Boolean).join(', ');

  const qualContra = [
    data.contra || 'não informado',
    data.tipoParte      ? `(${tipoContra})` : '',
    data.contraEstadoCivil ? `estado civil: ${data.contraEstadoCivil}` : '',
    data.contraDoc      ? `CPF/CNPJ: ${data.contraDoc}` : '',
    data.contraEndereco ? `endereço: ${data.contraEndereco}` : '',
  ].filter(Boolean).join(', ');

  return { qualCliente, qualContra };
}

function setCors(req, res) {
  const origin = process.env.NODE_ENV !== 'production' ? '*' : (process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (origin !== '*') res.setHeader('Vary', 'Origin');
}

export function createHandler(anthropicClient) {
  return async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') {
      return res.status(405).json({ erro: 'Método não permitido.' });
    }

    // Falha imediata se configuração ausente — não consome rate limit nem valida payload
    if (!process.env.SESSION_SECRET || !process.env.ANTHROPIC_API_KEY) {
      console.error({ name: 'ConfigError', firstLine: 'Env vars obrigatórias ausentes' });
      return res.status(503).json({ erro: 'Serviço temporariamente indisponível. Tente em instantes.' });
    }

    // ── Autenticação ──────────────────────────────────────────────────────────
    const authHeader = req.headers['authorization'] || '';
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const tokenPayload = rawToken ? verify(rawToken, process.env.SESSION_SECRET) : null;

    if (!tokenPayload || tokenPayload.trial_until < Date.now()) {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada. Recarregue a página.' });
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    const rl = checkRateLimit(ip, 'gerar', { hourLimit: 10, dayLimit: 50 });
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ erro: `Muitas requisições. Aguarde ${rl.retryAfter} segundos.` });
    }

    // ── Validação ─────────────────────────────────────────────────────────────
    const parsed = validatePayload(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({ erro: `Dados inválidos: ${msg}` });
    }

    const modo = parsed.data.modo || 'geracao';
    const data = modo === 'geracao'
      ? { ...parsed.data, ...formatParties(parsed.data) }
      : parsed.data;

    // ── Chamada Claude (SSE streaming) ───────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const config = MODEL_CONFIG[modo] || MODEL_CONFIG.geracao;
      const stream = await anthropicClient.messages.create({
        model: MODEL,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
        system: getSystemPrompt(modo),
        messages: buildMessages(modo, data),
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ t: event.delta.text })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');

    } catch (err) {
      const status = err?.status;
      console.error({ status, name: err?.name || 'Error', firstLine: String(err?.message || '').split('\n')[0].slice(0, 120) });
      let msg = 'Erro interno. Nossa equipe já foi notificada.';
      if (status === 529 || status === 503) msg = 'Serviço temporariamente indisponível. Tente em instantes.';
      else if (status === 429) msg = 'Muitas requisições. Aguarde e tente novamente.';
      res.write(`event: error\ndata: ${JSON.stringify({ erro: msg })}\n\n`);
    }

    res.end();
  };
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export default createHandler(client);
