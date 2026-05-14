// outbound-pulse-cron — agente diário de outbound (migrado de
// scripts/outbound-pulse.mjs pra eliminar dependência de GitHub Actions).
//
// Chamado via pg_cron em https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/outbound-pulse-cron
// Auth: header `x-cron-key: ${CRON_INTERNAL_KEY}` (mesmo padrão dos outros crons).
//
// Fluxo (idêntico ao script .mjs original):
//   1. Pull leads pendentes (gtm.outbound_pendentes, limit 40)
//   2. Pra cada lead: Anthropic Sonnet 4.6 personaliza a mensagem
//   3. Monta HTML + CSV
//   4. Envia e-mail via gtm.pulse_send_email
//   5. Atualiza próximo_passo_em de cada lead via gtm.lead_update_service

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://brgorknbrjlfwvrrlwxj.supabase.co'
const CRON_KEY = Deno.env.get('CRON_INTERNAL_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const CANAL_INTERVALO: Record<string, number> = {
  linkedin_follow: 1,
  linkedin_dm: 2,
  email_diagnostico: 3,
  whatsapp: 2,
  email_case: 3,
  ligacao: 2,
  email_breakup: 14,
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  )
}

function csvQuote(s: unknown): string {
  const str = String(s ?? '').replace(/\n/g, ' | ')
  return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
}

