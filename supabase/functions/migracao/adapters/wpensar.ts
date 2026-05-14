// ═══════════════════════════════════════════════════════════════
//  Adapter WPensar / Agenda Edu — Sprint 4 da Migração de ERPs
//
//  WPensar e Agenda Edu são produtos da mesma família (Agenda
//  Educacional). Atendem ao mesmo adapter porque os exports
//  compartilham terminologia (e o usuário pode ter migrado de um
//  pro outro mantendo o histórico). Quando precisar diferenciar
//  algo específico de Agenda Edu, adicionar branch no statusMap
//  ou no entidadeBySheetName.
//
//  Foco: comunicação/agenda + financeiro padrão.
//
//  Decisões e ordem das fases em memory:project_migracao_erps.
// ═══════════════════════════════════════════════════════════════

import { normName } from "../validator.ts";
import { SIN_BASE, normKey, type EntidadeAlvo, type ErpDialect, type SynonymMap } from "./excel.ts";

// ── Sinônimos PT-BR específicos do WPensar / Agenda Edu ───────
// Ordem importa — o primeiro hit ganha. Termos WPensar ficam ANTES dos
// genéricos do SIN_BASE.
export const SIN_WPENSAR: SynonymMap = {
  ...SIN_BASE,

  // ── alunos ───────────────────────────────────────────────────
  nome: [
    "Nome do Estudante", "Estudante", "Aluno", "Nome do Aluno",
    "Nome Completo", "Aluno(a)", ...SIN_BASE.nome,
  ],
  email: [
    "E-mail do Estudante", "Email Aluno", "Email do Aluno",
    ...SIN_BASE.email,
  ],
  cpf: [
    "CPF do Estudante", "CPF do Aluno", "Documento", ...SIN_BASE.cpf,
  ],
  data_nascimento: [
    "Data de Nascimento", "Dt. Nascimento", "Nascimento", "Aniversário",
    ...SIN_BASE.data_nascimento,
  ],
  serie_origem: [
    "Turma Atual", "Turma", "Série/Turma", "Curso", "Série",
    "Etapa de Ensino", "Etapa", ...SIN_BASE.serie_origem,
  ],
  responsavel_email: [
    "E-mail do Responsável", "Email Responsável",
    "E-mail do Familiar", "Email Familiar",
    ...SIN_BASE.responsavel_email,
  ],
  responsavel_cpf: [
    "CPF do Responsável", "Documento do Responsável",
    "CPF do Familiar", ...SIN_BASE.responsavel_cpf,
  ],

  // ── responsáveis / familiares ────────────────────────────────
  nome_resp: [
    "Familiar", "Nome do Familiar", "Responsável", "Nome do Responsável",
    "Resp. Estudante", "Mãe", "Pai", "Tutor", ...SIN_BASE.nome_resp,
  ],
  telefone: [
    "Telefone do Responsável", "Telefone Fixo", "Tel. Residencial",
    "Telefone do Familiar", ...SIN_BASE.telefone,
  ],
  whatsapp: [
    "Celular do Responsável", "Celular", "WhatsApp do Responsável",
    "WhatsApp", "Tel. Celular", ...SIN_BASE.whatsapp,
  ],
  endereco: [
    "Endereço Completo", "Endereço Residencial", "Logradouro",
    ...SIN_BASE.endereco,
  ],
  cidade: ["Cidade do Responsável", "Cidade", ...SIN_BASE.cidade],
  uf: ["UF", "Estado", ...SIN_BASE.uf],
  cep: ["CEP do Responsável", "CEP", ...SIN_BASE.cep],
  parentesco: [
    "Grau de Parentesco", "Tipo de Familiar", "Tipo de Vínculo",
    "Relação com o Estudante", "Vínculo", "Parentesco",
    ...SIN_BASE.parentesco,
  ],
  aluno_email: [
    "E-mail do Estudante Vinculado", "Email Estudante Vinculado",
    "Email do Aluno Vinculado", ...SIN_BASE.aluno_email,
  ],
  responsavel_financeiro: [
    "Responsável Financeiro?", "Pagador?", "Financeiro Principal",
    "Responsável Financeiro Principal", ...SIN_BASE.responsavel_financeiro,
  ],

  // ── turmas ───────────────────────────────────────────────────
  turma_nome: [
    "Nome da Turma", "Turma", "Código da Turma", "Cód. Turma",
    "Curso", "Etapa", "Série", ...SIN_BASE.turma_nome,
  ],
  ano: ["Ano Letivo", "Exercício", "Ano de Referência", ...SIN_BASE.ano],
  turno: [
    "Turno da Turma", "Turno", "Período", "Horário de Aula",
    ...SIN_BASE.turno,
  ],

  // ── matrículas ──────────────────────────────────────────────
  status_matricula: [
    "Situação da Matrícula", "Status do Estudante", "Situação do Aluno",
    "Status Acadêmico", "Situação", ...SIN_BASE.status_matricula,
  ],
  data_matricula: [
    "Data da Matrícula", "Dt. Matrícula", "Matriculado em",
    "Data de Ingresso", ...SIN_BASE.data_matricula,
  ],

  // ── funcionários ────────────────────────────────────────────
  cargo: [
    "Cargo na Escola", "Cargo/Função", "Função", "Cargo Atual",
    "Tipo de Usuário", "Perfil de Acesso", ...SIN_BASE.cargo,
  ],

  // ── financeiro ──────────────────────────────────────────────
  tipo: [
    "Tipo de Lançamento", "Natureza do Título", "Receita/Despesa",
    "Tipo de Movimentação", ...SIN_BASE.tipo,
  ],
  categoria_origem: [
    "Categoria do Lançamento", "Categoria Financeira", "Plano de Contas",
    "Conta Contábil", "Centro de Custo", "Grupo", "Classificação",
    ...SIN_BASE.categoria_origem,
  ],
  descricao: [
    "Histórico", "Descrição do Lançamento", "Descrição",
    "Mês de Referência", "Mês Ref.", "Competência",
    "Observação Financeira", ...SIN_BASE.descricao,
  ],
  valor: [
    "Valor Original", "Valor da Mensalidade", "Valor do Boleto",
    "Valor a Pagar", "Valor a Receber", "Valor Bruto", "Valor Líquido",
    ...SIN_BASE.valor,
  ],
  data_lancamento: [
    "Data de Emissão", "Data da Emissão", "Emitido em",
    "Data de Geração", ...SIN_BASE.data_lancamento,
  ],
  data_vencimento: [
    "Data de Vencimento", "Vencimento", "Dt. Vencimento",
    "Próximo Vencimento", ...SIN_BASE.data_vencimento,
  ],
  data_pagamento: [
    "Data de Pagamento", "Pago em", "Data do Pagamento",
    "Quitado em", "Data da Baixa", "Data de Quitação",
    ...SIN_BASE.data_pagamento,
  ],
  status_origem: [
    "Situação do Boleto", "Status do Boleto", "Status do Lançamento",
    "Situação Financeira", "Status", "Estado da Cobrança",
    ...SIN_BASE.status_origem,
  ],
  fornecedor: [
    "Fornecedor", "Beneficiário", "Razão Social do Fornecedor",
    "Credor", ...SIN_BASE.fornecedor,
  ],
  familia_email: [
    "E-mail do Pagador", "Email do Responsável Financeiro",
    "E-mail do Familiar Pagador", ...SIN_BASE.familia_email,
  ],
  familia_nome: [
    "Pagador", "Familiar Pagador", "Responsável Financeiro",
    "Nome do Pagador", ...SIN_BASE.familia_nome,
  ],
  familia_cpf: [
    "CPF do Pagador", "CPF do Familiar Pagador",
    "CPF Resp. Financeiro", ...SIN_BASE.familia_cpf,
  ],
  documento: [
    "Nº do Boleto", "Nosso Número", "Número do Documento",
    "Identificador do Boleto", "Código do Boleto", "Nº NF",
    ...SIN_BASE.documento,
  ],

  // ── notas ────────────────────────────────────────────────────
  periodo: [
    "Período Avaliativo", "Bimestre", "Trimestre", "Etapa Avaliativa",
    "Avaliação", "Tipo de Avaliação", ...SIN_BASE.periodo,
  ],
  disciplina: [
    "Disciplina", "Componente Curricular", "Matéria", "Componente",
    ...SIN_BASE.disciplina,
  ],
  nota: [
    "Nota Final", "Média", "Nota da Avaliação", "Pontuação",
    ...SIN_BASE.nota,
  ],
  conceito: ["Conceito", "Menção", "Letra", ...SIN_BASE.conceito],
};

