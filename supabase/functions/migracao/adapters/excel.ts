// ═══════════════════════════════════════════════════════════════
//  Adapter genérico Excel/CSV
//  Lê XLSX/CSV e produz registros normalizados pra migracao_staging_*
//  Detecção de colunas é por sinônimos (PT-BR + comuns dos ERPs alvo).
// ═══════════════════════════════════════════════════════════════

import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { normName, parseDateBR, parseMoneyBR, statusFinanceiroMap, sha256Hex, onlyDigits } from "../validator.ts";

export type EntidadeAlvo =
  | "alunos" | "responsaveis" | "turmas" | "matriculas"
  | "funcionarios" | "financeiro" | "notas";

type RawRow = Record<string, unknown>;

// Sinônimos por campo (chaves normalizadas: lowercase, sem acento, sem espaços extras).
// O primeiro hit ganha — ordem importa.
const SIN: Record<string, string[]> = {
  // alunos
  nome:               ["nome aluno","nome do aluno","aluno","nome completo","nome","name"],
  email:              ["email","e-mail","email aluno","email do aluno"],
  cpf:                ["cpf","cpf aluno","cpf do aluno","cpf/rg"],
  data_nascimento:    ["data nascimento","data de nascimento","nascimento","dt nascimento","dt nasc","data nasc"],
  serie_origem:       ["serie","série","turma","classe","ano","grade","class"],
  responsavel_email:  ["email responsavel","email responsável","email pai","email mae","email mãe","email do responsavel"],
  responsavel_cpf:    ["cpf responsavel","cpf responsável","cpf pai","cpf mae","cpf mãe","cpf do responsavel"],
  // responsáveis
  nome_resp:          ["nome responsavel","nome responsável","responsavel","responsável","pai","mae","mãe","tutor"],
  telefone:           ["telefone","fone","tel","celular"],
  whatsapp:           ["whatsapp","wpp","zap","whats"],
  endereco:           ["endereco","endereço","logradouro","rua"],
  cidade:             ["cidade","municipio","município"],
  uf:                 ["uf","estado"],
  cep:                ["cep"],
  parentesco:         ["parentesco","relacao","relação","tipo responsavel","grau"],
  aluno_email:        ["email aluno","email do aluno","email aluno relacionado"],
  aluno_cpf:          ["cpf aluno","cpf do aluno"],
  responsavel_financeiro: ["responsavel financeiro","responsável financeiro","fin","financeiro"],
  // turmas
  turma_nome:         ["nome turma","turma","serie","série","classe","class"],
  ano:                ["ano","ano letivo","exercicio","exercício","year"],
  turno:              ["turno","periodo","período","shift"],
  // matriculas
  status_matricula:   ["status","situacao","situação","matricula status","status matricula"],
  data_matricula:     ["data matricula","data matrícula","matriculado em","data inscricao"],
  // funcionarios
  cargo:              ["cargo","função","funcao","papel","role"],
  // financeiro
  tipo:               ["tipo","natureza","operacao","operação"],   // receita/despesa
  categoria_origem:   ["categoria","plano de contas","conta","grupo","classificacao","classificação"],
  descricao:          ["descricao","descrição","historico","histórico","memo","observacao","observação","memo financeiro"],
  valor:              ["valor","total","montante","amount"],
  data_lancamento:    ["data lancamento","data lançamento","data emissao","data emissão","emitido em"],
  data_vencimento:    ["data vencimento","vencimento","dt venc","due date"],
  data_pagamento:     ["data pagamento","pagamento","dt pgto","paid at","pago em","baixa em","data baixa"],
  status_origem:      ["status","situacao","situação","status titulo"],
  fornecedor:         ["fornecedor","sacado","cliente","destinatario","destinatário"],
  familia_email:      ["email pagador","email cliente","email familia","email família","email responsavel","email responsável"],
  familia_nome:       ["nome pagador","nome cliente","nome familia","nome família","nome responsavel","nome responsável"],
  familia_cpf:        ["cpf pagador","cpf cliente","cpf familia","cpf família","cpf responsavel","cpf responsável"],
  documento:          ["documento","numero documento","número documento","boleto","nota","nf","numero","número"],
  // notas
  periodo:            ["periodo","período","bimestre","trimestre","etapa"],
  disciplina:         ["disciplina","materia","matéria","componente"],
  nota:               ["nota","media","média","score","grade nota"],
  conceito:           ["conceito","letra","menção","mencao"],
};

