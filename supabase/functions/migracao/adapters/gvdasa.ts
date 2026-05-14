// ═══════════════════════════════════════════════════════════════
//  Adapter GVDasa Educacional — Sprint 7 da Migração de ERPs
//
//  GVDasa (adquirido pela Gennera, hoje "Gennera Educação") é um ERP
//  veterano do mercado brasileiro de gestão educacional. Características
//  que afetam o adapter:
//   • Vocabulário próprio: "Educando" (aluno), "Mantenedor" (responsável
//     financeiro, frequentemente pessoa jurídica — mantenedora/empresa),
//     "Sacado" (família), "Etapa Letiva" (série/ano), "Período Letivo"
//     no formato "AAAA/N" (ex.: "2026/1").
//   • Identificadores: CodEducando / CodPessoa / CodMantenedor /
//     CodTurma / CodEtapa / CodLancamento / NumeroDocumento /
//     NossoNumero (boleto bancário).
//   • Multi-unidade (mantenedora pode ter várias unidades) — no Lumied
//     uma escola = uma unidade. Operador filtra export por UNIDADE
//     antes de subir.
//   • Status financeiro: letras de uma posição ("A"=Aberto, "P"=Pago,
//     "C"=Cancelado, "R"=Renegociado, "X"=Excluído) E/OU textuais
//     ("Em Aberto", "Quitado", "Cancelado", "Renegociado").
//   • Plano de Contas: "Conta Contábil" + "Centro de Custo" + "Origem
//     do Lançamento" (mensalidade/material/uniforme/diversos).
//   • Cobrança: "Mensalidades" e "Boletos" são abas distintas em
//     exports típicos. "Conta Corrente" lista movimentações por
//     mantenedor — tratamos como financeiro também.
//
//  Decisões e ordem das fases em memory:project_migracao_erps.
// ═══════════════════════════════════════════════════════════════

import { normName } from "../validator.ts";
import { SIN_BASE, normKey, type EntidadeAlvo, type ErpDialect, type SynonymMap } from "./excel.ts";

