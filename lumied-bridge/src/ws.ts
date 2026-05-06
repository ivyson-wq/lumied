import WebSocket from "ws";
import { config } from "./config.js";
import { log } from "./log.js";
import { dispatch, type Tipo, type CommandPayload } from "./idface.js";

const HEARTBEAT_MS = 30_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_INITIAL_MS;
let heartbeatTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "heartbeat", ts: Date.now() })); }
      catch (e) { log.warn("heartbeat send failed", String(e)); }
    }
  }, HEARTBEAT_MS);
}

interface IncomingCommand {
  req_id: string;
  tipo: Tipo;
  payload: CommandPayload;
}

async function handleCommand(msg: IncomingCommand) {
  log.info(`comando ${msg.tipo} req_id=${msg.req_id}`, { device: msg.payload?.device });
  try {
    const result = await dispatch(msg.tipo, msg.payload);
    sendRaw({ type: "command_result", req_id: msg.req_id, ok: true, payload: result });
    log.info(`✓ ${msg.tipo} req_id=${msg.req_id}`);
  } catch (e: any) {
    const error = e?.message || String(e);
    sendRaw({ type: "command_result", req_id: msg.req_id, ok: false, error });
    log.error(`✗ ${msg.tipo} req_id=${msg.req_id}`, error);
  }
}

export function sendRaw(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); }
    catch (e) { log.warn("ws send failed", String(e)); }
  } else {
    log.warn("ws not open — dropping message", obj);
  }
}

/** Encaminha um evento iDFace (recebido pelo HTTP listener) ao gateway. */
export function forwardEvent(payload: Record<string, unknown>): void {
  sendRaw({ type: "event", payload });
}

function connect(): void {
  if (shuttingDown) return;

  const url = `${config.gatewayUrl}/connect/${config.escolaId}?token=${encodeURIComponent(config.bridgeToken)}`;
  log.info(`conectando ao gateway ${config.gatewayUrl}…`);

  ws = new WebSocket(url, { handshakeTimeout: 15_000 });

  ws.on("open", () => {
    reconnectDelay = RECONNECT_INITIAL_MS;
    log.info("✓ conectado ao gateway");
    startHeartbeat();
  });

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); }
    catch { log.warn("mensagem inválida do gateway", raw.toString().slice(0, 200)); return; }

    if (msg.type === "welcome") { log.info("welcome", { escola_id: msg.escola_id }); return; }
    if (msg.type === "heartbeat_ack") return;

    // Comando do edge: vem em formato {req_id, tipo, payload, wait_ms}
    if (msg.req_id && msg.tipo) {
      handleCommand(msg as IncomingCommand).catch((e) => log.error("handler crashed", e));
      return;
    }

    log.debug("mensagem ignorada", msg);
  });

  ws.on("close", (code, reason) => {
    log.warn(`ws fechado code=${code} reason=${reason?.toString() || ""}`);
    clearHeartbeat();
    ws = null;
    if (!shuttingDown) scheduleReconnect();
  });

  ws.on("error", (err) => {
    log.error("ws erro", err.message);
  });
}

function scheduleReconnect(): void {
  log.info(`reconectando em ${Math.round(reconnectDelay / 1000)}s…`);
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

export function start(): void {
  shuttingDown = false;
  connect();
}

export function stop(): void {
  shuttingDown = true;
  clearHeartbeat();
  if (ws) {
    try { ws.close(1000, "shutdown"); } catch { /* ignore */ }
    ws = null;
  }
}
