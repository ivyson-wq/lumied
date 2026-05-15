import { networkInterfaces } from "node:os";
import { tolerantFetch } from "./http-tolerant.js";
import { config, passwordFor } from "./config.js";
import { log } from "./log.js";

interface RemoteDevice { id: string; nome: string; ip: string; porta: number; tipo: string }

function detectLanIp(): string {
  if (config.eventListenerHost) return config.eventListenerHost;
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

/** Busca lista de devices do edge function autenticado por bridge_token. */
export async function fetchDevices(): Promise<RemoteDevice[]> {
  const httpsUrl = config.gatewayUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  // Mas precisamos chamar o edge function, não o gateway. URL fixa do Supabase:
  const url = "https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/acesso";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "acesso_bridge_devices", bridge_token: config.bridgeToken }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`fetchDevices HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data: any = await res.json();
  if (data?.error) throw new Error(`fetchDevices: ${data.error}`);
  const inner = data?.data || data;
  return (inner?.devices || []) as RemoteDevice[];
}

/** Tenta setar callback URL nos iDFace. Best-effort — falha não derruba o daemon. */
export async function configureCallbacks(devices: RemoteDevice[]): Promise<void> {
  const lanIp = detectLanIp();
  const callbackUrl = `http://${lanIp}:${config.eventListenerPort}/event`;
  log.info(`auto-config: callback URL alvo = ${callbackUrl} (${devices.length} devices)`);

  for (const dev of devices) {
    try {
      await configureOne(dev, callbackUrl);
      log.info(`✓ ${dev.nome} (${dev.ip}) callback configurado`);
    } catch (e: any) {
      log.warn(`⚠️  ${dev.nome} (${dev.ip}) auto-config falhou — configure manualmente`, e?.message || String(e));
    }
  }
}

async function configureOne(dev: RemoteDevice, callbackUrl: string): Promise<void> {
  const password = passwordFor(dev.ip);
  if (!password) throw new Error(`sem senha para ${dev.ip}`);

  // 1. login
  const loginRes = await tolerantFetch(`https://${dev.ip}:${dev.porta}/login.fcgi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: config.idfaceLogin, password }),
  }, 8000);
  if (!loginRes.ok) throw new Error(`login HTTP ${loginRes.status}`);
  const loginData: any = await loginRes.json();
  const session = loginData?.session;
  if (!session) throw new Error("login sem session");

  // 2. config_server.fcgi — endpoint do iDFace pra setar URL de notificação de eventos
  //    Estrutura da Control iD: { server_url, server_port, server_path }
  const url = new URL(callbackUrl);
  const cfgRes = await tolerantFetch(`https://${dev.ip}:${dev.porta}/config_server.fcgi?session=${session}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enable_send_events: 1,
      server_address: url.hostname,
      server_port: Number(url.port || 80),
      server_path: url.pathname,
      server_protocol: url.protocol === "https:" ? "https" : "http",
    }),
  }, 8000);
  if (!cfgRes.ok) throw new Error(`config_server HTTP ${cfgRes.status}`);
}

/** Roda na inicialização: busca devices + auto-config callbacks. */
export async function runStartupAutoConfig(): Promise<void> {
  try {
    const devices = await fetchDevices();
    if (!devices.length) {
      log.info("auto-config: nenhum device via_bridge — pulando");
      return;
    }
    await configureCallbacks(devices);
  } catch (e: any) {
    log.warn("auto-config falhou — daemon segue rodando", e?.message || String(e));
  }
}
