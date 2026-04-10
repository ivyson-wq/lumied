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

// Auth middleware: gerente/diretor (legado) ou financeiro (sessão unificada)
const authGerenteOuFinanceiro: import("../_shared/router.ts").Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

  const { data: gs } = await ctx.sb
    .from("gerente_sessoes")
    .select("*, gerentes(id, nome, email)")
    .eq("token", token)
    .maybeSingle();
  if (gs && new Date(gs.expira_em) >= new Date()) {
    ctx.user = { ...(gs as any).gerentes, tipo: "gerente" };
    return next();
  }

  const { data: us } = await ctx.sb
    .from("sessoes")
    .select("*, usuarios(id, nome, email, papeis, papel)")
    .eq("token", token)
    .maybeSingle();
  if (us && new Date(us.expira_em) >= new Date()) {
    const usuario = (us as any).usuarios;
    const papeis: string[] = usuario?.papeis?.length ? usuario.papeis : (usuario?.papel ? [usuario.papel] : []);
    const permitidos = ["gerente", "diretor", "financeiro"];
    if (papeis.some((p: string) => permitidos.includes(p))) {
      ctx.user = { ...usuario, tipo: papeis[0] };
      return next();
    }
  }

  throw new AppError("AUTH_INVALID", "Sessão inválida ou sem permissão financeira.");
};

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

router.on("regua_executar", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
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
