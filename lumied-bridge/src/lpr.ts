// ═══════════════════════════════════════════════════════════════
//  LPR (License Plate Recognition) — Fase 1
//
//  Loop: ffmpeg snapshot RTSP → POST CodeProject.AI ALPR →
//        match in-memory cache → forwardEvent (kind:'lpr').
//
//  Cache de placas: Map em memória, sincronizado pelo edge via
//  comando "lpr_sync" (vide idface.ts dispatch).
// ═══════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { config } from "./config.js";
import { log } from "./log.js";
import { forwardEvent } from "./ws.js";

export interface CachedPlate {
  id: string;
  placa: string;
  ativo: boolean;
  validade_inicio: string | null;     // YYYY-MM-DD
  validade_fim: string | null;
  janela_horaria: Record<string, Array<{ inicio: string; fim: string }>> | null;
  apelido: string | null;
}

const DEBOUNCE_MS = 30_000;

let platesCache = new Map<string, CachedPlate>();
let scanTimer: NodeJS.Timeout | null = null;
let inFlight = false;
const recentReads = new Map<string, number>(); // placa → ts da última leitura

function normalizePlate(p: string): string {
  return p.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function replacePlatesCache(plates: CachedPlate[]): void {
  const m = new Map<string, CachedPlate>();
  for (const p of plates) m.set(normalizePlate(p.placa), p);
  platesCache = m;
  log.info(`LPR cache atualizado: ${m.size} placas`);
}

export function getLprStats() {
  return {
    enabled: !!(config.lprRtspUrl && config.lprAlprUrl),
    plates_cached: platesCache.size,
    scan_interval_ms: config.lprScanIntervalMs,
    confidence_min: config.lprConfidenceMin,
  };
}

// ── snapshot via ffmpeg (pipe stdout, sem temp file) ─────────────
async function snapshotJpeg(rtspUrl: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const args = [
      "-rtsp_transport", "tcp",
      "-i", rtspUrl,
      "-frames:v", "1",
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

// ── ALPR via CodeProject.AI (ou compatível) ──────────────────────
interface AlprResult { plate: string; confidence: number }

async function runAlpr(jpeg: Buffer): Promise<AlprResult | null> {
  const fd = new FormData();
  fd.append("image", new Blob([jpeg], { type: "image/jpeg" }), "frame.jpg");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(config.lprAlprUrl, { method: "POST", body: fd, signal: ctrl.signal });
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
    return { plate: normalizePlate(plate), confidence };
  } catch (e) {
    log.warn(`ALPR erro: ${String(e)}`);
    return null;
  }
}

// ── decisão: autorizado? ─────────────────────────────────────────
type Motivo = "autorizado" | "nao_cadastrada" | "fora_validade" | "fora_horario" | "inativa";
interface MatchResult { autorizado: boolean; motivo: Motivo; placa_id: string | null }

const DIA_KEYS = ["dom","seg","ter","qua","qui","sex","sab"];

function matchPlate(placa: string): MatchResult {
  const cached = platesCache.get(placa);
  if (!cached) return { autorizado: false, motivo: "nao_cadastrada", placa_id: null };
  if (!cached.ativo) return { autorizado: false, motivo: "inativa", placa_id: cached.id };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (cached.validade_inicio && today < cached.validade_inicio) {
    return { autorizado: false, motivo: "fora_validade", placa_id: cached.id };
  }
  if (cached.validade_fim && today > cached.validade_fim) {
    return { autorizado: false, motivo: "fora_validade", placa_id: cached.id };
  }

  if (cached.janela_horaria) {
    const dia = DIA_KEYS[now.getDay()];
    const janelas = cached.janela_horaria[dia];
    if (!janelas || !janelas.length) return { autorizado: false, motivo: "fora_horario", placa_id: cached.id };
    const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    const ok = janelas.some(j => hhmm >= j.inicio && hhmm <= j.fim);
    if (!ok) return { autorizado: false, motivo: "fora_horario", placa_id: cached.id };
  }
  return { autorizado: true, motivo: "autorizado", placa_id: cached.id };
}

// ── tick do loop ─────────────────────────────────────────────────
async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const jpeg = await snapshotJpeg(config.lprRtspUrl);
    if (!jpeg) return;
    const det = await runAlpr(jpeg);
    if (!det) return;

    if (det.confidence < config.lprConfidenceMin) {
      // Baixa confiança: ainda emite evento (visibilidade) mas marca
      forwardEvent({
        kind: "lpr",
        placa_lida: det.plate,
        placa_id: null,
        confidence: det.confidence,
        autorizado: false,
        motivo: "baixa_confianca",
        ts: new Date().toISOString(),
      });
      return;
    }

    // Debounce: mesma placa em 30s = ignora (carro parado, múltiplas leituras)
    const last = recentReads.get(det.plate);
    if (last && Date.now() - last < DEBOUNCE_MS) return;
    recentReads.set(det.plate, Date.now());
    if (recentReads.size > 200) {
      const cutoff = Date.now() - DEBOUNCE_MS * 2;
      for (const [k, v] of recentReads) if (v < cutoff) recentReads.delete(k);
    }

    const m = matchPlate(det.plate);
    log.info(`LPR ${det.plate} conf=${det.confidence.toFixed(2)} → ${m.motivo}`);

    forwardEvent({
      kind: "lpr",
      placa_lida: det.plate,
      placa_id: m.placa_id,
      confidence: det.confidence,
      autorizado: m.autorizado,
      motivo: m.motivo,
      ts: new Date().toISOString(),
    });
  } finally {
    inFlight = false;
  }
}

export function startLpr(): void {
  if (!config.lprRtspUrl) {
    log.info("LPR desabilitado (LPR_RTSP_URL não configurada)");
    return;
  }
  if (!config.lprAlprUrl) {
    log.warn("LPR: LPR_RTSP_URL setada mas LPR_ALPR_URL ausente — LPR não inicia");
    return;
  }
  const safeUrl = config.lprRtspUrl.replace(/:\/\/[^@]+@/, "://***@");
  log.info(`LPR ativo: rtsp=${safeUrl} interval=${config.lprScanIntervalMs}ms conf>=${config.lprConfidenceMin}`);
  scanTimer = setInterval(() => {
    tick().catch((e) => log.error("lpr tick crashed", String(e)));
  }, config.lprScanIntervalMs);
}

export function stopLpr(): void {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
}
