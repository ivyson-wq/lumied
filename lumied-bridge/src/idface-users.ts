// ═══════════════════════════════════════════════════════════════
//  iDFace Users Puller — lista funcionários cadastrados no REP
//  Control iD via /load_objects.fcgi.
//
//  Comando WS: { tipo: "idface_users_pull", payload: {ip, porta, protocolo,
//      auth_modo, usuario, senha, url_login} }
//  Retorno:    { ok: true, users: [{id, name, registration}, ...] }
//              | { ok: false, error: "..." }
//
//  registration é o campo que o iDFace usa como "PIS" no AFD — é a
//  ponte de-para com afd_funcionarios.pis_afd no Lumied.
// ═══════════════════════════════════════════════════════════════

import { tolerantFetch, type TolerantResponse } from "./http-tolerant.js";
import { log } from "./log.js";

const TIMEOUT_MS = 25_000;

export interface IdfaceUsersPullPayload {
  ip: string;
  porta: number;
  protocolo: "http" | "https";
  auth_modo: "controlid_session" | "form_login" | "basic" | "none";
  usuario?: string;
  senha?: string;
  url_login?: string;
}

interface IdfaceUser {
  id?: number | string;
  name?: string;
  registration?: string;
  pis?: string;
  role?: string;
}

function baseUrl(p: IdfaceUsersPullPayload): string {
  return `${p.protocolo}://${p.ip}:${p.porta}`;
}

async function fetchTimeout(url: string, init: any = {}): Promise<TolerantResponse> {
  return tolerantFetch(url, init, TIMEOUT_MS);
}

/** Login Control iD — POST /login.fcgi {login, password} → session */
async function controlidLogin(p: IdfaceUsersPullPayload): Promise<string> {
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

export async function execIdfaceUsersPull(p: IdfaceUsersPullPayload): Promise<{ ok: boolean; users?: Array<{ id: string; name: string; registration: string }>; error?: string; total?: number }> {
  try {
    if (p.auth_modo !== "controlid_session") {
      return { ok: false, error: `auth_modo '${p.auth_modo}' não suportado para idface_users_pull (apenas controlid_session por enquanto).` };
    }
    const session = await controlidLogin(p);
    const url = `${baseUrl(p)}/load_objects.fcgi?session=${session}`;
    const res = await fetchTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "users" }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `load_objects HTTP ${res.status} ${txt.slice(0, 200)}` };
    }
    const data: any = await res.json();
    const raw: IdfaceUser[] = Array.isArray(data?.users) ? data.users : [];
    const users = raw
      .map((u): { id: string; name: string; registration: string } => ({
        id: String(u.id ?? ""),
        name: String(u.name ?? "").trim(),
        registration: String(u.registration ?? u.pis ?? "").trim(),
      }))
      .filter(u => u.registration);
    log.info(`iDFace ${p.ip}: ${users.length} usuários listados`);
    return { ok: true, users, total: users.length };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
