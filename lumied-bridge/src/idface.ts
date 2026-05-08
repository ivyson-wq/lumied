import { Agent, fetch as undiciFetch } from "undici";
import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { config, passwordFor } from "./config.js";
import { log } from "./log.js";
import { replacePlatesCache, getLprStats, type CachedPlate } from "./lpr.js";

const pexec = promisify(exec);

// iDFace usa cert self-signed → ignora validação TLS
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

interface DeviceAddr { id: string; ip: string; porta: number }

const sessionCache = new Map<string, { session: string; expires: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function url(d: DeviceAddr, path: string): string {
  return `https://${d.ip}:${d.porta}${path}`;
}

async function call(d: DeviceAddr, path: string, init: RequestInit & { body?: any } = {}, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await undiciFetch(url(d, path), {
      ...(init as any),
      dispatcher: insecureAgent,
      signal: ctrl.signal,
    }) as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}

async function login(d: DeviceAddr): Promise<string> {
  const cached = sessionCache.get(d.ip);
  if (cached && cached.expires > Date.now()) return cached.session;

  const password = passwordFor(d.ip);
  if (!password) throw new Error(`Sem senha configurada para ${d.ip} (defina IDFACE_PASSWORD ou IDFACE_PASSWORDS)`);

  const res = await call(d, "/login.fcgi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: config.idfaceLogin, password }),
  });
  if (!res.ok) throw new Error(`login.fcgi HTTP ${res.status}`);
  const data: any = await res.json();
  if (!data?.session) throw new Error("login.fcgi sem session");
  sessionCache.set(d.ip, { session: data.session, expires: Date.now() + SESSION_TTL_MS });
  log.debug(`iDFace ${d.ip} login ok`);
  return data.session;
}

async function withSession<T>(d: DeviceAddr, fn: (session: string) => Promise<T>): Promise<T> {
  let session = await login(d);
  try {
    return await fn(session);
  } catch (e: any) {
    // Sessão expirada → drop cache e re-login uma vez
    if (String(e).match(/401|403|session/i)) {
      sessionCache.delete(d.ip);
      session = await login(d);
      return await fn(session);
    }
    throw e;
  }
}

export interface CommandPayload {
  device: DeviceAddr;
  user?: { id: number; name: string; registration: string };
  users?: Array<{ id: number; name: string; registration: string }>;
  user_id?: number;
  photo_b64?: string;
  card_value?: number;
  // http_proxy
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body_b64?: string;
}

export async function execEnrollUser(p: CommandPayload): Promise<unknown> {
  const values = p.users ?? (p.user ? [p.user] : []);
  if (!values.length) throw new Error("enroll_user sem user/users");
  return withSession(p.device, async (session) => {
    const res = await call(p.device, `/create_objects.fcgi?session=${session}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "users", values }),
    });
    if (!res.ok) throw new Error(`create_objects users HTTP ${res.status}`);
    return res.json();
  });
}

export async function execEnrollFace(p: CommandPayload): Promise<unknown> {
  if (!p.user_id || !p.photo_b64) throw new Error("enroll_face exige user_id e photo_b64");
  const bytes = Buffer.from(p.photo_b64, "base64");
  return withSession(p.device, async (session) => {
    const ts = Math.floor(Date.now() / 1000);
    const res = await call(p.device, `/user_set_image.fcgi?session=${session}&user_id=${p.user_id}&timestamp=${ts}`, {
      method: "POST",
      body: bytes,
    }, 20000);
    if (!res.ok) throw new Error(`user_set_image HTTP ${res.status}`);
    return res.json().catch(() => ({ ok: true }));
  });
}

export async function execEnrollCard(p: CommandPayload): Promise<unknown> {
  if (p.card_value === undefined || p.user_id === undefined) throw new Error("enroll_card exige card_value e user_id");
  return withSession(p.device, async (session) => {
    const res = await call(p.device, `/create_objects.fcgi?session=${session}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "cards", values: [{ value: p.card_value, user_id: p.user_id }] }),
    });
    if (!res.ok) throw new Error(`create_objects cards HTTP ${res.status}`);
    return res.json();
  });
}

