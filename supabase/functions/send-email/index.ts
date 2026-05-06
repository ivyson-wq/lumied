// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: send-email
//  Envia notificações por e-mail (ausência, turno, atividade)
//  Usa Resend como provedor de e-mail (configurar RESEND_API_KEY)
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, getClientIP } from '../_shared/ratelimit.ts'
import { captureException } from '../_shared/sentry.ts'
import { resolveEscolaId } from '../_shared/tenant.ts'

let CORS: Record<string, string> = getCorsHeaders()

const ok  = (data: unknown)        => new Response(JSON.stringify(data), { headers: CORS })
const err = (msg: string, s = 400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS })

// ── Templates de e-mail (com branding dinâmico) ─────────────
function emailAusencia(body: Record<string, unknown>, escolaNome: string, cor: string, icone: string): { subject: string; html: string } {
  const { nomeResp, nomeCrianca, dataAusencia } = body
  const dataFmt = String(dataAusencia || '').split('-').reverse().join('/')
  return {
    subject: `Aviso de Ausência — ${nomeCrianca}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:${cor};">${icone} ${escolaNome} — Aviso de Ausência</h2>
        <p>O responsável <strong>${nomeResp}</strong> registrou uma ausência:</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Criança:</td><td style="padding:6px 12px;">${nomeCrianca}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Data:</td><td style="padding:6px 12px;">${dataFmt}</td></tr>
        </table>
        <p style="color:#666;font-size:13px;">Este é um e-mail automático do Portal ${escolaNome}.</p>
      </div>
    `,
  }
}

function emailTurno(body: Record<string, unknown>, escolaNome: string, cor: string, icone: string): { subject: string; html: string } {
  const { nomeResp, nomeCrianca, turno, serie, diasSemana } = body
  const dias = Array.isArray(diasSemana) ? (diasSemana as string[]).join(', ') : 'Todos os dias'
  return {
    subject: `Nova Solicitação de Turno — ${nomeCrianca}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:${cor};">${icone} ${escolaNome} — Solicitação de Turno</h2>
        <p>Nova solicitação recebida:</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Responsável:</td><td style="padding:6px 12px;">${nomeResp}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Criança:</td><td style="padding:6px 12px;">${nomeCrianca}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Série:</td><td style="padding:6px 12px;">${serie}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Turno:</td><td style="padding:6px 12px;">${turno}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Dias:</td><td style="padding:6px 12px;">${dias}</td></tr>
        </table>
        <p style="color:#666;font-size:13px;">Este é um e-mail automático do Portal ${escolaNome}.</p>
      </div>
    `,
  }
}

function emailAtividade(body: Record<string, unknown>, escolaNome: string, cor: string, icone: string): { subject: string; html: string } {
  const { nomeResp, nomeCrianca, serie, atividades } = body
  const lista = Array.isArray(atividades)
    ? (atividades as Array<{ nome: string; turma_selecionada: string }>)
        .map(a => `<li>${a.nome} — ${a.turma_selecionada || 'turma única'}</li>`).join('')
    : '<li>—</li>'
  return {
    subject: `Inscrição em Atividades — ${nomeCrianca}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:${cor};">${icone} ${escolaNome} — Inscrição em Atividades</h2>
        <p>Nova inscrição recebida:</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Responsável:</td><td style="padding:6px 12px;">${nomeResp}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Criança:</td><td style="padding:6px 12px;">${nomeCrianca}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Série:</td><td style="padding:6px 12px;">${serie}</td></tr>
        </table>
        <p><strong>Atividades:</strong></p>
        <ul>${lista}</ul>
        <p style="color:#666;font-size:13px;">Este é um e-mail automático do Portal ${escolaNome}.</p>
      </div>
    `,
  }
}

