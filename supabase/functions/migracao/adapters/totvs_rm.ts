// ═══════════════════════════════════════════════════════════════
//  Adapter TOTVS RM Educacional — Sprint 6 da Migração de ERPs
//
//  TOTVS RM (originalmente Microsiga/RM Sistemas, agora TOTVS) é um
//  ERP corporativo robusto, herdado de schema SQL Server. Características
//  que afetam o adapter:
//   • Códigos são reis: CODCOLIGADA, CODFILIAL, CODPESSOA, CODALUNO,
//     CODTURMA, CODCURSO, CODHABILITACAO, CODSITUACAO, etc.
//   • Multi-coligada (várias razões sociais sob mesmo ERP) — não
//     temos análogo direto no Lumied, então ignoramos COLIGADA/FILIAL
//     e migramos tudo pra escola_id corrente. Operador deve filtrar
//     o export por COLIGADA antes de subir.
//   • Headers às vezes em UPPER CASE sem espaços (estilo coluna SQL
//     Server). Por isso normKey já normaliza maiúsculas + espaços.
//   • PERLET = Período Letivo (formato "AAAANN" tipo "20251").
//   • Lançamento financeiro com Natureza Financeira (TBLNATFINANCEIRO)
//     + Centro de Custo + Tipo de Documento.
//   • Status: "0" (Em Aberto), "1" (Baixado/Pago), "2" (Cancelado).
//     Acomodamos ambos numéricos e textuais.
//
//  Decisões e ordem das fases em memory:project_migracao_erps.
// ═══════════════════════════════════════════════════════════════

import { normName } from "../validator.ts";
import { SIN_BASE, normKey, type EntidadeAlvo, type ErpDialect, type SynonymMap } from "./excel.ts";

