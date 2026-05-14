// Acesso — cartões RFID (cadastro, listagem, sincronização)
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import { type Any, authGerenteOrSecretaria, uuidToDeviceId, deviceEnrollCard } from "../_lib.ts";

export function register(router: Router) {
  router.on("acesso_rfid_cadastrar", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { card_uid, pessoa_tipo, pessoa_id, pessoa_nome } = ctx.body as Any;
    if (!card_uid || !pessoa_tipo || !pessoa_id || !pessoa_nome) {
      throw new AppError("VALIDATION_FAILED", "card_uid, pessoa_tipo, pessoa_id e pessoa_nome são obrigatórios.");
    }

    const { data, error } = await ctx.sb.from("acesso_rfid").insert({
      escola_id: ctx.escola_id, card_uid, pessoa_tipo, pessoa_id, pessoa_nome,
    }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.code === "23505" ? "Cartão já cadastrado." : error.message);

    const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
    const deviceUserId = uuidToDeviceId(pessoa_id);
    for (const dev of devices ?? []) {
      try {
        const r = await deviceEnrollCard(ctx.sb, dev, Number(card_uid), deviceUserId);
        if (!r.ok) console.error(`Erro sync RFID → ${dev.nome}: ${r.error || `HTTP ${r.status}`}`);
      } catch (err) {
        console.error(`Erro sync RFID → ${dev.nome}:`, err);
      }
    }
    return successResponse(data);
  });

  router.on("acesso_rfid_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb.from("acesso_rfid").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true).order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  });

  router.on("acesso_rfid_delete", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    await ctx.sb.from("acesso_rfid").update({ ativo: false }).eq("id", id).eq("escola_id", ctx.escola_id);
    return successResponse({ ok: true });
  });

  // ─── alias com lookup de nome ───
  router.on("acesso_rfid_create", authGerente, async (ctx) => {
    const { pessoa_id, pessoa_tipo, pessoa_nome: nomeOverride } = ctx.body as Any;
    let pessoa_nome = nomeOverride || null;
    if (!pessoa_nome && pessoa_id && pessoa_tipo) {
      if (pessoa_tipo === "aluno") {
        const { data } = await ctx.sb.from("alunos").select("nome").eq("id", pessoa_id).maybeSingle();
        pessoa_nome = data?.nome || null;
      } else if (pessoa_tipo === "responsavel") {
        const { data } = await ctx.sb.from("acesso_faces").select("pessoa_nome").eq("pessoa_id", pessoa_id).eq("pessoa_tipo", "responsavel").maybeSingle();
        pessoa_nome = data?.pessoa_nome || null;
      } else if (pessoa_tipo === "funcionario") {
        const { data } = await ctx.sb.from("usuarios").select("nome").eq("id", pessoa_id).maybeSingle();
        pessoa_nome = data?.nome || null;
      }
    }
    if (!pessoa_nome) throw new AppError("NOT_FOUND", "Pessoa não encontrada.");
    (ctx.body as Any).pessoa_nome = pessoa_nome;
    return router.dispatch("acesso_rfid_cadastrar", ctx);
  });

  // ─── toggle ativo/inativo ───
  router.on("acesso_rfid_update", authGerente, async (ctx) => {
    const { id, ativo } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    const { error } = await ctx.sb.from("acesso_rfid").update({ ativo: !!ativo }).eq("id", id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse({ ok: true });
  });
}
