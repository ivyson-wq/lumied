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

export type RawRow = Record<string, unknown>;
export type SynonymMap = Record<string, string[]>;

/**
 * Dialect of an ERP source — what makes Escolaweb different from Sponte
 * different from Excel genérico. All fields are optional; the parser
 * falls back to SIN_BASE / statusFinanceiroMap from validator.ts when a
 * dialect doesn't override.
 */
export type ErpDialect = {
  id: string;
  /** Override or extend SIN_BASE. Synonyms listed first win. */
  synonyms?: SynonymMap;
  /** Custom raw-status-text → canonical status mapping. */
  statusMap?: (raw: string | null | undefined) => "pendente" | "pago" | "atrasado" | "cancelado" | null;
  /** Sheet-name → entidade heuristic for multi-sheet workbooks. */
  entidadeBySheetName?: (name: string) => EntidadeAlvo | null;
  /** Detect this dialect from header row of an arbitrary file. */
  detectByHeaders?: (headers: string[]) => boolean;
};

// Sinônimos por campo (chaves normalizadas: lowercase, sem acento, sem espaços extras).
// O primeiro hit ganha — ordem importa.
export const SIN_BASE: SynonymMap = {
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

export function normKey(k: string): string {
  return String(k || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[\.\:\;\(\)\[\]\/\\]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function pick(
  row: Record<string, unknown>,
  field: string,
  synonyms: SynonymMap,
): unknown {
  const candidates = synonyms[field] || SIN_BASE[field] || [];
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

/**
 * Read every sheet of an XLSX/CSV file. CSV/TXT returns a single anonymous
 * sheet. Useful for ERPs (ex.: Escolaweb) que exportam Cadastros,
 * Mensalidades e Funcionários em sheets distintas dentro do mesmo arquivo.
 */
export function parseFileToSheets(
  filename: string, bytes: Uint8Array,
): { name: string; rows: RawRow[] }[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return [{ name: "default", rows: parseCsv(new TextDecoder("utf-8").decode(bytes)) }];
  }
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: false, raw: false });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    // deno-lint-ignore no-explicit-any
    const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: false }) as any[];
    return { name, rows: rows as RawRow[] };
  });
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
  dialect?: ErpDialect,
): Promise<ParsedRow[]> {
  const syn = dialect?.synonyms ?? SIN_BASE;
  const stMap = dialect?.statusMap ?? statusFinanceiroMap;
  const out: ParsedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const data = mapRow(r, entidade, syn, stMap);
    if (!data) continue;
    const hash = await sha256Hex(JSON.stringify(data) + "|" + entidade);
    out.push({ entidade, data, hash, linha: i + 2 }); // +2 = header + 1-indexed
  }
  return out;
}

