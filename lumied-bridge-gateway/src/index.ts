// ═══════════════════════════════════════════════════════════════
//  Lumied Bridge Gateway (Cloudflare Worker + Durable Object)
//
//  Roteia comandos entre a edge function `acesso` (Supabase) e os
//  daemons "Lumied Bridge" rodando na LAN de cada escola.
//
//  Endpoints:
//   - WS  /connect/:escola_id?token=lbr_…  (bridge → gateway)
//   - POST /dispatch/:escola_id            (edge → bridge, Bearer INTERNAL_SECRET)
//   - GET  /status/:escola_id              (edge consulta se bridge online)
//   - GET  /health                         (liveness)
//
//  Cada DO (BridgeRoom) é endereçado por escola_id e mantém UMA
//  conexão WS ativa por vez (reconexões substituem a anterior).
// ═══════════════════════════════════════════════════════════════

export interface Env {
  BRIDGE_DO: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  INTERNAL_SECRET: string;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "health") {
      return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
    }

    // /connect/<escola_id> — bridge handshake (WSS upgrade)
    if (parts[0] === "connect" && parts[1]) {
      const escolaId = parts[1];
      const token = url.searchParams.get("token") || extractBearer(request);
      if (!token) return jsonErr("Missing bridge token", 401);
      if (request.headers.get("Upgrade") !== "websocket") return jsonErr("Expected WebSocket", 400);

      const valid = await validateBridgeToken(env, escolaId, token);
      if (!valid) return jsonErr("Invalid bridge token for this escola", 403);

      const stub = env.BRIDGE_DO.get(env.BRIDGE_DO.idFromName(escolaId));
      const fwd = new Request(`https://do/connect?escola_id=${escolaId}`, request);
      return stub.fetch(fwd);
    }

    // /dispatch/<escola_id> — edge envia comando ao bridge
    if (parts[0] === "dispatch" && parts[1]) {
      if (!checkInternal(request, env)) return jsonErr("Unauthorized", 401);
      const escolaId = parts[1];
      const stub = env.BRIDGE_DO.get(env.BRIDGE_DO.idFromName(escolaId));
      return stub.fetch(new Request(`https://do/dispatch?escola_id=${escolaId}`, request));
    }

    // /status/<escola_id> — edge consulta status
    if (parts[0] === "status" && parts[1]) {
      if (!checkInternal(request, env)) return jsonErr("Unauthorized", 401);
      const escolaId = parts[1];
      const stub = env.BRIDGE_DO.get(env.BRIDGE_DO.idFromName(escolaId));
      return stub.fetch(new Request(`https://do/status`, request));
    }

    return jsonErr("Not found", 404);
  },
};

function jsonErr(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: cors });
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function checkInternal(req: Request, env: Env): boolean {
  return extractBearer(req) === env.INTERNAL_SECRET;
}

async function validateBridgeToken(env: Env, escolaId: string, token: string): Promise<boolean> {
  // Validate UUID-shape escolaId before sending to PostgREST
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(escolaId)) return false;
  if (!/^lbr_[0-9a-f]{32,128}$/i.test(token)) return false;

  const url = `${env.SUPABASE_URL}/rest/v1/escolas?id=eq.${escolaId}&bridge_token=eq.${encodeURIComponent(token)}&select=id`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as Array<{ id: string }>;
  return Array.isArray(rows) && rows.length === 1 && rows[0].id === escolaId;
}

// ═══════════════════════════════════════════════════════════════
//  Durable Object: BridgeRoom — uma instância por escola
// ═══════════════════════════════════════════════════════════════

interface PendingResult {
  resolve: (v: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeRoom {
  private state: DurableObjectState;
  private env: Env;
  private bridgeWs: WebSocket | null = null;
  private escolaId: string | null = null;
  private lastHeartbeat = 0;
  private pending = new Map<string, PendingResult>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      this.escolaId = url.searchParams.get("escola_id");
      return this.handleConnect();
    }
    if (url.pathname === "/dispatch") {
      this.escolaId = url.searchParams.get("escola_id") || this.escolaId;
      return this.handleDispatch(request);
    }
    if (url.pathname === "/status") {
      return Response.json({
        ok: true,
        connected: !!this.bridgeWs,
        last_heartbeat: this.lastHeartbeat || null,
        escola_id: this.escolaId,
        pending: this.pending.size,
      });
    }
    return new Response("Not found", { status: 404 });
  }