// ── Sinônimos PT-BR específicos do TOTVS RM ────────────────────
// Ordem importa — o primeiro hit ganha. Termos TOTVS RM ficam ANTES
// dos genéricos do SIN_BASE.
export const SIN_TOTVS_RM: SynonymMap = {
  ...SIN_BASE,

  // ── alunos ───────────────────────────────────────────────────
  nome: [
    "NOMEALUNO", "NOMECOMPL", "NOMEPESSOA", "Nome do Aluno",
    "Nome da Pessoa", "Aluno", "Nome Completo", "Pessoa",
    ...SIN_BASE.nome,
  ],
  email: [
    "EMAIL", "E-MAIL", "EMAILPESSOAL", "E-mail Pessoal",
    "EMAILALUNO", "Email Aluno", ...SIN_BASE.email,
  ],
  cpf: [
    "CPF", "CGCCPF", "Documento", "CPF do Aluno", "RA",
    "Cód. Aluno", "CODALUNO", "CODPESSOA", "RA do Aluno",
    ...SIN_BASE.cpf,
  ],
  data_nascimento: [
    "DTNASCIMENTO", "DATANASCIMENTO", "DT_NASC", "Data de Nascimento",
    "Dt. Nascimento", ...SIN_BASE.data_nascimento,
  ],
  serie_origem: [
    "CODHABILITACAO", "Habilitação", "CODCURSO", "Curso",
    "CODTURMA", "Turma", "Nome do Curso", "PERLET",
    "Período Letivo", "Série", "Etapa", ...SIN_BASE.serie_origem,
  ],
  responsavel_email: [
    "EMAILRESP", "Email Responsável", "EMAILRESPFINANCEIRO",
    "E-mail do Responsável Financeiro", ...SIN_BASE.responsavel_email,
  ],
  responsavel_cpf: [
    "CPFRESP", "CGCCPFRESP", "CODPESSOARESP", "CPF do Responsável",
    "CPF Resp. Financeiro", "Documento do Responsável",
    ...SIN_BASE.responsavel_cpf,
  ],

  // ── responsáveis (TOTVS: PESSOA com tipo RESP) ──────────────
  nome_resp: [
    "NOMERESP", "Nome do Responsável", "Responsável", "NOMECLIENTE",
    "Sacado", "Pagador", "RESPFINANCEIRO", "Pessoa Responsável",
    "Mãe", "Pai", "Tutor", ...SIN_BASE.nome_resp,
  ],
  telefone: [
    "TELEFONE1", "TELEFONE", "FONE", "TELRESIDENCIAL",
    "Telefone Residencial", "Telefone Principal",
    ...SIN_BASE.telefone,
  ],
  whatsapp: [
    "TELEFONE2", "CELULAR", "TELCELULAR", "WhatsApp", "Celular",
    ...SIN_BASE.whatsapp,
  ],
  endereco: [
    "RUA", "ENDERECO", "Logradouro", "Endereço Completo",
    "Endereço Residencial", ...SIN_BASE.endereco,
  ],
  cidade: ["CIDADE", "Cidade", "Município", ...SIN_BASE.cidade],
  uf: ["UF", "ESTADO", "Estado", ...SIN_BASE.uf],
  cep: ["CEP", ...SIN_BASE.cep],
  parentesco: [
    "TIPORESP", "TIPOPESSOA", "Grau de Parentesco", "Tipo de Vínculo",
    "Vínculo", "Parentesco", ...SIN_BASE.parentesco,
  ],
  aluno_email: [
    "EMAILALUNOVINCULADO", "E-mail do Aluno Vinculado",
    "Email Aluno Vinculado", ...SIN_BASE.aluno_email,
  ],
  responsavel_financeiro: [
    "RESPFINANCEIRO", "Resp Financeiro", "Responsável Financeiro?",
    "PAGADOR", "Pagador?", ...SIN_BASE.responsavel_financeiro,
  ],

  // ── turmas ───────────────────────────────────────────────────
  turma_nome: [
    "CODTURMA", "NOMETURMA", "Nome da Turma", "Turma", "Código da Turma",
    "Curso/Turma", "Cód. Habilitação", "Habilitação", "Classe",
    ...SIN_BASE.turma_nome,
  ],
  ano: [
    "PERLET", "Período Letivo", "Ano Letivo", "ANOLETIVO",
    "Exercício", ...SIN_BASE.ano,
  ],
  turno: [
    "TURNO", "Turno", "Período", "Horário de Aula",
    ...SIN_BASE.turno,
  ],

  // ── matrículas ──────────────────────────────────────────────
  status_matricula: [
    "CODSITUACAO", "SITUACAO", "Situação da Matrícula", "Status",
    "Situação", "Status do Aluno", ...SIN_BASE.status_matricula,
  ],
  data_matricula: [
    "DTMATRICULA", "Data da Matrícula", "Dt. Matrícula",
    "DATAINGRESSO", ...SIN_BASE.data_matricula,
  ],

  // ── funcionários ────────────────────────────────────────────
  cargo: [
    "CODCARGO", "NOMECARGO", "FUNCAO", "Cargo", "Função",
    "Tipo de Funcionário", "Categoria do Funcionário",
    ...SIN_BASE.cargo,
  ],

  // ── financeiro (TOTVS RM: LANCAMENTOS) ──────────────────────
  tipo: [
    "TIPOLANCAMENTO", "Tipo de Lançamento", "Natureza Financeira",
    "TBLNATFINANCEIRO", "NATUREZA", "Tipo do Título",
    "Receita/Despesa", "Operação", ...SIN_BASE.tipo,
  ],
  categoria_origem: [
    "CODCFO", "CODCENTROCUSTO", "Centro de Custo", "Conta Contábil",
    "Plano de Contas", "Centro de Resultado", "Sub-Plano",
    "Natureza Financeira", "Classificação TOTVS",
    ...SIN_BASE.categoria_origem,
  ],
  descricao: [
    "HISTORICO", "HISTORICOLANCAMENTO", "Histórico", "Descrição",
    "MENSALIDADE", "Memorando", "Mês de Referência",
    "MESCOMPETENCIA", "Competência", "Observação Financeira",
    ...SIN_BASE.descricao,
  ],
  valor: [
    "VALORLIQUIDO", "VALORBRUTO", "VALORORIGINAL", "VALOR",
    "Valor Original", "Valor Líquido", "Valor Bruto",
    "Valor do Lançamento", "Valor a Pagar", "Valor a Receber",
    "VALORBAIXADO", "Valor Recebido", ...SIN_BASE.valor,
  ],
  data_lancamento: [
    "DATAEMISSAO", "DATALANCAMENTO", "Data do Lançamento",
    "Data de Emissão", "Dt. Emissão", ...SIN_BASE.data_lancamento,
  ],
  data_vencimento: [
    "DATAVENCIMENTO", "DTVENC", "Data de Vencimento",
    "Vencimento", "Dt. Vencimento", ...SIN_BASE.data_vencimento,
  ],
  data_pagamento: [
    "DATABAIXA", "DATAPAGAMENTO", "Data de Pagamento",
    "Data da Baixa", "Pago em", "Dt. Pagamento",
    "Data de Quitação", ...SIN_BASE.data_pagamento,
  ],
  status_origem: [
    "STATUSLAN", "STATUS", "SITUACAO", "Situação do Lançamento",
    "Status do Lançamento", "Status do Título", "Estado do Boleto",
    ...SIN_BASE.status_origem,
  ],
  fornecedor: [
    "NOMEFORNECEDOR", "FORNECEDOR", "NOMECREDOR", "Fornecedor",
    "Beneficiário", "Credor", "CODCFO Fornecedor", "Razão Social",
    ...SIN_BASE.fornecedor,
  ],
  familia_email: [
    "EMAILCLIENTE", "EMAILCFO", "E-mail do Cliente", "Email Sacado",
    "Email do Pagador", "E-mail Resp. Financeiro",
    ...SIN_BASE.familia_email,
  ],
  familia_nome: [
    "NOMECFO", "NOMECLIENTE", "Cliente", "Sacado", "Pagador",
    "Nome do Cliente", "Pessoa Pagadora", ...SIN_BASE.familia_nome,
  ],
  familia_cpf: [
    "CGCCFO", "CGCCPFCLIENTE", "CPF/CNPJ do Cliente",
    "Documento do Cliente", "CPF do Pagador", "CODPESSOAPAGADOR",
    ...SIN_BASE.familia_cpf,
  ],
  documento: [
    "NUMERODOCUMENTO", "NUMDOC", "NUMERONFE", "NOSSONUMERO",
    "IDLANC", "Nº do Documento", "Nosso Número", "Nº Boleto",
    "Cód. Lançamento", "ID Lançamento", "Nº NF",
    ...SIN_BASE.documento,
  ],

  // ── notas ────────────────────────────────────────────────────
  periodo: [
    "ETAPA", "CODETAPA", "Etapa", "Etapa Avaliativa", "Bimestre",
    "Trimestre", "Período Avaliativo", "Avaliação",
    ...SIN_BASE.periodo,
  ],
  disciplina: [
    "CODDISC", "NOMEDISC", "DISCIPLINA", "Disciplina",
    "Componente Curricular", "Matéria", ...SIN_BASE.disciplina,
  ],
  nota: [
    "NOTA", "NOTAFINAL", "MEDIA", "Nota Final", "Média",
    "Nota da Avaliação", "Pontuação", ...SIN_BASE.nota,
  ],
  conceito: [
    "CONCEITO", "MENCAO", "Conceito", "Menção", "Letra",
    ...SIN_BASE.conceito,
  ],
};

