// ═══════════════════════════════════════════════════════════════
//  Adapter Sophia — Sprint 5 da Migração de ERPs
//
//  Sophia é um ERP educacional robusto (Prima/Senior Sistemas) usado
//  por instituições maiores. Características que afetam o adapter:
//   • Pessoa é a entidade base (Aluno e Responsável herdam de Pessoa).
//     Exports costumam ter "Cód. Pessoa" como identificador único.
//   • Plano de Pagamento + Lançamento + Centro de Resultado no
//     financeiro — granularidade maior que Escolaweb/Sponte.
//   • Etapa Letiva substitui ano/série na nomenclatura.
//   • Status financeiros incluem "Acordo" (renegociação formal) que
//     mapeamos para pendente até liquidação.
//
//  Decisões e ordem das fases em memory:project_migracao_erps.
// ═══════════════════════════════════════════════════════════════

import { normName } from "../validator.ts";
import { SIN_BASE, normKey, type EntidadeAlvo, type ErpDialect, type SynonymMap } from "./excel.ts";

// ── Sinônimos PT-BR específicos do Sophia ──────────────────────
// Ordem importa — o primeiro hit ganha. Termos Sophia ficam ANTES dos
// genéricos do SIN_BASE.
export const SIN_SOPHIA: SynonymMap = {
  ...SIN_BASE,

  // ── alunos ───────────────────────────────────────────────────
  nome: [
    "Nome do Aluno", "Nome da Pessoa", "Pessoa", "Aluno",
    "Nome Completo", "Nome", ...SIN_BASE.nome,
  ],
  email: [
    "E-mail do Aluno", "E-mail Principal", "Email Aluno",
    "Email Sophia", "E-mail da Pessoa", ...SIN_BASE.email,
  ],
  cpf: [
    "CPF do Aluno", "CPF da Pessoa", "Documento da Pessoa",
    "Cód. Pessoa", "Código da Pessoa", ...SIN_BASE.cpf,
  ],
  data_nascimento: [
    "Data de Nascimento", "Dt. Nascimento", "Nascimento",
    "Data Nasc. Pessoa", ...SIN_BASE.data_nascimento,
  ],
  serie_origem: [
    "Etapa Letiva", "Etapa Atual", "Curso", "Curso/Etapa",
    "Turma Atual", "Turma", "Série", "Classe",
    ...SIN_BASE.serie_origem,
  ],
  responsavel_email: [
    "E-mail do Responsável", "E-mail Resp. Financeiro",
    "Email do Responsável Financeiro", "Email Pessoa Resp.",
    ...SIN_BASE.responsavel_email,
  ],
  responsavel_cpf: [
    "CPF do Responsável", "Cód. Pessoa Resp.", "Documento do Responsável",
    "CPF Resp. Financeiro", ...SIN_BASE.responsavel_cpf,
  ],

  // ── responsáveis (Sophia: Pessoa-Responsável) ───────────────
  nome_resp: [
    "Nome do Responsável", "Responsável", "Responsável Financeiro",
    "Pessoa Responsável", "Pagador", "Sacado",
    "Mãe", "Pai", "Tutor", ...SIN_BASE.nome_resp,
  ],
  telefone: [
    "Telefone Residencial", "Telefone Fixo", "Tel. Residencial",
    "Telefone Principal", "Tel. Pessoa", ...SIN_BASE.telefone,
  ],
  whatsapp: [
    "Telefone Celular", "Celular", "Tel. Celular", "WhatsApp",
    ...SIN_BASE.whatsapp,
  ],
  endereco: [
    "Logradouro", "Endereço Residencial", "Endereço Completo",
    "Rua/Avenida", ...SIN_BASE.endereco,
  ],
  cidade: ["Cidade", "Município", ...SIN_BASE.cidade],
  uf: ["UF", "Estado", ...SIN_BASE.uf],
  cep: ["CEP", "CEP Residencial", ...SIN_BASE.cep],
  parentesco: [
    "Tipo de Vínculo", "Grau de Parentesco", "Vínculo com o Aluno",
    "Relação", "Parentesco", ...SIN_BASE.parentesco,
  ],
  aluno_email: [
    "E-mail do Aluno Vinculado", "Email do Aluno Vinculado",
    ...SIN_BASE.aluno_email,
  ],
  responsavel_financeiro: [
    "Responsável Financeiro?", "Pagador Principal", "Resp Financeiro",
    "Pagador?", ...SIN_BASE.responsavel_financeiro,
  ],

  // ── turmas ───────────────────────────────────────────────────
  turma_nome: [
    "Nome da Turma", "Turma", "Cód. Turma", "Código da Turma",
    "Descrição da Turma", "Etapa Letiva", "Curso", "Classe",
    ...SIN_BASE.turma_nome,
  ],
  ano: [
    "Ano Letivo", "Período Letivo", "Exercício", "Ano de Referência",
    ...SIN_BASE.ano,
  ],
  turno: [
    "Turno da Turma", "Turno", "Período", "Horário de Aula",
    ...SIN_BASE.turno,
  ],

  // ── matrículas ──────────────────────────────────────────────
  status_matricula: [
    "Situação da Matrícula", "Status da Matrícula", "Status do Aluno",
    "Situação Acadêmica", "Situação", ...SIN_BASE.status_matricula,
  ],
  data_matricula: [
    "Data da Matrícula", "Dt. Matrícula", "Matriculado em",
    "Dt. Cadastro", ...SIN_BASE.data_matricula,
  ],

  // ── funcionários ────────────────────────────────────────────
  cargo: [
    "Cargo/Função", "Função Sophia", "Cargo Atual", "Tipo de Vínculo",
    "Categoria do Funcionário", "Perfil de Acesso", ...SIN_BASE.cargo,
  ],

  // ── financeiro (Plano de Pagamento + Lançamento) ────────────
  tipo: [
    "Tipo de Lançamento", "Tipo do Título", "Natureza do Lançamento",
    "Receita/Despesa", "Operação", ...SIN_BASE.tipo,
  ],
  categoria_origem: [
    "Centro de Resultado", "Centro de Custo", "Plano de Contas",
    "Conta Contábil", "Categoria do Lançamento", "Grupo Financeiro",
    "Classificação Sophia", "Sub-Plano", ...SIN_BASE.categoria_origem,
  ],
  descricao: [
    "Histórico", "Descrição do Lançamento", "Memorando",
    "Plano de Pagamento", "Descrição da Parcela", "Mês de Referência",
    "Competência", ...SIN_BASE.descricao,
  ],
  valor: [
    "Valor Original", "Valor Bruto", "Valor do Lançamento",
    "Valor da Parcela", "Valor a Pagar", "Valor a Receber",
    "Valor Líquido", "Valor Recebido", ...SIN_BASE.valor,
  ],
  data_lancamento: [
    "Data do Lançamento", "Dt. Lançamento", "Data de Emissão",
    "Emitido em", "Dt. Cadastro Lançamento", ...SIN_BASE.data_lancamento,
  ],
  data_vencimento: [
    "Data de Vencimento", "Vencimento", "Dt. Vencimento", "Venc.",
    "Próximo Vencimento", ...SIN_BASE.data_vencimento,
  ],
  data_pagamento: [
    "Data de Pagamento", "Data de Quitação", "Quitado em", "Pago em",
    "Dt. Baixa", "Data da Baixa", "Data Liquidação",
    ...SIN_BASE.data_pagamento,
  ],
  status_origem: [
    "Status do Lançamento", "Situação do Lançamento", "Status do Título",
    "Situação", "Estado do Boleto", "Status Sophia",
    ...SIN_BASE.status_origem,
  ],
  fornecedor: [
    "Fornecedor", "Nome do Fornecedor", "Razão Social do Fornecedor",
    "Beneficiário", "Credor", "Cód. Fornecedor", ...SIN_BASE.fornecedor,
  ],
  familia_email: [
    "E-mail do Sacado", "Email do Pagador", "E-mail Resp. Financeiro",
    "E-mail Cliente", ...SIN_BASE.familia_email,
  ],
  familia_nome: [
    "Sacado", "Nome do Sacado", "Pagador", "Cliente",
    "Razão Social do Cliente", "Pessoa Pagadora", ...SIN_BASE.familia_nome,
  ],
  familia_cpf: [
    "CPF/CNPJ do Sacado", "CPF do Sacado", "Documento do Cliente",
    "Cód. Pessoa Pagador", "CPF do Pagador", ...SIN_BASE.familia_cpf,
  ],
  documento: [
    "Nº do Documento", "Nosso Número", "Nº Boleto", "Número da Parcela",
    "Cód. Lançamento", "Identificador Sophia", "Nº NF",
    ...SIN_BASE.documento,
  ],

  // ── notas ────────────────────────────────────────────────────
  periodo: [
    "Etapa Avaliativa", "Bimestre", "Trimestre", "Avaliação",
    "Tipo de Avaliação", "Período Avaliativo", ...SIN_BASE.periodo,
  ],
  disciplina: [
    "Disciplina", "Componente Curricular", "Matéria",
    "Componente", "Cód. Disciplina", ...SIN_BASE.disciplina,
  ],
  nota: [
    "Nota Final", "Média", "Nota da Avaliação", "Pontuação",
    "Nota Sophia", ...SIN_BASE.nota,
  ],
  conceito: ["Conceito", "Menção", "Letra", ...SIN_BASE.conceito],
};

