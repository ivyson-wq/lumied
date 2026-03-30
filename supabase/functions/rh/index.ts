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
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("rh_funcionarios").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("rh_ponto_registrar", feat, async (ctx) => {
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
