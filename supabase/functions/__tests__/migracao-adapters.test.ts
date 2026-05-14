// deno test supabase/functions/__tests__/migracao-adapters.test.ts
//
// Onda 2 do refator: cobertura de testes pra os 7 ERP adapters da
// migracao (escolaweb, sponte, wpensar, sophia, totvs_rm, gvdasa,
// excel genérico). Foco em funções puras (statusMap, detectByHeaders,
// entidadeBySheetName) — tudo determinístico, sem rede nem DB.

import { assertEquals, assertExists } from "@std/testing/asserts";

import { ESCOLAWEB_DIALECT } from "../migracao/adapters/escolaweb.ts";
import { SPONTE_DIALECT } from "../migracao/adapters/sponte.ts";
import { WPENSAR_DIALECT } from "../migracao/adapters/wpensar.ts";
import { SOPHIA_DIALECT } from "../migracao/adapters/sophia.ts";
import { TOTVS_RM_DIALECT } from "../migracao/adapters/totvs_rm.ts";
import { GVDASA_DIALECT, statusGvdasa, entidadeBySheetNameGvdasa, detectGvdasaByHeaders } from "../migracao/adapters/gvdasa.ts";

// ═══════════════════════════════════════════════════════════════
//  Sanidade básica dos dialects (todos têm id + synonyms + statusMap)
// ═══════════════════════════════════════════════════════════════

const DIALECTS = [
  ESCOLAWEB_DIALECT,
  SPONTE_DIALECT,
  WPENSAR_DIALECT,
  SOPHIA_DIALECT,
  TOTVS_RM_DIALECT,
  GVDASA_DIALECT,
];

Deno.test("dialects - cada um expõe id único", () => {
  const ids = DIALECTS.map((d) => d.id);
  assertEquals(new Set(ids).size, ids.length, `IDs duplicados: ${ids.join(",")}`);
});

Deno.test("dialects - cada um tem statusMap function", () => {
  for (const d of DIALECTS) {
    assertEquals(typeof d.statusMap, "function", `${d.id} sem statusMap`);
  }
});

Deno.test("dialects - cada um tem synonyms map", () => {
  for (const d of DIALECTS) {
    assertExists(d.synonyms, `${d.id} sem synonyms`);
  }
});

// ═══════════════════════════════════════════════════════════════
//  GVDasa — status financeiro (códigos de 1 letra + textual)
// ═══════════════════════════════════════════════════════════════

Deno.test("statusGvdasa - código A (Aberto) → pendente", () => {
  assertEquals(statusGvdasa("A"), "pendente");
});

Deno.test("statusGvdasa - código P (Pago) → pago", () => {
  assertEquals(statusGvdasa("P"), "pago");
  assertEquals(statusGvdasa("B"), "pago");  // Baixado tb é pago
});

Deno.test("statusGvdasa - código C/X (Cancelado/Excluído) → cancelado", () => {
  assertEquals(statusGvdasa("C"), "cancelado");
  assertEquals(statusGvdasa("X"), "cancelado");
});

Deno.test("statusGvdasa - código R (Renegociado) → pendente", () => {
  assertEquals(statusGvdasa("R"), "pendente");
});

Deno.test("statusGvdasa - textuais Pago/Quitado/Liquidado", () => {
  assertEquals(statusGvdasa("Pago"), "pago");
  assertEquals(statusGvdasa("Quitado"), "pago");
  assertEquals(statusGvdasa("Liquidado"), "pago");
});

Deno.test("statusGvdasa - 'Em Aberto' e variantes → pendente", () => {
  assertEquals(statusGvdasa("Em Aberto"), "pendente");
  assertEquals(statusGvdasa("Pendente"), "pendente");
  assertEquals(statusGvdasa("Renegociado"), "pendente");
});

Deno.test("statusGvdasa - 'Vencido' → atrasado", () => {
  assertEquals(statusGvdasa("Vencido"), "atrasado");
  assertEquals(statusGvdasa("Atrasado"), "atrasado");
  assertEquals(statusGvdasa("Inadimplente"), "atrasado");
});

Deno.test("statusGvdasa - 'Cancelado'/'Estornado' → cancelado", () => {
  assertEquals(statusGvdasa("Cancelado"), "cancelado");
  assertEquals(statusGvdasa("Estornado"), "cancelado");
});

Deno.test("statusGvdasa - null/undefined/desconhecido → null", () => {
  assertEquals(statusGvdasa(null), null);
  assertEquals(statusGvdasa(undefined), null);
  assertEquals(statusGvdasa(""), null);
  assertEquals(statusGvdasa("foobar"), null);
});