// ── Sinônimos PT-BR específicos do GVDasa ──────────────────────
// Ordem importa — o primeiro hit ganha. Termos GVDasa ficam ANTES
// dos genéricos do SIN_BASE.
export const SIN_GVDASA: SynonymMap = {
  ...SIN_BASE,

  // ── alunos (GVDasa: Educando) ────────────────────────────────
  nome: [
    "NomeEducando", "Nome do Educando", "Educando", "Nome Completo do Aluno",
    "NomeAluno", "NomePessoa", "Nome do Aluno", "Aluno",
    ...SIN_BASE.nome,
  ],
  email: [
    "EmailEducando", "E-mail do Educando", "EmailPessoal", "E-mail Pessoal",
    "EmailAluno", "Email do Aluno", ...SIN_BASE.email,
  ],
  cpf: [
    "CpfEducando", "CPF do Educando", "CGCCPF", "Documento do Educando",
    "Matricula", "Matrícula", "CodEducando", "Cód. Educando",
    "Código do Educando", "RA", "CodPessoa",
    ...SIN_BASE.cpf,
  ],
  data_nascimento: [
    "DataNascimento", "Data de Nascimento", "Dt. Nascimento",
    "DtNasc", "DT_NASCIMENTO", ...SIN_BASE.data_nascimento,
  ],
  serie_origem: [
    "CodEtapa", "Etapa Letiva", "Etapa", "CodCurso", "Curso",
    "Nome do Curso", "CodTurma", "Turma", "Período Letivo",
    "PeriodoLetivo", "Ciclo", "Série", "Ano Escolar",
    ...SIN_BASE.serie_origem,
  ],
  responsavel_email: [
    "EmailMantenedor", "E-mail do Mantenedor", "EmailRespFinanceiro",
    "E-mail do Responsável Financeiro", "EmailResp",
    ...SIN_BASE.responsavel_email,
  ],
  responsavel_cpf: [
    "CpfMantenedor", "CGC/CPF do Mantenedor", "CodMantenedor",
    "CPF do Responsável Financeiro", "CPF Resp. Financeiro",
    "Documento do Mantenedor", "CpfResp",
    ...SIN_BASE.responsavel_cpf,
  ],

  // ── responsáveis (GVDasa: Mantenedor / Sacado) ───────────────
  nome_resp: [
    "NomeMantenedor", "Mantenedor", "Nome do Mantenedor",
    "Nome do Responsável Financeiro", "Responsável Financeiro",
    "NomeSacado", "Sacado", "NomePagador", "Pagador",
    "Razão Social do Mantenedor", "Mãe", "Pai", "Tutor",
    ...SIN_BASE.nome_resp,
  ],
  telefone: [
    "TelefoneResidencial", "TelResidencial", "Telefone Residencial",
    "Telefone Principal", "TelefonePrincipal", "Fone",
    ...SIN_BASE.telefone,
  ],
  whatsapp: [
    "TelefoneCelular", "TelCelular", "Celular", "WhatsApp",
    "Telefone Comercial", "TelefoneComercial",
    ...SIN_BASE.whatsapp,
  ],
  endereco: [
    "EnderecoMantenedor", "Logradouro", "Endereço Completo",
    "Endereço Residencial", "Rua", ...SIN_BASE.endereco,
  ],
  cidade: ["CidadeMantenedor", "Cidade", "Município", ...SIN_BASE.cidade],
  uf: ["UfMantenedor", "UF", "Estado", ...SIN_BASE.uf],
  cep: ["CepMantenedor", "CEP", ...SIN_BASE.cep],
  parentesco: [
    "TipoMantenedor", "GrauParentesco", "Grau de Parentesco",
    "Tipo de Vínculo", "Vínculo", "Parentesco",
    ...SIN_BASE.parentesco,
  ],
  aluno_email: [
    "EmailEducandoVinculado", "E-mail do Educando Vinculado",
    "Email Aluno Vinculado", ...SIN_BASE.aluno_email,
  ],
  responsavel_financeiro: [
    "IndRespFinanceiro", "Resp. Financeiro?", "Mantenedor Principal?",
    "Pagador?", "RespFinanceiro", ...SIN_BASE.responsavel_financeiro,
  ],

  // ── turmas (GVDasa: Etapa Letiva + Turma) ────────────────────
  turma_nome: [
    "CodTurma", "NomeTurma", "Nome da Turma", "Turma",
    "Código da Turma", "CodEtapa", "Etapa Letiva", "Etapa",
    "Classe", "Habilitação", "Curso/Turma",
    ...SIN_BASE.turma_nome,
  ],
  ano: [
    "PeriodoLetivo", "Período Letivo", "AnoLetivo", "Ano Letivo",
    "Exercício", ...SIN_BASE.ano,
  ],
  turno: [
    "Turno", "Período", "Horário de Aula", "TurnoAula",
    ...SIN_BASE.turno,
  ],

  // ── matrículas ──────────────────────────────────────────────
  status_matricula: [
    "SituacaoMatricula", "Situação da Matrícula", "StatusMatricula",
    "Status do Aluno", "Status", "Situação", "CodSituacao",
    ...SIN_BASE.status_matricula,
  ],
  data_matricula: [
    "DataMatricula", "Data da Matrícula", "Dt. Matrícula",
    "DataIngresso", "Data de Ingresso",
    ...SIN_BASE.data_matricula,
  ],

  // ── funcionários ────────────────────────────────────────────
  cargo: [
    "CodCargo", "NomeCargo", "Cargo", "Função", "Funcao",
    "Tipo de Funcionário", "Categoria do Funcionário",
    ...SIN_BASE.cargo,
  ],

  // ── financeiro (GVDasa: Lançamentos / Mensalidades / Cobranças) ──
  tipo: [
    "TipoLancamento", "Tipo de Lançamento", "TipoTitulo",
    "Origem do Lançamento", "Operação", "Receita/Despesa",
    "Natureza", ...SIN_BASE.tipo,
  ],
  categoria_origem: [
    "CodContaContabil", "Conta Contábil", "ContaContabil",
    "CodCentroCusto", "Centro de Custo", "Centro de Resultado",
    "Plano de Contas", "Origem do Lançamento",
    "Classificação GVDasa", "Sub-Plano",
    ...SIN_BASE.categoria_origem,
  ],
  descricao: [
    "Historico", "Histórico", "HistoricoLancamento",
    "Descrição", "Descricao", "Memorando",
    "Mês de Referência", "MesCompetencia", "Competência",
    "Observação Financeira", "Mensalidade",
    ...SIN_BASE.descricao,
  ],
  valor: [
    "ValorOriginal", "ValorLiquido", "ValorBruto", "Valor",
    "ValorTitulo", "Valor do Título", "Valor Original",
    "Valor Líquido", "Valor Bruto", "Valor a Pagar",
    "Valor a Receber", "ValorPago", "Valor Pago",
    "Valor Recebido", ...SIN_BASE.valor,
  ],
  data_lancamento: [
    "DataEmissao", "DataLancamento", "Data do Lançamento",
    "Data de Emissão", "Dt. Emissão", "DtEmissao",
    ...SIN_BASE.data_lancamento,
  ],
  data_vencimento: [
    "DataVencimento", "DtVenc", "Data de Vencimento",
    "Vencimento", "Dt. Vencimento", "DataVenc",
    ...SIN_BASE.data_vencimento,
  ],
  data_pagamento: [
    "DataPagamento", "DataBaixa", "DtBaixa", "Data de Pagamento",
    "Data da Baixa", "Pago em", "Dt. Pagamento",
    "Data de Quitação", ...SIN_BASE.data_pagamento,
  ],
  status_origem: [
    "SituacaoLancamento", "Situação do Lançamento", "Status",
    "StatusLancamento", "Status do Lançamento", "Estado do Título",
    "Situação do Boleto", "CodSituacao",
    ...SIN_BASE.status_origem,
  ],
  fornecedor: [
    "NomeFornecedor", "Fornecedor", "NomeCredor", "Credor",
    "Beneficiário", "CodFornecedor", "Razão Social do Fornecedor",
    ...SIN_BASE.fornecedor,
  ],
  familia_email: [
    "EmailMantenedor", "EmailSacado", "E-mail do Sacado",
    "Email do Pagador", "E-mail Resp. Financeiro",
    "EmailRespFinanceiro", ...SIN_BASE.familia_email,
  ],
  familia_nome: [
    "NomeMantenedor", "NomeSacado", "Sacado", "Pagador",
    "Nome do Mantenedor", "Pessoa Pagadora", "Cliente",
    ...SIN_BASE.familia_nome,
  ],
  familia_cpf: [
    "CpfMantenedor", "CgcMantenedor", "CGC/CPF do Mantenedor",
    "CPF/CNPJ do Sacado", "Documento do Sacado",
    "CPF do Pagador", "CodMantenedor",
    ...SIN_BASE.familia_cpf,
  ],
  documento: [
    "NumeroDocumento", "NumDoc", "NumeroBoleto", "NossoNumero",
    "Nosso Número", "CodLancamento", "ID Lançamento",
    "Nº do Documento", "Nº Boleto", "Nº NF", "NumeroNF",
    ...SIN_BASE.documento,
  ],

  // ── notas ────────────────────────────────────────────────────
  periodo: [
    "CodEtapaAvaliativa", "Etapa Avaliativa", "Bimestre",
    "Trimestre", "Período Avaliativo", "Avaliação",
    "EtapaAvaliacao", ...SIN_BASE.periodo,
  ],
  disciplina: [
    "CodDisciplina", "NomeDisciplina", "Disciplina",
    "Componente Curricular", "Matéria", "Materia",
    ...SIN_BASE.disciplina,
  ],
  nota: [
    "Nota", "NotaFinal", "Media", "Média", "Nota Final",
    "Nota da Avaliação", "Pontuação", "Resultado",
    ...SIN_BASE.nota,
  ],
  conceito: [
    "Conceito", "Mencao", "Menção", "Letra", "ConceitoFinal",
    ...SIN_BASE.conceito,
  ],
};