function normKey(k: string): string {
  return String(k || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[\.\:\;\(\)\[\]\/\\]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function pick(row: Record<string, unknown>, field: keyof typeof SIN): unknown {
  const candidates = SIN[field as string] || [];
  for (const c of candidates) {
    const want = normKey(c);
    for (const k of Object.keys(row)) {
      if (normKey(k) === want) return row[k];
    }
  }
  // fallback: substring match
  for (const c of candidates) {
    const want = normKey(c);
    for (const k of Object.keys(row)) {
      if (normKey(k).includes(want)) return row[k];
    }
  }
  return undefined;
}

function val(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function valBool(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return /^(true|1|sim|s|yes|y|x)$/.test(s);
}

// ── File → array of rows ────────────────────────────────────
export function parseFileToRows(filename: string, bytes: Uint8Array): RawRow[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return parseCsv(new TextDecoder("utf-8").decode(bytes));
  }
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: false, raw: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  // deno-lint-ignore no-explicit-any
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: false }) as any[];
  return rows as RawRow[];
}

function parseCsv(text: string): RawRow[] {
  // Heurística: detecta separador entre ; (BR padrão) e ,
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0], sep);
  const out: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    if (cells.every(c => !c)) continue;
    const row: RawRow = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? null; });
    out.push(row);
  }
  return out;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// ── Row → registros normalizados por entidade ────────────────

export type ParsedRow = { entidade: EntidadeAlvo; data: Record<string, unknown>; hash: string; linha: number };

export async function rowsToStaging(
  rows: RawRow[],
  entidade: EntidadeAlvo,
): Promise<ParsedRow[]> {
  const out: ParsedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const data = mapRow(r, entidade);
    if (!data) continue;
    const hash = await sha256Hex(JSON.stringify(data) + "|" + entidade);
    out.push({ entidade, data, hash, linha: i + 2 }); // +2 = header + 1-indexed
  }
  return out;
}

