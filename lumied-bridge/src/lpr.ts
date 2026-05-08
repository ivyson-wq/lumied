// ═══════════════════════════════════════════════════════════════
//  LPR (License Plate Recognition) — Fase 3 multi-cam
//
//  - 1 worker por câmera (Map<camera_id, CameraState>).
//  - Configuração via DB (lpr_cameras_sync). Fallback: env LPR_RTSP_URL
//    cria uma câmera "env-default" enquanto nenhuma vem do DB.
//  - ROI polygon (point-in-polygon) descarta detecções fora da área.
//  - Acionamento: webhook OU GPIO direto (libgpiod), exclusivos por câmera.
// ═══════════════════════════════════════════════════════════════

import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { log } from "./log.js";
import { forwardEvent } from "./ws.js";

const pexec = promisify(exec);

// ── Tipos ────────────────────────────────────────────────────────

export interface CachedPlate {
  id: string;
  placa: string;
  ativo: boolean;
  validade_inicio: string | null;
  validade_fim: string | null;
  janela_horaria: Record<string, Array<{ inicio: string; fim: string }>> | null;
  apelido: string | null;
}

export interface CameraConfig {
  id: string;
  nome: string;
  rtsp_url: string;
  alpr_url: string;
  scan_interval_ms: number;
  confidence_min: number;
  roi_polygon: Array<{ x: number; y: number }> | null;
  gate_webhook_url: string | null;
  gate_webhook_token: string | null;
  gpio_pin: number | null;
  gpio_pulse_ms: number;
  ativa: boolean;
}

interface CameraState {
  config: CameraConfig;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  recentReads: Map<string, number>;
}

const DEBOUNCE_MS = 30_000;
// FFmpeg snapshot é fixo 1280x720 — pra normalizar coords de bbox em ROI
const SNAP_WIDTH = 1280;
const SNAP_HEIGHT = 720;

const cameras = new Map<string, CameraState>();
let platesCache = new Map<string, CachedPlate>();

// ── Cache de placas (mantém compat com lpr_sync) ─────────────────
function normalizePlate(p: string): string {
  return p.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function replacePlatesCache(plates: CachedPlate[]): void {
  const m = new Map<string, CachedPlate>();
  for (const p of plates) m.set(normalizePlate(p.placa), p);
  platesCache = m;
  log.info(`LPR placas cache atualizado: ${m.size}`);
}

// ── Sync câmeras do DB ───────────────────────────────────────────
export function syncCamerasFromDb(configs: CameraConfig[]): { count: number; ativas: number } {
  const newIds = new Set(configs.map((c) => c.id));
  // env-default sai quando vem qualquer câmera do DB
  if (configs.length > 0 && cameras.has("env-default")) stopCamera("env-default");
  // remove câmeras que sumiram
  for (const id of Array.from(cameras.keys())) {
    if (id === "env-default") continue;
    if (!newIds.has(id)) stopCamera(id);
  }
  // (re)inicia
  for (const cfg of configs) {
    stopCamera(cfg.id);
    if (cfg.ativa && cfg.rtsp_url && cfg.alpr_url) startCamera(cfg);
  }
  // se DB veio vazio, fallback pra env (se houver)
  if (configs.length === 0) bootEnvCamera();
  return {
    count: cameras.size,
    ativas: Array.from(cameras.values()).filter((c) => c.timer !== null).length,
  };
}

export function getLprStats() {
  return {
    enabled: cameras.size > 0,
    cameras: Array.from(cameras.values()).map((c) => ({
      id: c.config.id,
      nome: c.config.nome,
      ativa: c.config.ativa,
      tem_roi: !!(c.config.roi_polygon && c.config.roi_polygon.length >= 3),
      gate: c.config.gate_webhook_url ? "webhook" : c.config.gpio_pin != null ? "gpio" : "off",
      cached_reads: c.recentReads.size,
    })),
    plates_cached: platesCache.size,
  };
}

// ── Snapshot público (lpr_snapshot comando) ──────────────────────
export async function execLprSnapshot(payload: { camera_id?: string }): Promise<unknown> {
  let target: CameraState | null = null;
  if (payload.camera_id && cameras.has(payload.camera_id)) {
    target = cameras.get(payload.camera_id)!;
  } else if (!payload.camera_id && cameras.size === 1) {
    target = Array.from(cameras.values())[0];
  } else if (!payload.camera_id && cameras.has("env-default")) {
    target = cameras.get("env-default")!;
  }
  if (!target) return { jpeg_b64: null, error: "Câmera não encontrada (use camera_id ou tenha apenas 1 ativa)" };
  const jpeg = await snapshotJpeg(target.config.rtsp_url);
  if (!jpeg) return { jpeg_b64: null, error: "FFmpeg falhou ao capturar snapshot" };
  return { jpeg_b64: jpeg.toString("base64"), width: SNAP_WIDTH, height: SNAP_HEIGHT };
}

// ── FFmpeg snapshot ──────────────────────────────────────────────
async function snapshotJpeg(rtspUrl: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const args = [
      "-rtsp_transport", "tcp",
      "-i", rtspUrl,
      "-frames:v", "1",
      "-vf", `scale=${SNAP_WIDTH}:${SNAP_HEIGHT}`,
      "-f", "image2",
      "-q:v", "5",
      "-loglevel", "error",
      "pipe:1",
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => { err += c.toString(); });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 8000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else { log.warn(`ffmpeg falhou code=${code} ${err.slice(0,200)}`); resolve(null); }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      log.warn(`ffmpeg erro: ${e.message} (instalado? apt install ffmpeg)`);
      resolve(null);
    });
  });
}