  private handleConnect(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Substitui conexão anterior (só uma bridge ativa por escola)
    if (this.bridgeWs) {
      try { this.bridgeWs.close(1000, "Replaced by new connection"); } catch (_) { /* ignore */ }
    }

    server.accept();
    this.bridgeWs = server;
    this.lastHeartbeat = Date.now();
    this.touchHeartbeat();

    server.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
        this.handleBridgeMessage(msg).catch((e) => console.error("Bridge msg error:", e));
      } catch (e) {
        console.error("Bridge parse error:", e);
      }
    });

    const onClose = () => {
      if (this.bridgeWs === server) this.bridgeWs = null;
    };
    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

    server.send(JSON.stringify({ type: "welcome", escola_id: this.escolaId, ts: Date.now() }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleBridgeMessage(msg: { type?: string; req_id?: string; payload?: unknown; ok?: boolean }) {
    this.lastHeartbeat = Date.now();

    if (msg.type === "heartbeat") {
      this.touchHeartbeat();
      this.bridgeWs?.send(JSON.stringify({ type: "heartbeat_ack", ts: Date.now() }));
      return;
    }

    if (msg.type === "event") {
      // iDFace event → repassa para acesso_evento_callback
      const payload = (msg.payload || {}) as Record<string, unknown>;
      try {
        await fetch(`${this.env.SUPABASE_URL}/functions/v1/acesso`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "acesso_evento_callback",
            escola_id: this.escolaId,
            ...payload,
          }),
        });
      } catch (e) {
        console.error("Forward event error:", e);
      }
      return;
    }

    if (msg.type === "command_result" && msg.req_id) {
      const pending = this.pending.get(msg.req_id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg);
        this.pending.delete(msg.req_id);
      }
      // Persist result into acesso_bridge_comandos (best-effort)
      this.persistResult(msg).catch((e) => console.error("Persist result error:", e));
      return;
    }
  }

  private async handleDispatch(request: Request): Promise<Response> {
    if (!this.bridgeWs) {
      return Response.json({ ok: false, error: "Bridge offline" }, { status: 503 });
    }

    let body: { req_id?: string; wait_ms?: number; tipo?: string; payload?: unknown };
    try { body = await request.json(); } catch { return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

    const reqId = body.req_id || crypto.randomUUID();
    const waitMs = Math.min(body.wait_ms ?? 0, 30_000); // teto de 30s

    const cmd = { ...body, req_id: reqId };
    try {
      this.bridgeWs.send(JSON.stringify(cmd));
    } catch (e) {
      this.bridgeWs = null;
      return Response.json({ ok: false, error: `Bridge WS send failed: ${String(e)}` }, { status: 503 });
    }

    if (waitMs <= 0) {
      return Response.json({ ok: true, req_id: reqId, queued: true });
    }

    const result = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve({ ok: false, error: "Bridge response timeout", req_id: reqId, timeout: true });
      }, waitMs);
      this.pending.set(reqId, { resolve, timer });
    });

    return Response.json(result);
  }

  private async touchHeartbeat() {
    if (!this.escolaId) return;
    try {
      await fetch(
        `${this.env.SUPABASE_URL}/rest/v1/escolas?id=eq.${this.escolaId}`,
        {
          method: "PATCH",
          headers: {
            apikey: this.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ bridge_ultimo_heartbeat: new Date().toISOString() }),
        },
      );
    } catch (e) {
      console.error("Heartbeat update error:", e);
    }
  }

  private async persistResult(msg: { req_id?: string; ok?: boolean }) {
    if (!msg.req_id) return;
    const status = msg.ok ? "concluido" : "erro";
    await fetch(
      `${this.env.SUPABASE_URL}/rest/v1/acesso_bridge_comandos?id=eq.${msg.req_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: this.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status,
          resultado: msg,
          concluido_em: new Date().toISOString(),
        }),
      },
    );
  }
}