async function gtmCall(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gtm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  if (!res.ok) throw new Error(`${action} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

function gerarTemplate(lead: any): string {
  const decisor = lead.nome_decisor
  const nomePrimeiro = lead.nome_escola?.split(' ')[0] ?? 'direção'
  const TEMPLATES: Record<string, string | null> = {
    linkedin_follow: null,
    linkedin_dm: `Oi ${decisor ? decisor.split(' ')[0] : nomePrimeiro}, tudo bem?\n\nVi que a ${lead.nome_escola} é referência na região. Parabéns!\n\nEstou falando com direções de escolas de 150-500 alunos que estão usando ${lead.sistema_atual || 'sistemas separados'} e sentindo o mesmo desconforto: três sistemas soltos, boleto manual, comunicação no WhatsApp pessoal das professoras.\n\nSomos do Lumied — plataforma única que substitui tudo isso.\n\nVale 15min pra eu te mostrar um caso parecido com o de vocês?`,
    email_diagnostico: `Assunto: ${lead.nome_escola} — 15min sobre gestão escolar (não é pitch)\n\nBom dia,\n\nSou Ivyson, fundador da Lumied (plataforma de gestão escolar).\n\nNão estou pedindo reunião de vendas — estou pedindo 15 minutos de diagnóstico. Em troca, te mando um relatório de 1 página com:\n1. Quanto tempo sua equipe gasta por mês conciliando ${lead.sistema_atual || 'seus sistemas'} + planilhas\n2. Quanto de mensalidade atrasada pode ser recuperada com régua de cobrança automática\n3. 3 riscos LGPD que vejo em escolas parecidas com a de vocês\n\nTem 15min esta semana?`,
    whatsapp: `Oi, aqui é Ivyson da Lumied. Te mandei e-mail sobre um diagnóstico rápido para a ${lead.nome_escola}. Topa 15min no Zoom esta semana? Nem precisa ligar câmera.`,
    email_case: `Assunto: Case Maple Bear Caxias — recuperou R$ 47k em 4 meses\n\nA Maple Bear Caxias tinha 12% de inadimplência quando começou com o Lumied. Usando só a régua de cobrança automática + PIX integrado, caíram para 3,8% em 4 meses. Em reais: R$ 47.200 recuperados. O Lumied custou R$ 21,6k no mesmo período. ROI 2,2x só nesse módulo.`,
    ligacao: `Script: "Oi, aqui é Ivyson da Lumied. Te mandei e-mail sobre a Maple Bear ter recuperado R$ 47k de inadimplência. Posso te tomar 90 segundos?"`,
    email_breakup: `Assunto: Encerrando follow-up — ${lead.nome_escola}\n\nImagino que agora não é o momento certo. Vou parar de te escrever. Deixo: lumied.com.br/vs/escolaweb/ e lumied.com.br/blog/ pro caso de serem úteis.`,
  }
  return TEMPLATES[lead.canal_proximo] ?? TEMPLATES.email_diagnostico!
}

async function gerarMensagem(lead: any): Promise<{ assunto: string | null; corpo: string; observacao: string }> {
  if (lead.canal_proximo === 'linkedin_follow') {
    return {
      assunto: null,
      corpo: `[Ação manual] Seguir ${lead.nome_escola} no LinkedIn e curtir 2 posts recentes. Sem DM ainda.`,
      observacao: `Lead novo — iniciar sequência com follow no LinkedIn`,
    }
  }

  const tierInfo = lead.tier_info ?? { nome: 'Start', preco_anual_mes: 697 }
  const templateBase = gerarTemplate(lead)
  const prompt = `Você é estrategista de outbound B2B vendendo a Lumied (gestão escolar SaaS) para escolas privadas brasileiras.

Lead: ${lead.nome_escola} (${lead.cidade || '?'}/${lead.uf || '?'})
Decisior: ${lead.nome_decisor || 'direção'}
Alunos estimados: ${lead.alunos_estimados || '?'}
Sistema atual: ${lead.sistema_atual || '?'}
Tier sugerido Lumied: ${tierInfo.nome} (R$ ${tierInfo.preco_anual_mes}/mês anual)
Toque atual: T${lead.toque_atual || 0} → próximo: T${lead.toque_proximo} (canal: ${lead.canal_proximo})
Origem do lead: ${lead.origem || '?'}

Template base para o canal "${lead.canal_proximo}":
${templateBase}

Personalize o template acima com dados reais do lead. Use o nome da escola, cidade, e sistema atual onde couber.
Se faltar algum dado (decisor, sistema), use texto genérico que funcione sem o dado.
NUNCA invente números ou dados que não estejam acima.
Mantenha tom consultivo, direto, sem jargão de vendas excessivo.

Retorne SOMENTE JSON válido (sem markdown, sem explicação):
{"assunto": "string ou null se LinkedIn/WhatsApp/ligação", "corpo": "mensagem completa pronta pra colar (com quebras \\n)", "observacao": "1 linha sobre o estado deste lead"}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`)
    const data = await res.json()
    const raw = data.content?.[0]?.text || '{}'
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned)
  } catch (e) {
    console.warn(`[pulse] Claude falhou para ${lead.nome_escola}:`, e)
    let assunto: string | null = null
    let corpo = templateBase
    if (['email_diagnostico', 'email_case', 'email_breakup'].includes(lead.canal_proximo)) {
      const lines = templateBase.split('\n')
      if (lines[0].startsWith('Assunto:')) {
        assunto = lines[0].replace('Assunto:', '').trim()
        corpo = lines.slice(2).join('\n').trim()
      }
    }
    return { assunto, corpo, observacao: '[fallback — Claude falhou]' }
  }
}

function montarHTML(leads: any[], mensagens: any[]): { html: string; csv: string; novos: number; breakup: number } {
  const data = todayISO()
  const novos = leads.filter((l) => l.toque_atual === 0 || l.status === 'novo').length
  const breakup = leads.filter((l) => l.canal_proximo === 'email_breakup').length

  const linhas = leads.map((lead, i) => {
    const msg = mensagens[i] ?? {}
    const corpo = (msg.corpo ?? '').replace(/\n/g, '<br>')
    const waLink = lead.wa_link_template || (lead.telefone ? `https://wa.me/${String(lead.telefone).replace(/\D/g, '')}` : null)
    const crmLink = `https://admin.lumied.com.br/#lead-${lead.id}`
    const tierNome = lead.tier_info?.nome || lead.tier_sugerido || '?'
    const tierPreco = lead.tier_info?.preco_anual_mes || '?'
    return `<tr>
      <td><b>${esc(lead.nome_escola)}</b><br><small>${esc(lead.cidade || '')}/${esc(lead.uf || '')}</small></td>
      <td>${esc(tierNome)}<br><small>R$ ${tierPreco}/mês</small></td>
      <td>T${lead.toque_atual || 0} → T${lead.toque_proximo}</td>
      <td>${esc(lead.canal_proximo)}</td>
      <td style="max-width:340px;font-size:12px">${msg.assunto ? `<b>${esc(msg.assunto)}</b><br>` : ''}${corpo}<br><small style="color:#888">${esc(msg.observacao || '')}</small></td>
      <td style="white-space:nowrap">${waLink ? `<a href="${esc(waLink)}" style="margin-right:8px">WhatsApp</a>` : ''}<a href="${esc(crmLink)}">CRM</a></td>
    </tr>`
  }).join('\n')

  const html = `<h2 style="font-family:sans-serif">Pulse Outbound — ${data}</h2>
<p style="font-family:sans-serif">${leads.length} leads aguardando ação &middot; ${novos} novos &middot; ${breakup} em break-up</p>
<table border="1" cellpadding="8" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr style="background:#6B3FA0;color:#fff"><th>Escola</th><th>Tier</th><th>Toque</th><th>Canal</th><th>Mensagem</th><th>Links</th></tr>
  ${linhas}
</table>
<p style="font-family:sans-serif;font-size:12px;color:#888;margin-top:16px">Gerado por pg_cron + outbound-pulse-cron &middot; ${new Date().toISOString()}</p>`

  const csvHeader = 'escola,decisor,cidade,uf,alunos,tier,toque_proximo,canal,assunto,mensagem,wa_link,crm_link\n'
  const csvLinhas = leads.map((lead, i) => {
    const msg = mensagens[i] ?? {}
    const waLink = lead.wa_link_template || (lead.telefone ? `https://wa.me/${String(lead.telefone).replace(/\D/g, '')}` : '')
    return [
      csvQuote(lead.nome_escola),
      csvQuote(lead.nome_decisor || 'direção'),
      csvQuote(lead.cidade),
      csvQuote(lead.uf),
      csvQuote(lead.alunos_estimados),
      csvQuote(lead.tier_info?.nome || lead.tier_sugerido),
      csvQuote(lead.toque_proximo),
      csvQuote(lead.canal_proximo),
      csvQuote(msg.assunto || ''),
      csvQuote((msg.corpo || '').replace(/\n/g, ' | ')),
      csvQuote(waLink),
      csvQuote(`https://admin.lumied.com.br/#lead-${lead.id}`),
    ].join(',')
  }).join('\n')

  return { html, csv: csvHeader + csvLinhas, novos, breakup }
}