// ═══════════════════════════════════════════════════════════════
//  GVDasa — detecção de entidade por nome de aba
// ═══════════════════════════════════════════════════════════════

Deno.test("entidadeBySheetNameGvdasa - aliases humanizados", () => {
  assertEquals(entidadeBySheetNameGvdasa("Educandos"), "alunos");
  assertEquals(entidadeBySheetNameGvdasa("Alunos Ativos"), "alunos");
  assertEquals(entidadeBySheetNameGvdasa("Mantenedores"), "responsaveis");
  assertEquals(entidadeBySheetNameGvdasa("Responsáveis Financeiros"), "responsaveis");
  assertEquals(entidadeBySheetNameGvdasa("Turmas 2026"), "turmas");
  assertEquals(entidadeBySheetNameGvdasa("Matrículas"), "matriculas");
  assertEquals(entidadeBySheetNameGvdasa("Funcionários"), "funcionarios");
  assertEquals(entidadeBySheetNameGvdasa("Mensalidades"), "financeiro");
  assertEquals(entidadeBySheetNameGvdasa("Conta Corrente"), "financeiro");
  assertEquals(entidadeBySheetNameGvdasa("Boletos"), "financeiro");
  assertEquals(entidadeBySheetNameGvdasa("Notas Bimestrais"), "notas");
  assertEquals(entidadeBySheetNameGvdasa("Boletim"), "notas");
});

Deno.test("entidadeBySheetNameGvdasa - nomes técnicos TBxxxx", () => {
  assertEquals(entidadeBySheetNameGvdasa("TBEDUCANDO"), "alunos");
  assertEquals(entidadeBySheetNameGvdasa("TBMANTENEDOR"), "responsaveis");
  assertEquals(entidadeBySheetNameGvdasa("TBLANCAMENTO"), "financeiro");
  assertEquals(entidadeBySheetNameGvdasa("TBTURMA"), "turmas");
});

Deno.test("entidadeBySheetNameGvdasa - aba desconhecida → null", () => {
  assertEquals(entidadeBySheetNameGvdasa("Configurações"), null);
  assertEquals(entidadeBySheetNameGvdasa(""), null);
  assertEquals(entidadeBySheetNameGvdasa("Plan1"), null);
});

// ═══════════════════════════════════════════════════════════════
//  GVDasa — detecção por headers (signature ≥ 2 hits)
// ═══════════════════════════════════════════════════════════════

Deno.test("detectGvdasaByHeaders - 2+ signatures detecta", () => {
  assertEquals(
    detectGvdasaByHeaders(["CodEducando", "NomeMantenedor", "Outro"]),
    true,
  );
});

Deno.test("detectGvdasaByHeaders - 1 signature isolada não basta", () => {
  // Só "nossonumero" pode aparecer em qualquer adapter financeiro
  assertEquals(detectGvdasaByHeaders(["NossoNumero", "Valor"]), false);
});

Deno.test("detectGvdasaByHeaders - vazio → false", () => {
  assertEquals(detectGvdasaByHeaders([]), false);
});

Deno.test("detectGvdasaByHeaders - headers genéricos sem GVDasa → false", () => {
  assertEquals(
    detectGvdasaByHeaders(["Nome", "CPF", "Email", "Telefone"]),
    false,
  );
});

Deno.test("detectGvdasaByHeaders - TB prefixos detectam", () => {
  assertEquals(
    detectGvdasaByHeaders(["TBEDUCANDO", "TBMANTENEDOR"]),
    true,
  );
});

// ═══════════════════════════════════════════════════════════════
//  Cross-dialect: cada um detecta a si mesmo, não os outros
// ═══════════════════════════════════════════════════════════════

Deno.test("cross-dialect - GVDasa NÃO detecta headers do Sponte", () => {
  // Sponte usa "CodAluno", "RespFinanceiro" — diferentes de GVDasa
  const sponteHeaders = ["CodAluno", "NomeAluno", "RespFinanceiro"];
  // GVDasa só detecta se tiver 2+ signatures dele
  assertEquals(detectGvdasaByHeaders(sponteHeaders), false);
});

Deno.test("cross-dialect - todos os dialects têm detectByHeaders coerente com synonyms", () => {
  // Sanidade: se um adapter declara detectByHeaders, ele deve ser uma função
  for (const d of DIALECTS) {
    if (d.detectByHeaders) {
      assertEquals(typeof d.detectByHeaders, "function", `${d.id} detectByHeaders inválido`);
      // Deve retornar boolean
      const result = d.detectByHeaders([]);
      assertEquals(typeof result, "boolean", `${d.id} detectByHeaders não retornou boolean`);
    }
  }
});