export async function execDeleteUser(p: CommandPayload): Promise<unknown> {
  if (p.user_id === undefined) throw new Error("delete_user exige user_id");
  return withSession(p.device, async (session) => {
    const res = await call(p.device, `/destroy_objects.fcgi?session=${session}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "users", where: { users: { id: p.user_id } } }),
    });
    if (!res.ok) throw new Error(`destroy_objects HTTP ${res.status}`);
    return res.json();
  });
}

export async function execPing(p: CommandPayload): Promise<unknown> {
  const res = await call(p.device, "/login.fcgi", { method: "GET" }, 5000);
  return { reachable: res.status < 500, status: res.status };
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path, "utf8");
    return buf.replace(/\0+$/, "").trim() || null;
  } catch { return null; }
}

async function readVcgencmdTemp(): Promise<number | null> {
  try {
    const { stdout } = await pexec("vcgencmd measure_temp", { timeout: 2000 });
    const m = stdout.match(/temp=(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

async function readThermalZoneTemp(): Promise<number | null> {
  const txt = await readTextOrNull("/sys/class/thermal/thermal_zone0/temp");
  if (!txt) return null;
  const n = parseInt(txt, 10);
  return Number.isFinite(n) ? n / 1000 : null;
}

export async function execHardware(): Promise<unknown> {
  const [model, vcTemp, thermalTemp] = await Promise.all([
    readTextOrNull("/proc/device-tree/model"),
    readVcgencmdTemp(),
    readThermalZoneTemp(),
  ]);
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const tempC = vcTemp ?? thermalTemp;
  return {
    pi_model: model,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    kernel: os.release(),
    cpu: { model: cpus[0]?.model || null, count: cpus.length },
    memory: {
      total_mb: Math.round(totalMem / 1024 / 1024),
      free_mb: Math.round(freeMem / 1024 / 1024),
      used_mb: Math.round((totalMem - freeMem) / 1024 / 1024),
    },
    load_avg: os.loadavg(),
    uptime_s: Math.round(os.uptime()),
    temp_c: tempC,
    temp_source: vcTemp != null ? "vcgencmd" : (thermalTemp != null ? "thermal_zone0" : null),
    node_version: process.version,
    daemon_uptime_s: Math.round(process.uptime()),
    ts: Date.now(),
  };
}

export async function execHttpProxy(p: CommandPayload): Promise<unknown> {
  if (!p.path || !p.method) throw new Error("http_proxy exige path e method");
  return withSession(p.device, async (session) => {
    const sep = p.path!.includes("?") ? "&" : "?";
    const finalPath = `${p.path}${sep}session=${session}`;
    const init: any = {
      method: p.method,
      headers: p.headers || {},
    };
    if (p.body_b64) init.body = Buffer.from(p.body_b64, "base64");
    const res = await call(p.device, finalPath, init);
    const text = await res.text();
    return { status: res.status, body: text };
  });
}

export type Tipo = "enroll_user" | "enroll_face" | "enroll_card" | "delete_user" | "ping" | "sync_all" | "http_proxy" | "hardware" | "lpr_sync" | "lpr_stats";

export async function dispatch(tipo: Tipo, payload: CommandPayload): Promise<unknown> {
  switch (tipo) {
    case "enroll_user": return execEnrollUser(payload);
    case "enroll_face": return execEnrollFace(payload);
    case "enroll_card": return execEnrollCard(payload);
    case "delete_user": return execDeleteUser(payload);
    case "ping": return execPing(payload);
    case "http_proxy": return execHttpProxy(payload);
    case "hardware": return execHardware();
    case "lpr_sync": {
      const plates = (payload as unknown as { plates?: CachedPlate[] }).plates;
      if (!Array.isArray(plates)) throw new Error("lpr_sync exige plates array");
      replacePlatesCache(plates);
      return { ok: true, count: plates.length };
    }
    case "lpr_stats": return getLprStats();
    case "sync_all": throw new Error("sync_all deve ser orquestrado pelo edge (envia enroll_user + enroll_face N vezes)");
    default: throw new Error(`tipo desconhecido: ${tipo}`);
  }
}
