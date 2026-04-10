// ═══════════════════════════════════════════════════════════════
//  Edge Function: rh (v2 — Router Pattern)
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";

const router = new Router("rh");
router.useGlobal(rateLimit());

const feat = requireFeature("rh");

router.on("rh_funcionarios_list", authGerente, feat, async (ctx) => {
  const { status, departamento } = ctx.body as any;
  let q = ctx.sb.from("rh_funcionarios").select("*").order("nome");
  if (status) q = q.eq("status", status);
  if (departamento) q = q.eq("departamento", departamento);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("rh_funcionarios_create", authGerente, feat, async (ctx) => {
  const { nome, cpf, email, telefone, cargo, departamento, tipo_contrato, data_admissao, salario_base, carga_horaria } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("rh_funcionarios").insert({ nome, cpf, email, telefone, cargo, departamento, tipo_contrato, data_admissao, salario_base, carga_horaria }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("rh_funcionarios_update", authGerente, feat, async (ctx) => {
  const body = ctx.body as any;
  const { id } = body;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const ALLOWED = [
    "nome", "cpf", "email", "telefone", "cargo", "departamento",
    "tipo_contrato", "data_admissao", "data_demissao", "salario_base",
    "carga_horaria", "status", "observacoes",
  ];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) update[k] = body[k];
  const { error } = await ctx.sb.from("rh_funcionarios").update(update).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// Auth middleware: aceita gerente OU o próprio funcionário (via sessão unificada).
// Para funcionário, valida que o funcionario_id corresponde ao usuário autenticado.
const authGerenteOuFuncionario: import("../_shared/router.ts").Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

  // Try gerente_sessoes first
  const { data: gs } = await ctx.sb
    .from("gerente_sessoes")
    .select("*, gerentes(id, nome, email)")
    .eq("token", token)
    .maybeSingle();
  if (gs && new Date(gs.expira_em) >= new Date()) {
    ctx.user = { ...(gs as any).gerentes, tipo: "gerente" };
    return next();
  }

  // Try sessão unificada → usuarios (funcionário pode bater ponto no seu próprio ID)
  const { data: us } = await ctx.sb
    .from("sessoes")
    .select("*, usuarios(id, nome, email, papeis, papel)")
    .eq("token", token)
    .maybeSingle();
  if (us && new Date(us.expira_em) >= new Date()) {
    const usuario = (us as any).usuarios;
    const papeis: string[] = usuario?.papeis?.length ? usuario.papeis : (usuario?.papel ? [usuario.papel] : []);
    // Gerente pode bater ponto por qualquer funcionário
    if (papeis.includes("gerente") || papeis.includes("diretor")) {
      ctx.user = { ...usuario, tipo: "gerente" };
      return next();
    }
    // Funcionário só pode bater ponto no próprio id
    const fid = (ctx.body as any).funcionario_id;
    if (fid && String(fid) === String(usuario?.id)) {
      ctx.user = { ...usuario, tipo: "funcionario" };
      return next();
    }
    // Tenta casar via tabela rh_funcionarios pelo email (caso id diferente)
    if (usuario?.email && fid) {
      const { data: func } = await ctx.sb.from("rh_funcionarios").select("id").eq("id", fid).maybeSingle();
      if (func) {
        const { data: funcByEmail } = await ctx.sb.from("rh_funcionarios").select("id").eq("email", usuario.email).eq("id", fid).maybeSingle();
        if (funcByEmail) {
          ctx.user = { ...usuario, tipo: "funcionario" };
          return next();
        }
      }
    }
    throw new AppError("AUTH_INVALID", "Só é permitido registrar ponto do próprio funcionário.");
  }

  throw new AppError("AUTH_INVALID", "Sessão inválida.");
};

router.on("rh_ponto_registrar", authGerenteOuFuncionario, feat, async (ctx) => {
  const { funcionario_id, tipo, localizacao, ip } = ctx.body as any;
  if (!funcionario_id || !tipo) throw new AppError("VALIDATION_FAILED", "funcionario_id e tipo obrigatórios.");
  const { data, error } = await ctx.sb.from("rh_ponto").insert({ funcionario_id, tipo, localizacao, ip }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("rh_ponto_list", authGerente, feat, async (ctx) => {
  const { funcionario_id, data_inicio, data_fim } = ctx.body as any;
  let q = ctx.sb.from("rh_ponto").select("*, rh_funcionarios(nome)").order("registrado_em", { ascending: false });
  if (funcionario_id) q = q.eq("funcionario_id", funcionario_id);
  if (data_inicio) q = q.gte("registrado_em", data_inicio);
  if (data_fim) q = q.lte("registrado_em", data_fim);
  const { data } = await q.limit(500);
  return successResponse(data ?? []);
});

router.on("rh_ferias_list", authGerente, feat, async (ctx) => {
  const { funcionario_id, status } = ctx.body as any;
  let q = ctx.sb.from("rh_ferias").select("*, rh_funcionarios(nome)").order("data_inicio", { ascending: false });
  if (funcionario_id) q = q.eq("funcionario_id", funcionario_id);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("rh_ferias_create", authGerente, feat, async (ctx) => {
  const { funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim, data_inicio, data_fim, dias, abono_pecuniario } = ctx.body as any;
  if (!funcionario_id || !data_inicio || !data_fim) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("rh_ferias").insert({ funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim, data_inicio, data_fim, dias, abono_pecuniario }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("rh_holerites_list", authGerente, feat, async (ctx) => {
  const { funcionario_id, mes, ano } = ctx.body as any;
  let q = ctx.sb.from("rh_holerites").select("*, rh_funcionarios(nome)").order("ano", { ascending: false }).order("mes", { ascending: false });
  if (funcionario_id) q = q.eq("funcionario_id", funcionario_id);
  if (mes) q = q.eq("mes", mes);
  if (ano) q = q.eq("ano", ano);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("rh_folha_list", authGerente, feat, async (ctx) => {
  const { ano } = ctx.body as any;
  let q = ctx.sb.from("rh_folha_pagamento").select("*").order("ano", { ascending: false }).order("mes", { ascending: false });
  if (ano) q = q.eq("ano", ano);
  const { data } = await q;
  return successResponse(data ?? []);
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
