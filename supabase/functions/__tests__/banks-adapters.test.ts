// deno test supabase/functions/__tests__/banks-adapters.test.ts
//
// Cobertura dos 5 adapters bancários (inter/sicredi/bb/itau/bradesco).
// Foco em funções puras: status mapping + parseWebhook (HMAC validation
// e payload parsing). Não testa emitirBoleto/consultarBoleto porque
// exigem rede + cert mTLS.

import { assertEquals, assertRejects } from "@std/testing/asserts";

import { interAdapter } from "../_shared/banks/adapters/inter.ts";
import { sicrediAdapter } from "../_shared/banks/adapters/sicredi.ts";
import { bbAdapter } from "../_shared/banks/adapters/bb.ts";
import { itauAdapter } from "../_shared/banks/adapters/itau.ts";
import { bradescoAdapter } from "../_shared/banks/adapters/bradesco.ts";
import { getBankAdapter, bancosImplementados } from "../_shared/banks/registry.ts";
import { BankError } from "../_shared/banks/errors.ts";
import type { BancoConfig } from "../_shared/banks/types.ts";

const FAKE_CONFIG: BancoConfig = {
  id: "00000000-0000-0000-0000-000000000000",
  escola_id: "11111111-1111-1111-1111-111111111111",
  banco: "inter",
  agencia: "0001",
  conta: "12345",
  conta_digito: "9",
  convenio: "1234567",
  carteira: "09",
  beneficiario_cnpj: "12345678000190",
  beneficiario_nome: "Escola Teste LTDA",
  homologado: false,
};

// ═══════════════════════════════════════════════════════════════
//  Registry
// ═══════════════════════════════════════════════════════════════

Deno.test("registry - 5 bancos implementados", () => {
  const bancos = bancosImplementados();
  assertEquals(bancos.length, 5);
  assertEquals(new Set(bancos), new Set(["inter", "sicredi", "bb", "itau", "bradesco"]));
});

Deno.test("registry - getBankAdapter retorna adapter correto", () => {
  assertEquals(getBankAdapter("inter").banco, "inter");
  assertEquals(getBankAdapter("sicredi").banco, "sicredi");
  assertEquals(getBankAdapter("bb").banco, "bb");
  assertEquals(getBankAdapter("itau").banco, "itau");
  assertEquals(getBankAdapter("bradesco").banco, "bradesco");
});

Deno.test("registry - banco inválido lança BankError NOT_IMPLEMENTED", () => {
  try {
    getBankAdapter("santander" as any);
    throw new Error("should have thrown");
  } catch (e) {
    if (!(e instanceof BankError)) throw e;
    assertEquals(e.code, "NOT_IMPLEMENTED");
  }
});

// ═══════════════════════════════════════════════════════════════
//  Adapter interface — todos implementam métodos obrigatórios
// ═══════════════════════════════════════════════════════════════

const ADAPTERS = [interAdapter, sicrediAdapter, bbAdapter, itauAdapter, bradescoAdapter];

Deno.test("adapters - todos têm banco identificador", () => {
  assertEquals(interAdapter.banco, "inter");
  assertEquals(sicrediAdapter.banco, "sicredi");
  assertEquals(bbAdapter.banco, "bb");
  assertEquals(itauAdapter.banco, "itau");
  assertEquals(bradescoAdapter.banco, "bradesco");
});

Deno.test("adapters - todos têm os 5 métodos obrigatórios", () => {
  for (const a of ADAPTERS) {
    assertEquals(typeof a.emitirBoleto, "function", `${a.banco} sem emitirBoleto`);
    assertEquals(typeof a.consultarBoleto, "function", `${a.banco} sem consultarBoleto`);
    assertEquals(typeof a.cancelarBoleto, "function", `${a.banco} sem cancelarBoleto`);
    assertEquals(typeof a.listarBoletos, "function", `${a.banco} sem listarBoletos`);
    assertEquals(typeof a.parseWebhook, "function", `${a.banco} sem parseWebhook`);
  }
});

