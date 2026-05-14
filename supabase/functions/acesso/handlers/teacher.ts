// Acesso — actions da professora (alertas chegada, encaminhar, presença turma)
import { Router, authProfessora, successResponse, AppError } from "../../_shared/mod.ts";
import { type Any, authGerenteOrSecretaria } from "../_lib.ts";

export function register(router: Router) {
  router.on("acesso_alertas_professora", authProfessora, async (ctx) => {
    const professoraId = ctx.user?.id;
    if (!professoraId) throw new AppError("AUTH_REQUIRED", "Professora ID não encontrado.");
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

    const { apenas_ativos } = ctx.body as Any;
    const apenasAtivos = apenas_ativos !== false; // default true (banner)

    const hojeIso = new Date().toISOString().split("T")[0];

    const { data: alertas } = await ctx.sb.from("acesso_alertas")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .eq("destinatario_tipo", "professora")
      .eq("destinatario_id", professoraId)
      .eq("tipo", "chegada_responsavel")
      .gte("criado_em", `${hojeIso}T00:00:00`)
      .order("criado_em", { ascending: false })
      .limit(apenasAtivos ? 20 : 200);

    // apenas_ativos=true: aguardando/encaminhado, ou concluído há <5min
    const cincoMinAtras = Date.now() - 5 * 60 * 1000;
    const visiveis = apenasAtivos
      ? (alertas ?? []).filter((a: Any) => {
          if (a.status === "aguardando" || a.status === "encaminhado") return true;
          if (a.status === "concluido" && a.concluido_em) {
            return new Date(a.concluido_em).getTime() > cincoMinAtras;
          }
          return false;
        })
      : (alertas ?? []);

    const alunoIds = Array.from(new Set(visiveis.map((a: Any) => a.aluno_id).filter(Boolean)));
    const eventoIds = Array.from(new Set(visiveis.map((a: Any) => a.responsavel_evento_id).filter(Boolean)));

    const alunoFotoMap = new Map<string, string>();
    if (alunoIds.length > 0) {
      const { data: faces } = await ctx.sb.from("acesso_faces")
        .select("pessoa_id, foto_url")
        .eq("escola_id", ctx.escola_id)
        .eq("pessoa_tipo", "aluno")
        .eq("ativo", true)
        .in("pessoa_id", alunoIds);
      for (const f of faces ?? []) if (f.pessoa_id && f.foto_url) alunoFotoMap.set(f.pessoa_id, f.foto_url);
    }

    const eventoFotoMap = new Map<string, string>();
    if (eventoIds.length > 0) {
      const { data: evts } = await ctx.sb.from("acesso_eventos")
        .select("id, foto_captura_url")
        .eq("escola_id", ctx.escola_id)
        .in("id", eventoIds);
      for (const e of evts ?? []) if (e.id && e.foto_captura_url) eventoFotoMap.set(e.id, e.foto_captura_url);
    }

    const enriched = visiveis.map((a: Any) => ({
      ...a,
      aluno_foto_url: a.aluno_id ? (alunoFotoMap.get(a.aluno_id) || null) : null,
      pai_foto_captura_url: a.responsavel_evento_id ? (eventoFotoMap.get(a.responsavel_evento_id) || null) : null,
    }));

    return successResponse(enriched);
  });

  router.on("acesso_chegada_encaminhar", authProfessora, async (ctx) => {
    const professoraId = ctx.user?.id;
    if (!professoraId) throw new AppError("AUTH_REQUIRED", "Professora ID não encontrado.");
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { alerta_id } = ctx.body as Any;
    if (!alerta_id) throw new AppError("VALIDATION_FAILED", "alerta_id obrigatório.");

    const { data: alerta } = await ctx.sb.from("acesso_alertas")
      .select("*")
      .eq("id", alerta_id)
      .eq("escola_id", ctx.escola_id)
      .eq("destinatario_tipo", "professora")
      .eq("destinatario_id", professoraId)
      .maybeSingle();
    if (!alerta) throw new AppError("NOT_FOUND", "Alerta não encontrado.");
    if (alerta.status !== "aguardando") {
      throw new AppError("BAD_REQUEST", `Alerta já está em status '${alerta.status}'.`);
    }

    const agora = new Date().toISOString();

    // Marca o alerta da professora
    await ctx.sb.from("acesso_alertas")
      .update({ status: "encaminhado", encaminhado_em: agora, encaminhado_por: professoraId, lido: true })
      .eq("id", alerta_id).eq("escola_id", ctx.escola_id);

    // Marca também o alerta-irmão da recepção (mesmo evento + mesmo aluno)
    if (alerta.responsavel_evento_id && alerta.aluno_id) {
      await ctx.sb.from("acesso_alertas")
        .update({ status: "encaminhado", encaminhado_em: agora, encaminhado_por: professoraId })
        .eq("escola_id", ctx.escola_id)
        .eq("responsavel_evento_id", alerta.responsavel_evento_id)
        .eq("aluno_id", alerta.aluno_id)
        .eq("destinatario_tipo", "recepcao")
        .eq("status", "aguardando");
    }
    return successResponse({ ok: true });
  });

  router.on("acesso_chegadas_portaria", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { apenas_ativos } = ctx.body as Any;
    const apenasAtivos = apenas_ativos !== false;

    const hojeIso = new Date().toISOString().split("T")[0];

    const { data: alertas } = await ctx.sb.from("acesso_alertas")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .eq("destinatario_tipo", "recepcao")
      .in("tipo", ["chegada_responsavel", "tentativa_saida_solo"])
      .gte("criado_em", `${hojeIso}T00:00:00`)
      .order("criado_em", { ascending: false })
      .limit(apenasAtivos ? 50 : 500);

    const cincoMinAtras = Date.now() - 5 * 60 * 1000;
    const visiveis = apenasAtivos
      ? (alertas ?? []).filter((a: Any) => {
          if (a.status === "aguardando" || a.status === "encaminhado") return true;
          if (a.urgente && !a.lido) return true;
          if (a.status === "concluido" && a.concluido_em) {
            return new Date(a.concluido_em).getTime() > cincoMinAtras;
          }
          return false;
        })
      : (alertas ?? []);

    const alunoIds = Array.from(new Set(visiveis.map((a: Any) => a.aluno_id).filter(Boolean)));
    const eventoIds = Array.from(new Set(visiveis.map((a: Any) => a.responsavel_evento_id).filter(Boolean)));

    const alunoFotoMap = new Map<string, string>();
    if (alunoIds.length > 0) {
      const { data: faces } = await ctx.sb.from("acesso_faces")
        .select("pessoa_id, foto_url")
        .eq("escola_id", ctx.escola_id)
        .eq("pessoa_tipo", "aluno")
        .eq("ativo", true)
        .in("pessoa_id", alunoIds);
      for (const f of faces ?? []) if (f.pessoa_id && f.foto_url) alunoFotoMap.set(f.pessoa_id, f.foto_url);
    }

    const eventoFotoMap = new Map<string, string>();
    if (eventoIds.length > 0) {
      const { data: evts } = await ctx.sb.from("acesso_eventos")
        .select("id, foto_captura_url")
        .eq("escola_id", ctx.escola_id)
        .in("id", eventoIds);
      for (const e of evts ?? []) if (e.id && e.foto_captura_url) eventoFotoMap.set(e.id, e.foto_captura_url);
    }

    // Professora vinculada via alerta-irmão (mesmo responsavel_evento_id+aluno_id)
    const profMap = new Map<string, { id: string; nome: string | null }>();
    if (eventoIds.length > 0) {
      const { data: profAlertas } = await ctx.sb.from("acesso_alertas")
        .select("responsavel_evento_id, aluno_id, destinatario_id")
        .eq("escola_id", ctx.escola_id)
        .eq("destinatario_tipo", "professora")
        .eq("tipo", "chegada_responsavel")
        .in("responsavel_evento_id", eventoIds);

      const profIds = Array.from(new Set((profAlertas ?? []).map((a: Any) => a.destinatario_id).filter(Boolean)));
      const profNomeMap = new Map<string, string>();
      if (profIds.length > 0) {
        const { data: profs } = await ctx.sb.from("professoras").select("id, nome").in("id", profIds);
        for (const p of profs ?? []) profNomeMap.set(p.id, p.nome || "");
      }

      for (const pa of profAlertas ?? []) {
        if (pa.responsavel_evento_id && pa.aluno_id && pa.destinatario_id) {
          profMap.set(`${pa.responsavel_evento_id}:${pa.aluno_id}`, {
            id: pa.destinatario_id,
            nome: profNomeMap.get(pa.destinatario_id) || null,
          });
        }
      }
    }

    const enriched = visiveis.map((a: Any) => {
      const profKey = `${a.responsavel_evento_id}:${a.aluno_id}`;
      const prof = profMap.get(profKey) || null;
      return {
        alerta_id: a.id,
        tipo: a.tipo,
        pessoa_nome: a.pessoa_nome,
        aluno_id: a.aluno_id,
        aluno_nome: a.aluno_nome,
        aluno_foto_url: a.aluno_id ? (alunoFotoMap.get(a.aluno_id) || null) : null,
        pai_foto_captura_url: a.responsavel_evento_id ? (eventoFotoMap.get(a.responsavel_evento_id) || null) : null,
        turma: a.turma,
        professora_id: prof?.id || null,
        professora_nome: prof?.nome || null,
        status: a.status,
        urgente: !!a.urgente,
        lido: !!a.lido,
        mensagem: a.mensagem,
        responsavel_evento_id: a.responsavel_evento_id,
        criado_em: a.criado_em,
        encaminhado_em: a.encaminhado_em,
        concluido_em: a.concluido_em,
      };
    });

    return successResponse(enriched);
  });

  router.on("acesso_presenca_turma", authProfessora, async (ctx) => {
    const professoraId = ctx.user?.id;
    if (!professoraId) throw new AppError("AUTH_REQUIRED", "Professora ID não encontrado.");
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

    const { data: prof } = await ctx.sb.from("professoras")
      .select("serie_id").eq("id", professoraId).eq("escola_id", ctx.escola_id).single();

    if (!prof?.serie_id) return successResponse([]);

    const { data: alunos } = await ctx.sb.from("alunos")
      .select("id, nome").eq("escola_id", ctx.escola_id).eq("serie_id", prof.serie_id).eq("ativo", true);

    if (!alunos?.length) return successResponse([]);

    const hoje = new Date().toISOString().split("T")[0];
    const alunoIds = alunos.map((a: Any) => a.id);

    const { data: presenca } = await ctx.sb.from("acesso_presenca")
      .select("*").eq("escola_id", ctx.escola_id).eq("data", hoje).in("aluno_id", alunoIds);

    const presMap = new Map((presenca ?? []).map((p: Any) => [p.aluno_id, p]));
    const resultado = alunos.map((a: Any) => {
      const p = presMap.get(a.id);
      return {
        aluno_id: a.id,
        aluno_nome: a.nome,
        status: p?.status || "ausente",
        hora_entrada: p?.hora_entrada || null,
        hora_saida: p?.hora_saida || null,
        entrada_metodo: p?.entrada_metodo || null,
        saida_metodo: p?.saida_metodo || null,
      };
    });

    return successResponse(resultado);
  });
}
