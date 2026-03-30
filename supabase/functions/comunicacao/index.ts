// ═══════════════════════════════════════════════════════════════
//  Edge Function: comunicacao (v2 — Router Pattern)
//  Agenda Digital + Chat escola-família
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, authProfessora, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { uploadArquivo } from "../_shared/auth.ts";

const log = createLogger("comunicacao");
const router = new Router("comunicacao");
router.useGlobal(rateLimit());

const agendaFeat = requireFeature("agenda_digital");
const chatFeat = requireFeature("chat");

// ═══ AGENDA DIGITAL ═══

router.on("agenda_registros_list", agendaFeat, async (ctx) => {
  const { serie_id, data: dataStr, aluno_email } = ctx.body as any;
  let q = ctx.sb.from("agenda_registros").select("*, series(nome), professoras(nome), agenda_itens(*, agenda_fotos(*))").order("data", { ascending: false });
  if (serie_id) q = q.eq("serie_id", serie_id);
  if (dataStr) q = q.eq("data", dataStr);
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  const { data } = await q.limit(50);
  return successResponse(data ?? []);
});

router.on("agenda_registros_create", authProfessora, agendaFeat, async (ctx) => {
  const { serie_id, aluno_email, aluno_nome, data: dataStr } = ctx.body as any;
  if (!serie_id || !dataStr) throw new AppError("VALIDATION_FAILED", "serie_id e data obrigatórios.");
  const { data, error } = await ctx.sb.from("agenda_registros").insert({ serie_id, aluno_email: aluno_email || null, aluno_nome: aluno_nome || null, data: dataStr, professor_id: ctx.user!.id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("agenda_itens_add", authProfessora, agendaFeat, async (ctx) => {
  const { registro_id, tipo, titulo, descricao, valor, hora, ordem } = ctx.body as any;
  if (!registro_id || !tipo) throw new AppError("VALIDATION_FAILED", "registro_id e tipo obrigatórios.");
  const { data, error } = await ctx.sb.from("agenda_itens").insert({ registro_id, tipo, titulo, descricao, valor, hora, ordem: ordem || 0 }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("agenda_itens_update", authProfessora, agendaFeat, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._prof_token;
  const { error } = await ctx.sb.from("agenda_itens").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("agenda_itens_delete", authProfessora, agendaFeat, async (ctx) => {
  const { id } = ctx.body as any;
  const { error } = await ctx.sb.from("agenda_itens").delete().eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("agenda_publicar", authProfessora, agendaFeat, async (ctx) => {
  const { id } = ctx.body as any;
  const { error } = await ctx.sb.from("agenda_registros").update({ publicado: true }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("agenda_pais_get", agendaFeat, async (ctx) => {
  const { aluno_email, data_inicio, data_fim } = ctx.body as any;
  if (!aluno_email) throw new AppError("VALIDATION_FAILED", "aluno_email obrigatório.");
  let q = ctx.sb.from("agenda_registros").select("*, series(nome), professoras(nome), agenda_itens(*, agenda_fotos(*))").eq("publicado", true).or(`aluno_email.eq.${aluno_email},aluno_email.is.null`).order("data", { ascending: false });
  if (data_inicio) q = q.gte("data", data_inicio);
  if (data_fim) q = q.lte("data", data_fim);
  const { data } = await q.limit(30);
  return successResponse(data ?? []);
});

router.on("agenda_foto_upload", authProfessora, agendaFeat, async (ctx) => {
  const { item_id, registro_id, base64, mime } = ctx.body as any;
  if (!base64 || !mime) throw new AppError("VALIDATION_FAILED", "base64 e mime obrigatórios.");
  const result = await uploadArquivo(ctx.sb, "agenda", ctx.user!.id, base64, mime);
  if ("error" in result) throw new AppError("BAD_REQUEST", result.error);
  const { data, error } = await ctx.sb.from("agenda_fotos").insert({ item_id, registro_id, url: result.url }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══ CHAT ═══

router.on("chat_conversas_list", chatFeat, async (ctx) => {
  const { usuario_tipo, usuario_id } = ctx.body as any;
  if (!usuario_tipo || !usuario_id) throw new AppError("VALIDATION_FAILED", "usuario_tipo e usuario_id obrigatórios.");
  const { data: participacoes } = await ctx.sb.from("chat_participantes").select("conversa_id").eq("usuario_tipo", usuario_tipo).eq("usuario_id", usuario_id);
  if (!participacoes?.length) return successResponse([]);
  const convIds = participacoes.map((p: any) => p.conversa_id);
  const { data } = await ctx.sb.from("chat_conversas").select("*, chat_participantes(usuario_nome, usuario_tipo)").in("id", convIds).order("criado_em", { ascending: false });
  const result = [];
  for (const conv of data || []) {
    const { data: lastMsg } = await ctx.sb.from("chat_mensagens").select("conteudo, remetente_nome, criado_em").eq("conversa_id", conv.id).eq("excluida", false).order("criado_em", { ascending: false }).limit(1).single();
    const { data: leitura } = await ctx.sb.from("chat_leituras").select("ultima_leitura").eq("conversa_id", conv.id).eq("usuario_tipo", usuario_tipo).eq("usuario_id", usuario_id).single();
    const { count } = await ctx.sb.from("chat_mensagens").select("*", { count: "exact", head: true }).eq("conversa_id", conv.id).eq("excluida", false).gt("criado_em", leitura?.ultima_leitura || "1970-01-01");
    result.push({ ...conv, ultima_mensagem: lastMsg || null, nao_lidas: count || 0 });
  }
  return successResponse(result);
});

router.on("chat_conversa_create", chatFeat, async (ctx) => {
  const { tipo, titulo, serie_id, participantes, criado_por_tipo, criado_por_id } = ctx.body as any;
  if (!tipo || !criado_por_tipo || !criado_por_id) throw new AppError("VALIDATION_FAILED", "tipo, criado_por_tipo e criado_por_id obrigatórios.");
  const { data: conv, error } = await ctx.sb.from("chat_conversas").insert({ tipo, titulo, serie_id, criado_por_tipo, criado_por_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (Array.isArray(participantes) && participantes.length) {
    await ctx.sb.from("chat_participantes").insert(participantes.map((p: any) => ({ conversa_id: conv.id, usuario_tipo: p.tipo, usuario_id: p.id, usuario_nome: p.nome, papel: p.papel || "membro" })));
  }
  return successResponse(conv);
});

router.on("chat_mensagem_send", chatFeat, async (ctx) => {
  const { conversa_id, remetente_tipo, remetente_id, remetente_nome, conteudo, tipo_msg, arquivo_url } = ctx.body as any;
  if (!conversa_id || !remetente_tipo || !remetente_id || !conteudo) throw new AppError("VALIDATION_FAILED", "conversa_id, remetente e conteudo obrigatórios.");
  const { data: part } = await ctx.sb.from("chat_participantes").select("id").eq("conversa_id", conversa_id).eq("usuario_tipo", remetente_tipo).eq("usuario_id", remetente_id).single();
  if (!part) throw new AppError("FORBIDDEN", "Você não participa desta conversa.");
  const { data, error } = await ctx.sb.from("chat_mensagens").insert({ conversa_id, remetente_tipo, remetente_id, remetente_nome, conteudo, tipo_msg: tipo_msg || "texto", arquivo_url }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  await ctx.sb.from("chat_leituras").upsert({ conversa_id, usuario_tipo: remetente_tipo, usuario_id: remetente_id, ultima_leitura: new Date().toISOString() }, { onConflict: "conversa_id,usuario_tipo,usuario_id" });
  return successResponse(data);
});

router.on("chat_mensagens_list", chatFeat, async (ctx) => {
  const { conversa_id, antes_de, limite } = ctx.body as any;
  if (!conversa_id) throw new AppError("VALIDATION_FAILED", "conversa_id obrigatório.");
  let q = ctx.sb.from("chat_mensagens").select("*").eq("conversa_id", conversa_id).eq("excluida", false).order("criado_em", { ascending: false }).limit(limite || 50);
  if (antes_de) q = q.lt("criado_em", antes_de);
  const { data } = await q;
  return successResponse((data ?? []).reverse());
});

router.on("chat_marcar_lida", chatFeat, async (ctx) => {
  const { conversa_id, usuario_tipo, usuario_id } = ctx.body as any;
  if (!conversa_id || !usuario_tipo || !usuario_id) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  await ctx.sb.from("chat_leituras").upsert({ conversa_id, usuario_tipo, usuario_id, ultima_leitura: new Date().toISOString() }, { onConflict: "conversa_id,usuario_tipo,usuario_id" });
  return successResponse({ success: true });
});

router.on("chat_avisos_turma", chatFeat, async (ctx) => {
  const { serie_id, titulo, conteudo } = ctx.body as any;
  if (!conteudo) throw new AppError("VALIDATION_FAILED", "Conteúdo obrigatório.");
  const remetente = ctx.user!;
  let convId: string;
  const { data: existing } = await ctx.sb.from("chat_conversas").select("id").eq("tipo", "turma").eq("serie_id", serie_id).single();
  if (existing) { convId = existing.id; }
  else {
    const { data: newConv } = await ctx.sb.from("chat_conversas").insert({ tipo: "turma", titulo: titulo || "Avisos", serie_id, criado_por_tipo: "gerente", criado_por_id: remetente.email }).select().single();
    convId = newConv!.id;
  }
  const { data, error } = await ctx.sb.from("chat_mensagens").insert({ conversa_id: convId, remetente_tipo: "gerente", remetente_id: remetente.email, remetente_nome: remetente.nome, conteudo, tipo_msg: "aviso" }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Aviso turma enviado", { metadata: { serie_id } });
  return successResponse(data);
});

router.on("chat_mensagem_delete", chatFeat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("chat_mensagens").update({ excluida: true }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("chat_mensagem_aprovar", authGerente, chatFeat, async (ctx) => {
  const { id, aprovada } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("chat_mensagens").update({ aprovada: aprovada !== false, aprovada_por: ctx.user!.nome }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