// ── ALPR ─────────────────────────────────────────────────────────
interface AlprDetection {
  plate: string;
  confidence: number;
  x_min?: number; y_min?: number; x_max?: number; y_max?: number;
}

async function runAlpr(jpeg: Buffer, alprUrl: string): Promise<AlprDetection | null> {
  const fd = new FormData();
  fd.append("image", new Blob([jpeg], { type: "image/jpeg" }), "frame.jpg");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(alprUrl, { method: "POST", body: fd, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { log.warn(`ALPR HTTP ${res.status}`); return null; }
    const data = await res.json() as { predictions?: any[]; results?: any[] };
    const preds = data.predictions || data.results || [];
    if (!preds.length) return null;
    const top = preds.reduce<any>((best, p) => {
      const c = p.confidence ?? p.score ?? p.dscore ?? 0;
      const bc = best ? (best.confidence ?? best.score ?? best.dscore ?? -1) : -1;
      return c > bc ? p : best;
    }, null);
    if (!top) return null;
    const plate = String(top.plate ?? top.label ?? "");
    const confidence = Number(top.confidence ?? top.score ?? top.dscore ?? 0);
    if (!plate) return null;
    return {
      plate: normalizePlate(plate),
      confidence,
      x_min: Number(top.x_min ?? top.xmin ?? top.x1 ?? NaN),
      y_min: Number(top.y_min ?? top.ymin ?? top.y1 ?? NaN),
      x_max: Number(top.x_max ?? top.xmax ?? top.x2 ?? NaN),
      y_max: Number(top.y_max ?? top.ymax ?? top.y2 ?? NaN),
    };
  } catch (e) {
    log.warn(`ALPR erro: ${String(e)}`);
    return null;
  }
}

// ── Point-in-polygon (ray casting) ───────────────────────────────
function pointInPolygon(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isInRoi(det: AlprDetection, polygon: Array<{ x: number; y: number }> | null): boolean {
  if (!polygon || polygon.length < 3) return true;
  if (!Number.isFinite(det.x_min) || !Number.isFinite(det.x_max)) return true; // bbox indisponível, não bloqueia
  const cx = ((det.x_min! + det.x_max!) / 2) / SNAP_WIDTH;
  const cy = ((det.y_min! + det.y_max!) / 2) / SNAP_HEIGHT;
  return pointInPolygon(cx, cy, polygon);
}

// ── Match contra cache de placas ─────────────────────────────────
type Motivo = "autorizado" | "nao_cadastrada" | "fora_validade" | "fora_horario" | "inativa";
interface MatchResult { autorizado: boolean; motivo: Motivo; placa_id: string | null }

const DIA_KEYS = ["dom","seg","ter","qua","qui","sex","sab"];

function matchPlate(placa: string): MatchResult {
  const cached = platesCache.get(placa);
  if (!cached) return { autorizado: false, motivo: "nao_cadastrada", placa_id: null };
  if (!cached.ativo) return { autorizado: false, motivo: "inativa", placa_id: cached.id };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (cached.validade_inicio && today < cached.validade_inicio) return { autorizado: false, motivo: "fora_validade", placa_id: cached.id };
  if (cached.validade_fim && today > cached.validade_fim) return { autorizado: false, motivo: "fora_validade", placa_id: cached.id };
  if (cached.janela_horaria) {
    const dia = DIA_KEYS[now.getDay()];
    const janelas = cached.janela_horaria[dia];
    if (!janelas || !janelas.length) return { autorizado: false, motivo: "fora_horario", placa_id: cached.id };
    const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    const ok = janelas.some((j) => hhmm >= j.inicio && hhmm <= j.fim);
    if (!ok) return { autorizado: false, motivo: "fora_horario", placa_id: cached.id };
  }
  return { autorizado: true, motivo: "autorizado", placa_id: cached.id };
}

// ── Acionamento (webhook OU GPIO) ────────────────────────────────
async function fireGate(cfg: CameraConfig, placa: string, placaId: string | null): Promise<void> {
  if (cfg.gpio_pin != null && cfg.gpio_pin >= 0) {
    await fireGpio(cfg.gpio_pin, cfg.gpio_pulse_ms);
    return;
  }
  if (cfg.gate_webhook_url) {
    await fireGateWebhook(cfg, placa, placaId);
  }
}

async function fireGateWebhook(cfg: CameraConfig, placa: string, placaId: string | null): Promise<void> {
  if (!cfg.gate_webhook_url) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.gate_webhook_token) headers.Authorization = `Bearer ${cfg.gate_webhook_token}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(cfg.gate_webhook_url, {
      method: "POST", headers,
      body: JSON.stringify({ placa, placa_id: placaId, camera_id: cfg.id, ts: new Date().toISOString() }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    log.info(`gate webhook → ${res.status} (cam=${cfg.nome} placa=${placa})`);
  } catch (e) {
    log.warn(`gate webhook falhou: ${String(e)}`);
  }
}

async function fireGpio(pin: number, pulseMs: number): Promise<void> {
  try {
    await pexec(`gpioset gpiochip0 ${pin}=1`, { timeout: 1000 });
    await new Promise((r) => setTimeout(r, Math.max(50, Math.min(pulseMs, 5000))));
    await pexec(`gpioset gpiochip0 ${pin}=0`, { timeout: 1000 });
    log.info(`GPIO ${pin} pulsed ${pulseMs}ms`);
  } catch (e) {
    log.warn(`GPIO ${pin} falhou: ${String(e)} (instalado? apt install gpiod)`);
  }
}

// ── Loop por câmera ──────────────────────────────────────────────
function emitEvent(cfg: CameraConfig, jpeg: Buffer | null, evt: Record<string, unknown>): void {
  evt.camera_id = cfg.id;
  if (config.lprFotoIncluir && jpeg && jpeg.length <= config.lprFotoMaxBytes) {
    evt.foto_b64 = jpeg.toString("base64");
  }
  forwardEvent(evt);
}

async function tick(state: CameraState): Promise<void> {
  if (state.inFlight) return;
  state.inFlight = true;
  const cfg = state.config;
  try {
    const jpeg = await snapshotJpeg(cfg.rtsp_url);
    if (!jpeg) return;
    const det = await runAlpr(jpeg, cfg.alpr_url);
    if (!det) return;

    if (det.confidence < cfg.confidence_min) {
      emitEvent(cfg, jpeg, {
        kind: "lpr",
        placa_lida: det.plate, placa_id: null,
        confidence: det.confidence,
        autorizado: false, motivo: "baixa_confianca",
        ts: new Date().toISOString(),
      });
      return;
    }

    // ROI: detecções fora do polígono são descartadas inteiramente
    if (!isInRoi(det, cfg.roi_polygon)) return;

    // Debounce por câmera
    const last = state.recentReads.get(det.plate);
    if (last && Date.now() - last < DEBOUNCE_MS) return;
    state.recentReads.set(det.plate, Date.now());
    if (state.recentReads.size > 200) {
      const cutoff = Date.now() - DEBOUNCE_MS * 2;
      for (const [k, v] of state.recentReads) if (v < cutoff) state.recentReads.delete(k);
    }

    const m = matchPlate(det.plate);
    log.info(`LPR[${cfg.nome}] ${det.plate} conf=${det.confidence.toFixed(2)} → ${m.motivo}`);

    emitEvent(cfg, jpeg, {
      kind: "lpr",
      placa_lida: det.plate, placa_id: m.placa_id,
      confidence: det.confidence,
      autorizado: m.autorizado, motivo: m.motivo,
      ts: new Date().toISOString(),
    });

    if (m.autorizado) void fireGate(cfg, det.plate, m.placa_id);
  } finally {
    state.inFlight = false;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────
function startCamera(cfg: CameraConfig): void {
  const safeUrl = cfg.rtsp_url.replace(/:\/\/[^@]+@/, "://***@");
  const gate = cfg.gpio_pin != null ? `gpio${cfg.gpio_pin}` : (cfg.gate_webhook_url ? "webhook" : "off");
  const roi = cfg.roi_polygon && cfg.roi_polygon.length >= 3 ? `roi${cfg.roi_polygon.length}` : "noroi";
  log.info(`LPR câmera "${cfg.nome}" iniciando: rtsp=${safeUrl} interval=${cfg.scan_interval_ms}ms conf>=${cfg.confidence_min} ${roi} gate=${gate}`);
  const state: CameraState = { config: cfg, timer: null, inFlight: false, recentReads: new Map() };
  state.timer = setInterval(() => {
    tick(state).catch((e) => log.error(`lpr tick crashed [${cfg.nome}]`, String(e)));
  }, cfg.scan_interval_ms);
  cameras.set(cfg.id, state);
}

function stopCamera(id: string): void {
  const c = cameras.get(id);
  if (!c) return;
  if (c.timer) clearInterval(c.timer);
  cameras.delete(id);
  log.info(`LPR câmera "${c.config.nome}" parada`);
}

function bootEnvCamera(): void {
  if (!config.lprRtspUrl) return;
  if (cameras.has("env-default")) return;
  startCamera({
    id: "env-default",
    nome: "Câmera padrão (.env)",
    rtsp_url: config.lprRtspUrl,
    alpr_url: config.lprAlprUrl,
    scan_interval_ms: config.lprScanIntervalMs,
    confidence_min: config.lprConfidenceMin,
    roi_polygon: null,
    gate_webhook_url: config.lprGateWebhookUrl || null,
    gate_webhook_token: config.lprGateWebhookToken || null,
    gpio_pin: null,
    gpio_pulse_ms: 500,
    ativa: true,
  });
}

export function startLpr(): void {
  if (!config.lprAlprUrl && !config.lprRtspUrl) {
    log.info("LPR desabilitado (sem env LPR_RTSP_URL/LPR_ALPR_URL — aguardando lpr_cameras_sync do edge)");
    return;
  }
  bootEnvCamera();
}

export function stopLpr(): void {
  for (const id of Array.from(cameras.keys())) stopCamera(id);
}
