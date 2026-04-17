import Anthropic from '@anthropic-ai/sdk';
import { verify } from './_lib/hmac.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { checkRateLimit } from './_lib/rate-limit.js';
import { validatePayload } from './_lib/schema.js';
import { sanitizeField } from './_lib/sanitize.js';
import { getSystemPrompt, buildMessages } from './_lib/prompts.js';

const MODEL = 'claude-sonnet-4-6';

const MODEL_CONFIG = {
  geracao:     { max_tokens: 4000, temperature: 0.3 },
  refinamento: { max_tokens: 1500, temperature: 0.4 },
  simulacao:   { max_tokens: 2000, temperature: 0.5 },
  revisao:     { max_tokens: 2000, temperature: 0.2 },
};

// Fábrica que aceita client injetado (facilita testes)
export function createHandler(anthropicClient) {
  return async function handler(req, res) {
    setCorsHeaders(req, res);
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ erro: 'Método não permitido.' });
    }

    // ── Autenticação ──────────────────────────────────────────────────────────
    const authHeader = req.headers['authorization'] || '';
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const secret = process.env.SESSION_SECRET;

    if (!secret || !rawToken) {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada. Recarregue a página.' });
    }

    const tokenPayload = verify(rawToken, secret);
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
      return res.status(429).json({
        erro: `Muitas requisições. Aguarde ${rl.retryAfter} segundos.`,
      });
    }

    // ── Validação de schema ───────────────────────────────────────────────────
    const parsed = validatePayload(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({ erro: `Dados inválidos: ${msg}`, codigo: 400 });
    }

    const data = parsed.data;
    const modo = data.modo || 'geracao';

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ erro: 'Serviço temporariamente indisponível. Tente em instantes.' });
    }

    // ── Chamada Claude ────────────────────────────────────────────────────────
    try {
      const config = MODEL_CONFIG[modo] || MODEL_CONFIG.geracao;
      const messages = buildMessages(modo, data, sanitizeField);

      const response = await anthropicClient.messages.create({
        model: MODEL,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
        system: getSystemPrompt(modo),
        messages,
      });

      return res.status(200).json({ peticao: response.content[0].text });

    } catch (err) {
      const status = err?.status;
      const name = err?.name || 'Error';
      const firstLine = String(err?.message || '').split('\n')[0].slice(0, 120);
      console.error({ status, name, firstLine });

      if (status === 529 || status === 503) {
        return res.status(503).json({ erro: 'Serviço temporariamente indisponível. Tente em instantes.' });
      }
      if (status === 429) {
        return res.status(429).json({ erro: 'Muitas requisições. Aguarde e tente novamente.' });
      }
      return res.status(500).json({ erro: 'Erro interno. Nossa equipe já foi notificada.' });
    }
  };
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export default createHandler(client);
