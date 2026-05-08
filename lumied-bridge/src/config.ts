import { readFileSync, existsSync } from "node:fs";

function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  const raw = readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}

loadDotEnv();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[lumied-bridge] env var obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

export interface Config {
  escolaId: string;
  bridgeToken: string;
  gatewayUrl: string;
  idfaceLogin: string;
  idfacePassword: string;
  idfacePasswords: Record<string, string>;
  eventListenerPort: number;
  eventListenerHost: string;
  logLevel: "debug" | "info" | "warn" | "error";
  // LPR (controle de acesso veicular) — opcional
  lprRtspUrl: string;            // ex: rtsp://user:pass@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0
  lprAlprUrl: string;            // ex: http://localhost:32168/v1/vision/alpr (CodeProject.AI)
  lprScanIntervalMs: number;     // ex: 2000
  lprConfidenceMin: number;      // 0..1 (default 0.85)
  lprFotoIncluir: boolean;       // anexa foto base64 nos eventos (default true)
  lprFotoMaxBytes: number;       // se jpeg > N, skip inclusão (default 250KB)
  lprGateWebhookUrl: string;     // POST quando placa autorizada (relé/Sonoff/ESP-Home)
  lprGateWebhookToken: string;   // Bearer opcional
}

let passwordsMap: Record<string, string> = {};
if (process.env.IDFACE_PASSWORDS) {
  try {
    passwordsMap = JSON.parse(process.env.IDFACE_PASSWORDS);
  } catch {
    console.warn("[lumied-bridge] IDFACE_PASSWORDS não é JSON válido, ignorando.");
  }
}

export const config: Config = {
  escolaId: required("LUMIED_ESCOLA_ID"),
  bridgeToken: required("LUMIED_BRIDGE_TOKEN"),
  gatewayUrl: process.env.LUMIED_GATEWAY_URL || "wss://lumied-bridge-gateway.ivyson.workers.dev",
  idfaceLogin: process.env.IDFACE_LOGIN || "admin",
  idfacePassword: process.env.IDFACE_PASSWORD || "",
  idfacePasswords: passwordsMap,
  eventListenerPort: Number(process.env.EVENT_LISTENER_PORT || 8765),
  eventListenerHost: process.env.EVENT_LISTENER_HOST || "",
  logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
  lprRtspUrl: process.env.LPR_RTSP_URL || "",
  lprAlprUrl: process.env.LPR_ALPR_URL || "",
  lprScanIntervalMs: Number(process.env.LPR_SCAN_INTERVAL_MS || 2000),
  lprConfidenceMin: Number(process.env.LPR_CONFIDENCE_MIN || 0.85),
  lprFotoIncluir: process.env.LPR_FOTO_INCLUIR !== "false",
  lprFotoMaxBytes: Number(process.env.LPR_FOTO_MAX_BYTES || 250 * 1024),
  lprGateWebhookUrl: process.env.LPR_GATE_WEBHOOK_URL || "",
  lprGateWebhookToken: process.env.LPR_GATE_WEBHOOK_TOKEN || "",
};

export function passwordFor(ip: string): string {
  return config.idfacePasswords[ip] || config.idfacePassword;
}