function b64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

async function run(): Promise<{ ok: boolean; summary: string }> {
  const data = todayISO()
  console.log(`[pulse] Iniciando — ${data}`)

  const leadsRes = await gtmCall('outbound_pendentes', { limit: 40 })
  const leads: any[] = leadsRes?.leads ?? leadsRes?.data?.leads ?? []
  const total = leadsRes?.total ?? leadsRes?.data?.total ?? leads.length

  if (total === 0 || leads.length === 0) {
    const html = `<p>Nenhum lead pendente para hoje (${data}).</p><p>Considere capturar leads novos via lead_capture.</p>`
    await gtmCall('pulse_send_email', { to: 'ivyson@gmail.com', subject: `Pulse Outbound — ${data} · fila zerada`, html })
    return { ok: true, summary: 'Fila zerada — aviso enviado' }
  }

  console.log(`[pulse] ${leads.length} leads. Gerando mensagens...`)
  const mensagens: any[] = []
  for (const lead of leads) mensagens.push(await gerarMensagem(lead))

  const { html, csv, novos, breakup } = montarHTML(leads, mensagens)

  const sendRes = await gtmCall('pulse_send_email', {
    to: 'ivyson@gmail.com',
    subject: `Pulse Outbound — ${data} · ${leads.length} leads`,
    html,
    csv_b64: b64(csv),
    csv_filename: `pulse-${data}.csv`,
  })
  const resendId = sendRes?.data?.resend_id ?? sendRes?.resend_id ?? null

  let atualizados = 0
  for (const lead of leads) {
    try {
      await gtmCall('lead_update_service', {
        id: lead.id,
        proximo_passo: `Aguardando resposta de ${lead.canal_proximo}`,
        proximo_passo_em: addDays(data, CANAL_INTERVALO[lead.canal_proximo] ?? 3),
      })
      atualizados++
    } catch (e) {
      console.warn(`[pulse] lead_update_service falhou ${lead.id}:`, e)
    }
  }

  return {
    ok: true,
    summary: `OK Pulse: ${leads.length} leads (${novos} novos, ${breakup} breakup) — Resend ${resendId} — ${atualizados}/${leads.length} atualizados`,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  const cronKey = req.headers.get('x-cron-key') ?? ''
  if (!CRON_KEY || cronKey !== CRON_KEY) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!ANTHROPIC_KEY) {
    return new Response('ANTHROPIC_API_KEY não setado', { status: 500 })
  }
  try {
    const result = await run()
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('[pulse] erro fatal:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