function emailCadastroFace(body: Record<string, unknown>, escolaNome: string, cor: string, icone: string): { subject: string; html: string } {
  const { pessoa_nome, pessoa_tipo, link } = body
  const tipoLabel = pessoa_tipo === 'aluno' ? 'aluno(a)' : (pessoa_tipo === 'responsavel' ? 'responsável' : 'colaborador(a)')
  return {
    subject: `📷 Cadastro facial — ${escolaNome}`,
    html: `
      <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;">
        <h2 style="color:${cor};margin:0 0 8px 0;">${icone} ${escolaNome}</h2>
        <p style="font-size:15px;line-height:1.6;margin:16px 0;">Olá!</p>
        <p style="font-size:15px;line-height:1.6;margin:16px 0;">
          A escola preparou um <strong>cadastro facial</strong> para o(a) ${tipoLabel} <strong>${pessoa_nome}</strong>.
          Esse cadastro permite o reconhecimento na entrada/saída sem precisar de cartão.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:${cor};color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">
            Cadastrar foto agora
          </a>
        </p>
        <div style="background:#f8f5f0;border-radius:10px;padding:16px;margin:24px 0;font-size:13px;line-height:1.6;color:#5a5249;">
          <strong style="color:#1a1a1a;">Dicas para uma boa foto:</strong><br>
          • Olhe diretamente para a câmera<br>
          • Boa iluminação no rosto, sem sombras<br>
          • Sem óculos escuros, boné ou máscara<br>
          • Rosto centralizado, próximo da câmera
        </div>
        <p style="font-size:13px;color:#666;margin:16px 0;">
          O link é válido por <strong>7 dias</strong>. Após o envio, a escola revisa e aprova manualmente.
        </p>
        <p style="font-size:12px;color:#999;margin:24px 0 0 0;">
          Se o botão acima não funcionar, copie este link: <br>
          <a href="${link}" style="color:${cor};word-break:break-all;">${link}</a>
        </p>
        <hr style="border:none;border-top:1px solid #e2dbd1;margin:32px 0 16px;">
        <p style="font-size:11px;color:#999;text-align:center;margin:0;">
          Este é um e-mail automático do Portal ${escolaNome}.
        </p>
      </div>
    `,
  }
}

// ── Handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  CORS = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {

  // Rate limiting (10 emails/min per IP)
  const ip = getClientIP(req)
  const rl = checkRateLimit(ip, 'upload') // reuse upload preset (10/min)
  if (!rl.allowed) return err(`Tente novamente em ${rl.retryAfterSeconds}s.`, 429)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return err('Body inválido') }

  const { tipo } = body

  // Carrega config da escola para branding (multi-tenant desde mig 236)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const escolaIdEmail = body.escola_id || await resolveEscolaId(req, sb)
  const { data: cfgRows } = await sb.from('escola_config').select('chave, valor').eq('escola_id', escolaIdEmail)
  const cfg: Record<string, any> = {}
  for (const r of cfgRows ?? []) cfg[r.chave] = r.valor
  const escolaNome = cfg.escola_nome || 'Escola'
  const cor = cfg.cor_primaria || '#C8102E'
  const icone = cfg.escola_icone || '🍁'
  const emailSender = cfg.escola_email_sender || Deno.env.get('EMAIL_SENDER') || 'noreply@escola.com.br'

  let email: { subject: string; html: string }

  switch (tipo) {
    case 'ausencia':  email = emailAusencia(body, escolaNome, cor, icone); break
    case 'turno':     email = emailTurno(body, escolaNome, cor, icone); break
    case 'atividade': email = emailAtividade(body, escolaNome, cor, icone); break
    case 'cadastro_face': email = emailCadastroFace(body, escolaNome, cor, icone); break
    default: return err('Tipo de e-mail não reconhecido: ' + tipo)
  }

  // Busca o e-mail destino:
  // - Para `cadastro_face`, vai para o responsável (body.to)
  // - Para os demais (ausência/turno/atividade), notifica a secretaria da escola
  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  const ESCOLA_EMAIL = cfg.escola_email_notif || Deno.env.get('ESCOLA_EMAIL') || cfg.escola_email_sender || 'secretaria@escola.com.br'
  const TO_EMAIL = (tipo === 'cadastro_face' && body.to) ? String(body.to) : ESCOLA_EMAIL

  if (!RESEND_KEY) {
    // Se Resend não está configurado, loga e retorna sucesso silencioso
    console.log('[send-email] RESEND_API_KEY não configurada. E-mail não enviado:', email.subject)
    return new Response(JSON.stringify({ sent: false, reason: 'RESEND_API_KEY não configurada' }), { status: 503, headers: CORS })
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: `${escolaNome} <${emailSender}>`,
        to: [TO_EMAIL],
        subject: email.subject,
        html: email.html,
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      console.error('[send-email] Resend error:', resp.status, errBody)
      return new Response(JSON.stringify({ sent: false, reason: 'Resend retornou ' + resp.status }), { status: 502, headers: CORS })
    }

    return ok({ sent: true })
  } catch (e) {
    console.error('[send-email] Fetch error:', e)
    return new Response(JSON.stringify({ sent: false, reason: 'Erro de conexão com Resend' }), { status: 502, headers: CORS })
  }

  } catch (error) {
    console.error('[send-email] Unhandled error:', error)
    captureException(error instanceof Error ? error : new Error(String(error)), { function: 'send-email' }).catch(() => {})
    return err('Erro interno do servidor.', 500)
  }
})
