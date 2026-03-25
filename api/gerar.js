// api/gerar.js — Peti.PRO (Conecte.se)
// Suporta 4 modos: geração, refinamento, simulacao, revisao

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── System prompts por modo ──────────────────────────────────────────────────

const PROMPT_GERACAO = `Você é um advogado brasileiro sênior especialista em redação de petições jurídicas.
Escreva petições completas, formais e tecnicamente precisas, seguindo todas as normas do ordenamento jurídico brasileiro.
Inclua: endereçamento correto, qualificação das partes, dos fatos, fundamentos jurídicos (com artigos de lei e jurisprudência pertinente), pedidos detalhados, valor da causa e fecho formal.
Linguagem: formal, objetiva, técnica. Sem introduções ou explicações — apenas a petição pronta.`;

const PROMPT_REFINAMENTO = `Você está refinando uma petição jurídica brasileira já existente.
Mostre APENAS o trecho que precisa ser alterado.
Formato obrigatório da resposta:

ANTES:
"[trecho original entre aspas]"

DEPOIS:
"[trecho novo entre aspas]"

Nada além disso. Sem explicações, sem introdução.
Se a instrução for uma pergunta e não uma alteração, responda em texto simples sem o formato ANTES/DEPOIS.`;

const PROMPT_SIMULACAO = `Você é o advogado da parte adversária analisando uma petição jurídica brasileira para encontrar vulnerabilidades e construir a melhor defesa possível.

Sua missão: identificar todos os pontos fracos, argumentos contestáveis, ausência de provas, valores sem memória de cálculo, e qualquer brecha que um bom advogado adversário exploraria.

Classifique cada ponto como:
🔴 RISCO ALTO — pode comprometer o resultado
🟡 RISCO MÉDIO — enfraquece mas não derruba
🟢 PONTO SÓLIDO — bem fundamentado, difícil de atacar

Para cada ponto fraco, ofereça uma sugestão direta de como o advogado autor pode se fortalecer.

Se a mensagem for uma pergunta ou instrução específica sobre a simulação, responda no contexto do papel de advogado adversário.

Seja direto, técnico e honesto. O advogado precisa saber a verdade sobre a petição antes de protocolar.`;

const PROMPT_REVISAO = `Você é um revisor jurídico técnico independente.
Releia esta petição como se não tivesse escrito — sem viés de confirmação, sem defender as escolhas feitas. Seu único objetivo é encontrar problemas.

Verifique obrigatoriamente:
1. Artigos de lei citados — estão corretos e aplicáveis?
2. Jurisprudência — está atualizada e pertinente?
3. Estrutura — todos os elementos obrigatórios presentes?
4. Coerência — os fatos sustentam os pedidos?
5. Pedidos — têm fundamentação legal adequada?
6. Valor da causa — tem memória de cálculo ou é arbitrário?
7. Contradições — há alguma afirmação que contradiz outra?

Para cada problema encontrado:
- Descreva o problema claramente
- Cite o trecho exato com o erro
- Sugira a correção

Para cada item verificado sem problemas:
- Confirme que está correto com ✓

Seja implacável. O advogado precisa saber a verdade antes de protocolar — não depois.`;