// ── Status financeiro TOTVS RM → canônico Lumied ──────────────
// TOTVS RM usa STATUSLAN numérico em alguns exports:
//   '0' = Em Aberto, '1' = Baixado, '2' = Cancelado, '3' = Renegociado.
// Aceitamos ambos numéricos e textuais.
export function statusTotvsRm(
  raw: string | null | undefined,
): "pendente" | "pago" | "atrasado" | "cancelado" | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  // Códigos numéricos
  if (/^0$/.test(s)) return "pendente";
  if (/^1$/.test(s)) return "pago";
  if (/^2$/.test(s)) return "cancelado";
  if (/^3$/.test(s)) return "pendente";  // renegociado

  const v = normName(raw);
  if (!v) return null;
  // Baixado / Pago / Quitado / Liquidado / Recebido
  if (/baixad|pago|quitad|liquid|recebid total|compens/.test(v)) return "pago";
  // Cancelado / Estornado / Excluído
  if (/cancel|estorn|excluid|anulad/.test(v)) return "cancelado";
  // Atrasado / Vencido / Inadimplente
  if (/atras|vencid|inadimpl|expirad/.test(v)) return "atrasado";
  // Em aberto / Renegociado / Negociado / Parcial / Pendente
  if (/em aberto|^aberto$|a pagar|a receber|pendent|renegoc|negociad|parcial|aguardand/.test(v)) {
    return "pendente";
  }
  return null;
}

