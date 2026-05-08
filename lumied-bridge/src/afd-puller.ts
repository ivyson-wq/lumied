// ═══════════════════════════════════════════════════════════════
//  AFD Puller — busca arquivo AFD (Portaria 671) do REP físico
//  na LAN da escola via HTTP/HTTPS.
//
//  Suporta:
//    - controlid_session (Control iD iDFace/iDClass): /login.fcgi → session na query
//    - form_login (Henry/Madis genérico): POST form-urlencoded com cookie session
//    - basic (Topdata): HTTP Basic auth
//    - none: GET puro
//
//  Comando WS: { tipo: "afd_pull", payload: {ip, porta, protocolo, auth_modo,
//     usuario, senha, url_login, url_afd_template, dataini, datafim} }
//  Retorno: { ok: true, afd_content: "..." } | { ok: false, error: "..." }
// ═══════════════════════════════════════════════════════════════

import { Agent, fetch as undiciFetch } from "undici";
import { log } from "./log.js";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const TIMEOUT_MS = 25_000;

export interface AfdPullPayload {
  ip: string;
  porta: number;
  protocolo: "http" | "https";
  auth_modo: "controlid_session" | "form_login" | "basic" | "none";
  usuario?: string;
  senha?: string;
  url_login?: string;
  url_afd_template: string;     // path com {DATAINI}/{DATAFIM}
  dataini: string;              // DDMMAAAA
  datafim: string;              // DDMMAAAA
}

function baseUrl(p: AfdPullPayload): string {
  return `${p.protocolo}://${p.ip}:${p.porta}`;
}

function fillPath(template: string, dataini: string, datafim: string): string {
  return template.replace(/\{DATAINI\}/g, dataini).replace(/\{DATAFIM\}/g, datafim);
}

function appendSession(path: string, session: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}session=${session}`;
}

async function fetchTimeout(url: string, init: any = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await undiciFetch(url, {
      ...init,
      dispatcher: insecureAgent,
      signal: ctrl.signal,
    }) as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}

/** Modo Control iD: POST /login.fcgi {login, password} → session string */
async function controlidLogin(p: AfdPullPayload): Promise<string> {
  const url = `${baseUrl(p)}/login.fcgi`;
  const res = await fetchTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: p.usuario || "admin", password: p.senha || "" }),
  });
  if (!res.ok) throw new Error(`login.fcgi HTTP ${res.status}`);
  const data: any = await res.json();
  if (!data?.session) throw new Error("login.fcgi sem session");
  return data.session;
}

/** Modo form_login: POST <url_login> form-urlencoded e captura cookies. */
async function formLogin(p: AfdPullPayload): Promise<string> {
  if (!p.url_login) throw new Error("url_login obrigatório no modo form_login");
  const url = `${baseUrl(p)}${p.url_login}`;
  const body = new URLSearchParams();
  body.set("login", p.usuario || "");
  body.set("usuario", p.usuario || "");
  body.set("password", p.senha || "");
  body.set("senha", p.senha || "");
  const res = await fetchTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual" as any,
  });
  // Aceita 200/302 — captura cookie da resposta
  const setCookie = (res.headers as any).getSetCookie?.() || res.headers.get("set-cookie");
  if (!setCookie) {
    if (res.status >= 400) throw new Error(`login HTTP ${res.status}`);
    return "";
  }
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((c: string) => c.split(";")[0]).join("; ");
}

/** Executa o pull AFD e retorna conteúdo bruto. */
export async function execAfdPull(p: AfdPullPayload): Promise<{ ok: boolean; afd_content?: string; error?: string }> {
  if (!p.ip || !p.url_afd_template || !p.dataini || !p.datafim) {
    return { ok: false, error: "Payload inválido (ip, url_afd_template, dataini, datafim obrigatórios)" };
  }
  log.info(`afd_pull → ${p.protocolo}://${p.ip}:${p.porta} ${p.dataini}-${p.datafim} (${p.auth_modo})`);

  try {
    let afdPath = fillPath(p.url_afd_template, p.dataini, p.datafim);
    const headers: Record<string, string> = {};

    switch (p.auth_modo) {
      case "controlid_session": {
        const session = await controlidLogin(p);
        afdPath = appendSession(afdPath, session);
        break;
      }
      case "form_login": {
        const cookie = await formLogin(p);
        if (cookie) headers["Cookie"] = cookie;
        break;
      }
      case "basic": {
        const b64 = Buffer.from(`${p.usuario || ""}:${p.senha || ""}`).toString("base64");
        headers["Authorization"] = `Basic ${b64}`;
        break;
      }
      case "none": break;
      default: return { ok: false, error: `auth_modo desconhecido: ${p.auth_modo}` };
    }

    const url = `${baseUrl(p)}${afdPath}`;
    const res = await fetchTimeout(url, { method: "GET", headers });
    if (!res.ok) {
      return { ok: false, error: `download HTTP ${res.status}` };
    }
    const text = await res.text();
    if (!text || text.length < 30) {
      return { ok: false, error: `resposta vazia ou inválida (${text.length} bytes)` };
    }
    // Heurística: AFD começa com "1" (header) ou pelo menos tem linhas que começam com "3" (eventos)
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const hasHeader = lines.some((l) => l.startsWith("1"));
    const hasEvents = lines.some((l) => l.startsWith("3"));
    if (!hasHeader && !hasEvents) {
      // Pode ser HTML de erro disfarçado de 200
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      return { ok: false, error: `resposta não parece AFD: "${snippet}…"` };
    }
    log.info(`✓ afd_pull baixou ${lines.length} linhas (${text.length} bytes)`);
    return { ok: true, afd_content: text };
  } catch (e: any) {
    const msg = e?.message || String(e);
    log.warn(`afd_pull falhou: ${msg}`);
    return { ok: false, error: msg };
  }
}
