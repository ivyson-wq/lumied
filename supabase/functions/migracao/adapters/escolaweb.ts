// ═══════════════════════════════════════════════════════════════
//  Adapter Escolaweb — Sprint 2 da Migração de ERPs
//
//  Estende o adapter Excel/CSV genérico com:
//   • Sinônimos PT-BR específicos do Escolaweb (RA/Matrícula, Sacado,
//     Responsável Financeiro, Mês Referência, Nosso Número, etc.)
//   • Mapeamento de status financeiros do Escolaweb
//     (Em aberto, Quitado, Renegociado, Estornado, etc.)
//   • Detecção por nomes de sheet em workbooks multi-aba típicos do
//     "Relatório Completo" do Escolaweb
//   • Detecção da fonte por assinaturas de header
//
//  Decisões e ordem das fases em memory:project_migracao_erps.
// ═══════════════════════════════════════════════════════════════

import { normName } from "../validator.ts";
import { SIN_BASE, normKey, type EntidadeAlvo, type ErpDialect, type SynonymMap } from "./excel.ts";

// ── Sinônimos PT-BR específicos do Escolaweb ────────────────────
// Ordem importa — o primeiro hit ganha. Mantemos os termos do Escolaweb
// PRIMEIRO e caímos no SIN_BASE como fallback.
export const SIN_ESCOLAWEB: SynonymMap = {
  ...SIN_BASE,

  // ── alunos ───────────────────────────────────────────────────
  nome: [
    "Nome do Aluno", "Aluno", "Nome Completo", "Aluno(a)", "Discente",
    ...SIN_BASE.nome,
  ],
  email: [
    "E-mail do Aluno", "Email do Aluno", "E-mail Aluno", ...SIN_BASE.email,
  ],
  cpf: [
    "CPF do Aluno", "CPF Aluno", "CPF/RG do Aluno", ...SIN_BASE.cpf,
  ],
  data_nascimento: [
    "Data de Nascimento", "Dt. Nascimento", "Dt Nasc.", "Nascimento",
    ...SIN_BASE.data_nascimento,
  ],
  serie_origem: [
    "Curso", "Curso/Série", "Série/Turma", "Turma", "Classe", "Série Atual",
    ...SIN_BASE.serie_origem,
  ],
  responsavel_email: [
    "E-mail do Responsável Financeiro", "E-mail Responsável", "Email do Pai",
    "Email da Mãe", ...SIN_BASE.responsavel_email,
  ],
  responsavel_cpf: [
    "CPF do Responsável Financeiro", "CPF Responsável Financeiro",
    "CPF do Sacado", ...SIN_BASE.responsavel_cpf,
  ],

  // ── responsáveis (Escolaweb usa "Sacado" no módulo financeiro) ──
  nome_resp: [
    "Nome do Responsável", "Responsável", "Responsável Financeiro",
    "Sacado", "Nome do Sacado", "Mãe", "Pai", "Nome da Mãe", "Nome do Pai",
    ...SIN_BASE.nome_resp,
  ],
  telefone: [
    "Telefone Fixo", "Telefone Residencial", "Telefone do Responsável",
    ...SIN_BASE.telefone,
  ],
  whatsapp: [
    "Celular", "Celular do Responsável", "WhatsApp do Responsável",
    ...SIN_BASE.whatsapp,
  ],
  endereco: [
    "Endereço Completo", "Endereço Residencial", "Logradouro",
    ...SIN_BASE.endereco,
  ],
  cep: ["CEP", "CEP Residencial", ...SIN_BASE.cep],
  parentesco: [
    "Grau de Parentesco", "Parentesco", "Tipo de Responsável", "Vínculo",
    ...SIN_BASE.parentesco,
  ],
  aluno_email: [
    "E-mail do Aluno Vinculado", "Email Aluno Vinculado", ...SIN_BASE.aluno_email,
  ],
  responsavel_financeiro: [
    "Responsável Financeiro", "Pagador", "É Responsável Financeiro",
    "Resp. Financeiro", ...SIN_BASE.responsavel_financeiro,
  ],

  // ── turmas ───────────────────────────────────────────────────
  turma_nome: [
    "Nome da Turma", "Turma", "Classe", "Série", "Curso",
    ...SIN_BASE.turma_nome,
  ],
  ano: ["Ano Letivo", "Exercício", "Ano de Referência", ...SIN_BASE.ano],
  turno: ["Turno", "Período", "Horário", ...SIN_BASE.turno],

  // ── matrículas ──────────────────────────────────────────────
  status_matricula: [
    "Situação da Matrícula", "Status da Matrícula", "Situação do Aluno",
    "Status Acadêmico", ...SIN_BASE.status_matricula,
  ],
  data_matricula: [
    "Data da Matrícula", "Matriculado em", "Dt. Matrícula",
    ...SIN_BASE.data_matricula,
  ],

  // ── funcionários ────────────────────────────────────────────
  cargo: [
    "Cargo/Função", "Função no Escolaweb", "Cargo Atual", "Perfil",
    ...SIN_BASE.cargo,
  ],

  // ── financeiro (boletos / mensalidades) ─────────────────────
  tipo: [
    "Tipo de Lançamento", "Natureza do Título", "Receita/Despesa",
    ...SIN_BASE.tipo,
  ],
  categoria_origem: [
    "Categoria do Lançamento", "Plano de Contas", "Tipo de Receita",
    "Tipo de Despesa", "Conta Contábil", "Centro de Custo",
    ...SIN_BASE.categoria_origem,
  ],
  descricao: [
    "Histórico", "Descrição do Lançamento", "Memorando", "Mês Referência",
    "Mês de Referência", "Competência", ...SIN_BASE.descricao,
  ],
  valor: [
    "Valor Original", "Valor do Boleto", "Valor da Mensalidade",
    "Valor Bruto", "Valor a Pagar", "Valor Líquido", ...SIN_BASE.valor,
  ],
  data_lancamento: [
    "Data de Emissão", "Data da Emissão", "Emitido em",
    ...SIN_BASE.data_lancamento,
  ],
  data_vencimento: [
    "Data de Vencimento", "Vencimento Original", "Dt. Venc.",
    ...SIN_BASE.data_vencimento,
  ],
  data_pagamento: [
    "Data de Quitação", "Quitado em", "Data do Pagamento", "Dt. Quitação",
    "Data da Baixa", ...SIN_BASE.data_pagamento,
  ],
  status_origem: [
    "Situação do Boleto", "Status do Título", "Status do Boleto",
    "Situação", "Estado do Lançamento", ...SIN_BASE.status_origem,
  ],
  fornecedor: [
    "Fornecedor", "Nome do Fornecedor", "Razão Social", "Beneficiário",
    ...SIN_BASE.fornecedor,
  ],
  familia_email: [
    "E-mail do Sacado", "E-mail do Pagador", "E-mail Resp. Financeiro",
    "Email do Sacado", ...SIN_BASE.familia_email,
  ],
  familia_nome: [
    "Nome do Sacado", "Sacado", "Pagador", "Nome do Pagador",
    ...SIN_BASE.familia_nome,
  ],
  familia_cpf: [
    "CPF do Sacado", "CPF/CNPJ do Sacado", "CPF do Pagador",
    "CPF Resp. Financeiro", ...SIN_BASE.familia_cpf,
  ],
  documento: [
    "Nosso Número", "Número do Boleto", "Identificador do Boleto", "Nº NF",
    "Número do Documento", ...SIN_BASE.documento,
  ],

  // ── notas ────────────────────────────────────────────────────
  periodo: [
    "Bimestre", "Trimestre", "Etapa Avaliativa", "Período Letivo",
    ...SIN_BASE.periodo,
  ],
  disciplina: [
    "Disciplina", "Componente Curricular", "Matéria", "Componente",
    ...SIN_BASE.disciplina,
  ],
  nota: ["Nota Final", "Média", "Nota Bimestral", ...SIN_BASE.nota],
  conceito: ["Conceito", "Menção", ...SIN_BASE.conceito],
};

