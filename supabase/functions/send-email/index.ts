// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: send-email
//  Envia notificações por e-mail (ausência, turno, atividade)
//  Usa Resend como provedor de e-mail (configurar RESEND_API_KEY)
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const ok  = (data: unknown)        => new Response(JSON.stringify(data), { headers: CORS })
const err = (msg: string, s = 400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS })

// ── Templates de e-mail ──────────────────────────────────────
function emailAusencia(body: Record<string, unknown>): { subject: string; html: string } {
  const { nomeResp, nomeCrianca, dataAusencia } = body
  const dataFmt = String(dataAusencia || '').split('-').reverse().join('/')
  return {
    subject: `Aviso de Ausência — ${nomeCrianca}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#C8102E;">🍁 Maple Bear — Aviso de Ausência</h2>
        <p>O responsável <strong>${nomeResp}</strong> registrou uma ausência:</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Criança:</td><td style="padding:6px 12px;">${nomeCrianca}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Data:</td><td style="padding:6px 12px;">${dataFmt}</td></tr>
        </table>
        <p style="color:#666;font-size:13px;">Este é um e-mail automático do Portal Maple Bear.</p>
      </div>
    `,
  }
}

function emailTurno(body: Record<string, unknown>): { subject: string; html: string } {
  const { nomeResp, nomeCrianca, turno, serie, diasSemana } = body
  const dias = Array.isArray(diasSemana) ? (diasSemana as string[]).join(', ') : 'Todos os dias'
  return {
    subject: `Nova Solicitação de Turno — ${nomeCrianca}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#C8102E;">🍁 Maple Bear — Solicitação de Turno</h2>
        <p>Nova solicitação recebida:</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Responsável:</td><td style="padding:6px 12px;">${nomeResp}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Criança:</td><td style="padding:6px 12px;">${nomeCrianca}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Série:</td><td style="padding:6px 12px;">${serie}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Turno:</td><td style="padding:6px 12px;">${turno}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Dias:</td><td style="padding:6px 12px;">${dias}</td></tr>
        </table>
        <p style="color:#666;font-size:13px;">Este é um e-mail automático do Portal Maple Bear.</p>
      </div>
    `,
  }
}

function emailAtividade(body: Record<string, unknown>): { subject: string; html: string } {
  const { nomeResp, nomeCrianca, serie, atividades } = body
  const lista = Array.isArray(atividades)
    ? (atividades as Array<{ nome: string; turma_selecionada: string }>)
        .map(a => `<li>${a.nome} — ${a.turma_selecionada || 'turma única'}</li>`).join('')
    : '<li>—</li>'
  return {
    subject: `Inscrição em Atividades — ${nomeCrianca}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#C8102E;">🍁 Maple Bear — Inscrição em Atividades</h2>
        <p>Nova inscrição recebida:</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Responsável:</td><td style="padding:6px 12px;">${nomeResp}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Criança:</td><td style="padding:6px 12px;">${nomeCrianca}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Série:</td><td style="padding:6px 12px;">${serie}</td></tr>
        </table>
        <p><strong>Atividades:</strong></p>
        <ul>${lista}</ul>
        <p style="color:#666;font-size:13px;">Este é um e-mail automático do Portal Maple Bear.</p>
      </div>
    `,
  }
}

// ── Handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return err('Body inválido') }

  const { tipo } = body
  let email: { subject: string; html: string }

  switch (tipo) {
    case 'ausencia':  email = emailAusencia(body); break
    case 'turno':     email = emailTurno(body); break
    case 'atividade': email = emailAtividade(body); break
    default: return err('Tipo de e-mail não reconhecido: ' + tipo)
  }

  // Busca o e-mail da escola para enviar a notificação
  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  const ESCOLA_EMAIL = Deno.env.get('ESCOLA_EMAIL') || 'secretaria@maplebear-cs.com.br'

  if (!RESEND_KEY) {
    // Se Resend não está configurado, loga e retorna sucesso silencioso
    console.log('[send-email] RESEND_API_KEY não configurada. E-mail não enviado:', email.subject)
    return ok({ sent: false, reason: 'RESEND_API_KEY não configurada' })
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Maple Bear Portal <noreply@maplebear-cs.com.br>',
        to: [ESCOLA_EMAIL],
        subject: email.subject,
        html: email.html,
      }),
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      console.error('[send-email] Resend error:', resp.status, errBody)
      return ok({ sent: false, reason: 'Resend retornou ' + resp.status })
    }

    return ok({ sent: true })
  } catch (e) {
    console.error('[send-email] Fetch error:', e)
    return ok({ sent: false, reason: 'Erro de conexão com Resend' })
  }
})