// ═══════════════════════════════════════════════════════════════
//  parseWebhook — Inter (sem HMAC, só payload parsing)
// ═══════════════════════════════════════════════════════════════

Deno.test("inter.parseWebhook - boleto pago", async () => {
  const body = JSON.stringify({
    situacao: "PAGO",
    nossoNumero: "00012345",
    valorNominal: 100.5,
    valorTotalRecebido: 100.5,
    dataPagamento: "2026-05-14",
  });
  const event = await interAdapter.parseWebhook(new Headers(), body, FAKE_CONFIG);
  assertEquals(event.banco, "inter");
  assertEquals(event.tipo, "boleto.pago");
  assertEquals(event.nosso_numero, "00012345");
  assertEquals(event.valor_pago, 100.5);
});

Deno.test("inter.parseWebhook - boleto vencido", async () => {
  const body = JSON.stringify({ situacao: "VENCIDO", nossoNumero: "00012345" });
  const event = await interAdapter.parseWebhook(new Headers(), body, FAKE_CONFIG);
  assertEquals(event.tipo, "boleto.vencido");
});

Deno.test("inter.parseWebhook - boleto expirado → vencido", async () => {
  const body = JSON.stringify({ situacao: "EXPIRADO", nossoNumero: "X" });
  const event = await interAdapter.parseWebhook(new Headers(), body, FAKE_CONFIG);
  assertEquals(event.tipo, "boleto.vencido");
});

Deno.test("inter.parseWebhook - situacao desconhecida", async () => {
  const body = JSON.stringify({ situacao: "FOOBAR", nossoNumero: "X" });
  const event = await interAdapter.parseWebhook(new Headers(), body, FAKE_CONFIG);
  assertEquals(event.tipo, "desconhecido");
});

// ═══════════════════════════════════════════════════════════════
//  parseWebhook — Sicredi (com HMAC SHA256)
// ═══════════════════════════════════════════════════════════════

async function computeHmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("sicredi.parseWebhook - assinatura HMAC válida → parseia", async () => {
  const cfg: BancoConfig = { ...FAKE_CONFIG, banco: "sicredi", webhook_secret: "test_secret_sicredi" };
  const body = JSON.stringify({ situacao: "LIQUIDADO", nossoNumero: "Y00012345", valor: 250 });
  const sig = await computeHmacHex(body, "test_secret_sicredi");
  const headers = new Headers({ "x-sicredi-assinatura": sig });
  const event = await sicrediAdapter.parseWebhook(headers, body, cfg);
  assertEquals(event.tipo, "boleto.pago");
  assertEquals(event.nosso_numero, "Y00012345");
});

Deno.test("sicredi.parseWebhook - assinatura HMAC inválida → BankError", async () => {
  const cfg: BancoConfig = { ...FAKE_CONFIG, banco: "sicredi", webhook_secret: "test_secret_sicredi" };
  const body = JSON.stringify({ situacao: "PAGO" });
  const headers = new Headers({ "x-sicredi-assinatura": "wrong_signature" });
  await assertRejects(
    () => sicrediAdapter.parseWebhook(headers, body, cfg),
    BankError,
    "Assinatura HMAC Sicredi inválida",
  );
});

Deno.test("sicredi.parseWebhook - sem webhook_secret → não valida (passa direto)", async () => {
  const cfg: BancoConfig = { ...FAKE_CONFIG, banco: "sicredi" };  // sem webhook_secret
  const body = JSON.stringify({ situacao: "LIQUIDADO", nossoNumero: "Y123" });
  const event = await sicrediAdapter.parseWebhook(new Headers(), body, cfg);
  assertEquals(event.tipo, "boleto.pago");
});

// ═══════════════════════════════════════════════════════════════
//  parseWebhook — BB (códigos numéricos)
// ═══════════════════════════════════════════════════════════════

Deno.test("bb.parseWebhook - código 6 (liquidado) → pago", async () => {
  const body = JSON.stringify({ codigoEstadoTituloCobranca: 6, numeroBoletoBB: "12345" });
  const event = await bbAdapter.parseWebhook(new Headers(), body, { ...FAKE_CONFIG, banco: "bb" });
  assertEquals(event.tipo, "boleto.pago");
});

