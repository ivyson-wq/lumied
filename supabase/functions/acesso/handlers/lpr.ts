// Acesso — LPR (License Plate Recognition): controle veicular
//   • Cadastro de placas (gerente)
//   • Câmeras + ROI + relatório (gerente)
//   • Portal família (solicitar/listar placa próprias)
//   • Aprovação/rejeição de solicitações (gerente)
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import {
  type Any,
  authGerenteOrSecretaria,
  normalizarPlaca,
  syncLprPlatesToBridge,
  syncCamerasToBridge,
  bridgeDispatchEphemeral,
  lprGetFamiliaByEmail,
} from "../_lib.ts";

export function register(router: Router) {
  // ═══════════════════════════════════════════════════════════════
  //  Cadastro de placas (gerente/secretaria)
  // ═══════════════════════════════════════════════════════════════

  router.on("acesso_lpr_placas_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb.from("acesso_lpr_placas")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  });

  router.on("acesso_lpr_placa_save", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const b = ctx.body as Any;
    const placa = normalizarPlaca(b.placa);
    if (!placa || placa.length < 4) throw new AppError("VALIDATION_FAILED", "placa inválida");
    const ownerTipos = ["familia","funcionario","aluno","visitante","outro"];
    if (!ownerTipos.includes(b.owner_tipo)) throw new AppError("VALIDATION_FAILED", "owner_tipo inválido");

    const row: Any = {
      placa,
      owner_tipo: b.owner_tipo,
      owner_id: b.owner_id || null,
      apelido: b.apelido || null,
      ativo: b.ativo !== false,
      validade_inicio: b.validade_inicio || null,
      validade_fim: b.validade_fim || null,
      janela_horaria: b.janela_horaria || null,
      observacao: b.observacao || null,
    };

    let saved: Any;
    if (b.id) {
      const { data, error } = await ctx.sb.from("acesso_lpr_placas")
        .update(row).eq("id", b.id).eq("escola_id", ctx.escola_id).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      saved = data;
    } else {
      const { data, error } = await ctx.sb.from("acesso_lpr_placas")
        .insert({ ...row, escola_id: ctx.escola_id, criado_por: ctx.user_id || null }).select().single();
      if (error) {
        if (error.code === "23505") throw new AppError("CONFLICT", "Placa já cadastrada nessa escola.");
        throw new AppError("BAD_REQUEST", error.message);
      }
      saved = data;
    }

    syncLprPlatesToBridge(ctx.sb, ctx.escola_id).catch(() => {});
    return successResponse(saved);
  });

  router.on("acesso_lpr_placa_delete", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório");
    await ctx.sb.from("acesso_lpr_placas").delete().eq("id", id).eq("escola_id", ctx.escola_id);
    syncLprPlatesToBridge(ctx.sb, ctx.escola_id).catch(() => {});
    return successResponse({ ok: true });
  });

  router.on("acesso_lpr_eventos_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const b = ctx.body as Any;
    const limit = Math.min(Number(b?.limit ?? 50), 200);
    let q = ctx.sb.from("acesso_lpr_eventos")
      .select("id, placa_lida, placa_id, confidence, autorizado, motivo, acao_tomada, ts")
      .eq("escola_id", ctx.escola_id)
      .order("ts", { ascending: false })
      .limit(limit);
    if (b?.apenas_nao_autorizadas === true) q = q.eq("autorizado", false);
    const { data: eventos } = await q;

    // Enriquece com info da placa (N+1 mas N pequeno)
    const placaIds = Array.from(new Set((eventos ?? []).map((e: Any) => e.placa_id).filter(Boolean)));
    const placasMap: Record<string, Any> = {};
    if (placaIds.length) {
      const { data: placas } = await ctx.sb.from("acesso_lpr_placas")
        .select("id, apelido, owner_tipo, owner_id")
        .in("id", placaIds);
      for (const p of (placas ?? [])) placasMap[p.id] = p;
    }
    const enriched = (eventos ?? []).map((e: Any) => ({
      ...e,
      placa_info: e.placa_id ? placasMap[e.placa_id] || null : null,
    }));
    return successResponse(enriched);
  });

  router.on("acesso_lpr_sync_now", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb.from("acesso_lpr_placas")
      .select("id, placa, ativo, validade_inicio, validade_fim, janela_horaria, apelido")
      .eq("escola_id", ctx.escola_id);
    const plates = data ?? [];
    const r = await bridgeDispatchEphemeral(ctx.escola_id, "lpr_sync", { plates }, 5000);
    return successResponse({ ok: r.ok, count: plates.length, error: r.error, body: r.body });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Câmeras + ROI + relatório (Fase 3)
  // ═══════════════════════════════════════════════════════════════

  router.on("acesso_lpr_cameras_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb.from("acesso_lpr_cameras")
      .select("*").eq("escola_id", ctx.escola_id).order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  });

  router.on("acesso_lpr_camera_save", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const b = ctx.body as Any;
    if (!b.nome || !b.rtsp_url) throw new AppError("VALIDATION_FAILED", "nome e rtsp_url são obrigatórios.");
    const row: Any = {
      nome: b.nome,
      rtsp_url: b.rtsp_url,
      alpr_url: b.alpr_url || "http://localhost:32168/v1/vision/alpr",
      scan_interval_ms: Math.max(500, Math.min(Number(b.scan_interval_ms || 2000), 30000)),
      confidence_min: Math.max(0, Math.min(Number(b.confidence_min || 0.85), 1)),
      gate_webhook_url: b.gate_webhook_url || null,
      gate_webhook_token: b.gate_webhook_token || null,
      gpio_pin: (b.gpio_pin === null || b.gpio_pin === undefined || b.gpio_pin === "") ? null : Number(b.gpio_pin),
      gpio_pulse_ms: Math.max(50, Math.min(Number(b.gpio_pulse_ms || 500), 5000)),
      ativa: b.ativa !== false,
    };
    let saved: Any;
    if (b.id) {
      const { data, error } = await ctx.sb.from("acesso_lpr_cameras")
        .update(row).eq("id", b.id).eq("escola_id", ctx.escola_id).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      saved = data;
    } else {
      const { data, error } = await ctx.sb.from("acesso_lpr_cameras")
        .insert({ ...row, escola_id: ctx.escola_id }).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      saved = data;
    }
    syncCamerasToBridge(ctx.sb, ctx.escola_id).catch(() => {});
    return successResponse(saved);
  });

  router.on("acesso_lpr_camera_delete", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório");
    await ctx.sb.from("acesso_lpr_cameras").delete().eq("id", id).eq("escola_id", ctx.escola_id);
    syncCamerasToBridge(ctx.sb, ctx.escola_id).catch(() => {});
    return successResponse({ ok: true });
  });

  // Salva apenas o polygon ROI (chamado pelo editor canvas)
  router.on("acesso_lpr_camera_roi_save", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id, roi_polygon } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório");
    let poly: Any = null;
    if (roi_polygon !== null && roi_polygon !== undefined) {
      if (!Array.isArray(roi_polygon)) throw new AppError("VALIDATION_FAILED", "roi_polygon deve ser array");
      if (roi_polygon.length > 0 && roi_polygon.length < 3) throw new AppError("VALIDATION_FAILED", "polygon precisa 0 ou ≥3 pontos");
      poly = roi_polygon.map((p: Any) => ({
        x: Math.max(0, Math.min(Number(p.x), 1)),
        y: Math.max(0, Math.min(Number(p.y), 1)),
      }));
      if (poly.length === 0) poly = null;
    }
    const { error } = await ctx.sb.from("acesso_lpr_cameras")
      .update({ roi_polygon: poly }).eq("id", id).eq("escola_id", ctx.escola_id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
    syncCamerasToBridge(ctx.sb, ctx.escola_id).catch(() => {});
    return successResponse({ ok: true });
  });

  // Pede um snapshot fresco da câmera (pra editor ROI)
  router.on("acesso_lpr_camera_snapshot", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { camera_id } = ctx.body as Any;
    const r = await bridgeDispatchEphemeral(ctx.escola_id, "lpr_snapshot", { camera_id }, 12000);
    if (!r.ok) return successResponse({ ok: false, error: r.error || "Falha no snapshot" });
    const body: Any = r.body || {};
    return successResponse({
      ok: !!body.jpeg_b64,
      jpeg_b64: body.jpeg_b64 || null,
      width: body.width || null,
      height: body.height || null,
      error: body.error || null,
    });
  });

  router.on("acesso_lpr_relatorio", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const dias = Math.max(1, Math.min(Number((ctx.body as Any)?.dias || 30), 90));
    const { data } = await ctx.sb.rpc("lpr_relatorio_diario", { p_escola: ctx.escola_id, p_dias: dias });
    return successResponse(data ?? []);
  });

  router.on("acesso_lpr_evento_foto_url", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { evento_id } = ctx.body as Any;
    if (!evento_id) throw new AppError("VALIDATION_FAILED", "evento_id obrigatório");
    const { data: evt } = await ctx.sb.from("acesso_lpr_eventos")
      .select("foto_path, escola_id")
      .eq("id", evento_id).eq("escola_id", ctx.escola_id).maybeSingle();
    if (!evt || !evt.foto_path) return successResponse({ url: null });
    const { data: signed } = await ctx.sb.storage.from("lpr-fotos").createSignedUrl(evt.foto_path, 60 * 10);
    return successResponse({ url: signed?.signedUrl || null });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Portal família — minhas placas + solicitação de cadastro
  // ═══════════════════════════════════════════════════════════════

  router.on("acesso_lpr_minhas_placas", async (ctx) => {
    const { email } = ctx.body as Any;
    if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
    const familia = await lprGetFamiliaByEmail(ctx, email);
    if (!familia) return successResponse({ placas: [], solicitacoes: [] });

    const [{ data: placas }, { data: solicitacoes }] = await Promise.all([
      ctx.sb.from("acesso_lpr_placas")
        .select("id, placa, apelido, ativo, validade_inicio, validade_fim, criado_em")
        .eq("escola_id", familia.escola_id)
        .eq("owner_tipo", "familia").eq("owner_cpf", familia.cpf)
        .order("criado_em", { ascending: false }),
      ctx.sb.from("acesso_lpr_solicitacoes")
        .select("id, placa, apelido, status, motivo_rejeicao, observacao, foto_path, criado_em")
        .eq("escola_id", familia.escola_id).eq("familia_cpf", familia.cpf)
        .order("criado_em", { ascending: false }).limit(20),
    ]);
    return successResponse({ placas: placas ?? [], solicitacoes: solicitacoes ?? [] });
  });

  router.on("acesso_lpr_solicitar_placa", async (ctx) => {
    const { email, placa: placaRaw, apelido, observacao, foto_b64 } = ctx.body as Any;
    if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
    const familia = await lprGetFamiliaByEmail(ctx, email);
    if (!familia) throw new AppError("NOT_FOUND", "Família não encontrada.");

    const placa = normalizarPlaca(placaRaw);
    if (placa.length < 4) throw new AppError("VALIDATION_FAILED", "Placa inválida.");

    const { data: existente } = await ctx.sb.from("acesso_lpr_placas")
      .select("id").eq("escola_id", familia.escola_id).eq("placa", placa).maybeSingle();
    if (existente) throw new AppError("CONFLICT", "Essa placa já está cadastrada na escola.");

    const { data: jaPendente } = await ctx.sb.from("acesso_lpr_solicitacoes")
      .select("id").eq("escola_id", familia.escola_id).eq("familia_cpf", familia.cpf)
      .eq("placa", placa).eq("status", "pendente").maybeSingle();
    if (jaPendente) throw new AppError("CONFLICT", "Você já tem uma solicitação pendente pra essa placa.");

    const { data: sol, error: insErr } = await ctx.sb.from("acesso_lpr_solicitacoes").insert({
      escola_id: familia.escola_id,
      familia_cpf: familia.cpf,
      familia_email: familia.email,
      familia_nome: familia.nome_responsavel,
      placa,
      apelido: apelido || null,
      observacao: observacao || null,
    }).select().single();
    if (insErr || !sol) throw new AppError("BAD_REQUEST", insErr?.message || "Erro ao criar solicitação.");

    // Upload foto (best-effort)
    if (foto_b64 && typeof foto_b64 === "string" && foto_b64.length < 800_000) {
      try {
        const cleanB64 = foto_b64.replace(/^data:image\/\w+;base64,/, "");
        const raw = atob(cleanB64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const path = `${familia.escola_id}/solicitacoes/${sol.id}.jpg`;
        const { error: upErr } = await ctx.sb.storage.from("lpr-fotos").upload(path, bytes, {
          contentType: "image/jpeg", upsert: true,
        });
        if (!upErr) {
          await ctx.sb.from("acesso_lpr_solicitacoes").update({ foto_path: path }).eq("id", sol.id);
          sol.foto_path = path;
        }
      } catch (e) {
        console.warn("[lpr] foto solicitação falhou:", String(e));
      }
    }

    return successResponse(sol);
  });

  router.on("acesso_lpr_minha_solicitacao_foto", async (ctx) => {
    const { email, solicitacao_id } = ctx.body as Any;
    if (!email || !solicitacao_id) throw new AppError("VALIDATION_FAILED", "email e solicitacao_id obrigatórios.");
    const familia = await lprGetFamiliaByEmail(ctx, email);
    if (!familia) return successResponse({ url: null });
    const { data: sol } = await ctx.sb.from("acesso_lpr_solicitacoes")
      .select("foto_path").eq("id", solicitacao_id)
      .eq("escola_id", familia.escola_id).eq("familia_cpf", familia.cpf).maybeSingle();
    if (!sol?.foto_path) return successResponse({ url: null });
    const { data: signed } = await ctx.sb.storage.from("lpr-fotos").createSignedUrl(sol.foto_path, 60 * 10);
    return successResponse({ url: signed?.signedUrl || null });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Gerente — lista/aprova/rejeita solicitações
  // ═══════════════════════════════════════════════════════════════

  router.on("acesso_lpr_solicitacoes_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { status_filter } = ctx.body as Any;
    let q = ctx.sb.from("acesso_lpr_solicitacoes")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .order("criado_em", { ascending: false }).limit(100);
    if (status_filter && ["pendente","aprovada","rejeitada"].includes(status_filter)) {
      q = q.eq("status", status_filter);
    }
    const { data: sols } = await q;
    const enriched = (sols ?? []).map((s: Any) => ({
      ...s,
      familia: { responsavel_nome: s.familia_nome, email: s.familia_email, cpf: s.familia_cpf },
    }));
    return successResponse(enriched);
  });

  router.on("acesso_lpr_solicitacao_foto_url", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { solicitacao_id } = ctx.body as Any;
    if (!solicitacao_id) throw new AppError("VALIDATION_FAILED", "solicitacao_id obrigatório.");
    const { data: sol } = await ctx.sb.from("acesso_lpr_solicitacoes")
      .select("foto_path").eq("id", solicitacao_id).eq("escola_id", ctx.escola_id).maybeSingle();
    if (!sol?.foto_path) return successResponse({ url: null });
    const { data: signed } = await ctx.sb.storage.from("lpr-fotos").createSignedUrl(sol.foto_path, 60 * 10);
    return successResponse({ url: signed?.signedUrl || null });
  });

  router.on("acesso_lpr_solicitacao_aprovar", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { solicitacao_id, validade_inicio, validade_fim } = ctx.body as Any;
    if (!solicitacao_id) throw new AppError("VALIDATION_FAILED", "solicitacao_id obrigatório.");

    const { data: sol } = await ctx.sb.from("acesso_lpr_solicitacoes")
      .select("*").eq("id", solicitacao_id).eq("escola_id", ctx.escola_id).maybeSingle();
    if (!sol) throw new AppError("NOT_FOUND", "Solicitação não encontrada.");
    if (sol.status !== "pendente") throw new AppError("CONFLICT", `Solicitação já está ${sol.status}.`);

    const { data: placa, error: placaErr } = await ctx.sb.from("acesso_lpr_placas").insert({
      escola_id: ctx.escola_id,
      placa: sol.placa,
      owner_tipo: "familia",
      owner_cpf: sol.familia_cpf,
      apelido: sol.apelido,
      ativo: true,
      validade_inicio: validade_inicio || null,
      validade_fim: validade_fim || null,
      observacao: sol.observacao,
      criado_por: ctx.user_id || null,
    }).select().single();
    if (placaErr) {
      if (placaErr.code === "23505") throw new AppError("CONFLICT", "Placa já cadastrada.");
      throw new AppError("BAD_REQUEST", placaErr.message);
    }

    await ctx.sb.from("acesso_lpr_solicitacoes").update({
      status: "aprovada",
      placa_id: placa.id,
      aprovada_por: ctx.user_id || null,
      aprovada_em: new Date().toISOString(),
    }).eq("id", solicitacao_id);

    syncLprPlatesToBridge(ctx.sb, ctx.escola_id).catch(() => {});
    return successResponse({ ok: true, placa });
  });

  router.on("acesso_lpr_solicitacao_rejeitar", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { solicitacao_id, motivo } = ctx.body as Any;
    if (!solicitacao_id) throw new AppError("VALIDATION_FAILED", "solicitacao_id obrigatório.");
    await ctx.sb.from("acesso_lpr_solicitacoes").update({
      status: "rejeitada",
      motivo_rejeicao: motivo || "Não informado",
      aprovada_por: ctx.user_id || null,
      aprovada_em: new Date().toISOString(),
    }).eq("id", solicitacao_id).eq("escola_id", ctx.escola_id).eq("status", "pendente");
    return successResponse({ ok: true });
  });
}
