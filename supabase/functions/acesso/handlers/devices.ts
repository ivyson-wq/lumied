// Acesso — gerenciamento de dispositivos iDFace + Simpax import + mapa
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import {
  type Any,
  authGerenteOrSecretaria,
  devicePing,
  getDeviceSession,
  parseSimpaxLine,
  parseSimpaxDate,
  classificarSimpax,
  deviceEnrollUsers,
  deviceSetFaceImage,
} from "../_lib.ts";

export function register(router: Router) {
  router.on("acesso_dispositivos_list", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data } = await ctx.sb
      .from("acesso_dispositivos")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .eq("ativo", true)
      .order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  });

  router.on("acesso_dispositivo_save", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id, nome, ip, porta, tipo, localizacao, modelo, via_bridge, api_login, api_password } = ctx.body as Any;
    if (!nome || !ip || !tipo) throw new AppError("VALIDATION_FAILED", "nome, ip e tipo são obrigatórios.");

    const row: Any = {
      nome, ip,
      porta: porta || 443,
      tipo,
      localizacao: localizacao || null,
      modelo: modelo || "iDFace",
    };
    if (typeof via_bridge === "boolean") row.via_bridge = via_bridge;
    if (api_login) row.api_login = api_login;
    if (api_password) row.api_password = api_password;

    if (id) {
      const { data, error } = await ctx.sb.from("acesso_dispositivos").update(row).eq("id", id).eq("escola_id", ctx.escola_id).select().single();
      if (error) throw new AppError("BAD_REQUEST", error.message);
      return successResponse(data);
    }
    const { data, error } = await ctx.sb.from("acesso_dispositivos").insert({ ...row, escola_id: ctx.escola_id }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse(data);
  });

  router.on("acesso_dispositivo_delete", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    await ctx.sb.from("acesso_dispositivos").update({ ativo: false }).eq("id", id).eq("escola_id", ctx.escola_id);
    return successResponse({ ok: true });
  });

  router.on("acesso_dispositivo_ping", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    const { data: device } = await ctx.sb.from("acesso_dispositivos").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
    if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");
    const r = await devicePing(ctx.sb, device);
    return successResponse({
      online: r.ok, status: r.status, error: r.error,
      ip: device.ip, porta: device.porta, via_bridge: !!device.via_bridge,
    });
  });

  router.on("acesso_dispositivo_sync", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
    const { data: device } = await ctx.sb.from("acesso_dispositivos").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
    if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");
    if (device.via_bridge) {
      const r = await devicePing(ctx.sb, device);
      return successResponse({ ok: r.ok, error: r.error, device_nome: device.nome, via_bridge: true });
    }
    try {
      const session = await getDeviceSession(ctx.sb, device);
      return successResponse({ ok: true, session, device_nome: device.nome });
    } catch (err) {
      return successResponse({ ok: false, error: err instanceof AppError ? err.message : String(err) });
    }
  });

  router.on("acesso_simpax_import", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { csv_text, dry_run } = ctx.body as Any;
    if (typeof csv_text !== "string" || csv_text.length < 50) {
      throw new AppError("VALIDATION_FAILED", "csv_text obrigatório (CSV decodificado em UTF-8).");
    }

    const lines = csv_text.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
    if (lines.length < 2) throw new AppError("VALIDATION_FAILED", "CSV vazio ou sem dados.");

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const r = parseSimpaxLine(lines[i]);
      if (r) rows.push(r);
    }

    const novos: Any[] = [];
    const atualizados: Any[] = [];
    const ignorados: Any[] = [];
    const sincroniaTs = new Date().toISOString();

    for (const r of rows) {
      const serial = r.identificacao.trim();
      if (!serial) { ignorados.push({ identificacao: r.identificacao, motivo: "sem serial" }); continue; }

      const { tipo, grupo_mapa, lado } = classificarSimpax(r.descricao, r.tipo_equipamento);
      const ativoFlag = r.ativo.toLowerCase() === "ativo";

      const meta = {
        ultima_comunicacao: parseSimpaxDate(r.ultima_comunicacao),
        ultimo_registro: parseSimpaxDate(r.data_ultimo_registro),
        total_registros: r.ultimo_registro && /^\d+$/.test(r.ultimo_registro) ? Number(r.ultimo_registro) : null,
        atestado: r.atestado || null,
        exige_bio: r.exige_bio === "Marcado",
        coletor_671: r.coletor_671 === "Marcado",
        contratante: r.contratante || null,
        refeitorio: r.refeitorio === "Marcado",
        estado: r.estado || null,
        tipo_registro: r.tipo_registro || null,
        tamanho_lbr: r.tamanho_lbr || null,
        possui_atualizacao: r.possui_atualizacao || null,
      };

      const { data: existing } = await ctx.sb
        .from("acesso_dispositivos")
        .select("id, nome, tipo, lado, grupo_mapa")
        .eq("escola_id", ctx.escola_id)
        .eq("serial_externo", serial)
        .maybeSingle();

      if (dry_run) {
        (existing ? atualizados : novos).push({ serial, descricao: r.descricao, tipo, grupo_mapa, lado, ativo: ativoFlag });
        continue;
      }

      if (existing) {
        const { error } = await ctx.sb
          .from("acesso_dispositivos")
          .update({
            nome: r.descricao || existing.nome,
            tipo, grupo_mapa, lado,
            modelo_detalhe: r.tipo_equipamento || null,
            simpax_meta: meta,
            simpax_ultima_sincronia: sincroniaTs,
            ativo: ativoFlag,
          })
          .eq("id", existing.id)
          .eq("escola_id", ctx.escola_id);
        if (error) ignorados.push({ serial, motivo: error.message });
        else atualizados.push({ serial, descricao: r.descricao });
      } else {
        const { error } = await ctx.sb.from("acesso_dispositivos").insert({
          escola_id: ctx.escola_id,
          serial_externo: serial,
          nome: r.descricao || `Terminal ${serial}`,
          ip: "", porta: 443, tipo, grupo_mapa, lado,
          localizacao: r.local || null,
          modelo: r.tipo_equipamento?.includes("idFace") ? "iDFace" : (r.tipo_equipamento || "Desconhecido"),
          modelo_detalhe: r.tipo_equipamento || null,
          simpax_meta: meta,
          simpax_ultima_sincronia: sincroniaTs,
          ativo: ativoFlag,
          via_bridge: true,
        });
        if (error) ignorados.push({ serial, motivo: error.message });
        else novos.push({ serial, descricao: r.descricao });
      }
    }

    return successResponse({
      total: rows.length,
      novos: novos.length, atualizados: atualizados.length, ignorados: ignorados.length,
      detalhe: { novos, atualizados, ignorados },
      dry_run: !!dry_run,
    });
  });

  router.on("acesso_dispositivos_mapa", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data, error } = await ctx.sb
      .from("v_acesso_dispositivos_mapa")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .order("grupo_mapa", { ascending: true })
      .order("lado", { ascending: true, nullsFirst: true })
      .order("nome", { ascending: true });
    if (error) throw new AppError("BAD_REQUEST", error.message);

    const grupos: Record<string, Any[]> = {};
    for (const d of data ?? []) {
      const g = d.grupo_mapa || "outros";
      (grupos[g] ??= []).push(d);
    }
    return successResponse({
      devices: data ?? [],
      grupos,
      resumo: {
        total: data?.length ?? 0,
        ok: data?.filter((d: Any) => d.status_mapa === "ok").length ?? 0,
        lento: data?.filter((d: Any) => d.status_mapa === "lento").length ?? 0,
        mudo: data?.filter((d: Any) => d.status_mapa === "mudo").length ?? 0,
        sem_dados: data?.filter((d: Any) => d.status_mapa === "sem_dados").length ?? 0,
        inativo: data?.filter((d: Any) => d.status_mapa === "inativo").length ?? 0,
      },
    });
  });

  // ─── alias para _save (UI usa _create) ───
  router.on("acesso_dispositivo_create", authGerente, async (ctx) => {
    return router.dispatch("acesso_dispositivo_save", ctx);
  });

  // ─── sincroniza todas faces para UM dispositivo ───
  router.on("acesso_dispositivo_sync_faces", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

    const { data: device } = await ctx.sb.from("acesso_dispositivos")
      .select("*").eq("id", id).eq("escola_id", ctx.escola_id).maybeSingle();
    if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");

    const { data: faces } = await ctx.sb.from("acesso_faces").select("*")
      .eq("escola_id", ctx.escola_id).eq("ativo", true).neq("sync_status", "aguardando_aprovacao");
    if (!faces?.length) return successResponse({ synced: 0, message: "Nenhuma face sincronizável." });

    let okCount = 0;
    let errCount = 0;
    const errors: string[] = [];

    try {
      const users = faces.map((f: Any) => ({ id: f.device_user_id, name: f.pessoa_nome, registration: f.pessoa_id }));
      const usersRes = await deviceEnrollUsers(ctx.sb, device, users);
      if (!usersRes.ok) {
        return successResponse({ ok: false, error: usersRes.error || `enroll_user HTTP ${usersRes.status}` });
      }

      for (const face of faces) {
        if (!face.foto_url) continue;
        try {
          const photoRes = await fetch(face.foto_url, { signal: AbortSignal.timeout(5000) });
          if (!photoRes.ok) { errCount++; continue; }
          const bytes = new Uint8Array(await photoRes.arrayBuffer());
          const r = await deviceSetFaceImage(ctx.sb, device, face.device_user_id, bytes);
          if (r.ok) okCount++;
          else { errCount++; errors.push(`${face.pessoa_nome}: ${r.error || `HTTP ${r.status}`}`); }
        } catch (err) {
          errCount++;
          errors.push(`${face.pessoa_nome}: ${String(err)}`);
        }
      }
    } catch (err) {
      return successResponse({ ok: false, error: err instanceof AppError ? err.message : String(err) });
    }

    return successResponse({ ok: true, device_nome: device.nome, sincronizadas: okCount, erros: errCount, detalhes: errors });
  });
}