// ── Status financeiro Escolaweb → canônico Lumied ──────────────
export function statusEscolaweb(
  raw: string | null | undefined,
): "pendente" | "pago" | "atrasado" | "cancelado" | null {
  const v = normName(raw);
  if (!v) return null;
  // Quitado / Pago / Liquidado / Baixado
  if (/quitad|pago|liquid|baixad|recebid/.test(v)) return "pago";
  // Cancelado / Estornado / Negativado (perda)
  if (/cancel|estorn|negativ|inadimpl/.test(v)) return "cancelado";
  // Atrasado / Vencido / Inadimplente
  if (/atras|vencid|expirad/.test(v)) return "atrasado";
  // Em aberto / Aberto / A pagar / A receber / Pendente / Renegociado
  if (/em aberto|^aberto$|a pagar|a receber|pendent|renegoc|parcelad/.test(v)) {
    return "pendente";
  }
  return null;
}

// ── Sheet name → entidade alvo ─────────────────────────────────
// O "Relatório Completo" do Escolaweb costuma vir como um único XLSX com
// abas tipo "Cadastro de Alunos", "Responsáveis", "Mensalidades",
// "Contas a Pagar", "Notas". Esta heurística cobre os termos mais comuns.
export function entidadeBySheetNameEscolaweb(sheet: string): EntidadeAlvo | null {
  const v = normName(sheet);
  if (!v) return null;
  if (/^aluno|cadastro de aluno|cadastros? alunos|discente/.test(v)) return "alunos";
  if (/respons|familia|sacado|pagador/.test(v)) return "responsaveis";
  if (/^turma|cadastro de turma|classe$|^serie/.test(v)) return "turmas";
  if (/matric/.test(v)) return "matriculas";
  if (/funcion|colaborad|professor|docente|equipe/.test(v)) return "funcionarios";
  if (
    /mensalid|boleto|financ|conta a receb|conta a pag|receit|despes|titulo|lancament/.test(v)
  ) return "financeiro";
  if (/^nota|boletim|avalia|desempenho/.test(v)) return "notas";
  return null;
}

// ── Detecção da fonte Escolaweb por headers ────────────────────
// Procuramos um conjunto de chaves muito específicas do Escolaweb. Match
// de ≥ 2 chaves dispara a detecção (evita falso positivo em planilhas
// genéricas que coincidentemente têm "Sacado").
const ESCOLAWEB_HEADER_SIGNATURES = [
  "nosso numero",
  "sacado",
  "responsavel financeiro",
  "situacao do boleto",
  "mes referencia",
  "mes de referencia",
  "ra do aluno",
  "matricula escolaweb",
];

export function detectEscolawebByHeaders(headers: string[]): boolean {
  const hs = headers.map(normKey);
  let hits = 0;
  for (const sig of ESCOLAWEB_HEADER_SIGNATURES) {
    if (hs.some((h) => h.includes(sig))) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// ── Dialect agregado (passado para rowsToStaging) ──────────────
export const ESCOLAWEB_DIALECT: ErpDialect = {
  id: "escolaweb",
  synonyms: SIN_ESCOLAWEB,
  statusMap: statusEscolaweb,
  entidadeBySheetName: entidadeBySheetNameEscolaweb,
  detectByHeaders: detectEscolawebByHeaders,
};
