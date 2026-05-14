// Acesso — cadastro de faces (público + gerente), tokens, link email/whatsapp,
// pendências, status de responsáveis e setup_checklist agregado
import { Router, authGerente, successResponse, AppError, resolveEscolaId } from "../../_shared/mod.ts";
import {
  type Any,
  authGerenteOrSecretaria,
  uuidToDeviceId,
  validarQualidadeFoto,
  deviceUnregisterUser,
  bridgeStatus,
} from "../_lib.ts";

export function register(router: Router) {
  // ═══════════════════════════════════════════════════════════════
  //  Worker cron: processa fila de remoção de faces (cron a cada 15min)
  // ═══════════════════════════════════════════════════════════════
  router.on("acesso_processar_remocoes_face", async (ctx) => {
    const auth = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
    const cronKey = Deno.env.get("CRON_INTERNAL_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const tk = m ? m[1].trim() : "";
    const valid = (cronKey && tk === cronKey) || (serviceKey && tk === serviceKey);
    if (!valid) throw new AppError("AUTH_INVALID", "Internal call only.");

    const { data: faces } = await ctx.sb.from("acesso_faces")
      .select("id, escola_id, device_user_id, pessoa_nome, pessoa_id")
      .eq("sync_status", "aguardando_remocao")
      .eq("ativo", true)
      .limit(50);

    if (!faces?.length) return successResponse({ processadas: 0, ok: 0, err: 0 });

    const devicesByEscola = new Map<string, Any[]>();
    let okCount = 0; let errCount = 0;
    const erros: Any[] = [];

    for (const f of faces) {
      let devices = devicesByEscola.get(f.escola_id);
      if (!devices) {
        const { data: ds } = await ctx.sb.from("acesso_dispositivos")
          .select("*").eq("escola_id", f.escola_id).eq("ativo", true);
        devices = ds || [];
        devicesByEscola.set(f.escola_id, devices);
      }

      let allOk = true;
      const devResults: Any[] = [];
      for (const dev of devices) {
        try {
          const r = await deviceUnregisterUser(ctx.sb, dev, f.device_user_id);
          if (!r.ok) { allOk = false; devResults.push({ device: dev.nome, ok: false, error: r.error || `HTTP ${r.status}` }); }
          else devResults.push({ device: dev.nome, ok: true });
        } catch (e) {
          allOk = false; devResults.push({ device: dev.nome, ok: false, error: String(e) });
        }
      }

      if (allOk) {
        await ctx.sb.from("acesso_faces").update({
          sync_status: "removido", ativo: false, sync_erro: null,
          atualizado_em: new Date().toISOString(),
        }).eq("id", f.id);
        okCount++;
      } else {
        await ctx.sb.from("acesso_faces").update({
          sync_erro: devResults.filter((r: Any) => !r.ok).map((r: Any) => `${r.device}: ${r.error}`).join("; "),
          atualizado_em: new Date().toISOString(),
        }).eq("id", f.id);
        errCount++;
        erros.push({ face_id: f.id, devices: devResults });
      }
    }

    return successResponse({ processadas: faces.length, ok: okCount, err: errCount, erros: erros.slice(0, 5) });
  });

  // ─── validar qualidade da foto antes de cadastrar (preview) ───
  router.on("acesso_validar_foto", async (ctx) => {
    const { foto } = ctx.body as Any;
    if (!foto) throw new AppError("VALIDATION_FAILED", "foto (base64) é obrigatória.");
    const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
    const binary = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) binary[i] = raw.charCodeAt(i);
    if (binary.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");
    const result = await validarQualidadeFoto(ctx.sb, binary);
    return successResponse(result);
  });

  // ─── info do token sem consumir (usado pela página pública) ───
  router.on("acesso_cadastro_token_info", async (ctx) => {
    const { token_cadastro } = ctx.body as Any;
    if (!token_cadastro || typeof token_cadastro !== "string") {
      throw new AppError("VALIDATION_FAILED", "token_cadastro obrigatório.");
    }
    if (!/^[a-f0-9]{32,128}$/i.test(token_cadastro)) {
      throw new AppError("AUTH_INVALID", "Token inválido.");
    }

    const { data: tk } = await ctx.sb.from("acesso_cadastro_tokens")
      .select("pessoa_tipo, pessoa_nome, expira_em, usado, escola_id")
      .eq("token", token_cadastro).maybeSingle();
    if (!tk) throw new AppError("AUTH_INVALID", "Link inválido ou já utilizado.");
    if (tk.usado) throw new AppError("AUTH_INVALID", "Este link já foi utilizado.");
    if (tk.expira_em && new Date(tk.expira_em) < new Date()) {
      throw new AppError("AUTH_EXPIRED", "Link expirado. Solicite um novo à escola.");
    }

    let escolaNome = "Lumied";
    let escolaIcone = "🎓";
    let corPrimaria = "#C8102E";
    if (tk.escola_id) {
      const { data: cfgRows } = await ctx.sb.from("escola_config")
        .select("chave, valor").eq("escola_id", tk.escola_id);
      const cfg: Any = {};
      for (const r of cfgRows ?? []) cfg[r.chave] = r.valor;
      escolaNome = cfg.escola_nome || escolaNome;
      escolaIcone = cfg.escola_icone || escolaIcone;
      corPrimaria = cfg.cor_primaria || corPrimaria;
    }

    return successResponse({
      pessoa_nome: tk.pessoa_nome,
      pessoa_tipo: tk.pessoa_tipo,
      expira_em: tk.expira_em,
      escola_nome: escolaNome,
      escola_icone: escolaIcone,
      cor_primaria: corPrimaria,
    });
  });

  // ─── consome token + cadastra face (aguardando aprovação) ───
  router.on("acesso_face_cadastro_publico", async (ctx) => {
    const { token_cadastro, pessoa_nome, foto } = ctx.body as Any;
    if (!token_cadastro || !foto) throw new AppError("VALIDATION_FAILED", "token_cadastro e foto são obrigatórios.");

    const { data: tk } = await ctx.sb
      .from("acesso_cadastro_tokens")
      .select("*")
      .eq("token", token_cadastro)
      .eq("usado", false)
      .maybeSingle();

    if (!tk) throw new AppError("AUTH_INVALID", "Link inválido ou já utilizado.");
    if (tk.expira_em && new Date(tk.expira_em) < new Date()) throw new AppError("AUTH_EXPIRED", "Link expirado.");

    const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
    const binary = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) binary[i] = raw.charCodeAt(i);
    if (binary.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");

    const qualidade = await validarQualidadeFoto(ctx.sb, binary);
    if (!qualidade.ok) {
      return successResponse({ ok: false, qualidade_erros: qualidade.errors, scores: qualidade.scores });
    }

    const path = `acesso/faces/${tk.pessoa_id}_${Date.now()}.jpg`;
    await ctx.sb.storage.from("wa-documentos").upload(path, binary, { contentType: "image/jpeg", upsert: true });
    const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
    const fotoUrl = signed?.signedUrl || null;

    const deviceUserId = uuidToDeviceId(tk.pessoa_id);

    const publicEscolaId = tk.escola_id || await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);
    if (!publicEscolaId) throw new AppError("BAD_REQUEST", "Não foi possível determinar a escola.");

    const { data: existing } = await ctx.sb
      .from("acesso_faces")
      .select("id")
      .eq("escola_id", publicEscolaId)
      .eq("pessoa_tipo", tk.pessoa_tipo)
      .eq("pessoa_id", tk.pessoa_id)
      .maybeSingle();

    if (existing) {
      await ctx.sb.from("acesso_faces").update({
        pessoa_nome: pessoa_nome || tk.pessoa_nome,
        foto_url: fotoUrl,
        device_user_id: deviceUserId,
        sync_status: "aguardando_aprovacao",
        atualizado_em: new Date().toISOString(),
      }).eq("id", existing.id).eq("escola_id", publicEscolaId);
    } else {
      await ctx.sb.from("acesso_faces").insert({
        escola_id: publicEscolaId,
        pessoa_tipo: tk.pessoa_tipo,
        pessoa_id: tk.pessoa_id,
        pessoa_nome: pessoa_nome || tk.pessoa_nome,
        foto_url: fotoUrl,
        device_user_id: deviceUserId,
        sync_status: "aguardando_aprovacao",
      });
    }

    await ctx.sb.from("acesso_cadastro_tokens").update({ usado: true, usado_em: new Date().toISOString() }).eq("id", tk.id);

    return successResponse({ ok: true, qualidade_erros: qualidade.errors, mensagem: "Foto enviada! Aguarde aprovação da escola." });
  });

  // ─── Gerente gera link de cadastro pra família ───
  router.on("acesso_gerar_link_cadastro", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { pessoa_tipo, pessoa_id, pessoa_nome, email } = ctx.body as Any;
    if (!pessoa_tipo || !pessoa_id || !pessoa_nome) {
      throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id e pessoa_nome são obrigatórios.");
    }

    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    const { data, error } = await ctx.sb.from("acesso_cadastro_tokens").insert({
      escola_id: ctx.escola_id, token, pessoa_tipo, pessoa_id, pessoa_nome,
      email: email || null,
      gerado_por: ctx.user?.nome || "sistema",
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);

    const appUrl = Deno.env.get("APP_URL") || "https://maplebearcaxias.lumied.com.br";
    const link = `${appUrl}/cadastro-face.html?token=${token}`;

    return successResponse({ token, link, expira_em: data.expira_em });
  });

  // ─── Status de responsáveis por aluno (slots: 1 obrigatório + 2 opc) ───
  router.on("acesso_alunos_responsaveis_status", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { busca } = ctx.body as Any;

    let aq = ctx.sb.from("alunos")
      .select("id, nome, serie_id, familia_email, email")
      .eq("escola_id", ctx.escola_id).eq("ativo", true)
      .order("nome");
    if (busca && String(busca).trim().length >= 2) {
      aq = aq.ilike("nome", `%${String(busca).trim()}%`);
    }
    aq = aq.limit(busca ? 100 : 200);
    const { data: alunos } = await aq;
    if (!alunos?.length) {
      return successResponse({ alunos: [], total: 0, com_min_obrigatorio: 0, min_responsaveis: 1, recomendado: 3 });
    }

    const alunoIds = alunos.map((a: Any) => a.id);

    const { data: perms } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id, aluno_id, responsavel_id, responsavel_nome, responsavel_email, responsavel_foto_url, parentesco, validade")
      .eq("escola_id", ctx.escola_id)
      .in("aluno_id", alunoIds)
      .eq("autorizado", true)
      .order("criado_em", { ascending: true });

    const responsavelIds = (perms ?? []).map((p: Any) => p.responsavel_id).filter((x: Any) => x);
    const facesByPid = new Map<string, Any>();
    if (responsavelIds.length) {
      const { data: faces } = await ctx.sb.from("acesso_faces")
        .select("pessoa_id, sync_status, atualizado_em")
        .eq("escola_id", ctx.escola_id).eq("ativo", true).eq("pessoa_tipo", "responsavel")
        .in("pessoa_id", responsavelIds);
      for (const f of faces ?? []) facesByPid.set(f.pessoa_id, f);
    }

    const { data: tokens } = await ctx.sb.from("acesso_cadastro_tokens")
      .select("pessoa_id, criado_em, expira_em, usado")
      .eq("escola_id", ctx.escola_id).eq("pessoa_tipo", "responsavel");
    const tokenByPid = new Map<string, Any>();
    for (const t of tokens ?? []) {
      const cur = tokenByPid.get(t.pessoa_id);
      if (!cur || new Date(t.criado_em) > new Date(cur.criado_em)) tokenByPid.set(t.pessoa_id, t);
    }

    const permsByAluno = new Map<string, Any[]>();
    for (const p of perms ?? []) {
      const list = permsByAluno.get(p.aluno_id) || [];
      list.push(p);
      permsByAluno.set(p.aluno_id, list);
    }

    const min = 1;
    const recomendado = 3;

    const alunosOut = alunos.map((a: Any) => {
      const responsaveis = (permsByAluno.get(a.id) || []).map((p: Any) => {
        const face = p.responsavel_id ? facesByPid.get(p.responsavel_id) : null;
        const tk = p.responsavel_id ? tokenByPid.get(p.responsavel_id) : null;
        const linkAtivo = tk && !tk.usado && new Date(tk.expira_em) > new Date();
        let face_status: "cadastrada" | "aguardando_aprovacao" | "erro" | "link_enviado" | "sem_face" = "sem_face";
        if (face) {
          if (face.sync_status === "sincronizado") face_status = "cadastrada";
          else if (face.sync_status === "aguardando_aprovacao") face_status = "aguardando_aprovacao";
          else if (face.sync_status === "erro") face_status = "erro";
          else face_status = "cadastrada";
        } else if (linkAtivo) face_status = "link_enviado";
        return {
          id: p.id, responsavel_id: p.responsavel_id,
          nome: p.responsavel_nome, email: p.responsavel_email,
          parentesco: p.parentesco, foto_url: p.responsavel_foto_url,
          validade: p.validade,
          face_status,
          link_expira_em: linkAtivo ? tk.expira_em : null,
        };
      });
      const cadastrados = responsaveis.filter((r: Any) => r.face_status === "cadastrada" || r.face_status === "aguardando_aprovacao").length;
      return {
        id: a.id, nome: a.nome,
        familia_email: a.familia_email || a.email || null,
        responsaveis,
        slots_preenchidos: responsaveis.length,
        faces_ok: cadastrados,
        atende_minimo: cadastrados >= min,
        atende_recomendado: cadastrados >= recomendado,
      };
    });

    const comMin = alunosOut.filter((a: Any) => a.atende_minimo).length;

    return successResponse({
      alunos: alunosOut,
      total: alunos.length,
      com_min_obrigatorio: comMin,
      min_responsaveis: min,
      recomendado,
    });
  });

  // ─── Cadastra responsável + opcionalmente gera link de face ───
  router.on("acesso_responsavel_create", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { aluno_id, responsavel_nome, parentesco, responsavel_email, validade, gerar_link } = ctx.body as Any;
    if (!aluno_id || !responsavel_nome) {
      throw new AppError("VALIDATION_FAILED", "aluno_id e responsavel_nome são obrigatórios.");
    }
    const { data: aluno } = await ctx.sb.from("alunos").select("id, nome").eq("id", aluno_id).eq("escola_id", ctx.escola_id).maybeSingle();
    if (!aluno) throw new AppError("NOT_FOUND", "Aluno não encontrado.");

    const responsavel_id = crypto.randomUUID();
    const { data: perm, error } = await ctx.sb.from("acesso_permissoes_retirada").insert({
      escola_id: ctx.escola_id,
      aluno_id, aluno_nome: aluno.nome,
      responsavel_id, responsavel_nome,
      responsavel_email: responsavel_email || null,
      parentesco: parentesco || null,
      validade: validade || null,
      autorizado: true,
      autorizado_por: ctx.user?.nome || "Gerente",
    }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);

    let linkData: Any = null;
    if (gerar_link) {
      const innerCtx: Any = { ...ctx, body: { pessoa_tipo: "responsavel", pessoa_id: responsavel_id, pessoa_nome: responsavel_nome, email: responsavel_email } };
      const lr: Any = await router.dispatch("acesso_gerar_link_cadastro", innerCtx);
      try { const j = await lr.json(); linkData = j?.data || j; } catch (_) { /* */ }
    }

    return successResponse({ permissao: perm, responsavel_id, link: linkData });
  });

  // ─── Pendências: alunos sem face cadastrada ───
  router.on("acesso_pendencias_face", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

    const { data: alunos } = await ctx.sb.from("alunos")
      .select("id, nome, serie_id, familia_email, email")
      .eq("escola_id", ctx.escola_id).eq("ativo", true)
      .order("nome");

    const alunoIds = (alunos ?? []).map((a: Any) => a.id);
    let comFace = new Set<string>();
    if (alunoIds.length) {
      const { data: faces } = await ctx.sb.from("acesso_faces")
        .select("pessoa_id, sync_status")
        .eq("escola_id", ctx.escola_id).eq("ativo", true).eq("pessoa_tipo", "aluno")
        .in("pessoa_id", alunoIds);
      comFace = new Set((faces ?? []).map((f: Any) => f.pessoa_id));
    }

    const { data: tokens } = await ctx.sb.from("acesso_cadastro_tokens")
      .select("pessoa_id, criado_em, expira_em, usado")
      .eq("escola_id", ctx.escola_id).eq("pessoa_tipo", "aluno");
    const tokenByAluno = new Map<string, Any>();
    for (const t of tokens ?? []) {
      const cur = tokenByAluno.get(t.pessoa_id);
      if (!cur || new Date(t.criado_em) > new Date(cur.criado_em)) tokenByAluno.set(t.pessoa_id, t);
    }

    const { data: waFams } = await ctx.sb.from("wa_familias")
      .select("aluno_nome, whatsapp, opt_in")
      .eq("escola_id", ctx.escola_id);
    const waByNome = new Map<string, string>();
    for (const w of waFams ?? []) {
      if (w.aluno_nome && w.whatsapp) waByNome.set(String(w.aluno_nome).toLowerCase().trim(), w.whatsapp);
    }

    const pendentes = (alunos ?? []).filter((a: Any) => !comFace.has(a.id)).map((a: Any) => {
      const tk = tokenByAluno.get(a.id);
      const linkAtivo = tk && !tk.usado && new Date(tk.expira_em) > new Date();
      return {
        id: a.id, nome: a.nome,
        email: a.familia_email || a.email || null,
        whatsapp: waByNome.get(String(a.nome || "").toLowerCase().trim()) || null,
        tem_link_ativo: !!linkAtivo,
        link_expira_em: linkAtivo ? tk.expira_em : null,
      };
    });

    return successResponse({
      total_alunos: alunos?.length || 0,
      com_face: comFace.size,
      pendentes,
    });
  });

  // ─── Envia link por email via send-email ───
  router.on("acesso_enviar_link_email", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { pessoa_tipo, pessoa_id, pessoa_nome, email } = ctx.body as Any;
    if (!pessoa_tipo || !pessoa_id || !pessoa_nome || !email) {
      throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id, pessoa_nome e email são obrigatórios.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError("VALIDATION_FAILED", "Email inválido.");
    }

    const innerCtx: Any = { ...ctx, body: { pessoa_tipo, pessoa_id, pessoa_nome, email } };
    const linkRes: Any = await router.dispatch("acesso_gerar_link_cadastro", innerCtx);
    let linkData: Any = null;
    try { linkData = await linkRes.json(); } catch (_) { /* ignore */ }
    const link = linkData?.data?.link || linkData?.link;
    if (!link) throw new AppError("BAD_REQUEST", "Não consegui gerar o link.");

    const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        tipo: "cadastro_face",
        escola_id: ctx.escola_id,
        to: email, pessoa_nome, pessoa_tipo, link,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const sendBody: Any = await r.json().catch(() => ({}));
    if (!r.ok || sendBody?.sent === false) {
      return successResponse({ ok: false, link, sent: false, reason: sendBody?.reason || `HTTP ${r.status}` });
    }
    return successResponse({ ok: true, link, sent: true });
  });

  // ─── WhatsApp helper — URL wa.me + telefone do responsável ───
  router.on("acesso_link_whatsapp_info", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { pessoa_tipo, pessoa_id, pessoa_nome, link } = ctx.body as Any;
    if (!pessoa_tipo || !pessoa_id || !pessoa_nome || !link) {
      throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id, pessoa_nome e link são obrigatórios.");
    }

    let phone: string | null = null;
    if (pessoa_tipo === "aluno") {
      const { data: aluno } = await ctx.sb.from("alunos").select("nome").eq("id", pessoa_id).maybeSingle();
      if (aluno?.nome) {
        const { data: wa } = await ctx.sb.from("wa_familias")
          .select("whatsapp")
          .eq("escola_id", ctx.escola_id)
          .ilike("aluno_nome", aluno.nome)
          .maybeSingle();
        phone = wa?.whatsapp || null;
      }
    }

    const { data: cfgRows } = await ctx.sb.from("escola_config")
      .select("chave, valor").eq("escola_id", ctx.escola_id);
    const cfg: Any = {};
    for (const r of cfgRows ?? []) cfg[r.chave] = r.valor;
    const escolaNome = cfg.escola_nome || "a escola";

    const msg = `Olá! ${escolaNome} preparou um cadastro facial para ${pessoa_nome}. ` +
      `Use o link abaixo (válido por 7 dias) pra enviar uma foto. ` +
      `Tudo é feito do celular, leva menos de 1 minuto:\n\n${link}\n\n` +
      `Dicas: boa iluminação, rosto centralizado, sem óculos escuros ou máscara. ` +
      `Após o envio, a escola revisa e aprova.`;

    const phoneClean = phone ? phone.replace(/[^\d]/g, "") : null;
    const waUrl = phoneClean
      ? `https://wa.me/${phoneClean}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    return successResponse({ whatsapp: phone, wa_url: waUrl, mensagem: msg });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Setup Face ID — checklist agregado (tudo que precisa pra funcionar)
  // ═══════════════════════════════════════════════════════════════
  router.on("acesso_setup_checklist", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const eid = ctx.escola_id;

    // 1. Token bridge + 2. Daemon online
    const { data: escola } = await ctx.sb.from("escolas")
      .select("bridge_token, bridge_ultimo_heartbeat, nome")
      .eq("id", eid).maybeSingle();
    const tokenOk = !!escola?.bridge_token;
    const gw = await bridgeStatus(eid);
    const hbDate = escola?.bridge_ultimo_heartbeat ? new Date(escola.bridge_ultimo_heartbeat) : null;
    const hbFresh = hbDate ? (Date.now() - hbDate.getTime() < 5 * 60 * 1000) : false;
    const daemonOnline = !!gw.connected || hbFresh;

    // 3-5. Dispositivos: cadastrados, credenciais, alcançáveis
    const { data: devices } = await ctx.sb.from("acesso_dispositivos")
      .select("id, nome, ip, porta, tipo, ativo, via_bridge, api_password, ultimo_heartbeat")
      .eq("escola_id", eid).eq("ativo", true);
    const totalDevices = devices?.length || 0;
    const devicesSemSenha = (devices ?? []).filter((d: Any) => !d.api_password).map((d: Any) => d.nome);
    const credsOk = totalDevices > 0 && devicesSemSenha.length === 0;
    const devicesAlcancaveis = (devices ?? []).filter((d: Any) => {
      if (!d.ultimo_heartbeat) return false;
      return (Date.now() - new Date(d.ultimo_heartbeat).getTime()) < 24 * 3600 * 1000;
    }).length;

    // 6-7-9. Faces: alunos com face, pendentes, com erro
    const { count: alunosTotal } = await ctx.sb.from("alunos")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid).eq("ativo", true);
    const { count: facesAlunos } = await ctx.sb.from("acesso_faces")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid).eq("ativo", true).eq("pessoa_tipo", "aluno");
    const { count: facesPendentes } = await ctx.sb.from("acesso_faces")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid).eq("ativo", true).eq("sync_status", "aguardando_aprovacao");
    const { count: facesErro } = await ctx.sb.from("acesso_faces")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid).eq("ativo", true).eq("sync_status", "erro");

    // 8. Permissões + 10. Eventos 24h
    const { count: permissoes } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid).eq("autorizado", true);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: eventos24h } = await ctx.sb.from("acesso_eventos")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid).gte("criado_em", since);

    const items = [
      {
        id: "token",
        label: "Token do bridge gerado",
        ok: tokenOk,
        detail: tokenOk ? "Token configurado." : "Sem token. Painel Lumied Bridge → Rotacionar.",
        action: tokenOk ? null : { label: "Gerar token", panel: "acessoBridge" },
        blocking: false,
        severity: tokenOk ? "ok" : "warn",
      },
      {
        id: "devices_cadastrados",
        label: "Dispositivos iDFace cadastrados",
        ok: totalDevices > 0,
        detail: totalDevices > 0 ? `${totalDevices} dispositivo(s) ativo(s).` : "Nenhum iDFace cadastrado.",
        action: totalDevices > 0 ? null : { label: "Cadastrar dispositivo", panel: "acessoDispositivos" },
        blocking: true,
        severity: totalDevices > 0 ? "ok" : "error",
      },
      {
        id: "creds",
        label: "Credenciais dos iDFace",
        ok: credsOk,
        detail: totalDevices === 0 ? "—" : (credsOk ? "Todos os dispositivos têm senha API configurada." : `Sem senha: ${devicesSemSenha.join(", ")}`),
        action: credsOk ? null : { label: "Configurar credenciais", panel: "acessoDispositivos" },
        blocking: totalDevices > 0,
        severity: credsOk ? "ok" : (totalDevices === 0 ? "muted" : "error"),
      },
      {
        id: "daemon",
        label: "Lumied Bridge daemon conectado",
        ok: daemonOnline,
        detail: daemonOnline
          ? (gw.connected ? "WS ativo no gateway." : `Heartbeat há ${hbDate ? Math.round((Date.now() - hbDate.getTime())/60000) : "?"}min.`)
          : (escola?.bridge_token ? "Token ok mas daemon nunca conectou. Instale na escola." : "Token ainda não foi gerado."),
        action: daemonOnline ? null : { label: "Ver instalação", panel: "acessoBridge" },
        blocking: (devices ?? []).some((d: Any) => d.via_bridge),
        severity: daemonOnline ? "ok" : ((devices ?? []).some((d: Any) => d.via_bridge) ? "error" : "warn"),
      },
      {
        id: "devices_online",
        label: "Dispositivos respondendo",
        ok: totalDevices > 0 && devicesAlcancaveis === totalDevices,
        detail: totalDevices === 0 ? "—" : `${devicesAlcancaveis}/${totalDevices} com heartbeat nas últimas 24h.`,
        action: null,
        blocking: false,
        severity: totalDevices === 0 ? "muted" : (devicesAlcancaveis === totalDevices ? "ok" : (devicesAlcancaveis > 0 ? "warn" : "error")),
      },
      {
        id: "faces",
        label: "Faces cadastradas (alunos)",
        ok: (facesAlunos ?? 0) > 0,
        detail: (alunosTotal ?? 0) === 0 ? "Nenhum aluno ativo." : `${facesAlunos ?? 0} face(s) de ${alunosTotal} aluno(s) ativos. (${alunosTotal ? Math.round(((facesAlunos || 0) / alunosTotal) * 100) : 0}% cobertura)`,
        action: { label: "Cadastrar face", panel: "acessoFaces" },
        blocking: false,
        severity: (facesAlunos ?? 0) === 0 ? "warn" : "ok",
      },
      {
        id: "faces_pendentes",
        label: "Faces aguardando aprovação",
        ok: (facesPendentes ?? 0) === 0,
        detail: (facesPendentes ?? 0) === 0 ? "Nenhuma pendente." : `${facesPendentes} face(s) aguardando você aprovar.`,
        action: (facesPendentes ?? 0) > 0 ? { label: "Revisar", panel: "acessoFaces" } : null,
        blocking: false,
        severity: (facesPendentes ?? 0) === 0 ? "ok" : "warn",
      },
      {
        id: "faces_erro",
        label: "Faces com erro de sync",
        ok: (facesErro ?? 0) === 0,
        detail: (facesErro ?? 0) === 0 ? "Nenhum erro." : `${facesErro} face(s) com erro — investigar.`,
        action: (facesErro ?? 0) > 0 ? { label: "Ver erros", panel: "acessoFaces" } : null,
        blocking: false,
        severity: (facesErro ?? 0) === 0 ? "ok" : "warn",
      },
      {
        id: "permissoes",
        label: "Permissões de retirada",
        ok: (permissoes ?? 0) > 0,
        detail: (permissoes ?? 0) > 0 ? `${permissoes} autorização(ões) ativas.` : "Nenhuma autorização cadastrada.",
        action: (permissoes ?? 0) === 0 ? { label: "Cadastrar", panel: "acessoPermissoes" } : null,
        blocking: false,
        severity: (permissoes ?? 0) > 0 ? "ok" : "warn",
      },
      {
        id: "responsaveis_face",
        label: "Responsáveis com face cadastrada",
        ok: false, detail: "—",
        action: { label: "Cadastrar", panel: "acessoPermissoes" },
        blocking: false, severity: "muted",
      },
      {
        id: "autorizacoes_pais_mes",
        label: "Autorizações criadas pelos pais (mês)",
        ok: true, detail: "—", action: null, blocking: false, severity: "muted",
      },
      {
        id: "remocoes_pendentes",
        label: "Remoções de face pendentes",
        ok: true, detail: "—", action: null, blocking: false, severity: "muted",
      },
      {
        id: "eventos",
        label: "Eventos nas últimas 24h",
        ok: (eventos24h ?? 0) > 0,
        detail: (eventos24h ?? 0) > 0 ? `${eventos24h} reconhecimento(s) registrado(s).` : "Nenhum evento — ninguém passou ainda ou callback não está configurado.",
        action: null,
        blocking: false,
        severity: (eventos24h ?? 0) > 0 ? "ok" : (totalDevices === 0 ? "muted" : "warn"),
      },
    ];

    // % de alunos com pelo menos 1 responsável com face cadastrada
    if ((alunosTotal ?? 0) > 0) {
      const { data: rfRows } = await ctx.sb.rpc("count_alunos_com_responsavel_face", { p_escola_id: eid }).maybeSingle();
      let comResp = rfRows?.count;
      if (typeof comResp !== "number") {
        // Fallback sem RPC: query inline
        const { data: permsRf } = await ctx.sb.from("acesso_permissoes_retirada")
          .select("aluno_id, responsavel_id")
          .eq("escola_id", eid).eq("autorizado", true);
        const respIds = (permsRf ?? []).map((p: Any) => p.responsavel_id).filter((x: Any) => x);
        let facesSet = new Set<string>();
        if (respIds.length) {
          const { data: faces } = await ctx.sb.from("acesso_faces")
            .select("pessoa_id").eq("escola_id", eid).eq("ativo", true).eq("pessoa_tipo", "responsavel")
            .in("pessoa_id", respIds);
          facesSet = new Set((faces ?? []).map((f: Any) => f.pessoa_id));
        }
        const alunosComFaceResp = new Set<string>();
        for (const p of permsRf ?? []) {
          if (p.responsavel_id && facesSet.has(p.responsavel_id)) alunosComFaceResp.add(p.aluno_id);
        }
        comResp = alunosComFaceResp.size;
      }
      const respItem = items.find((i) => i.id === "responsaveis_face");
      if (respItem) {
        const pct = Math.round(((comResp || 0) / alunosTotal) * 100);
        respItem.ok = (comResp || 0) === alunosTotal;
        respItem.detail = `${comResp || 0} de ${alunosTotal} aluno(s) com pelo menos 1 responsável com face. (${pct}% cobertura)`;
        respItem.severity = respItem.ok ? "ok" : (pct >= 50 ? "warn" : "error");
        respItem.blocking = false;
      }
    } else {
      const respItem = items.find((i) => i.id === "responsaveis_face");
      if (respItem) {
        respItem.detail = "Nenhum aluno ativo.";
        respItem.severity = "muted";
        respItem.ok = true;
      }
    }

    // autorizacoes_pais_mes — informativo
    const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
    const { count: autPaisMes } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid)
      .eq("criado_por_familia", true)
      .gte("criado_em", inicioMes.toISOString());
    const { count: autPaisAtivas } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid)
      .eq("criado_por_familia", true)
      .eq("autorizado", true);
    const autItem = items.find((i) => i.id === "autorizacoes_pais_mes");
    if (autItem) {
      if ((autPaisMes ?? 0) === 0 && (autPaisAtivas ?? 0) === 0) {
        autItem.detail = "Nenhuma autorização de pai criada ainda este mês.";
        autItem.severity = "muted";
      } else {
        autItem.detail = `${autPaisMes || 0} criada(s) este mês • ${autPaisAtivas || 0} ativa(s) no total.`;
        autItem.severity = "ok";
      }
    }

    // remoções pendentes — alerta se acumulou
    const { count: remPend } = await ctx.sb.from("acesso_faces")
      .select("id", { count: "exact", head: true })
      .eq("escola_id", eid)
      .eq("sync_status", "aguardando_remocao")
      .eq("ativo", true);
    const remItem = items.find((i) => i.id === "remocoes_pendentes");
    if (remItem) {
      const n = remPend ?? 0;
      if (n === 0) {
        remItem.detail = "Nenhuma remoção pendente.";
        remItem.severity = "ok";
        remItem.ok = true;
      } else if (n < 5) {
        remItem.detail = `${n} face(s) na fila pra remover do iDFace (cron processa a cada 15min).`;
        remItem.severity = "warn";
        remItem.ok = false;
      } else {
        remItem.detail = `${n} face(s) acumuladas — possível erro no Bridge. Verificar logs do daemon.`;
        remItem.severity = "error";
        remItem.ok = false;
      }
    }

    const blockers = items.filter((i) => i.blocking && !i.ok).length;
    const totalOk = items.filter((i) => i.ok).length;

    return successResponse({
      escola_nome: escola?.nome || "",
      score: items.length === 0 ? 0 : Math.round((totalOk / items.length) * 100),
      blockers,
      pode_operar: blockers === 0,
      items,
      devices: (devices ?? []).map((d: Any) => ({
        id: d.id, nome: d.nome, ip: d.ip, porta: d.porta, tipo: d.tipo,
        via_bridge: d.via_bridge, tem_senha: !!d.api_password,
        ultimo_heartbeat: d.ultimo_heartbeat,
      })),
    });
  });
}
