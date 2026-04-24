import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from './_lib/rate-limit.js';
import { validatePayload } from './_lib/schema.js';
import { getSystemPrompt, buildMessages } from './_lib/prompts.js';
import { getUserFromRequest } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { QUOTA, currentMonth } from './_lib/quota.js';

const MODEL = 'claude-sonnet-4-6';

const MODEL_CONFIG = {
  geracao:     { max_tokens: 4000, temperature: 0.3 },
  refinamento: { max_tokens: 3000, temperature: 0.4 },
  simulacao:   { max_tokens: 2000, temperature: 0.5 },
  diabo:       { max_tokens: 3000, temperature: 0.6 },
  revisao:     { max_tokens: 2000, temperature: 0.2 },
};

// Formata qualificação das partes (lógica de domínio, não de prompt)
function formatParties(data) {
  const tipoContra = data.tipoParte === 'pj' ? 'Pessoa Jurídica' : 'Pessoa Física';
  const qualCliente = [
    data.nome,
    data.nacionalidade   ? `nacionalidade: ${data.nacionalidade}` : '',
    data.estadoCivil     ? `estado civil: ${data.estadoCivil}` : '',
    data.profissao       ? `profissão: ${data.profissao}` : '',
    data.cpf             ? `CPF: ${data.cpf}` : '',
    data.enderecoCliente ? `endereço: ${data.enderecoCliente}` : '',
  ].filter(Boolean).join(', ');

  const qualContra = [
    data.contra || 'não informado',
    data.tipoParte         ? `(${tipoContra})` : '',
    data.contraEstadoCivil ? `estado civil: ${data.contraEstadoCivil}` : '',
    data.contraDoc         ? `CPF/CNPJ: ${data.contraDoc}` : '',
    data.contraEndereco    ? `endereço: ${data.contraEndereco}` : '',
  ].filter(Boolean).join(', ');

  return { qualCliente, qualContra };
}

function buildContextoExtra(data) {
  const lines = [];

  if (data.tipo === 'Inicial Trabalhista') {
    if (data.rg)              lines.push(`RG: ${data.rg}`);
    if (data.ctps)            lines.push(`CTPS: ${data.ctps}`);
    if (data.pis)             lines.push(`PIS/PASEP: ${data.pis}`);
    if (data.dataAdmissao)    lines.push(`Data de admissão: ${data.dataAdmissao}`);
    if (data.dataDemissao)    lines.push(`Data de demissão: ${data.dataDemissao}`);
    if (data.cargo)           lines.push(`Cargo/função: ${data.cargo}`);
    if (data.salario)         lines.push(`Último salário: R$ ${data.salario}`);
    if (data.jornada)         lines.push(`Jornada: ${data.jornada}`);
    if (data.tipoDesligamento) lines.push(`Tipo de desligamento: ${data.tipoDesligamento}`);
  }

  if (data.tipo === 'Habeas Corpus') {
    if (data.pacienteDoc)        lines.push(`CPF/RG do paciente: ${data.pacienteDoc}`);
    if (data.localRecolhimento)  lines.push(`Local de recolhimento: ${data.localRecolhimento}`);
    if (data.numProcesso)        lines.push(`Nº do processo/inquérito: ${data.numProcesso}`);
    if (data.autoridadeCargo)    lines.push(`Cargo/unidade da autoridade coatora: ${data.autoridadeCargo}`);
    if (data.tipoConstrangimento) lines.push(`Tipo de constrangimento: ${data.tipoConstrangimento}`);
    if (data.tribunal)           lines.push(`Tribunal competente: ${data.tribunal}`);
  }

  if (data.tipo === 'Contestação Cível') {
    if (data.numProcesso)  lines.push(`Nº do processo: ${data.numProcesso}`);
    if (data.preliminares) lines.push(`Preliminares a arguir: ${data.preliminares}`);
  }

  if (data.tipo === 'Indenização') {
    if (data.tipoDano)          lines.push(`Tipo(s) de dano: ${data.tipoDano}`);
    if (data.valorDanoMaterial) lines.push(`Valor do dano material: R$ ${data.valorDanoMaterial}`);
    if (data.valorDanoMoral)    lines.push(`Valor pleiteado (dano moral): R$ ${data.valorDanoMoral}`);
    if (data.provasDocumentos)  lines.push(`Documentos/provas disponíveis: ${data.provasDocumentos}`);
  }

  return lines.join('\n');
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

    // Falha imediata se configuração ausente
    if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error({ name: 'ConfigError', firstLine: 'Env vars obrigatórias ausentes' });
      return res.status(503).json({ erro: 'Serviço temporariamente indisponível. Tente em instantes.' });
    }

    // ── Autenticação via Supabase ─────────────────────────────────────────────
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ erro: 'Sessão inválida. Recarregue a página.' });

    // ── Rate limit anti-burst ─────────────────────────────────────────────────
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    const rl = checkRateLimit(ip, 'gerar', { hourLimit: 10, dayLimit: 50 });
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ erro: `Muitas requisições. Aguarde ${rl.retryAfter} segundos.` });
    }

    // ── Plano e quota ─────────────────────────────────────────────────────────
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status, plan')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!sub || !['trialing', 'active', 'past_due'].includes(sub.status)) {
      return res.status(402).json({ erro: 'Assinatura necessária.', code: 'NO_SUB' });
    }

    const plan = sub.status === 'trialing' ? 'trial' : sub.plan;
    const limit = QUOTA[plan] ?? 0;

    if (Number.isFinite(limit)) {
      const month = currentMonth();
      const { data: use } = await supabaseAdmin
        .from('usage').select('count').eq('user_id', user.id).eq('month', month).maybeSingle();
      if ((use?.count || 0) >= limit) {
        return res.status(402).json({ erro: 'Limite mensal atingido.', code: 'QUOTA_EXCEEDED', plan, used: use?.count || 0, limit });
      }
      await supabaseAdmin.rpc('increment_usage', { p_user_id: user.id, p_month: month });
    }

    // ── Validação ─────────────────────────────────────────────────────────────
    const parsed = validatePayload(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({ erro: `Dados inválidos: ${msg}` });
    }

    const modo = parsed.data.modo || 'geracao';
    const data = modo === 'geracao'
      ? { ...parsed.data, ...formatParties(parsed.data), contextoExtra: buildContextoExtra(parsed.data) }
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
