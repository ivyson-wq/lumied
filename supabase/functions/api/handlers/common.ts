// API Handlers: Common (series, config, notificações, módulos, permissões)
import { type Context } from "../../_shared/router.ts";
import { successResponse, AppError } from "../../_shared/errors.ts";
import { getModulosHabilitados, getEscolaPadrao } from "../../_shared/modulos.ts";

export async function seriesList(ctx: Context) {
  const { data } = await ctx.sb.from("series").select("id, nome, turno, ativo").eq("ativo", true).order("nome");
  return successResponse(data ?? []);
}

export async function seriesListAll(ctx: Context) {
  const { data } = await ctx.sb.from("series").select("*").order("nome");
  return successResponse(data ?? []);
}

export async function seriesCreate(ctx: Context) {
  const { nome, turno } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("series").insert({ nome, turno }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
}

export async function seriesUpdate(ctx: Context) {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("series").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
}

export async function seriesDelete(ctx: Context) {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("series").update({ ativo: false }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
}

export async function configGet(ctx: Context) {
  const { chave } = ctx.body as any;
  if (!chave) throw new AppError("VALIDATION_FAILED", "Chave obrigatória.");
  const { data } = await ctx.sb.from("config").select("valor").eq("chave", chave).single();
  return successResponse({ chave, valor: data?.valor ?? null });
}

export async function configSet(ctx: Context) {
  const { chave, valor } = ctx.body as any;
  if (!chave) throw new AppError("VALIDATION_FAILED", "Chave obrigatória.");
  const { error } = await ctx.sb.from("config").upsert({ chave, valor }, { onConflict: "chave" });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
}

export async function configDelete(ctx: Context) {
  const { chave } = ctx.body as any;
  if (!chave) throw new AppError("VALIDATION_FAILED", "Chave obrigatória.");
  await ctx.sb.from("config").delete().eq("chave", chave);
  return successResponse({ success: true });
}

export async function notifList(ctx: Context) {
  const { portal, destinatario, limite } = ctx.body as any;
  let q = ctx.sb.from("notificacoes").select("*").order("criado_em", { ascending: false }).limit(limite || 50);
  if (portal) q = q.eq("portal", portal);
  if (destinatario) q = q.eq("destinatario", destinatario);
  const { data } = await q;
  return successResponse(data ?? []);
}

export async function notifMarcarLida(ctx: Context) {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  await ctx.sb.from("notificacoes").update({ lida: true }).eq("id", id);
  return successResponse({ success: true });
}

export async function notifMarcarTodas(ctx: Context) {
  const { portal, destinatario } = ctx.body as any;
  let q = ctx.sb.from("notificacoes").update({ lida: true }).eq("lida", false);
  if (portal) q = q.eq("portal", portal);
  if (destinatario) q = q.eq("destinatario", destinatario);
  await q;
  return successResponse({ success: true });
}

export async function modulosHabilitados(ctx: Context) {
  try {
    const escolaId = await getEscolaPadrao(ctx.sb);
    if (!escolaId) return successResponse({ modulos: [], tema: "corporativo" });
    const modulos = await getModulosHabilitados(ctx.sb, escolaId);
    const { data: escola } = await ctx.sb.from("escolas").select("tema").eq("id", escolaId).single();
    return successResponse({ modulos: [...modulos], tema: escola?.tema || "corporativo" });
  } catch { return successResponse({ modulos: [], tema: "corporativo" }); }
}

export async function permissoesUsuario(ctx: Context) {
  const papel = (ctx.body as any).papel || "gerente";
  const { data } = await ctx.sb.from("permissoes_papel").select("modulo, pode_ver, pode_editar").eq("papel", papel);
  return successResponse(data ?? []);
}