// ── Status financeiro GVDasa → canônico Lumied ────────────────
// GVDasa usa códigos de uma letra em alguns exports:
//   'A' = Aberto, 'P' = Pago, 'C' = Cancelado, 'R' = Renegociado,
//   'X' = Excluído, 'B' = Baixado.
// Também aparece "Em Aberto", "Quitado", "Renegociado" em outros.
export function statusGvdasa(
  raw: string | null | undefined,
): "pendente" | "pago" | "atrasado" | "cancelado" | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase();
  // Códigos de uma letra (somente quando o valor é exatamente a letra)
  if (s === "A") return "pendente";
  if (s === "P" || s === "B") return "pago";
  if (s === "C" || s === "X") return "cancelado";
  if (s === "R") return "pendente";  // renegociado vira pendente

  const v = normName(raw);
  if (!v) return null;
  // Pago / Quitado / Baixado / Liquidado / Recebido / Compensado
  if (/pago|quitad|baixad|liquid|recebid total|compens/.test(v)) return "pago";
  // Cancelado / Estornado / Excluído / Anulado
  if (/cancel|estorn|excluid|anulad/.test(v)) return "cancelado";
  // Atrasado / Vencido / Inadimplente / Expirado
  if (/atras|vencid|inadimpl|expirad/.test(v)) return "atrasado";
  // Em aberto / Renegociado / Negociado / Parcial / Pendente / Aguardando
  if (/em aberto|^aberto$|a pagar|a receber|pendent|renegoc|negociad|parcial|aguardand/.test(v)) {
    return "pendente";
  }
  return null;
}