// ─── Handler principal ────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      erro: 'A geração de petições ainda não está ativa nesta instalação. Para ativar, configure sua chave de API nas variáveis de ambiente da Vercel. Dúvidas? Fale com a Conecte.se.',
    });
  }

  const body = req.body;
  const { modo } = body;

  try {
    // ── MODO: REFINAMENTO ──────────────────────────────────────────────────────
    if (modo === 'refinamento') {
      const { peticaoAtual, instrucao, historico = [] } = body;

      const messages = [
        ...historico.map(m => ({ role: m.role, content: m.content })),
        {
          role: 'user',
          content: `Petição atual:\n\n${peticaoAtual}\n\n---\nInstrução: ${instrucao}`,
        },
      ];

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: PROMPT_REFINAMENTO,
        messages,
      });

      return res.status(200).json({ peticao: response.content[0].text });
    }

    // ── MODO: SIMULAÇÃO DE DEFESA ──────────────────────────────────────────────
    if (modo === 'simulacao') {
      const { peticaoAtual, instrucao = '', historico = [] } = body;

      const userMsg = instrucao
        ? `Instrução adicional: ${instrucao}`
        : `Analise esta petição como advogado adversário:\n\n${peticaoAtual}`;

      const messages = [
        { role: 'user', content: `Petição a ser analisada:\n\n${peticaoAtual}` },
        ...historico
          .filter((_, i) => i > 0) // pula primeira msg se já incluímos a petição
          .map(m => ({ role: m.role, content: m.content })),
      ];

      // Se é a primeira mensagem (sem histórico), montar direto
      const msgs = historico.length === 0
        ? [{ role: 'user', content: `Analise esta petição como advogado adversário:\n\n${peticaoAtual}` }]
        : [
            ...historico.map(m => ({ role: m.role, content: m.content })),
            instrucao ? { role: 'user', content: instrucao } : null,
          ].filter(Boolean);

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        system: PROMPT_SIMULACAO,
        messages: msgs,
      });

      return res.status(200).json({ peticao: response.content[0].text });
    }

    // ── MODO: REVISÃO TÉCNICA ──────────────────────────────────────────────────
    if (modo === 'revisao') {
      const { peticaoAtual } = body;

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        system: PROMPT_REVISAO,
        messages: [
          { role: 'user', content: `Revise esta petição:\n\n${peticaoAtual}` },
        ],
      });

      return res.status(200).json({ peticao: response.content[0].text });
    }

    // ── MODO: GERAÇÃO INICIAL (padrão) ─────────────────────────────────────────
    const {
      tipo   = '',
      nome   = '',
      cpf    = '',
      estadoCivil = '',
      profissao = '',
      enderecoCliente = '',
      tipoParte = '',
      contra = '',
      contraEstadoCivil = '',
      contraDoc = '',
      contraEndereco = '',
      vara   = '',
      fatos  = '',
      fundamentosJuridicos = '',
      pedido = '',
      audienciaConciliacao = '',
      valor  = '',
    } = body;

    // Monta qualificação completa se campos trabalhistas presentes
    const qualCliente = [
      nome,
      estadoCivil ? `estado civil: ${estadoCivil}` : '',
      profissao ? `profissão: ${profissao}` : '',
      cpf ? `CPF: ${cpf}` : '',
      enderecoCliente ? `endereço: ${enderecoCliente}` : '',
    ].filter(Boolean).join(', ');

    const tipoContra = tipoParte === 'pj' ? 'Pessoa Jurídica' : 'Pessoa Física';
    const qualContra = [
      contra || 'não informado',
      tipoParte ? `(${tipoContra})` : '',
      contraEstadoCivil ? `estado civil: ${contraEstadoCivil}` : '',
      contraDoc ? `CPF/CNPJ: ${contraDoc}` : '',
      contraEndereco ? `endereço: ${contraEndereco}` : '',
    ].filter(Boolean).join(', ');

    const userPrompt = `
Tipo de petição: ${tipo}
Cliente: ${qualCliente}
Parte contrária: ${qualContra}
Vara / Foro: ${vara || 'não informado'}
${audienciaConciliacao ? `Requer audiência de conciliação: ${audienciaConciliacao === 'sim' ? 'Sim' : 'Não'}` : ''}

FATOS:
${fatos}
${fundamentosJuridicos ? `\nFUNDAMENTOS JURÍDICOS INDICADOS PELO ADVOGADO:\n${fundamentosJuridicos}` : ''}

PEDIDO:
${pedido}
${valor ? `\nValor da causa: R$ ${valor}` : ''}

Redija a petição completa.`.trim();

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: PROMPT_GERACAO,
      messages: [{ role: 'user', content: userPrompt }],
    });

    return res.status(200).json({ peticao: response.content[0].text });

  } catch (err) {
    console.error('Erro na API Anthropic:', err);
    return res.status(500).json({
      erro: `Erro ao gerar petição: ${err.message || 'Erro desconhecido'}`,
    });
  }
};
