// ═══════════════════════════════════════════════════════════════
//  Edge Function: financeiro-ext (v2 — Router Pattern)
//  PIX Integrado + Integração Contábil
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("financeiro-ext");
const router = new Router("financeiro-ext");
router.useGlobal(rateLimit());

// ═══ PIX ═══
router.on("pix_config_get", authGerente, requireFeature("pix"), async (ctx) => {
  const { data } = await ctx.sb.from("pix_config").select("*").eq("ativo", true).limit(1).single();
  return successResponse(data || {});
});

router.on("pix_config_set", authGerente, requireFeature("pix"), async (ctx) => {
  const { chave_pix, tipo_chave, nome_beneficiario, cidade } = ctx.body as any;
  if (!chave_pix) throw new AppError("VALIDATION_FAILED", "Chave PIX obrigatória.");
  const { data: existing } = await ctx.sb.from("pix_config").select("id").limit(1).single();
  if (existing) await ctx.sb.from("pix_config").update({ chave_pix, tipo_chave, nome_beneficiario, cidade }).eq("id", existing.id);
  else await ctx.sb.from("pix_config").insert({ chave_pix, tipo_chave, nome_beneficiario, cidade });
  log.info("PIX config atualizado");
  return successResponse({ success: true });
});

router.on("pix_gerar_cobranca", authGerente, requireFeature("pix"), async (ctx) => {
  const { valor, descricao, familia_email, boleto_id, mensalidade_id } = ctx.body as any;
  if (!valor) throw new AppError("VALIDATION_FAILED", "Valor obrigatório.");
  const { data: config } = await ctx.sb.from("pix_config").select("*").eq("ativo", true).limit(1).single();
  if (!config) throw new AppError("BAD_REQUEST", "PIX não configurado.");
  const txid = "MB" + Date.now().toString(36).toUpperCase() + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join('').toUpperCase();
  const payload = gerarPayloadPix(config.chave_pix, config.nome_beneficiario || "MAPLE BEAR", config.cidade || "CAXIAS DO SUL", valor, txid);
  const { data, error } = await ctx.sb.from("pix_cobrancas").insert({ boleto_id, mensalidade_id, txid, qr_code_payload: payload, valor, descricao, familia_email, expira_em: new Date(Date.now() + 24 * 3600000).toISOString() }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("PIX cobrança gerada", { metadata: { txid, valor } });
  return successResponse(data);
});

router.on("pix_cobrancas_list", authGerente, requireFeature("pix"), async (ctx) => {
  const { status, familia_email } = ctx.body as any;
  let q = ctx.sb.from("pix_cobrancas").select("*").order("criado_em", { ascending: false });
  if (status) q = q.eq("status", status);
  if (familia_email) q = q.eq("familia_email", familia_email);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

// ═══ CONTÁBIL ═══
router.on("contabil_config_get", authGerente, requireFeature("contabil"), async (ctx) => {
  const { data } = await ctx.sb.from("contabil_config").select("*").eq("ativo", true);
  return successResponse(data ?? []);
});

router.on("contabil_config_set", authGerente, requireFeature("contabil"), async (ctx) => {
  const { sistema, formato_exportacao, config: cfg } = ctx.body as any;
  if (!sistema) throw new AppError("VALIDATION_FAILED", "Sistema obrigatório.");
  const { error } = await ctx.sb.from("contabil_config").upsert({ sistema, formato_exportacao, config: cfg || {} } as any);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("contabil_exportar", authGerente, requireFeature("contabil"), async (ctx) => {
  const { sistema, periodo_inicio, periodo_fim, tipo } = ctx.body as any;
  if (!sistema || !periodo_inicio || !periodo_fim) throw new AppError("VALIDATION_FAILED", "sistema, periodo_inicio e periodo_fim obrigatórios.");
  const { data: lancamentos } = await ctx.sb.from("fin_lancamentos").select("*").gte("data_lancamento", periodo_inicio).lte("data_lancamento", periodo_fim).order("data_lancamento");
  const { data: exp, error } = await ctx.sb.from("contabil_exportacoes").insert({ sistema, periodo_inicio, periodo_fim, tipo: tipo || "lancamentos", registros: lancamentos?.length || 0, gerado_por: ctx.user?.nome }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Exportação contábil", { metadata: { sistema, registros: lancamentos?.length } });
  return successResponse({ ...exp, lancamentos: lancamentos ?? [] });
});

router.on("contabil_exportacoes_list", authGerente, requireFeature("contabil"), async (ctx) => {
  const { data } = await ctx.sb.from("contabil_exportacoes").select("*").order("gerado_em", { ascending: false }).limit(50);
  return successResponse(data ?? []);
});

// CRC16-CCITT (poly 0x1021, init 0xFFFF) — obrigatório para EMV PIX (BR Code)
function crc16Ccitt(payload: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function gerarPayloadPix(chave: string, nome: string, cidade: string, valor: number, txid: string): string {
  const pad = (id: string, val: string) => id + val.length.toString().padStart(2, "0") + val;
  const gui = pad("00", "br.gov.bcb.pix");
  const chavePix = pad("01", chave);
  const merchantAccount = pad("26", gui + chavePix);
  const payloadSemCrc = pad("00", "01") + merchantAccount + pad("52", "0000") + pad("53", "986") + pad("54", valor.toFixed(2)) + pad("58", "BR") + pad("59", nome.substring(0, 25)) + pad("60", cidade.substring(0, 15)) + pad("62", pad("05", txid)) + "6304";
  return payloadSemCrc + crc16Ccitt(payloadSemCrc);
}

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
