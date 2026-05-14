// Acesso — cadastro/sincronização de faces + buscar pessoa
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import {
  type Any,
  authGerenteOrSecretaria,
  uuidToDeviceId,
  deviceEnrollUser,
  deviceEnrollUsers,
  deviceSetFaceImage,
} from "../_lib.ts";

export function register(router: Router) {
  router.on("acesso_face_cadastrar", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { pessoa_tipo, pessoa_id, pessoa_nome, foto } = ctx.body as Any;
    if (!pessoa_tipo || !pessoa_id || !pessoa_nome) {
      throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id e pessoa_nome são obrigatórios.");
    }

    const deviceUserId = uuidToDeviceId(pessoa_id);

    let fotoUrl: string | null = null;
    let fotoBinary: Uint8Array | null = null;
    if (foto) {
      try {
        const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
        fotoBinary = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) fotoBinary[i] = raw.charCodeAt(i);

        const path = `acesso/faces/${pessoa_id}_${Date.now()}.jpg`;
        const { error: upErr } = await ctx.sb.storage.from("wa-documentos").upload(path, fotoBinary, {
          contentType: "image/jpeg", upsert: true,
        });
        if (!upErr) {
          // Bucket privado (mig 279): signed URL com TTL 7d
          const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
          fotoUrl = signed?.signedUrl || null;
        }
      } catch (e) {
        console.error("Erro ao processar foto:", e);
      }
    }

    const { data: existing } = await ctx.sb
      .from("acesso_faces")
      .select("id")
      .eq("escola_id", ctx.escola_id)
      .eq("pessoa_tipo", pessoa_tipo)
      .eq("pessoa_id", pessoa_id)
      .eq("ativo", true)
      .maybeSingle();

    let faceRecord;
    if (existing) {
      const { data, error } = await ctx.sb.from("acesso_faces").update({
        pessoa_nome, foto_url: fotoUrl, device_user_id: deviceUserId,
        sync_status: "pendente", sync_erro: null, atualizado_em: new Date().toISOString(),
      }).eq("id", existing.id).eq("escola_id", ctx.escola_id).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      faceRecord = data;
    } else {
      const { data, error } = await ctx.sb.from("acesso_faces").insert({
        escola_id: ctx.escola_id, pessoa_tipo, pessoa_id, pessoa_nome, foto_url: fotoUrl,
        device_user_id: deviceUserId, sync_status: "pendente",
      }).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      faceRecord = data;
    }

    const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
    const syncResults: Any[] = [];

    for (const dev of devices ?? []) {
      try {
        const userRes = await deviceEnrollUser(ctx.sb, dev, { id: deviceUserId, name: pessoa_nome, registration: pessoa_id });
        if (!userRes.ok) {
          syncResults.push({ device: dev.nome, ok: false, error: userRes.error || `enroll_user HTTP ${userRes.status}` });
          continue;
        }

        if (fotoBinary) {
          const imgRes = await deviceSetFaceImage(ctx.sb, dev, deviceUserId, fotoBinary);
          syncResults.push({ device: dev.nome, ok: imgRes.ok, status: imgRes.status, error: imgRes.error });
        } else {
          syncResults.push({ device: dev.nome, ok: true, note: "Sem foto para enviar" });
        }
      } catch (err) {
        syncResults.push({ device: dev.nome, ok: false, error: String(err) });
      }
    }

    const allOk = syncResults.length > 0 && syncResults.every((r) => r.ok);
    const anyErr = syncResults.some((r) => !r.ok);
    await ctx.sb.from("acesso_faces").update({
      sync_status: allOk ? "sincronizado" : anyErr ? "erro" : "pendente",
      sync_erro: anyErr ? syncResults.filter((r) => !r.ok).map((r) => `${r.device}: ${r.error}`).join("; ") : null,
      atualizado_em: new Date().toISOString(),
    }).eq("id", faceRecord.id).eq("escola_id", ctx.escola_id);

    return successResponse({ face: faceRecord, sync: syncResults });
  });

  // Busca de pessoas — versão completa (sobrescreve a versão antiga, é o mesmo nome)
  // Mantemos a 2ª definição porque é a que cobre os 3 tipos (aluno/responsavel/funcionario) e foi
  // a última registrada no monolito original (Router.on substitui handlers anteriores).
  router.on("acesso_buscar_pessoa", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { tipo, busca } = ctx.body as Any;
    const term = String(busca || "").trim();
    if (term.length < 2) return successResponse([]);
    const like = `%${term}%`;

    if (tipo === "aluno") {
      const { data } = await ctx.sb.from("alunos")
        .select("id, nome, serie")
        .eq("escola_id", ctx.escola_id).eq("ativo", true)
        .ilike("nome", like).order("nome").limit(20);
      return successResponse(data ?? []);
    }
    if (tipo === "responsavel") {
      const { data } = await ctx.sb.from("acesso_faces")
        .select("pessoa_id, pessoa_nome")
        .eq("escola_id", ctx.escola_id)
        .eq("pessoa_tipo", "responsavel").eq("ativo", true)
        .ilike("pessoa_nome", like).order("pessoa_nome").limit(20);
      return successResponse((data ?? []).map((f: Any) => ({ id: f.pessoa_id, nome: f.pessoa_nome })));
    }
    if (tipo === "funcionario") {
      const { data } = await ctx.sb.from("usuarios")
        .select("id, nome, email, papeis")
        .eq("escola_id", ctx.escola_id).eq("ativo", true)
        .ilike("nome", like).order("nome").limit(20);
      return successResponse(data ?? []);
    }
    throw new AppError("VALIDATION_FAILED", "tipo deve ser 'aluno', 'responsavel' ou 'funcionario'.");
  });

  router.on("acesso_faces_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { pessoa_tipo } = ctx.body as Any;
    let q = ctx.sb.from("acesso_faces").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true).order("criado_em", { ascending: false });
    if (pessoa_tipo) q = q.eq("pessoa_tipo", pessoa_tipo);
    const { data } = await q;
    return successResponse(data ?? []);
  });

  router.on("acesso_face_delete", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    await ctx.sb.from("acesso_faces").update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", id).eq("escola_id", ctx.escola_id);
    return successResponse({ ok: true });
  });

  router.on("acesso_face_sync_all", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data: faces } = await ctx.sb.from("acesso_faces").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
    const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
    if (!faces?.length) return successResponse({ synced: 0, message: "Nenhuma face cadastrada." });
    if (!devices?.length) return successResponse({ synced: 0, message: "Nenhum dispositivo ativo." });

    const results: Any[] = [];
    for (const dev of devices) {
      try {
        const users = faces.map((f: Any) => ({ id: f.device_user_id, name: f.pessoa_nome, registration: f.pessoa_id }));
        const usersRes = await deviceEnrollUsers(ctx.sb, dev, users);
        if (!usersRes.ok) {
          results.push({ device: dev.nome, ok: false, error: usersRes.error || `enroll_user HTTP ${usersRes.status}` });
          continue;
        }
        for (const face of faces) {
          if (!face.foto_url) continue;
          try {
            const photoRes = await fetch(face.foto_url, { signal: AbortSignal.timeout(5000) });
            if (!photoRes.ok) continue;
            const photoBytes = new Uint8Array(await photoRes.arrayBuffer());
            const r = await deviceSetFaceImage(ctx.sb, dev, face.device_user_id, photoBytes);
            if (r.ok) {
              await ctx.sb.from("acesso_faces").update({
                sync_status: "sincronizado", sync_erro: null, atualizado_em: new Date().toISOString(),
              }).eq("id", face.id).eq("escola_id", ctx.escola_id);
            } else {
              await ctx.sb.from("acesso_faces").update({
                sync_status: "erro", sync_erro: `${dev.nome}: ${r.error || `HTTP ${r.status}`}`, atualizado_em: new Date().toISOString(),
              }).eq("id", face.id).eq("escola_id", ctx.escola_id);
            }
          } catch (err) {
            await ctx.sb.from("acesso_faces").update({
              sync_status: "erro", sync_erro: `${dev.nome}: ${String(err)}`, atualizado_em: new Date().toISOString(),
            }).eq("id", face.id).eq("escola_id", ctx.escola_id);
          }
        }
        results.push({ device: dev.nome, ok: true });
      } catch (err) {
        results.push({ device: dev.nome, ok: false, error: String(err) });
      }
    }
    return successResponse({ synced: faces.length, devices: results });
  });

  // ─── face_create: gerente cadastra face direto (alias com lookup de nome) ───
  router.on("acesso_face_create", authGerente, async (ctx) => {
    const { pessoa_id, pessoa_tipo, foto_base64, foto, pessoa_nome: nomeOverride } = ctx.body as Any;
    if (!pessoa_id || !pessoa_tipo) {
      throw new AppError("VALIDATION_FAILED", "pessoa_id e pessoa_tipo são obrigatórios.");
    }
    let pessoa_nome = nomeOverride || null;
    if (!pessoa_nome) {
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
    (ctx.body as Any).foto = foto || foto_base64 || null;
    return router.dispatch("acesso_face_cadastrar", ctx);
  });

  // ─── alias _sync_all_faces → _face_sync_all ───
  router.on("acesso_sync_all_faces", authGerente, async (ctx) => {
    return router.dispatch("acesso_face_sync_all", ctx);
  });

  // ─── faces aguardando aprovação ───
  router.on("acesso_faces_pendentes", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb.from("acesso_faces")
      .select("*")
      .eq("escola_id", ctx.escola_id).eq("ativo", true).eq("sync_status", "aguardando_aprovacao")
      .order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  });

  // ─── aprovar face cadastrada pela família (gerente revisa) ───
  router.on("acesso_face_aprovar", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

    const { data: face } = await ctx.sb.from("acesso_faces").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
    if (!face) throw new AppError("NOT_FOUND", "Face não encontrada.");

    let fotoBinary: Uint8Array | null = null;
    if (face.foto_url) {
      try {
        const res = await fetch(face.foto_url, { signal: AbortSignal.timeout(10000) });
        if (res.ok) fotoBinary = new Uint8Array(await res.arrayBuffer());
      } catch (e) { console.warn('[acesso] Face photo download failed:', (e as Error).message); }
    }

    const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
    const syncResults: Any[] = [];

    for (const dev of devices ?? []) {
      try {
        const userRes = await deviceEnrollUser(ctx.sb, dev, { id: face.device_user_id, name: face.pessoa_nome, registration: face.pessoa_id });
        if (!userRes.ok) {
          syncResults.push({ device: dev.nome, ok: false, error: userRes.error || `enroll_user HTTP ${userRes.status}` });
          continue;
        }
        if (fotoBinary) {
          const r = await deviceSetFaceImage(ctx.sb, dev, face.device_user_id, fotoBinary);
          if (!r.ok) {
            syncResults.push({ device: dev.nome, ok: false, error: r.error || `set_image HTTP ${r.status}` });
            continue;
          }
        }
        syncResults.push({ device: dev.nome, ok: true });
      } catch (err) {
        syncResults.push({ device: dev.nome, ok: false, error: String(err) });
      }
    }

    const allOk = syncResults.every(r => r.ok);
    await ctx.sb.from("acesso_faces").update({
      sync_status: allOk ? "sincronizado" : "erro",
      sync_erro: allOk ? null : syncResults.filter(r => !r.ok).map(r => `${r.device}: ${r.error}`).join("; "),
      atualizado_em: new Date().toISOString(),
    }).eq("id", id).eq("escola_id", ctx.escola_id);

    return successResponse({ aprovado: true, sync: syncResults });
  });
}