// ── Status financeiro Sophia → canônico Lumied ────────────────
// Sophia tem "Acordo" (renegociação formal) e "Negociado" — ambos caem
// pendente até liquidação. "Em Análise" também é pendente (gestão de
// inadimplência interna do Sophia).
export function statusSophia(
  raw: string | null | undefined,
): "pendente" | "pago" | "atrasado" | "cancelado" | null {
  const v = normName(raw);
  if (!v) return null;
  // Quitado / Pago / Liquidado / Baixado / Recebido
  if (/quitad|pago|liquid|baixad|recebid total/.test(v)) return "pago";
  // Cancelado / Estornado / Anulado
  if (/cancel|estorn|anulad|excluid/.test(v)) return "cancelado";
  // Atrasado / Vencido / Inadimplente
  if (/atras|vencid|inadimpl|expirad/.test(v)) return "atrasado";
  // Em aberto / Acordo / Negociado / Em análise / Parcial / Aguardando
  if (
    /em aberto|^aberto$|a pagar|a receber|pendent|acord|negociad|parcial|aguardand|em analise/.test(v)
  ) return "pendente";
  return null;
}

// ── Sheet name → entidade alvo ─────────────────────────────────
// Sophia exporta com aba "Pessoas" (base genérica) + abas filtradas
// por papel: "Alunos", "Responsáveis", "Funcionários". Financeiro fica
// em "Lançamentos" / "Cobranças" / "Plano de Pagamento".
export function entidadeBySheetNameSophia(sheet: string): EntidadeAlvo | null {
  const v = normName(sheet);
  if (!v) return null;
  if (/^aluno|cadastro de aluno|cad alunos|discente/.test(v)) return "alunos";
  if (/^respons|familia|sacado|pagador|^pessoa resp/.test(v)) return "responsaveis";
  if (/^turma|^curso|^etapa|^classe|^serie|cadastro de turma/.test(v)) return "turmas";
  if (/matric/.test(v)) return "matriculas";
  if (/funcion|colaborad|professor|docente|equipe|pessoal/.test(v)) {
    return "funcionarios";
  }
  if (
    /lancament|cobranca|cobran|financ|boleto|titulo|conta a receb|conta a pag|receit|despes|plano de pagamento/.test(v)
  ) return "financeiro";
  if (/^nota|boletim|avalia|desempenho|conceito/.test(v)) return "notas";
  // Pessoas: aba genérica, ignoramos — operador deve dividir em
  // Alunos/Responsáveis específicos (geralmente já vem assim).
  return null;
}

// ── Detecção da fonte Sophia por headers ───────────────────────
// Procuramos chaves específicas do Sophia. Match ≥ 2 dispara detecção.
const SOPHIA_HEADER_SIGNATURES = [
  "sophia",
  "cod sophia",
  "cod pessoa",
  "codigo da pessoa",
  "etapa letiva",
  "centro de resultado",
  "plano de pagamento",
  "tipo de vinculo",
];

export function detectSophiaByHeaders(headers: string[]): boolean {
  const hs = headers.map(normKey);
  let hits = 0;
  for (const sig of SOPHIA_HEADER_SIGNATURES) {
    if (hs.some((h) => h.includes(sig))) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// ── Dialect agregado (passado para rowsToStaging) ──────────────
export const SOPHIA_DIALECT: ErpDialect = {
  id: "sophia",
  synonyms: SIN_SOPHIA,
  statusMap: statusSophia,
  entidadeBySheetName: entidadeBySheetNameSophia,
  detectByHeaders: detectSophiaByHeaders,
};
