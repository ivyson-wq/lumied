// ═══════════════════════════════════════════════════════════════
//  Edge Function: comunicacao (v2 — Router Pattern)
//  Agenda Digital + Chat escola-família
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, authProfessora, requireFeature, type Middleware } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { uploadArquivo } from "../_shared/auth.ts";
import { resolveEscolaId } from "../_shared/tenant.ts";

const log = createLogger("comunicacao");
const router = new Router("comunicacao");
router.useGlobal(rateLimit());

const agendaFeat = requireFeature("agenda_digital");
const chatFeat = requireFeature("chat");

// ═══ Auth middleware for pais (family portal) ═══
// Validates the Supabase Auth Bearer token (sb.auth.getUser) and derives
// identity from the authenticated user — never from body.
const authPais: Middleware = async (ctx, next) => {
  const authHeader = ctx.req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");
  const { data: { user }, error } = await ctx.sb.auth.getUser(token);
  if (error || !user) throw new AppError("AUTH_INVALID", "Sessão inválida.");
  const email = (user.email || "").toLowerCase().trim();
  if (!email) throw new AppError("AUTH_INVALID", "Email não encontrado na sessão.");
  ctx.user = { id: user.id, nome: (user.user_metadata?.full_name as string) || email.split("@")[0], email, tipo: "pais" };
  return next();
};

// Auth middleware that accepts any valid session: gerente, professora, or pais.
// Used for chat endpoints where any authenticated user may be a participant.
const authAny: Middleware = async (ctx, next) => {
  const gToken = (ctx.body._token as string) || null;
  const pToken = (ctx.body._prof_token as string) || null;
  // Try gerente first
  if (gToken) {
    const { data } = await ctx.sb.from("gerente_sessoes").select("*, gerentes(id, nome, email)").eq("token", gToken).single();
    if (data && new Date((data as any).expira_em) >= new Date()) {
      const u = (data as any).gerentes;
      ctx.user = { id: u.id, nome: u.nome, email: u.email, tipo: "gerente" };
      return next();
    }
  }
  // Try professora
  if (pToken) {
    const { data } = await ctx.sb.from("professora_sessoes").select("*, professoras(id, nome, email)").eq("token", pToken).single();
    if (data && new Date((data as any).expira_em) >= new Date()) {
      const u = (data as any).professoras;
      ctx.user = { id: u.id, nome: u.nome, email: u.email, tipo: "professora" };
      return next();
    }
  }
  // Fallback: Supabase Auth Bearer (pais)
  const authHeader = ctx.req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    const { data: { user }, error } = await ctx.sb.auth.getUser(bearer);
    if (!error && user) {
      const email = (user.email || "").toLowerCase().trim();
      if (email) {
        ctx.user = { id: user.id, nome: (user.user_metadata?.full_name as string) || email.split("@")[0], email, tipo: "pais" };
        return next();
      }
    }
  }
  throw new AppError("AUTH_REQUIRED", "Autenticação obrigatória.");
};

