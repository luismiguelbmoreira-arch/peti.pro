import { z } from 'zod';

const TIPOS = ['Inicial Trabalhista', 'Habeas Corpus', 'Contestação Cível', 'Indenização'];

const historicoItem = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(5000),
});

function validarHistoricoAlternado(arr) {
  if (arr.length === 0) return true;
  if (arr[0].role !== 'user') return false;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].role === arr[i - 1].role) return false;
  }
  return true;
}

const historicoSchema = z
  .array(historicoItem)
  .max(20)
  .refine((arr) => JSON.stringify(arr).length <= 51200, {
    message: 'Histórico excede 50KB',
  })
  .refine(validarHistoricoAlternado, {
    message: 'Histórico deve alternar mensagens user/assistant começando com user',
  })
  .optional()
  .default([]);

const geracaoSchema = z.object({
  modo: z.literal('geracao').optional(),
  tipo: z.enum(TIPOS, { errorMap: () => ({ message: 'Tipo de petição inválido' }) }),
  nome: z.string().min(1, 'Nome obrigatório').max(200),
  cpf: z.string().max(14).regex(/^[\d.\-\s]*$/, 'CPF inválido').optional().default(''),
  estadoCivil: z.string().max(50).optional().default(''),
  profissao: z.string().max(100).optional().default(''),
  enderecoCliente: z.string().max(300).optional().default(''),
  tipoParte: z.enum(['pf', 'pj', '']).optional().default(''),
  contra: z.string().max(200).optional().default(''),
  contraEstadoCivil: z.string().max(50).optional().default(''),
  contraDoc: z.string().max(20).optional().default(''),
  contraEndereco: z.string().max(300).optional().default(''),
  vara: z.string().max(200).optional().default(''),
  fatos: z.string().min(10, 'Fatos muito curtos').max(5000),
  fundamentosJuridicos: z.string().max(2000).optional().default(''),
  pedido: z.string().min(5, 'Pedido muito curto').max(5000),
  audienciaConciliacao: z.enum(['sim', 'nao', '']).optional().default(''),
  valor: z.string().max(50).optional().default(''),

  // Docs adicionais do cliente
  rg: z.string().max(20).optional().default(''),
  ctps: z.string().max(30).optional().default(''),
  pis: z.string().max(20).optional().default(''),
  nacionalidade: z.string().max(60).optional().default(''),

  // Trabalhista — vínculo empregatício
  dataAdmissao: z.string().max(20).optional().default(''),
  dataDemissao: z.string().max(20).optional().default(''),
  cargo: z.string().max(100).optional().default(''),
  salario: z.string().max(50).optional().default(''),
  jornada: z.string().max(100).optional().default(''),
  tipoDesligamento: z.string().max(100).optional().default(''),

  // Habeas Corpus
  pacienteDoc: z.string().max(50).optional().default(''),
  localRecolhimento: z.string().max(300).optional().default(''),
  numProcesso: z.string().max(50).optional().default(''),
  autoridadeCargo: z.string().max(200).optional().default(''),
  tipoConstrangimento: z.string().max(100).optional().default(''),
  tribunal: z.string().max(200).optional().default(''),

  // Contestação Cível
  preliminares: z.string().max(500).optional().default(''),

  // Indenização
  tipoDano: z.string().max(200).optional().default(''),
  valorDanoMaterial: z.string().max(50).optional().default(''),
  valorDanoMoral: z.string().max(50).optional().default(''),
  provasDocumentos: z.string().max(1000).optional().default(''),
});

const refinamentoSchema = z.object({
  modo: z.literal('refinamento'),
  peticaoAtual: z.string().min(1).max(50000),
  instrucao: z.string().min(1, 'Instrução obrigatória').max(10000),
  historico: historicoSchema,
});

const simulacaoSchema = z.object({
  modo: z.literal('simulacao'),
  peticaoAtual: z.string().min(1).max(50000),
  instrucao: z.string().max(10000).optional().default(''),
  historico: historicoSchema,
});

const revisaoSchema = z.object({
  modo: z.literal('revisao'),
  peticaoAtual: z.string().min(1).max(50000),
});

const diaboSchema = z.object({
  modo: z.literal('diabo'),
  peticaoAtual: z.string().min(1).max(50000),
  instrucao: z.string().max(10000).optional().default(''),
  historico: historicoSchema,
});

export function validatePayload(body) {
  const modo = body?.modo;
  switch (modo) {
    case 'refinamento': return refinamentoSchema.safeParse(body);
    case 'simulacao':   return simulacaoSchema.safeParse(body);
    case 'revisao':     return revisaoSchema.safeParse(body);
    case 'diabo':       return diaboSchema.safeParse(body);
    default:            return geracaoSchema.safeParse(body);
  }
}