// ── Sheet name → entidade alvo ─────────────────────────────────
// TOTVS RM exporta em XLSX multi-aba com nomes técnicos típicos do
// schema (PESSOA, SALUNO, FLAN, SHISTORICO, etc.) ou nomes humanizados
// quando o operador customiza o relatório. Cobrimos os dois.
export function entidadeBySheetNameTotvsRm(sheet: string): EntidadeAlvo | null {
  const v = normName(sheet);
  if (!v) return null;
  if (/^aluno|^saluno|cadastro de aluno|cad alunos|discente/.test(v)) return "alunos";
  if (/^respons|familia|sacado|pagador|^cfo|pessoa resp/.test(v)) return "responsaveis";
  if (/^turma|^sturma|^curso|^habilitac|^etapa|cadastro de turma|^classe|^serie/.test(v)) {
    return "turmas";
  }
  if (/matric|^smatric/.test(v)) return "matriculas";
  if (/funcion|colaborad|professor|docente|equipe|^pfunc|folha|pessoal/.test(v)) {
    return "funcionarios";
  }
  if (
    /^flan|lancament|cobranca|financ|boleto|titulo|^cr$|^cp$|conta a receb|conta a pag|receit|despes/.test(v)
  ) return "financeiro";
  if (/^nota|^shist|^etapa|boletim|avalia|desempenho|conceito|historico/.test(v)) return "notas";
  return null;
}

// ── Detecção da fonte TOTVS RM por headers ────────────────────
// Procuramos chaves específicas. Match ≥ 2 dispara detecção.
const TOTVS_RM_HEADER_SIGNATURES = [
  "totvs",
  "rm educacional",
  "codcoligada",
  "codfilial",
  "codpessoa",
  "codaluno",
  "codturma",
  "codcurso",
  "codhabilitacao",
  "perlet",
  "codsituacao",
  "tblnatfinanceiro",
  "codcfo",
  "statuslan",
];

export function detectTotvsRmByHeaders(headers: string[]): boolean {
  const hs = headers.map(normKey);
  let hits = 0;
  for (const sig of TOTVS_RM_HEADER_SIGNATURES) {
    if (hs.some((h) => h.includes(sig))) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// ── Dialect agregado (passado para rowsToStaging) ──────────────
export const TOTVS_RM_DIALECT: ErpDialect = {
  id: "totvs_rm",
  synonyms: SIN_TOTVS_RM,
  statusMap: statusTotvsRm,
  entidadeBySheetName: entidadeBySheetNameTotvsRm,
  detectByHeaders: detectTotvsRmByHeaders,
};
