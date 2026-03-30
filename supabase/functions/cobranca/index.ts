// ═══════════════════════════════════════════════════════════════
//  Edge Function: cobranca (v2 — Router Pattern)
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature, validateInput } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("cobranca");
const router = new Router("cobranca");
router.useGlobal(rateLimit());

router.on("regua_config_list", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const { data } = await ctx.sb.from("regua_config").select("*").order("ordem");
  return successResponse(data ?? []);
});

router.on("regua_config_create", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const { evento, canal, dias_offset, template_assunto, template_corpo } = ctx.body as any;
  if (!evento || !canal || dias_offset === undefined) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("regua_config").insert({ evento, canal, dias_offset, template_assunto, template_corpo }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("regua_config_update", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("regua_config").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("regua_executar", requireFeature("regua_cobranca"), async (ctx) => {
  const hoje = new Date();
  const { data: configs } = await ctx.sb.from("regua_config").select("*").eq("ativo", true).order("ordem");
  if (!configs?.length) return successResponse({ executados: 0 });
  const { data: mensalidades } = await ctx.sb.from("fin_mensalidades").select("*").eq("status", "pendente");
  let executados = 0;
  for (const mens of mensalidades || []) {
    const vencimento = new Date(mens.vencimento || mens.mes + "-10");
    for (const cfg of configs) {
      const dataDisparo = new Date(vencimento);
      dataDisparo.setDate(dataDisparo.getDate() + cfg.dias_offset);
      if (dataDisparo.toISOString().split("T")[0] !== hoje.toISOString().split("T")[0]) continue;
      const { count } = await ctx.sb.from("regua_execucoes").select("*", { count: "exact", head: true }).eq("config_id", cfg.id).eq("familia_email", mens.familia_email);
      if ((count || 0) > 0) continue;
      await ctx.sb.from("regua_execucoes").insert({ config_id: cfg.id, familia_email: mens.familia_email, canal: cfg.canal, status: "enviado" });
      executados++;
    }
  }
  log.info("Régua executada", { metadata: { executados } });
  return successResponse({ executados });
});

router.on("regua_execucoes_list", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const { familia_email, limite } = ctx.body as any;
  let q = ctx.sb.from("regua_execucoes").select("*, regua_config(evento, canal, dias_offset)").order("enviado_em", { ascending: false }).limit(limite || 100);
  if (familia_email) q = q.eq("familia_email", familia_email);
  const { data } = await q;
  return successResponse(data ?? []);
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