// Helper: verify ctx.user is a participant of the given conversa
async function assertParticipant(ctx: any, conversa_id: string) {
  const { data: part } = await ctx.sb
    .from("chat_participantes")
    .select("id")
    .eq("conversa_id", conversa_id)
    .eq("usuario_tipo", ctx.user.tipo)
    .eq("usuario_id", ctx.user.tipo === "pais" ? ctx.user.email : ctx.user.id)
    .maybeSingle();
  if (!part) throw new AppError("FORBIDDEN", "Você não participa desta conversa.");
}

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
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { serie_id, aluno_email, aluno_nome, data: dataStr } = ctx.body as any;
  if (!serie_id || !dataStr) throw new AppError("VALIDATION_FAILED", "serie_id e data obrigatórios.");
  const { data, error } = await ctx.sb.from("agenda_registros").insert({ escola_id: ctx.escola_id, serie_id, aluno_email: aluno_email || null, aluno_nome: aluno_nome || null, data: dataStr, professor_id: ctx.user!.id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("agenda_itens_add", authProfessora, agendaFeat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { registro_id, tipo, titulo, descricao, valor, hora, ordem } = ctx.body as any;
  if (!registro_id || !tipo) throw new AppError("VALIDATION_FAILED", "registro_id e tipo obrigatórios.");
  const { data, error } = await ctx.sb.from("agenda_itens").insert({ escola_id: ctx.escola_id, registro_id, tipo, titulo, descricao, valor, hora, ordem: ordem || 0 }).select().single();
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

router.on("agenda_pais_get", authPais, agendaFeat, async (ctx) => {
  const { data_inicio, data_fim } = ctx.body as any;
  // Email is derived from authenticated session, never from body.
  const aluno_email = ctx.user!.email;
  // Avoid PostgREST .or() injection: run two queries and merge in code.
  const baseSelect = "*, series(nome), professoras(nome), agenda_itens(*, agenda_fotos(*))";
  let q1 = ctx.sb.from("agenda_registros").select(baseSelect).eq("publicado", true).eq("aluno_email", aluno_email).order("data", { ascending: false });
  let q2 = ctx.sb.from("agenda_registros").select(baseSelect).eq("publicado", true).is("aluno_email", null).order("data", { ascending: false });
  if (data_inicio) { q1 = q1.gte("data", data_inicio); q2 = q2.gte("data", data_inicio); }
  if (data_fim) { q1 = q1.lte("data", data_fim); q2 = q2.lte("data", data_fim); }
  const [{ data: d1 }, { data: d2 }] = await Promise.all([q1.limit(30), q2.limit(30)]);
  const merged = [...(d1 ?? []), ...(d2 ?? [])];
  // Deduplicate by id and sort by data desc
  const seen = new Set<string>();
  const unique = merged.filter((r: any) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  unique.sort((a: any, b: any) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return successResponse(unique.slice(0, 30));
});

router.on("agenda_foto_upload", authProfessora, agendaFeat, async (ctx) => {
  const { item_id, registro_id, base64, mime } = ctx.body as any;
  if (!base64 || !mime) throw new AppError("VALIDATION_FAILED", "base64 e mime obrigatórios.");
  const result = await uploadArquivo(ctx.sb, "agenda", ctx.user!.id, base64, mime);
  if ("error" in result) throw new AppError("BAD_REQUEST", result.error);
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data, error } = await ctx.sb.from("agenda_fotos").insert({ escola_id: ctx.escola_id, item_id, registro_id, url: result.url }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══ CHAT ═══

router.on("chat_conversas_list", authAny, chatFeat, async (ctx) => {
  // Derive identity from authenticated session, never from body.
  const usuario_tipo = ctx.user!.tipo;
  const usuario_id = usuario_tipo === "pais" ? ctx.user!.email : ctx.user!.id;
  const { data: participacoes } = await ctx.sb.from("chat_participantes").select("conversa_id").eq("usuario_tipo", usuario_tipo).eq("usuario_id", usuario_id);
  if (!participacoes?.length) return successResponse([]);
  const convIds = participacoes.map((p: any) => p.conversa_id);
  const { data } = await ctx.sb.from("chat_conversas").select("*, chat_participantes(usuario_nome, usuario_tipo)").in("id", convIds).order("criado_em", { ascending: false });
  const result = [];
  for (const conv of data || []) {
    const { data: lastMsg } = await ctx.sb.from("chat_mensagens").select("conteudo, remetente_nome, criado_em").eq("conversa_id", conv.id).eq("excluida", false).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    const { data: leitura } = await ctx.sb.from("chat_leituras").select("ultima_leitura").eq("conversa_id", conv.id).eq("usuario_tipo", usuario_tipo).eq("usuario_id", usuario_id).maybeSingle();
    const { count } = await ctx.sb.from("chat_mensagens").select("*", { count: "exact", head: true }).eq("conversa_id", conv.id).eq("excluida", false).gt("criado_em", leitura?.ultima_leitura || "1970-01-01");
    result.push({ ...conv, ultima_mensagem: lastMsg || null, nao_lidas: count || 0 });
  }
  return successResponse(result);
});

router.on("chat_conversa_create", authAny, chatFeat, async (ctx) => {
  const { tipo, titulo, serie_id, participantes } = ctx.body as any;
  if (!tipo) throw new AppError("VALIDATION_FAILED", "tipo obrigatório.");
  // Resolve escola_id (authAny may not set it for pais)
  if (!ctx.escola_id) ctx.escola_id = (await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body)) || undefined;
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Não foi possível determinar a escola.");
  // Derive creator identity from authenticated session, never from body.
  const criado_por_tipo = ctx.user!.tipo;
  const criado_por_id = criado_por_tipo === "pais" ? ctx.user!.email : ctx.user!.id;
  const { data: conv, error } = await ctx.sb.from("chat_conversas").insert({ escola_id: ctx.escola_id, tipo, titulo, serie_id, criado_por_tipo, criado_por_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  // Always ensure the creator is a participant.
  const allParticipants: any[] = [{ escola_id: ctx.escola_id, conversa_id: conv.id, usuario_tipo: criado_por_tipo, usuario_id: criado_por_id, usuario_nome: ctx.user!.nome, papel: "admin" }];
  if (Array.isArray(participantes) && participantes.length) {
    for (const p of participantes) {
      allParticipants.push({ escola_id: ctx.escola_id, conversa_id: conv.id, usuario_tipo: p.tipo, usuario_id: p.id, usuario_nome: p.nome, papel: p.papel || "membro" });
    }
  }
  await ctx.sb.from("chat_participantes").insert(allParticipants);
  return successResponse(conv);
});

router.on("chat_mensagem_send", authAny, chatFeat, async (ctx) => {
  const { conversa_id, conteudo, tipo_msg, arquivo_url } = ctx.body as any;
  if (!conversa_id || !conteudo) throw new AppError("VALIDATION_FAILED", "conversa_id e conteudo obrigatórios.");
  // Derive sender identity from authenticated session, never from body.
  const remetente_tipo = ctx.user!.tipo;
  const remetente_id = remetente_tipo === "pais" ? ctx.user!.email : ctx.user!.id;
  const remetente_nome = ctx.user!.nome;
  const { data: part } = await ctx.sb.from("chat_participantes").select("id").eq("conversa_id", conversa_id).eq("usuario_tipo", remetente_tipo).eq("usuario_id", remetente_id).maybeSingle();
  if (!part) throw new AppError("FORBIDDEN", "Você não participa desta conversa.");
  // Resolve escola_id
  if (!ctx.escola_id) ctx.escola_id = (await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body)) || undefined;
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Não foi possível determinar a escola.");
  const { data, error } = await ctx.sb.from("chat_mensagens").insert({ escola_id: ctx.escola_id, conversa_id, remetente_tipo, remetente_id, remetente_nome, conteudo, tipo_msg: tipo_msg || "texto", arquivo_url }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  await ctx.sb.from("chat_leituras").upsert({ escola_id: ctx.escola_id, conversa_id, usuario_tipo: remetente_tipo, usuario_id: remetente_id, ultima_leitura: new Date().toISOString() }, { onConflict: "conversa_id,usuario_tipo,usuario_id" });
  return successResponse(data);
});

router.on("chat_mensagens_list", authAny, chatFeat, async (ctx) => {
  const { conversa_id, antes_de, limite } = ctx.body as any;
  if (!conversa_id) throw new AppError("VALIDATION_FAILED", "conversa_id obrigatório.");
  // Verify authenticated user is a participant of this conversa.
  await assertParticipant(ctx, conversa_id);
  let q = ctx.sb.from("chat_mensagens").select("*").eq("conversa_id", conversa_id).eq("excluida", false).order("criado_em", { ascending: false }).limit(limite || 50);
  if (antes_de) q = q.lt("criado_em", antes_de);
  const { data } = await q;
  return successResponse((data ?? []).reverse());
});

router.on("chat_marcar_lida", authAny, chatFeat, async (ctx) => {
  const { conversa_id } = ctx.body as any;
  if (!conversa_id) throw new AppError("VALIDATION_FAILED", "conversa_id obrigatório.");
  // Verify authenticated user is a participant of this conversa.
  await assertParticipant(ctx, conversa_id);
  const usuario_tipo = ctx.user!.tipo;
  const usuario_id = usuario_tipo === "pais" ? ctx.user!.email : ctx.user!.id;
  // Resolve escola_id
  if (!ctx.escola_id) ctx.escola_id = (await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body)) || undefined;
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Não foi possível determinar a escola.");
  await ctx.sb.from("chat_leituras").upsert({ escola_id: ctx.escola_id, conversa_id, usuario_tipo, usuario_id, ultima_leitura: new Date().toISOString() }, { onConflict: "conversa_id,usuario_tipo,usuario_id" });
  return successResponse({ success: true });
});

router.on("chat_avisos_turma", authGerente, chatFeat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { serie_id, titulo, conteudo } = ctx.body as any;
  if (!conteudo) throw new AppError("VALIDATION_FAILED", "Conteúdo obrigatório.");
  const remetente = ctx.user!;
  let convId: string;
  const { data: existing } = await ctx.sb.from("chat_conversas").select("id").eq("escola_id", ctx.escola_id).eq("tipo", "turma").eq("serie_id", serie_id).maybeSingle();
  if (existing) { convId = existing.id; }
  else {
    const { data: newConv } = await ctx.sb.from("chat_conversas").insert({ escola_id: ctx.escola_id, tipo: "turma", titulo: titulo || "Avisos", serie_id, criado_por_tipo: "gerente", criado_por_id: remetente.email }).select().single();
    convId = newConv!.id;
  }
  const { data, error } = await ctx.sb.from("chat_mensagens").insert({ escola_id: ctx.escola_id, conversa_id: convId, remetente_tipo: "gerente", remetente_id: remetente.email, remetente_nome: remetente.nome, conteudo, tipo_msg: "aviso" }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Aviso turma enviado", { metadata: { serie_id } });
  return successResponse(data);
});

router.on("chat_mensagem_delete", authAny, chatFeat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  // Only the original sender (or a gerente) can delete a message.
  const { data: msg } = await ctx.sb.from("chat_mensagens").select("remetente_tipo, remetente_id").eq("id", id).maybeSingle();
  if (!msg) throw new AppError("NOT_FOUND", "Mensagem não encontrada.");
  const callerTipo = ctx.user!.tipo;
  const callerId = callerTipo === "pais" ? ctx.user!.email : ctx.user!.id;
  const isOwner = (msg as any).remetente_tipo === callerTipo && (msg as any).remetente_id === callerId;
  const isGerente = callerTipo === "gerente";
  if (!isOwner && !isGerente) throw new AppError("FORBIDDEN", "Apenas o autor ou um gerente pode excluir esta mensagem.");
  // Resolve escola_id for tenant-safe update
  if (!ctx.escola_id) ctx.escola_id = (await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body)) || undefined;
  const updateQ = ctx.sb.from("chat_mensagens").update({ excluida: true }).eq("id", id);
  if (ctx.escola_id) updateQ.eq("escola_id", ctx.escola_id);
  const { error } = await updateQ;
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("chat_mensagem_aprovar", authGerente, chatFeat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, aprovada } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("chat_mensagens").update({ aprovada: aprovada !== false, aprovada_por: ctx.user!.nome }).eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
