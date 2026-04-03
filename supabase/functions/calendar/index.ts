// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: calendar
//  Gestão de reuniões: gestoras, horários, agendamento
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, getClientIP } from '../_shared/ratelimit.ts'
import { captureException } from '../_shared/sentry.ts'

let CORS: Record<string, string> = getCorsHeaders()

const ok  = (data: unknown)        => new Response(JSON.stringify(data), { headers: CORS })
const err = (msg: string, s = 400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS })

Deno.serve(async (req) => {
  CORS = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {

  // Rate limiting
  const ip = getClientIP(req)
  const rl = checkRateLimit(ip, 'api')
  if (!rl.allowed) return err(`Tente novamente em ${rl.retryAfterSeconds}s.`, 429)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return err('Body inválido') }
  const { action } = body

  // ── gestoras_list ──────────────────────────────────────
  if (action === 'gestoras_list') {
    const { data } = await sb.from('gestoras').select('*').order('cargo')
    return ok(data || [])
  }

  // ── gestoras_update ────────────────────────────────────
  if (action === 'gestoras_update') {
    const { id, nome, email, calendar_id } = body as { id: string; nome: string; email: string; calendar_id: string }
    if (!id) return err('ID obrigatório')
    const { error } = await sb.from('gestoras').update({ nome, email, calendar_id }).eq('id', id)
    if (error) return err(error.message)
    return ok({ success: true })
  }

  // ── horarios_list ──────────────────────────────────────
  if (action === 'horarios_list') {
    const { gestora_id } = body as { gestora_id: string }
    if (!gestora_id) return err('gestora_id obrigatório')
    const { data } = await sb.from('horarios_disponiveis')
      .select('*').eq('gestora_id', gestora_id)
      .order('dia_semana').order('hora_inicio')
    return ok(data || [])
  }

  // ── horarios_create ────────────────────────────────────
  if (action === 'horarios_create') {
    const { gestora_id, dia_semana, hora_inicio, hora_fim } = body as {
      gestora_id: string; dia_semana: number; hora_inicio: string; hora_fim: string
    }
    if (!gestora_id || !hora_inicio || !hora_fim) return err('Campos obrigatórios faltando')
    if (hora_inicio >= hora_fim) return err('Horário de início deve ser antes do fim')
    const { data, error } = await sb.from('horarios_disponiveis')
      .insert({ gestora_id, dia_semana, hora_inicio, hora_fim }).select().single()
    if (error) return err(error.message)
    return ok(data)
  }

  // ── horarios_delete ────────────────────────────────────
  if (action === 'horarios_delete') {
    const { id } = body as { id: string }
    if (!id) return err('ID obrigatório')
    await sb.from('horarios_disponiveis').delete().eq('id', id)
    return ok({ success: true })
  }

  // ── slots_disponiveis ──────────────────────────────────
  // Retorna slots livres para as próximas N semanas
  if (action === 'slots_disponiveis') {
    const { gestora_id, semanas } = body as { gestora_id: string; semanas: number }
    if (!gestora_id) return err('gestora_id obrigatório')
    const weeks = semanas || 4

    // 1. Busca horários recorrentes da gestora
    const { data: horarios } = await sb.from('horarios_disponiveis')
      .select('*').eq('gestora_id', gestora_id)
    if (!horarios?.length) return ok([])

    // 2. Busca reuniões já agendadas no período
    const hoje = new Date()
    const fim = new Date(hoje)
    fim.setDate(fim.getDate() + weeks * 7)
    const hojeFmt = hoje.toISOString().split('T')[0]
    const fimFmt = fim.toISOString().split('T')[0]

    const { data: ocupados } = await sb.from('reunioes')
      .select('data_reuniao, hora_inicio')
      .eq('gestora_id', gestora_id)
      .eq('status', 'agendada')
      .gte('data_reuniao', hojeFmt)
      .lte('data_reuniao', fimFmt)

    const ocupadoSet = new Set((ocupados || []).map(r => `${r.data_reuniao}_${r.hora_inicio}`))

    // 3. Gera slots livres
    const slots: { data: string; data_fmt: string; hora_inicio: string; hora_fim: string }[] = []
    const diasPT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    for (let d = 1; d <= weeks * 7; d++) {
      const dt = new Date(hoje)
      dt.setDate(hoje.getDate() + d)
      const diaSemana = dt.getDay() // 0=dom, 1=seg, etc.
      if (diaSemana === 0 || diaSemana === 6) continue

      const dtStr = dt.toISOString().split('T')[0]
      for (const h of horarios) {
        if (h.dia_semana !== diaSemana) continue
        const key = `${dtStr}_${h.hora_inicio}`
        if (ocupadoSet.has(key)) continue

        const dataFmt = `${diasPT[diaSemana]} ${dt.getDate().toString().padStart(2, '0')}/${(dt.getMonth() + 1).toString().padStart(2, '0')}`
        slots.push({
          data: dtStr,
          data_fmt: dataFmt,
          hora_inicio: h.hora_inicio.substring(0, 5),
          hora_fim: h.hora_fim.substring(0, 5),
        })
      }
    }

    return ok(slots)
  }

  // ── agendar_reuniao ────────────────────────────────────
  if (action === 'agendar_reuniao') {
    const { gestora_id, email_resp, nome_resp, data_reuniao, hora_inicio, hora_fim, assunto } = body as {
      gestora_id: string; email_resp: string; nome_resp: string
      data_reuniao: string; hora_inicio: string; hora_fim: string; assunto: string
    }
    if (!gestora_id || !email_resp || !data_reuniao || !hora_inicio) {
      return err('Campos obrigatórios faltando')
    }

    // Verifica se o slot ainda está livre
    const { data: existente } = await sb.from('reunioes')
      .select('id').eq('gestora_id', gestora_id)
      .eq('data_reuniao', data_reuniao).eq('hora_inicio', hora_inicio)
      .eq('status', 'agendada').maybeSingle()

    if (existente) return err('Este horário já foi reservado. Escolha outro.')

    const { data, error } = await sb.from('reunioes')
      .insert({ gestora_id, email_resp, nome_resp, data_reuniao, hora_inicio, hora_fim, assunto })
      .select().single()
    if (error) return err(error.message)
    return ok(data)
  }

  // ── minhas_reunioes ────────────────────────────────────
  if (action === 'minhas_reunioes') {
    const { email } = body as { email: string }
    if (!email) return err('E-mail obrigatório')
    const { data } = await sb.from('reunioes')
      .select('*, gestoras(nome, cargo)')
      .ilike('email_resp', email)
      .eq('status', 'agendada')
      .gte('data_reuniao', new Date().toISOString().split('T')[0])
      .order('data_reuniao')
    return ok(data || [])
  }

  // ── reunioes_list (admin) ──────────────────────────────
  if (action === 'reunioes_list') {
    const { data } = await sb.from('reunioes')
      .select('*, gestoras(nome, cargo)')
      .eq('status', 'agendada')
      .gte('data_reuniao', new Date().toISOString().split('T')[0])
      .order('data_reuniao')
    return ok(data || [])
  }

  // ── cancelar_reuniao ───────────────────────────────────
  if (action === 'cancelar_reuniao') {
    const { id } = body as { id: string }
    if (!id) return err('ID obrigatório')
    const { error } = await sb.from('reunioes')
      .update({ status: 'cancelada' }).eq('id', id)
    if (error) return err(error.message)
    return ok({ success: true })
  }

  return err('Ação não reconhecida: ' + action, 400)

  } catch (error) {
    console.error('[calendar] Unhandled error:', error)
    captureException(error instanceof Error ? error : new Error(String(error)), { function: 'calendar' }).catch(() => {})
    return err('Erro interno do servidor.', 500)
  }
})
