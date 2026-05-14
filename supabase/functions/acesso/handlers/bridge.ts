// Acesso — Lumied Bridge: token, status, hardware do daemon
import { Router, authGerente, successResponse, AppError } from "../../_shared/mod.ts";
import { type Any, authGerenteOrSecretaria, bridgeStatus, bridgeDispatchEphemeral } from "../_lib.ts";

export function register(router: Router) {
  // ─── daemon busca devices da escola via bridge_token (sem session token) ───
  router.on("acesso_bridge_devices", async (ctx) => {
    const { bridge_token } = ctx.body as Any;
    if (!bridge_token || typeof bridge_token !== "string" || !/^lbr_[0-9a-f]{32,128}$/i.test(bridge_token)) {
      throw new AppError("AUTH_REQUIRED", "bridge_token inválido.");
    }
    const { data: escola } = await ctx.sb.from("escolas")
      .select("id, bridge_token")
      .eq("bridge_token", bridge_token)
      .maybeSingle();
    if (!escola?.id) throw new AppError("AUTH_INVALID", "Token de bridge não reconhecido.");

    const { data: devices } = await ctx.sb.from("acesso_dispositivos")
      .select("id, nome, ip, porta, tipo, via_bridge, ativo")
      .eq("escola_id", escola.id)
      .eq("ativo", true)
      .eq("via_bridge", true);

    // Heartbeat: esse endpoint serve como sinal de "daemon vivo"
    await ctx.sb.from("escolas")
      .update({ bridge_ultimo_heartbeat: new Date().toISOString() })
      .eq("id", escola.id);

    return successResponse({
      escola_id: escola.id,
      devices: devices ?? [],
      daemon_event_path: "/event",
    });
  });

  router.on("acesso_bridge_status", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data: escola } = await ctx.sb.from("escolas")
      .select("bridge_token, bridge_ultimo_heartbeat")
      .eq("id", ctx.escola_id).maybeSingle();
    const status = await bridgeStatus(ctx.escola_id);
    const { data: pendentes } = await ctx.sb.from("acesso_bridge_comandos")
      .select("id, tipo, status, criado_em")
      .eq("escola_id", ctx.escola_id)
      .in("status", ["pendente", "em_execucao"])
      .order("criado_em", { ascending: false })
      .limit(20);
    return successResponse({
      token_configurado: !!escola?.bridge_token,
      ultimo_heartbeat_db: escola?.bridge_ultimo_heartbeat || null,
      gateway: status,
      comandos_em_voo: pendentes ?? [],
    });
  });

  router.on("acesso_bridge_hardware", authGerenteOrSecretaria, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const r = await bridgeDispatchEphemeral(ctx.escola_id, "hardware", {}, 8000);
    if (!r.ok) return successResponse({ ok: false, error: r.error || "Falha ao consultar bridge", status: r.status });
    return successResponse({ ok: true, hardware: r.body });
  });

  router.on("acesso_bridge_token_get", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const { data: escola } = await ctx.sb.from("escolas")
      .select("bridge_token")
      .eq("id", ctx.escola_id).maybeSingle();
    return successResponse({ bridge_token: escola?.bridge_token || null });
  });

  router.on("acesso_bridge_token_rotate", authGerente, async (ctx) => {
    if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const token = `lbr_${hex}`;
    const { error } = await ctx.sb.from("escolas")
      .update({ bridge_token: token, bridge_ultimo_heartbeat: null })
      .eq("id", ctx.escola_id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse({ bridge_token: token });
  });
}
