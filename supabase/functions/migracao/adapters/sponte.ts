// ═══════════════════════════════════════════════════════════════
//  Adapter Sponte — Sprint 3 da Migração de ERPs
//
//  Estende o adapter Excel/CSV genérico com:
//   • Sinônimos PT-BR específicos do Sponte (RA, Curso, Parcela,
//     Responsável Financeiro, Forma de Recebimento, Conta Bancária,
//     Centro de Custo, etc.)
//   • Mapeamento de status financeiros do Sponte
//     (Em Aberto, Quitado, Em Atraso, Renegociado, Parcial, Cancelado)
//   • Detecção de entidade por nome de sheet nos exports "Relatório
//     Geral" do Sponte (Cad Alunos, CR, CP, Boletins...)
//   • Detecção da fonte por assinaturas de header
//
//  Decisões e ordem das fases em memory:project_migracao_erps.
// ═══════════════════════════════════════════════════════════════

import { normName } from "../validator.ts";
import { SIN_BASE, normKey, type EntidadeAlvo, type ErpDialect, type SynonymMap } from "./excel.ts";

// ── Sinônimos PT-BR específicos do Sponte ──────────────────────
// Ordem importa — o primeiro hit ganha. Termos Sponte ficam ANTES dos
// genéricos do SIN_BASE.
export const SIN_SPONTE: SynonymMap = {
  ...SIN_BASE,

  // ── alunos ───────────────────────────────────────────────────
  nome: [
    "Nome do Aluno", "Aluno", "Discente", "Nome", "Nome Completo",
    "Aluno(a)", ...SIN_BASE.nome,
  ],
  email: [
    "E-mail do Aluno", "Email Aluno", "Email Sponte", ...SIN_BASE.email,
  ],
  cpf: [
    "CPF do Aluno", "CPF Aluno", "Documento Aluno", "CPF/RG",
    ...SIN_BASE.cpf,
  ],
  data_nascimento: [
    "Data de Nascimento", "Dt. Nascimento", "Nascimento", "Dt Nasc",
    "Aniversário", ...SIN_BASE.data_nascimento,
  ],
  serie_origem: [
    "Curso", "Curso Atual", "Curso/Turma", "Turma", "Turma Atual",
    "Classe", "Série", "Modalidade", ...SIN_BASE.serie_origem,
  ],
  responsavel_email: [
    "E-mail do Responsável Financeiro", "Email Responsável",
    "Email Resp. Financeiro", "Email do Resp.", ...SIN_BASE.responsavel_email,
  ],
  responsavel_cpf: [
    "CPF do Responsável Financeiro", "CPF Resp Financeiro",
    "Documento do Responsável", "CPF Pai", "CPF Mãe",
    ...SIN_BASE.responsavel_cpf,
  ],

  // ── responsáveis ─────────────────────────────────────────────
  nome_resp: [
    "Responsável Financeiro", "Responsável", "Resp. Financeiro",
    "Nome do Responsável", "Cliente", "Pagador", "Sacado",
    "Pai", "Mãe", ...SIN_BASE.nome_resp,
  ],
  telefone: [
    "Telefone Fixo", "Telefone Residencial", "Telefone do Responsável",
    "Tel. Residencial", "Tel. Comercial", ...SIN_BASE.telefone,
  ],
  whatsapp: [
    "Celular", "Celular do Responsável", "Tel. Celular", "WhatsApp",
    ...SIN_BASE.whatsapp,
  ],
  endereco: [
    "Endereço Completo", "Logradouro", "Endereço Residencial",
    ...SIN_BASE.endereco,
  ],
  cidade: ["Cidade", "Município do Responsável", ...SIN_BASE.cidade],
  uf: ["UF", "Estado", ...SIN_BASE.uf],
  cep: ["CEP", ...SIN_BASE.cep],
  parentesco: [
    "Grau de Parentesco", "Parentesco", "Tipo Responsável", "Vínculo",
    "Relação", ...SIN_BASE.parentesco,
  ],
  aluno_email: [
    "E-mail do Aluno Vinculado", "Aluno Vinculado", ...SIN_BASE.aluno_email,
  ],
  responsavel_financeiro: [
    "É Responsável Financeiro", "Resp Financeiro", "Responsável Financeiro?",
    "Pagador?", ...SIN_BASE.responsavel_financeiro,
  ],

  // ── turmas ───────────────────────────────────────────────────
  turma_nome: [
    "Nome da Turma", "Turma", "Código da Turma", "Cód Turma",
    "Descrição da Turma", "Curso", "Classe", ...SIN_BASE.turma_nome,
  ],
  ano: ["Ano Letivo", "Exercício", "Ano de Referência", ...SIN_BASE.ano],
  turno: [
    "Turno", "Período", "Horário de Aula", "Período da Turma",
    ...SIN_BASE.turno,
  ],

  // ── matrículas ──────────────────────────────────────────────
  status_matricula: [
    "Situação da Matrícula", "Status do Aluno", "Status Acadêmico",
    "Situação", "Situação Atual", ...SIN_BASE.status_matricula,
  ],
  data_matricula: [
    "Data da Matrícula", "Dt. Matrícula", "Matriculado em",
    "Data de Ingresso", ...SIN_BASE.data_matricula,
  ],

  // ── funcionários ────────────────────────────────────────────
  cargo: [
    "Cargo/Função", "Função Sponte", "Cargo Atual", "Perfil de Acesso",
    "Tipo de Funcionário", ...SIN_BASE.cargo,
  ],

  // ── financeiro (contas a receber / pagar) ───────────────────
  tipo: [
    "Tipo de Lançamento", "Natureza", "Receita/Despesa",
    "Tipo de Movimentação", "Tipo do Título", ...SIN_BASE.tipo,
  ],
  categoria_origem: [
    "Categoria", "Plano de Contas", "Conta Contábil", "Subconta",
    "Centro de Custo", "Grupo Financeiro", "Classificação Financeira",
    ...SIN_BASE.categoria_origem,
  ],
  descricao: [
    "Histórico", "Descrição do Lançamento", "Memorando", "Descrição",
    "Observação Financeira", "Obs. do Boleto", "Parcela",
    ...SIN_BASE.descricao,
  ],
  valor: [
    "Valor Original", "Valor do Título", "Valor da Parcela",
    "Valor a Pagar", "Valor a Receber", "Valor Pago", "Valor Bruto",
    "Valor Líquido", "Valor Recebido", ...SIN_BASE.valor,
  ],
  data_lancamento: [
    "Data de Emissão", "Data da Emissão", "Emitido em", "Dt. Emissão",
    "Data de Lançamento", "Data Cadastro", ...SIN_BASE.data_lancamento,
  ],
  data_vencimento: [
    "Data de Vencimento", "Vencimento", "Dt. Venc.", "Venc.",
    "Vencimento Original", "Próximo Vencimento", ...SIN_BASE.data_vencimento,
  ],
  data_pagamento: [
    "Data de Recebimento", "Data de Pagamento", "Recebido em",
    "Pago em", "Dt. Pagto", "Data da Baixa", "Data de Quitação",
    "Quitado em", ...SIN_BASE.data_pagamento,
  ],
  status_origem: [
    "Situação do Título", "Situação", "Status do Lançamento",
    "Status", "Estado do Boleto", ...SIN_BASE.status_origem,
  ],
  fornecedor: [
    "Fornecedor", "Beneficiário", "Razão Social do Fornecedor",
    "Nome do Fornecedor", "Credor", ...SIN_BASE.fornecedor,
  ],
  familia_email: [
    "E-mail do Cliente", "Email do Sacado", "E-mail Resp. Financeiro",
    "Email do Pagador", ...SIN_BASE.familia_email,
  ],
  familia_nome: [
    "Cliente", "Nome do Cliente", "Sacado", "Pagador",
    "Nome do Sacado", "Razão Social do Cliente", ...SIN_BASE.familia_nome,
  ],
  familia_cpf: [
    "CPF/CNPJ do Cliente", "CPF do Sacado", "Documento do Cliente",
    "CPF do Pagador", ...SIN_BASE.familia_cpf,
  ],
  documento: [
    "Nº do Documento", "Nº Boleto", "Nosso Número", "Número do Título",
    "Número da Parcela", "Doc Sponte", "Identificador",
    ...SIN_BASE.documento,
  ],

  // ── notas ────────────────────────────────────────────────────
  periodo: [
    "Bimestre", "Trimestre", "Etapa", "Etapa Avaliativa",
    "Período Letivo", "Avaliação", ...SIN_BASE.periodo,
  ],
  disciplina: [
    "Disciplina", "Componente Curricular", "Matéria", "Componente",
    "Disciplina Sponte", ...SIN_BASE.disciplina,
  ],
  nota: [
    "Nota Final", "Média", "Nota Bimestral", "Nota da Avaliação",
    "Nota Sponte", ...SIN_BASE.nota,
  ],
  conceito: ["Conceito", "Menção", "Letra", ...SIN_BASE.conceito],
};