Deno.test("bb.parseWebhook - código 7 (baixado) → cancelado", async () => {
  const body = JSON.stringify({ codigoEstadoTituloCobranca: 7 });
  const event = await bbAdapter.parseWebhook(new Headers(), body, { ...FAKE_CONFIG, banco: "bb" });
  assertEquals(event.tipo, "boleto.cancelado");
});

Deno.test("bb.parseWebhook - código 9 (vencido) → vencido", async () => {
  const body = JSON.stringify({ codigoEstadoTituloCobranca: 9 });
  const event = await bbAdapter.parseWebhook(new Headers(), body, { ...FAKE_CONFIG, banco: "bb" });
  assertEquals(event.tipo, "boleto.vencido");
});

Deno.test("bb.parseWebhook - lista de eventos pega o primeiro", async () => {
  const body = JSON.stringify({ eventos: [{ codigoEstadoTituloCobranca: 6, numeroBoletoBB: "AAA" }] });
  const event = await bbAdapter.parseWebhook(new Headers(), body, { ...FAKE_CONFIG, banco: "bb" });
  assertEquals(event.tipo, "boleto.pago");
  assertEquals(event.nosso_numero, "AAA");
});

// ═══════════════════════════════════════════════════════════════
//  parseWebhook — Itaú (situacao_geral_boleto)
// ═══════════════════════════════════════════════════════════════

Deno.test("itau.parseWebhook - PAGO", async () => {
  const body = JSON.stringify({ situacao_geral_boleto: "PAGO", numero_nosso_numero: "175001" });
  const event = await itauAdapter.parseWebhook(new Headers(), body, { ...FAKE_CONFIG, banco: "itau" });
  assertEquals(event.tipo, "boleto.pago");
  assertEquals(event.nosso_numero, "175001");
});

Deno.test("itau.parseWebhook - BAIXADO → cancelado", async () => {
  const body = JSON.stringify({ situacao_geral_boleto: "BAIXADO" });
  const event = await itauAdapter.parseWebhook(new Headers(), body, { ...FAKE_CONFIG, banco: "itau" });
  assertEquals(event.tipo, "boleto.cancelado");
});

// ═══════════════════════════════════════════════════════════════
//  parseWebhook — Bradesco (HMAC + cdSituacaoTitulo)
// ═══════════════════════════════════════════════════════════════

Deno.test("bradesco.parseWebhook - sem secret valida só o payload", async () => {
  const body = JSON.stringify({ cdSituacaoTitulo: "LIQUIDADO", nuTituloBeneficiario: "0900012345" });
  const event = await bradescoAdapter.parseWebhook(
    new Headers(),
    body,
    { ...FAKE_CONFIG, banco: "bradesco" },
  );
  assertEquals(event.tipo, "boleto.pago");
  assertEquals(event.nosso_numero, "0900012345");
});

Deno.test("bradesco.parseWebhook - HMAC válida", async () => {
  const cfg: BancoConfig = { ...FAKE_CONFIG, banco: "bradesco", webhook_secret: "bradesco_secret" };
  const body = JSON.stringify({ cdSituacaoTitulo: "LIQUIDADO", nuTituloBeneficiario: "ABC" });
  const sig = await computeHmacHex(body, "bradesco_secret");
  const headers = new Headers({ "bradesco-signature": sig });
  const event = await bradescoAdapter.parseWebhook(headers, body, cfg);
  assertEquals(event.tipo, "boleto.pago");
});

Deno.test("bradesco.parseWebhook - HMAC inválida → BankError", async () => {
  const cfg: BancoConfig = { ...FAKE_CONFIG, banco: "bradesco", webhook_secret: "bradesco_secret" };
  const body = JSON.stringify({ cdSituacaoTitulo: "PAGO" });
  const headers = new Headers({ "bradesco-signature": "nope" });
  await assertRejects(
    () => bradescoAdapter.parseWebhook(headers, body, cfg),
    BankError,
    "Assinatura HMAC Bradesco inválida",
  );
});