// ── Status financeiro WPensar/Agenda Edu → canônico Lumied ────
// WPensar usa termos próximos do mercado mas tem o "Negociado" e o
// "Aguardando confirmação" para boletos PIX/cartão. Ambos caem em
// pendente até a baixa efetiva.
export function statusWpensar(
  raw: string | null | undefined,
): "pendente" | "pago" | "atrasado" | "cancelado" | null {
  const v = normName(raw);
  if (!v) return null;
  // Pago / Quitado / Liquidado / Confirmado / Compensado
  if (/pago|quitad|liquid|baixad|compens|confirmad|recebid/.test(v)) return "pago";
  // Cancelado / Estornado / Anulado
  if (/cancel|estorn|anulad/.test(v)) return "cancelado";
  // Atrasado / Vencido / Inadimplente
  if (/atras|vencid|inadimpl|expirad/.test(v)) return "atrasado";
  // Em aberto / Aguardando / Negociado / Parcelado / Pendente
  if (/em aberto|^aberto$|aguardand|negociad|parcelad|pendent|a pagar|a receber/.test(v)) {
    return "pendente";
  }
  return null;
}

// ── Sheet name → entidade alvo ─────────────────────────────────
// WPensar/Agenda Edu costumam exportar em XLSX multi-aba com nomes
// próximos ao usuário final: "Cadastro de Estudantes", "Familiares",
// "Mensalidades", "Frequência", "Notas". A heurística reconhece tanto
// "Estudante" (WPensar) quanto "Aluno" (Agenda Edu).
export function entidadeBySheetNameWpensar(sheet: string): EntidadeAlvo | null {
  const v = normName(sheet);
  if (!v) return null;
  if (/^aluno|^estudante|cadastro de aluno|cadastro de estudante|discente/.test(v)) {
    return "alunos";
  }
  if (/^respons|familia|familiar|sacado|pagador/.test(v)) return "responsaveis";
  if (/^turma|cadastro de turma|^classe|^curso|^etapa/.test(v)) return "turmas";
  if (/matric/.test(v)) return "matriculas";
  if (/funcion|colaborad|professor|docente|equipe|usuario|coordena/.test(v)) {
    return "funcionarios";
  }
  if (
    /mensalid|boleto|financ|conta a receb|conta a pag|cobranca|receit|despes|titulo|lancament/.test(v)
  ) return "financeiro";
  if (/^nota|boletim|avalia|desempenho|conceito/.test(v)) return "notas";
  return null;
}

// ── Detecção da fonte WPensar/Agenda Edu por headers ──────────
// Procuramos chaves bem específicas do WPensar/Agenda Edu. Match de ≥ 2
// chaves dispara a detecção.
const WPENSAR_HEADER_SIGNATURES = [
  "wpensar",
  "agenda edu",
  "agenda educacional",
  "estudante",
  "familiar",
  "etapa de ensino",
  "mes de referencia",
  "id wpensar",
  "id agenda",
];

export function detectWpensarByHeaders(headers: string[]): boolean {
  const hs = headers.map(normKey);
  let hits = 0;
  for (const sig of WPENSAR_HEADER_SIGNATURES) {
    if (hs.some((h) => h.includes(sig))) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// ── Dialect agregado (passado para rowsToStaging) ──────────────
// Compartilhado por wpensar e agenda_edu (ambos no mesmo grupo).
export const WPENSAR_DIALECT: ErpDialect = {
  id: "wpensar",
  synonyms: SIN_WPENSAR,
  statusMap: statusWpensar,
  entidadeBySheetName: entidadeBySheetNameWpensar,
  detectByHeaders: detectWpensarByHeaders,
};