function mapRow(
  r: RawRow,
  entidade: EntidadeAlvo,
  syn: SynonymMap,
  stMap: (raw: string | null | undefined) => "pendente"|"pago"|"atrasado"|"cancelado"|null,
): Record<string, unknown> | null {
  switch (entidade) {
    case "alunos": return {
      nome: val(pick(r, "nome", syn)),
      email: val(pick(r, "email", syn))?.toLowerCase() ?? null,
      cpf: onlyDigits(val(pick(r, "cpf", syn)) || "") || null,
      data_nascimento: parseDateBR(val(pick(r, "data_nascimento", syn)) || ""),
      serie_origem: val(pick(r, "serie_origem", syn)),
      responsavel_email: val(pick(r, "responsavel_email", syn))?.toLowerCase() ?? null,
      responsavel_cpf: onlyDigits(val(pick(r, "responsavel_cpf", syn)) || "") || null,
    };
    case "responsaveis": return {
      nome: val(pick(r, "nome_resp", syn)) ?? val(pick(r, "nome", syn)),
      email: val(pick(r, "email", syn))?.toLowerCase() ?? null,
      cpf: onlyDigits(val(pick(r, "cpf", syn)) || "") || null,
      telefone: val(pick(r, "telefone", syn)),
      whatsapp: val(pick(r, "whatsapp", syn)),
      endereco: val(pick(r, "endereco", syn)),
      cidade: val(pick(r, "cidade", syn)),
      uf: val(pick(r, "uf", syn))?.toUpperCase() ?? null,
      cep: onlyDigits(val(pick(r, "cep", syn)) || "") || null,
      parentesco: normName(val(pick(r, "parentesco", syn)) || "") || null,
      aluno_email: val(pick(r, "aluno_email", syn))?.toLowerCase() ?? null,
      aluno_cpf: onlyDigits(val(pick(r, "aluno_cpf", syn)) || "") || null,
      responsavel_financeiro: valBool(pick(r, "responsavel_financeiro", syn)),
    };
    case "turmas": return {
      nome: val(pick(r, "turma_nome", syn)),
      ano: parseInt(String(pick(r, "ano", syn) || "")) || null,
      turno: normName(val(pick(r, "turno", syn)) || "") || null,
    };
    case "matriculas": return {
      aluno_email: val(pick(r, "aluno_email", syn)) || val(pick(r, "email", syn)),
      aluno_cpf: onlyDigits(val(pick(r, "aluno_cpf", syn)) || val(pick(r, "cpf", syn)) || "") || null,
      turma_origem: val(pick(r, "turma_nome", syn)) || val(pick(r, "serie_origem", syn)),
      ano: parseInt(String(pick(r, "ano", syn) || "")) || new Date().getFullYear(),
      status: normName(val(pick(r, "status_matricula", syn)) || "matriculado"),
      data_matricula: parseDateBR(val(pick(r, "data_matricula", syn)) || ""),
    };
    case "funcionarios": return {
      nome: val(pick(r, "nome", syn)),
      email: val(pick(r, "email", syn))?.toLowerCase() ?? null,
      cpf: onlyDigits(val(pick(r, "cpf", syn)) || "") || null,
      telefone: val(pick(r, "telefone", syn)),
      cargo: val(pick(r, "cargo", syn)),
    };
    case "financeiro": {
      const tipoRaw = normName(val(pick(r, "tipo", syn)) || "");
      let tipo: "receita" | "despesa" = "receita";
      if (/desp|paga|saida|saída|pagamento|fornecedor/.test(tipoRaw)) tipo = "despesa";
      else if (/receit|recebi|cobranca|cobrança|cliente|mensalidade/.test(tipoRaw)) tipo = "receita";
      return {
        tipo,
        categoria_origem: val(pick(r, "categoria_origem", syn)),
        descricao: val(pick(r, "descricao", syn)),
        valor: parseMoneyBR(pick(r, "valor", syn) as string),
        data_lancamento: parseDateBR(val(pick(r, "data_lancamento", syn)) || ""),
        data_vencimento: parseDateBR(val(pick(r, "data_vencimento", syn)) || ""),
        data_pagamento: parseDateBR(val(pick(r, "data_pagamento", syn)) || ""),
        status_origem: val(pick(r, "status_origem", syn)),
        status_lumied: stMap(val(pick(r, "status_origem", syn)) || ""),
        fornecedor: val(pick(r, "fornecedor", syn)),
        familia_email: val(pick(r, "familia_email", syn))?.toLowerCase() ?? null,
        familia_nome: val(pick(r, "familia_nome", syn)),
        familia_cpf: onlyDigits(val(pick(r, "familia_cpf", syn)) || "") || null,
        documento: val(pick(r, "documento", syn)),
      };
    }
    case "notas": return {
      aluno_email: val(pick(r, "aluno_email", syn)) || val(pick(r, "email", syn)),
      ano: parseInt(String(pick(r, "ano", syn) || "")) || null,
      periodo: val(pick(r, "periodo", syn)),
      disciplina: val(pick(r, "disciplina", syn)),
      nota: parseMoneyBR(pick(r, "nota", syn) as string),
      conceito: val(pick(r, "conceito", syn)),
    };
  }
}

// ── ERP detection (signatures) ───────────────────────────────
/**
 * Detect the source ERP from filename + headers. Headers podem refinar a
 * detecção quando o nome do arquivo é genérico (ex.: "export.xlsx"). Cada
 * dialect pode plugar uma função `detectByHeaders` para a sua assinatura.
 */
export function detectErp(filename: string, headers: string[], dialects: ErpDialect[] = []): string {
  const fn = filename.toLowerCase();
  const hs = headers.map(normKey).join("|");
  // Filename hints (mantém compat com Sprint 1)
  if (fn.includes("escolaweb") || hs.includes("matricula escolaweb")) return "escolaweb";
  if (fn.includes("sponte") || hs.includes("sponte")) return "sponte";
  if (fn.includes("wpensar") || fn.includes("agenda edu")) return "wpensar";
  if (fn.includes("sophia")) return "sophia";
  if (fn.includes("totvs") || fn.includes("rm educacional")) return "totvs_rm";
  if (fn.includes("gvdasa")) return "gvdasa";
  // Header-based detection via dialects (Sprint 2+)
  for (const d of dialects) {
    if (d.detectByHeaders && d.detectByHeaders(headers)) return d.id;
  }
  return "excel";
}