function mapRow(r: RawRow, entidade: EntidadeAlvo): Record<string, unknown> | null {
  switch (entidade) {
    case "alunos": return {
      nome: val(pick(r, "nome")),
      email: val(pick(r, "email"))?.toLowerCase() ?? null,
      cpf: onlyDigits(val(pick(r, "cpf")) || "") || null,
      data_nascimento: parseDateBR(val(pick(r, "data_nascimento")) || ""),
      serie_origem: val(pick(r, "serie_origem")),
      responsavel_email: val(pick(r, "responsavel_email"))?.toLowerCase() ?? null,
      responsavel_cpf: onlyDigits(val(pick(r, "responsavel_cpf")) || "") || null,
    };
    case "responsaveis": return {
      nome: val(pick(r, "nome_resp")) ?? val(pick(r, "nome")),
      email: val(pick(r, "email"))?.toLowerCase() ?? null,
      cpf: onlyDigits(val(pick(r, "cpf")) || "") || null,
      telefone: val(pick(r, "telefone")),
      whatsapp: val(pick(r, "whatsapp")),
      endereco: val(pick(r, "endereco")),
      cidade: val(pick(r, "cidade")),
      uf: val(pick(r, "uf"))?.toUpperCase() ?? null,
      cep: onlyDigits(val(pick(r, "cep")) || "") || null,
      parentesco: normName(val(pick(r, "parentesco")) || "") || null,
      aluno_email: val(pick(r, "aluno_email"))?.toLowerCase() ?? null,
      aluno_cpf: onlyDigits(val(pick(r, "aluno_cpf")) || "") || null,
      responsavel_financeiro: valBool(pick(r, "responsavel_financeiro")),
    };
    case "turmas": return {
      nome: val(pick(r, "turma_nome")),
      ano: parseInt(String(pick(r, "ano") || "")) || null,
      turno: normName(val(pick(r, "turno")) || "") || null,
    };
    case "matriculas": return {
      aluno_email: val(pick(r, "aluno_email")) || val(pick(r, "email")),
      aluno_cpf: onlyDigits(val(pick(r, "aluno_cpf")) || val(pick(r, "cpf")) || "") || null,
      turma_origem: val(pick(r, "turma_nome")) || val(pick(r, "serie_origem")),
      ano: parseInt(String(pick(r, "ano") || "")) || new Date().getFullYear(),
      status: normName(val(pick(r, "status_matricula")) || "matriculado"),
      data_matricula: parseDateBR(val(pick(r, "data_matricula")) || ""),
    };
    case "funcionarios": return {
      nome: val(pick(r, "nome")),
      email: val(pick(r, "email"))?.toLowerCase() ?? null,
      cpf: onlyDigits(val(pick(r, "cpf")) || "") || null,
      telefone: val(pick(r, "telefone")),
      cargo: val(pick(r, "cargo")),
    };
    case "financeiro": {
      const tipoRaw = normName(val(pick(r, "tipo")) || "");
      let tipo: "receita" | "despesa" = "receita";
      if (/desp|paga|saida|saída|pagamento|fornecedor/.test(tipoRaw)) tipo = "despesa";
      else if (/receit|recebi|cobranca|cobrança|cliente|mensalidade/.test(tipoRaw)) tipo = "receita";
      return {
        tipo,
        categoria_origem: val(pick(r, "categoria_origem")),
        descricao: val(pick(r, "descricao")),
        valor: parseMoneyBR(pick(r, "valor") as string),
        data_lancamento: parseDateBR(val(pick(r, "data_lancamento")) || ""),
        data_vencimento: parseDateBR(val(pick(r, "data_vencimento")) || ""),
        data_pagamento: parseDateBR(val(pick(r, "data_pagamento")) || ""),
        status_origem: val(pick(r, "status_origem")),
        status_lumied: statusFinanceiroMap(val(pick(r, "status_origem")) || ""),
        fornecedor: val(pick(r, "fornecedor")),
        familia_email: val(pick(r, "familia_email"))?.toLowerCase() ?? null,
        familia_nome: val(pick(r, "familia_nome")),
        familia_cpf: onlyDigits(val(pick(r, "familia_cpf")) || "") || null,
        documento: val(pick(r, "documento")),
      };
    }
    case "notas": return {
      aluno_email: val(pick(r, "aluno_email")) || val(pick(r, "email")),
      ano: parseInt(String(pick(r, "ano") || "")) || null,
      periodo: val(pick(r, "periodo")),
      disciplina: val(pick(r, "disciplina")),
      nota: parseMoneyBR(pick(r, "nota") as string),
      conceito: val(pick(r, "conceito")),
    };
  }
}

// ── ERP detection (signatures) ───────────────────────────────
export function detectErp(filename: string, headers: string[]): string {
  const fn = filename.toLowerCase();
  const hs = headers.map(normKey).join("|");
  if (fn.includes("escolaweb") || hs.includes("matricula escolaweb")) return "escolaweb";
  if (fn.includes("sponte") || hs.includes("sponte")) return "sponte";
  if (fn.includes("wpensar") || fn.includes("agenda edu")) return "wpensar";
  if (fn.includes("sophia")) return "sophia";
  if (fn.includes("totvs") || fn.includes("rm educacional")) return "totvs_rm";
  if (fn.includes("gvdasa")) return "gvdasa";
  return "excel";
}
