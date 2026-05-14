// ═══════════════════════════════════════════════════════════════
//  Diplomas — helpers compartilhados (Onda 3 do refator)
//  Extraídos do index.ts monolítico (linhas 1-154 do original).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  resolveProfessora,
  resolveGerente,
  resolveSecretaria,
  resolveAlmoxarifado,
  resolveUsuario,
  getCorsHeaders,
  createLogger,
} from '../_shared/mod.ts'

// deno-lint-ignore no-explicit-any
export type Any = any

/** Context passado pra cada handler. Carrega tudo que serve() já resolveu. */
export interface HandlerCtx {
  req: Request
  sb: ReturnType<typeof createClient>
  body: Record<string, Any>
  action: string
  token: string
  clientIp: string
  cors: Record<string, string>
}

export const log = createLogger('diplomas')

/** json() local. Os handlers passam o cors do ctx pra preservar headers dinâmicos por request. */
export function json(data: unknown, status = 200, cors: Record<string, string> = getCorsHeaders()) {
  return new Response(JSON.stringify(data), { status, headers: cors })
}

export async function criarNotif(
  sb: Any,
  portal: string,
  destinatario: string,
  titulo: string,
  mensagem: string,
  tipo = 'info',
  escola_id?: string,
) {
  const row: Record<string, unknown> = { portal, destinatario, titulo, mensagem, tipo }
  if (escola_id) row.escola_id = escola_id
  await sb.from('notificacoes').insert(row)
}

// ── Verificação de horário de acesso da professora ───────────
export async function verificarHorarioAcesso(
  sb: ReturnType<typeof createClient>,
  professoraId: string,
): Promise<{ permitido: boolean; mensagem?: string }> {
  const now = new Date()
  const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const diaSemana = brNow.getDay()
  const { data: regras } = await sb
    .from('professora_horario_acesso').select('dia_semana, hora_inicio, hora_fim, ativo')
    .eq('professora_id', professoraId).eq('ativo', true)
  if (!regras || regras.length === 0) return { permitido: true }
  const regraHoje = regras.find((r: Any) => r.dia_semana === diaSemana)
  if (!regraHoje) {
    return { permitido: false, mensagem: 'Acesso não permitido neste dia da semana.' }
  }
  if (!regraHoje.hora_inicio || !regraHoje.hora_fim) return { permitido: true }
  const horaAtual = brNow.getHours() * 60 + brNow.getMinutes()
  const [hi, mi] = regraHoje.hora_inicio.split(':').map(Number)
  const [hf, mf] = regraHoje.hora_fim.split(':').map(Number)
  if (isNaN(hi) || isNaN(mi) || isNaN(hf) || isNaN(mf)) return { permitido: true }
  const inicio = hi * 60 + mi
  const fim = hf * 60 + mf
  if (horaAtual < inicio || horaAtual > fim) {
    return { permitido: false, mensagem: `Acesso permitido apenas das ${regraHoje.hora_inicio} às ${regraHoje.hora_fim}.` }
  }
  return { permitido: true }
}

// ── Session validators (thin wrappers — backwards compat com 100+ call sites) ──
export const getProfessora = (sb: ReturnType<typeof createClient>, token: string) => resolveProfessora(sb, token)
export const getGerente = (sb: ReturnType<typeof createClient>, token: string) => resolveGerente(sb, token)
export const getSecretaria = (sb: ReturnType<typeof createClient>, token: string) => resolveSecretaria(sb, token)
export const getAlmoxarifado = (sb: ReturnType<typeof createClient>, token: string) => resolveAlmoxarifado(sb, token)
export const getUsuario = (sb: ReturnType<typeof createClient>, token: string) => resolveUsuario(sb, token)

// ── Parent (Supabase Auth JWT) validator ─────────────────────
export async function getPaiEmail(
  sb: ReturnType<typeof createClient>,
  token: string,
  fallbackEmail?: string,
): Promise<string | null> {
  if (token) {
    try {
      const { data: { user } } = await sb.auth.getUser(token)
      if (user?.email) return user.email.toLowerCase().trim()
    } catch (e) { console.warn('[diplomas] getPaiEmail auth failed:', (e as Error).message) }
  }
  return fallbackEmail ? fallbackEmail.toLowerCase().trim() : null
}

// ── Pickup ETA helpers ──────────────────────────────────────
export async function calcEtaGoogleMaps(
  latPai: number, lonPai: number,
): Promise<{ etaMinutos: number; modo: string } | null> {
  const key = Deno.env.get('GOOGLE_MAPS_KEY')
  if (!key) return null
  const schoolLat = Deno.env.get('SCHOOL_LAT') || '-28.8628'
  const schoolLon = Deno.env.get('SCHOOL_LON') || '-51.5201'
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${latPai},${lonPai}` +
      `&destinations=${schoolLat},${schoolLon}` +
      `&mode=driving&language=pt-BR&key=${key}`
    const r = await fetch(url)
    const d = await r.json()
    const secs: number | undefined = d?.rows?.[0]?.elements?.[0]?.duration?.value
    if (!secs) return null
    return { etaMinutos: Math.ceil(secs / 60), modo: 'google_maps' }
  } catch {
    return null
  }
}

export function calcEtaLocal(latPai: number, lonPai: number): number {
  const schoolLat = parseFloat(Deno.env.get('SCHOOL_LAT') || '-28.8628')
  const schoolLon = parseFloat(Deno.env.get('SCHOOL_LON') || '-51.5201')
  const R = 6371
  const dLat = (schoolLat - latPai) * Math.PI / 180
  const dLon = (schoolLon - lonPai) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(latPai * Math.PI / 180) * Math.cos(schoolLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.max(1, Math.ceil(dist / 40 * 60)) // 40 km/h média urbana
}

// ── Mercado Livre OAuth ──────────────────────────────────────
export const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID') || ''
export const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET') || ''
export const ML_REDIRECT_URI = Deno.env.get('ML_REDIRECT_URI') ||
  `${Deno.env.get('SUPABASE_URL')}/functions/v1/diplomas?action=ml_oauth_callback`

export async function getMLToken(sb: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await sb.from('ml_tokens').select('*').order('atualizado_em', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  // Refresh se expirou (5min de margem)
  if (new Date(data.expires_at) <= new Date(Date.now() + 5 * 60000)) {
    try {
      const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&client_id=${ML_CLIENT_ID}&client_secret=${ML_CLIENT_SECRET}&refresh_token=${data.refresh_token}`,
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const t = await res.json()
        await sb.from('ml_tokens').update({
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq('id', data.id)
        return t.access_token
      }
    } catch (e) { console.warn('[diplomas] ML token refresh failed:', (e as Error).message) }
    return null
  }
  return data.access_token
}
