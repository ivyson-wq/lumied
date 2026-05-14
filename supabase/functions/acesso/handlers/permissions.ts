// Acesso — permissões de retirada (autorizados a buscar aluno)
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import { type Any, authGerenteOrSecretaria, uploadBase64Photo } from "../_lib.ts";

export function register(router: Router) {
  router.on("acesso_permissoes_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { aluno_id, busca } = ctx.body as Any;

    // Modo 1: filtro por aluno_id específico → retorna lista flat (compat antiga)
    if (aluno_id) {
      const { data } = await ctx.sb
        .from("acesso_permissoes_retirada")
        .select("*")
        .eq("escola_id", ctx.escola_id)
        .eq("aluno_id", aluno_id)
        .eq("autorizado", true)
        .order("criado_em", { ascending: false });
      return successResponse(data ?? []);
    }

    // Modo 2: lista alunos com seus autorizados aninhados (UI gerente)
    let alq = ctx.sb.from("alunos")
      .select("id, nome, serie")
      .eq("escola_id", ctx.escola_id).eq("ativo", true)
      .order("nome")
      .limit(busca ? 100 : 50);
    if (busca && String(busca).trim().length >= 2) {
      alq = alq.ilike("nome", `%${String(busca).trim()}%`);
    }
    const { data: alunos } = await alq;
    if (!alunos?.length) return successResponse([]);

    const alunoIds = alunos.map((a: Any) => a.id);
    const { data: perms } = await ctx.sb
      .from("acesso_permissoes_retirada")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .in("aluno_id", alunoIds)
      .order("criado_em", { ascending: false });

    const byAluno = new Map<string, Any[]>();
    for (const p of perms ?? []) {
      const list = byAluno.get(p.aluno_id) || [];
      list.push({
        id: p.id, nome: p.responsavel_nome, parentesco: p.parentesco,
        validade: p.validade, ativo: p.autorizado, foto_url: p.responsavel_foto_url,
      });
      byAluno.set(p.aluno_id, list);
    }

    return successResponse(alunos.map((a: Any) => ({
      id: a.id, nome: a.nome, serie: a.serie,
      autorizados: byAluno.get(a.id) || [],
    })));
  });

  router.on("acesso_permissao_save", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id, aluno_id, aluno_nome, responsavel_id, responsavel_nome, responsavel_email, responsavel_foto_url, parentesco, validade } = ctx.body as Any;
    if (!aluno_id || !aluno_nome || !responsavel_nome) {
      throw new AppError("VALIDATION_FAILED", "aluno_id, aluno_nome e responsavel_nome são obrigatórios.");
    }

    const row = {
      aluno_id, aluno_nome, responsavel_id: responsavel_id || null,
      responsavel_nome, responsavel_email: responsavel_email || null,
      responsavel_foto_url: responsavel_foto_url || null,
      parentesco: parentesco || null,
      autorizado: true,
      autorizado_por: ctx.user?.nome || "Gerente",
      validade: validade || null,
    };

    if (id) {
      const { data, error } = await ctx.sb.from("acesso_permissoes_retirada").update(row).eq("id", id).eq("escola_id", ctx.escola_id).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      return successResponse(data);
    }
    const { data, error } = await ctx.sb.from("acesso_permissoes_retirada").insert({ ...row, escola_id: ctx.escola_id }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse(data);
  });

  router.on("acesso_permissao_delete", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id).eq("escola_id", ctx.escola_id);
    return successResponse({ ok: true });
  });

  // ─── alias _permissao_create: cria autorizado com upload de foto ───
  router.on("acesso_permissao_create", authGerente, async (ctx) => {
    const { aluno_id, responsavel_nome, foto_base64, responsavel_email, responsavel_id } = ctx.body as Any;
    if (!aluno_id || !responsavel_nome) {
      throw new AppError("VALIDATION_FAILED", "aluno_id e responsavel_nome são obrigatórios.");
    }
    const { data: aluno } = await ctx.sb.from("alunos").select("id, nome").eq("id", aluno_id).maybeSingle();
    if (!aluno) throw new AppError("NOT_FOUND", "Aluno não encontrado.");

    const fotoUrl = await uploadBase64Photo(ctx.sb, foto_base64, "autorizados");

    (ctx.body as Any).aluno_nome = aluno.nome;
    (ctx.body as Any).responsavel_foto_url = fotoUrl;
    if (responsavel_id) (ctx.body as Any).responsavel_id = responsavel_id;
    if (responsavel_email) (ctx.body as Any).responsavel_email = responsavel_email;
    return router.dispatch("acesso_permissao_save", ctx);
  });
}