// ── Sheet name → entidade alvo ─────────────────────────────────
// GVDasa exporta em XLSX multi-aba com nomes humanizados típicos
// do produto ("Educandos", "Mantenedores", "Mensalidades", "Conta
// Corrente") ou nomes técnicos quando o operador customiza
// (TBEDUCANDO, TBMANTENEDOR, TBLANCAMENTO). Cobrimos os dois.
export function entidadeBySheetNameGvdasa(sheet: string): EntidadeAlvo | null {
  const v = normName(sheet);
  if (!v) return null;
  if (/^educand|^aluno|^tbeducando|^tbaluno|cadastro de educand|cadastro de aluno|discente/.test(v)) {
    return "alunos";
  }
  if (/^mantened|^respons|familia|sacado|pagador|^tbmantenedor|pessoa resp/.test(v)) {
    return "responsaveis";
  }
  if (/^turma|^tbturma|^curso|^etapa|^ciclo|cadastro de turma|^classe|^serie/.test(v)) {
    return "turmas";
  }
  if (/matric|^tbmatricula/.test(v)) return "matriculas";
  if (/funcion|colaborad|professor|docente|equipe|^tbfunc|folha|pessoal/.test(v)) {
    return "funcionarios";
  }
  if (
    /^tblancamento|lancament|mensalidad|cobranca|conta corrente|financ|boleto|titulo|^cr$|^cp$|conta a receb|conta a pag|receit|despes/.test(v)
  ) return "financeiro";
  if (/^nota|^tbnota|boletim|avalia|desempenho|conceito|historico escolar/.test(v)) return "notas";
  return null;
}

// ── Detecção da fonte GVDasa por headers ──────────────────────
// Procuramos chaves específicas. Match ≥ 2 dispara detecção.
const GVDASA_HEADER_SIGNATURES = [
  "gvdasa",
  "gennera",
  "codeducando",
  "codmantenedor",
  "nomemantenedor",
  "nomeeducando",
  "codetapa",
  "etapa letiva",
  "periodoletivo",
  "tbeducando",
  "tbmantenedor",
  "tblancamento",
  "situacaolancamento",
  "nossonumero",
];

export function detectGvdasaByHeaders(headers: string[]): boolean {
  const hs = headers.map(normKey);
  let hits = 0;
  for (const sig of GVDASA_HEADER_SIGNATURES) {
    if (hs.some((h) => h.includes(sig))) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// ── Dialect agregado (passado para rowsToStaging) ──────────────
export const GVDASA_DIALECT: ErpDialect = {
  id: "gvdasa",
  synonyms: SIN_GVDASA,
  statusMap: statusGvdasa,
  entidadeBySheetName: entidadeBySheetNameGvdasa,
  detectByHeaders: detectGvdasaByHeaders,
};