// ── Status financeiro Sponte → canônico Lumied ────────────────
// "Parcial" e "Renegociado" caem como pendente — o histórico de
// pagamentos completos vai pra fin_lancamentos via promote, mas o
// status do título original é considerado pendente até saldo zero.
export function statusSponte(
  raw: string | null | undefined,
): "pendente" | "pago" | "atrasado" | "cancelado" | null {
  const v = normName(raw);
  if (!v) return null;
  // Quitado / Pago / Liquidado / Baixado / Recebido
  if (/quitad|pago|liquid|baixad|recebid total/.test(v)) return "pago";
  // Cancelado / Estornado / Suspenso
  if (/cancel|estorn|suspens/.test(v)) return "cancelado";
  // Atrasado / Vencido / Inadimplente
  if (/atras|vencid|inadimpl|expirad/.test(v)) return "atrasado";
  // Em aberto / Parcial / Renegociado / A pagar / A receber
  if (/em aberto|^aberto$|a pagar|a receber|pendent|parcial|renegoc|aguardand/.test(v)) {
    return "pendente";
  }
  return null;
}

// ── Sheet name → entidade alvo ─────────────────────────────────
// O "Relatório Geral" do Sponte costuma vir como XLSX multi-aba: "Cad
// Alunos", "Cad Resp", "Cad Turmas", "Cad Func", "CR" (Contas a Receber),
// "CP" (Contas a Pagar), "Boletins", "Frequência". A heurística cobre as
// abreviações comuns que aparecem na exportação padrão.
export function entidadeBySheetNameSponte(sheet: string): EntidadeAlvo | null {
  const v = normName(sheet);
  if (!v) return null;
  if (/^cad alunos|^aluno|cadastro de aluno|discente|alunos sponte/.test(v)) return "alunos";
  if (/^cad resp|^respons|familia|sacado|pagador|^cliente/.test(v)) return "responsaveis";
  if (/^cad turma|^turma|^curso|classe|^serie/.test(v)) return "turmas";
  if (/matric/.test(v)) return "matriculas";
  if (/^cad func|funcion|colaborad|professor|docente|equipe|usuari/.test(v)) {
    return "funcionarios";
  }
  if (
    /^cr$|^cp$|contas? a receb|contas? a pag|financ|mensalid|boleto|titulo|lancament|receit|despes/.test(v)
  ) return "financeiro";
  if (/^nota|boletim|avalia|desempenho|conceito/.test(v)) return "notas";
  return null;
}

// ── Detecção da fonte Sponte por headers ───────────────────────
// Procuramos um conjunto de chaves muito específicas do Sponte. Match
// de ≥ 2 chaves dispara a detecção (evita falso positivo em planilhas
// genéricas que coincidentemente têm "Cliente" ou "Sacado").
const SPONTE_HEADER_SIGNATURES = [
  "sponte",
  "ra do aluno",
  "ra sponte",
  "curso/turma",
  "cliente sponte",
  "plano sponte",
  "forma de recebimento",
  "conta bancaria sponte",
  "responsavel financeiro",
  "nosso numero",
  "parcela",
];

export function detectSponteByHeaders(headers: string[]): boolean {
  const hs = headers.map(normKey);
  let hits = 0;
  for (const sig of SPONTE_HEADER_SIGNATURES) {
    if (hs.some((h) => h.includes(sig))) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// ── Dialect agregado (passado para rowsToStaging) ──────────────
export const SPONTE_DIALECT: ErpDialect = {
  id: "sponte",
  synonyms: SIN_SPONTE,
  statusMap: statusSponte,
  entidadeBySheetName: entidadeBySheetNameSponte,
  detectByHeaders: detectSponteByHeaders,
};
