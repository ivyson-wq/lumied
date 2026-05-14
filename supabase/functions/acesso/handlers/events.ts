// Acesso — callback do iDFace (entrada/saída) + queries de eventos/alertas/dashboard/config
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import { type Any, authGerenteOrSecretaria, getConfig } from "../_lib.ts";

export function register(router: Router) {
  // ═══════════════════════════════════════════════════════════════
  //  DEVICE CALLBACK
  //  Auth:
  //    (a) IP origem registrado em acesso_dispositivos (modo direto)
  //    (b) Bearer = BRIDGE_GATEWAY_SECRET + escola_id no body (via gateway)
  // ═══════════════════════════════════════════════════════════════
  router.on("acesso_evento_callback", async (ctx) => {
    const body = ctx.body as Any;

    // ── Branch LPR (controle de acesso veicular) ─────────────────
    if (body.kind === "lpr") {
      const authHeader = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
      const bridgeSecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const fromBridge = !!(bridgeSecret && bearerMatch && bearerMatch[1].trim() === bridgeSecret);
      const lprEscolaId = body.escola_id;
      if (!fromBridge || !lprEscolaId) {
        throw new AppError("FORBIDDEN", "Evento LPR rejeitado: precisa vir do bridge gateway.");
      }
      const placa = String(body.placa_lida || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (!placa) throw new AppError("VALIDATION_FAILED", "placa_lida vazia");
      const motivosValidos = ["autorizado","nao_cadastrada","fora_validade","fora_horario","inativa","baixa_confianca"];
      const motivo = motivosValidos.includes(body.motivo) ? body.motivo : "nao_cadastrada";

      let fotoPath: string | null = null;
      if (body.foto_b64 && typeof body.foto_b64 === "string" && body.foto_b64.length < 600_000) {
        try {
          const raw = atob(body.foto_b64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const path = `${lprEscolaId}/eventos/${Date.now()}_${placa}.jpg`;
          const { error: upErr } = await ctx.sb.storage.from("lpr-fotos").upload(path, bytes, {
            contentType: "image/jpeg", upsert: false,
          });
          if (!upErr) fotoPath = path;
          else console.warn("[lpr] upload foto falhou:", upErr.message);
        } catch (e) {
          console.warn("[lpr] decode foto_b64 falhou:", String(e));
        }
      }

      const cameraId = (typeof body.camera_id === "string" && body.camera_id.length === 36) ? body.camera_id : null;

      await ctx.sb.from("acesso_lpr_eventos").insert({
        escola_id: lprEscolaId,
        camera_id: cameraId,
        placa_lida: placa,
        placa_id: body.placa_id || null,
        confidence: body.confidence != null ? Number(body.confidence) : null,
        autorizado: !!body.autorizado,
        motivo,
        acao_tomada: body.autorizado ? "log_apenas" : null,
        foto_path: fotoPath,
      });
      return successResponse({ ok: true });
    }

    const { user_id, device_id, timestamp: _ts, method, card_value, direction, confidence, photo, escola_id: bodyEscolaId } = body;

    // Bridge-authenticated path
    const authHeader = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
    const bridgeSecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const fromBridge = !!(bridgeSecret && bearerMatch && bearerMatch[1].trim() === bridgeSecret);

    let dispositivo: Any = null;

    if (fromBridge && bodyEscolaId) {
      if (device_id) {
        const { data } = await ctx.sb.from("acesso_dispositivos")
          .select("*").eq("id", device_id).eq("escola_id", bodyEscolaId).eq("ativo", true).maybeSingle();
        dispositivo = data;
      }
      if (!dispositivo) {
        console.warn(`[acesso_evento_callback] Bridge event sem device_id válido. escola=${bodyEscolaId} device_id=${device_id}`);
        throw new AppError("FORBIDDEN", "Evento bridge: dispositivo não encontrado nessa escola.");
      }
    } else {
      // Direct mode: device IP must match a registered device
      const sourceIp = ctx.ip;
      const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("ativo", true);
      if (device_id) {
        dispositivo = (devices ?? []).find((d: Any) => d.id === device_id);
      }
      if (!dispositivo) {
        dispositivo = (devices ?? []).find((d: Any) => d.ip === sourceIp);
      }
      if (!dispositivo) {
        console.warn(`[acesso_evento_callback] Rejeitado: origem não reconhecida. sourceIp=${sourceIp} device_id=${device_id}`);
        throw new AppError("FORBIDDEN", "Evento rejeitado: dispositivo não registrado.");
      }
    }

    let direcao = direction || "entrada";
    if (dispositivo) {
      if (dispositivo.tipo === "catraca_entrada" || dispositivo.tipo === "terminal_entrada") direcao = "entrada";
      else if (dispositivo.tipo === "catraca_saida" || dispositivo.tipo === "terminal_saida") direcao = "saida";
    }

    let pessoa: Any = null;

    if (method === "card" && card_value) {
      const { data } = await ctx.sb.from("acesso_rfid").select("*").eq("card_uid", String(card_value)).eq("ativo", true).eq("escola_id", dispositivo.escola_id).single();
      if (data) pessoa = { tipo: data.pessoa_tipo, id: data.pessoa_id, nome: data.pessoa_nome };
    } else if (user_id) {
      const { data } = await ctx.sb.from("acesso_faces").select("*").eq("device_user_id", Number(user_id)).eq("ativo", true).eq("escola_id", dispositivo.escola_id).single();
      if (data) pessoa = { tipo: data.pessoa_tipo, id: data.pessoa_id, nome: data.pessoa_nome };
    }

    let fotoCapturaUrl: string | null = null;
    if (photo) {
      try {
        const raw = atob(photo.replace(/^data:image\/\w+;base64,/, ""));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const path = `acesso/capturas/${Date.now()}_${user_id || "unknown"}.jpg`;
        const { error: upErr } = await ctx.sb.storage.from("wa-documentos").upload(path, bytes, {
          contentType: "image/jpeg", upsert: true,
        });
        if (!upErr) {
          const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
          fotoCapturaUrl = signed?.signedUrl || null;
        }
      } catch (e) {
        console.error("Erro ao salvar foto captura:", e);
      }
    }

    const eventoEscolaId = dispositivo.escola_id;
    if (!eventoEscolaId) {
      console.warn(`[acesso_evento_callback] Dispositivo ${dispositivo.id} sem escola_id.`);
      throw new AppError("BAD_REQUEST", "Dispositivo sem escola associada.");
    }

    // Unknown person
    if (!pessoa) {
      const { data: evento } = await ctx.sb.from("acesso_eventos").insert({
        escola_id: eventoEscolaId,
        dispositivo_id: dispositivo?.id || null,
        pessoa_tipo: "desconhecido",
        pessoa_id: "00000000-0000-0000-0000-000000000000",
        pessoa_nome: "Desconhecido",
        metodo: method === "card" ? "rfid" : "face",
        direcao,
        foto_captura_url: fotoCapturaUrl,
        confianca: confidence || null,
        card_uid: card_value ? String(card_value) : null,
      }).select().single();

      const alertaDesconhecido = await getConfig(ctx.sb, "alerta_desconhecido");
      if (alertaDesconhecido !== "false") {
        await ctx.sb.from("acesso_alertas").insert({
          escola_id: eventoEscolaId,
          evento_id: evento?.id,
          tipo: "desconhecido",
          pessoa_nome: "Pessoa não identificada",
          mensagem: `Pessoa não identificada detectada no ${dispositivo?.nome || "dispositivo desconhecido"} (${direcao}).`,
          destinatario_tipo: "recepcao",
        });
      }
      return successResponse({ ok: true, recognized: false });
    }

    // ── BLOQUEIO DE SAÍDA SOLO ──────────────────────────────
    // Aluno só pode sair se houver alerta 'chegada_responsavel' aberto hoje.
    let saidaNegada = false;
    if (pessoa.tipo === "aluno" && direcao === "saida") {
      const hojeIso = new Date().toISOString().split("T")[0];
      const { data: alertaAberto } = await ctx.sb.from("acesso_alertas")
        .select("id")
        .eq("escola_id", eventoEscolaId)
        .eq("aluno_id", pessoa.id)
        .eq("tipo", "chegada_responsavel")
        .in("status", ["aguardando", "encaminhado"])
        .gte("criado_em", `${hojeIso}T00:00:00`)
        .limit(1)
        .maybeSingle();
      if (!alertaAberto) {
        saidaNegada = true;
        direcao = "saida_negada";
      }
    }

    const metodo = method === "card" ? "rfid" : "face";
    const { data: evento } = await ctx.sb.from("acesso_eventos").insert({
      escola_id: eventoEscolaId,
      dispositivo_id: dispositivo?.id || null,
      pessoa_tipo: pessoa.tipo,
      pessoa_id: pessoa.id,
      pessoa_nome: pessoa.nome,
      metodo, direcao,
      foto_captura_url: fotoCapturaUrl,
      confianca: confidence || null,
      card_uid: card_value ? String(card_value) : null,
    }).select().single();

    if (saidaNegada) {
      // Alerta urgente interno (NÃO notifica família — feedback_incidentes_internos)
      await ctx.sb.from("acesso_alertas").insert({
        escola_id: eventoEscolaId,
        evento_id: evento?.id,
        tipo: "tentativa_saida_solo",
        pessoa_nome: pessoa.nome,
        aluno_id: pessoa.id,
        aluno_nome: pessoa.nome,
        urgente: true,
        mensagem: `${pessoa.nome} tentou sair sem responsável presente.`,
        destinatario_tipo: "recepcao",
      });
      // Resposta síncrona pro iDFace: nega + mensagem (sem acentos, max 64 chars)
      return new Response(JSON.stringify({
        result: false,
        message: "Aguardando responsavel",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ── ALUNO: atualiza presença ──────────────────────────────
    if (pessoa.tipo === "aluno") {
      const hoje = new Date().toISOString().split("T")[0];
      const agora = new Date().toTimeString().split(" ")[0];

      if (direcao === "entrada") {
        const { data: existing } = await ctx.sb.from("acesso_presenca")
          .select("id").eq("escola_id", eventoEscolaId).eq("aluno_id", pessoa.id).eq("data", hoje).maybeSingle();

        if (existing) {
          await ctx.sb.from("acesso_presenca").update({
            hora_entrada: agora, entrada_metodo: metodo, entrada_evento_id: evento?.id, status: "presente",
          }).eq("id", existing.id).eq("escola_id", eventoEscolaId);
        } else {
          await ctx.sb.from("acesso_presenca").insert({
            escola_id: eventoEscolaId, aluno_id: pessoa.id, aluno_nome: pessoa.nome, data: hoje,
            hora_entrada: agora, entrada_metodo: metodo, entrada_evento_id: evento?.id, status: "presente",
          });
        }

        await ctx.sb.from("acesso_alertas").insert({
          escola_id: eventoEscolaId,
          evento_id: evento?.id,
          tipo: "entrada_aluno",
          pessoa_nome: pessoa.nome,
          aluno_nome: pessoa.nome,
          mensagem: `${pessoa.nome} chegou na escola via ${metodo}.`,
          destinatario_tipo: "recepcao",
        });
      } else {
        const { data: existing } = await ctx.sb.from("acesso_presenca")
          .select("id").eq("escola_id", eventoEscolaId).eq("aluno_id", pessoa.id).eq("data", hoje).maybeSingle();

        if (existing) {
          await ctx.sb.from("acesso_presenca").update({
            hora_saida: agora, saida_metodo: metodo, saida_evento_id: evento?.id, status: "saiu",
          }).eq("id", existing.id).eq("escola_id", eventoEscolaId);
        } else {
          await ctx.sb.from("acesso_presenca").insert({
            escola_id: eventoEscolaId, aluno_id: pessoa.id, aluno_nome: pessoa.nome, data: hoje,
            hora_saida: agora, saida_metodo: metodo, saida_evento_id: evento?.id, status: "saiu",
          });
        }

        await ctx.sb.from("acesso_alertas").insert({
          escola_id: eventoEscolaId,
          evento_id: evento?.id,
          tipo: "saida_aluno",
          pessoa_nome: pessoa.nome,
          aluno_id: pessoa.id,
          aluno_nome: pessoa.nome,
          mensagem: `${pessoa.nome} saiu da escola via ${metodo}.`,
          destinatario_tipo: "recepcao",
        });

        // Auto-fecha alertas 'chegada_responsavel' abertos pra esse aluno hoje
        await ctx.sb.from("acesso_alertas")
          .update({
            status: "concluido",
            concluido_em: new Date().toISOString(),
            concluido_evento_id: evento?.id,
          })
          .eq("escola_id", eventoEscolaId)
          .eq("aluno_id", pessoa.id)
          .eq("tipo", "chegada_responsavel")
          .in("status", ["aguardando", "encaminhado"])
          .gte("criado_em", `${hoje}T00:00:00`);
      }
    }

    // ── RESPONSAVEL: confere permissões + alerta professora ──────
    if (pessoa.tipo === "responsavel") {
      const { data: perms } = await ctx.sb.from("acesso_permissoes_retirada")
        .select("*")
        .eq("escola_id", eventoEscolaId)
        .eq("responsavel_id", pessoa.id)
        .eq("autorizado", true);

      const hoje = new Date().toISOString().split("T")[0];
      const validPerms = (perms ?? []).filter((p: Any) => !p.validade || p.validade >= hoje);

      if (validPerms.length === 0) {
        const alertaNaoAut = await getConfig(ctx.sb, "alerta_nao_autorizado");
        if (alertaNaoAut !== "false") {
          await ctx.sb.from("acesso_alertas").insert({
            escola_id: eventoEscolaId,
            evento_id: evento?.id,
            tipo: "nao_autorizado",
            pessoa_nome: pessoa.nome,
            mensagem: `${pessoa.nome} tentou acessar mas NÃO está autorizado(a) a retirar nenhum aluno.`,
            destinatario_tipo: "todos",
          });
        }
      } else {
        for (const perm of validPerms) {
          const { data: aluno } = await ctx.sb.from("alunos")
            .select("id, nome, serie, serie_id")
            .eq("id", perm.aluno_id)
            .eq("escola_id", eventoEscolaId)
            .maybeSingle();

          const turma = aluno?.serie || "Sem turma";

          let professoraId: string | null = null;
          if (aluno?.serie_id) {
            const { data: prof } = await ctx.sb.from("professoras")
              .select("id, nome")
              .eq("serie_id", aluno.serie_id)
              .eq("ativo", true)
              .maybeSingle();
            professoraId = prof?.id || null;
          }

          await ctx.sb.from("acesso_alertas").insert({
            escola_id: eventoEscolaId,
            evento_id: evento?.id,
            responsavel_evento_id: evento?.id,
            aluno_id: perm.aluno_id,
            tipo: "chegada_responsavel",
            pessoa_nome: pessoa.nome,
            aluno_nome: perm.aluno_nome,
            turma,
            mensagem: `${pessoa.nome} (${perm.parentesco || "responsavel"}) chegou para buscar ${perm.aluno_nome} (${turma}).`,
            destinatario_tipo: "recepcao",
            status: "aguardando",
          });

          if (professoraId) {
            await ctx.sb.from("acesso_alertas").insert({
              escola_id: eventoEscolaId,
              evento_id: evento?.id,
              responsavel_evento_id: evento?.id,
              aluno_id: perm.aluno_id,
              tipo: "chegada_responsavel",
              pessoa_nome: pessoa.nome,
              aluno_nome: perm.aluno_nome,
              turma,
              mensagem: `${pessoa.nome} (${perm.parentesco || "responsavel"}) chegou para buscar ${perm.aluno_nome}.`,
              destinatario_tipo: "professora",
              destinatario_id: professoraId,
              status: "aguardando",
            });
          }
        }
      }
    }

    return successResponse({ ok: true, recognized: true, pessoa_nome: pessoa.nome, direcao });
  });

  // ═══════════════════════════════════════════════════════════════
  //  EVENT QUERIES (gerente/secretaria)
  // ═══════════════════════════════════════════════════════════════

  router.on("acesso_eventos_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data_inicio, data_fim, pessoa_tipo, direcao, limit: lim } = ctx.body as Any;
    let q = ctx.sb.from("acesso_eventos").select("*, acesso_dispositivos(nome, localizacao)")
      .eq("escola_id", ctx.escola_id)
      .order("criado_em", { ascending: false })
      .limit(lim || 100);
    if (pessoa_tipo) q = q.eq("pessoa_tipo", pessoa_tipo);
    if (direcao) q = q.eq("direcao", direcao);
    if (data_inicio) q = q.gte("criado_em", `${data_inicio}T00:00:00`);
    if (data_fim) q = q.lte("criado_em", `${data_fim}T23:59:59`);
    const { data } = await q;
    return successResponse(data ?? []);
  });

  router.on("acesso_presenca_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data: dataFiltro, turma, status } = ctx.body as Any;
    const hoje = dataFiltro || new Date().toISOString().split("T")[0];

    let q = ctx.sb.from("acesso_presenca").select("*").eq("escola_id", ctx.escola_id).eq("data", hoje).order("aluno_nome");
    if (status) q = q.eq("status", status);
    const { data } = await q;

    if (turma && data) {
      const alunoIds = data.map((p: Any) => p.aluno_id);
      if (alunoIds.length > 0) {
        const { data: alunos } = await ctx.sb.from("alunos").select("id, serie").eq("escola_id", ctx.escola_id).in("id", alunoIds);
        const alunoSerie = new Map((alunos ?? []).map((a: Any) => [a.id, a.serie]));
        const filtered = data.filter((p: Any) => alunoSerie.get(p.aluno_id) === turma);
        return successResponse(filtered);
      }
    }
    return successResponse(data ?? []);
  });

  router.on("acesso_alertas_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { lido, limit: lim } = ctx.body as Any;
    let q = ctx.sb.from("acesso_alertas").select("*")
      .eq("escola_id", ctx.escola_id)
      .order("lido", { ascending: true })
      .order("criado_em", { ascending: false })
      .limit(lim || 50);
    if (lido !== undefined && lido !== null) q = q.eq("lido", lido);
    const { data } = await q;
    return successResponse(data ?? []);
  });

  router.on("acesso_alerta_marcar_lido", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id, ids } = ctx.body as Any;
    if (ids && Array.isArray(ids)) {
      await ctx.sb.from("acesso_alertas").update({ lido: true }).in("id", ids).eq("escola_id", ctx.escola_id);
    } else if (id) {
      await ctx.sb.from("acesso_alertas").update({ lido: true }).eq("id", id).eq("escola_id", ctx.escola_id);
    } else {
      throw new AppError("VALIDATION_FAILED", "id ou ids obrigatório.");
    }
    return successResponse({ ok: true });
  });

  router.on("acesso_dashboard", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const hoje = new Date().toISOString().split("T")[0];

    const { data: presentes } = await ctx.sb.from("acesso_presenca")
      .select("id", { count: "exact" }).eq("escola_id", ctx.escola_id).eq("data", hoje).eq("status", "presente");
    const { data: sairam } = await ctx.sb.from("acesso_presenca")
      .select("id", { count: "exact" }).eq("escola_id", ctx.escola_id).eq("data", hoje).eq("status", "saiu");
    const { count: totalAlunos } = await ctx.sb.from("alunos")
      .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true);
    const { count: alertasNaoLidos } = await ctx.sb.from("acesso_alertas")
      .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("lido", false);
    const { count: eventosHoje } = await ctx.sb.from("acesso_eventos")
      .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).gte("criado_em", `${hoje}T00:00:00`);

    // Heartbeat dos últimos 2min
    const twoMinAgo = new Date(Date.now() - 120000).toISOString();
    const { count: devicesOnline } = await ctx.sb.from("acesso_dispositivos")
      .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true).gte("ultimo_heartbeat", twoMinAgo);
    const { count: devicesTotal } = await ctx.sb.from("acesso_dispositivos")
      .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true);

    return successResponse({
      presentes: presentes?.length ?? 0,
      sairam: sairam?.length ?? 0,
      ausentes: (totalAlunos ?? 0) - (presentes?.length ?? 0) - (sairam?.length ?? 0),
      total_alunos: totalAlunos ?? 0,
      alertas_nao_lidos: alertasNaoLidos ?? 0,
      eventos_hoje: eventosHoje ?? 0,
      devices_online: devicesOnline ?? 0,
      devices_total: devicesTotal ?? 0,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  CONFIG CRUD
  // ═══════════════════════════════════════════════════════════════

  router.on("acesso_config_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb.from("acesso_config").select("*").eq("escola_id", ctx.escola_id).order("chave");
    return successResponse(data ?? []);
  });

  router.on("acesso_config_save", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { chave, valor, descricao } = ctx.body as Any;
    if (!chave || valor === undefined) throw new AppError("VALIDATION_FAILED", "chave e valor são obrigatórios.");
    const { data, error } = await ctx.sb.from("acesso_config").upsert(
      { escola_id: ctx.escola_id, chave, valor: String(valor), descricao: descricao || null },
      { onConflict: "escola_id,chave" }
    ).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse(data);
  });
}
