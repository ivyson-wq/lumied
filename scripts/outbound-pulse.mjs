#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Outbound Pulse — Lumied Sales Agent
//  Roda via GitHub Actions 1× por dia (07:00 BRT)
//  Pulls leads → gera mensagens via Claude Sonnet 4.6 → envia CSV+HTML ao Ivyson
// ═══════════════════════════════════════════════════════════════

import { writeFileSync } from 'fs';

const CRON_KEY      = process.env.CRON_INTERNAL_KEY || 'lumied_cron_dbb4070f6b5601bb23bd2cb38d373bea';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://brgorknbrjlfwvrrlwxj.supabase.co';

// ── Validação ──
if (!CRON_KEY || !ANTHROPIC_KEY) {
  console.error('[pulse] ERRO: variáveis obrigatórias ausentes.');
  console.error(`  CRON_INTERNAL_KEY: ${CRON_KEY ? 'OK' : 'FALTANDO'}`);
  console.error(`  ANTHROPIC_API_KEY: ${ANTHROPIC_KEY ? 'OK' : 'FALTANDO'}`);
  process.exit(1);
}

// ── Helpers ──
const TODAY_ISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function csvQuote(s) {
  const str = String(s || '').replace(/\n/g, ' | ');
  return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
}
function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

// Canal → intervalo em dias
const CANAL_INTERVALO = {
  linkedin_follow:   1,
  linkedin_dm:       2,
  email_diagnostico: 3,
  whatsapp:          2,
  email_case:        3,
  ligacao:           2,
  email_breakup:     14,
};

// ── Passo 1: Pull leads pendentes ──
async function pullLeads() {
  console.log('[pulse] Passo 1: Puxando leads pendentes...');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gtm`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CRON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'outbound_pendentes', limit: 40 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outbound_pendentes falhou HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  const leads = json?.leads ?? json?.data?.leads ?? [];
  const total = json?.total ?? json?.data?.total ?? leads.length;
  console.log(`[pulse]   → ${total} leads retornados`);
  return { leads, total };
}

// ── Passo 2: Gerar mensagem personalizada via Claude ──
async function gerarMensagem(lead) {
  const tierInfo = lead.tier_info || { nome: 'Start', preco_anual_mes: 697 };
  const nomePrimeiro = lead.nome_escola?.split(' ')[0] || 'direção';
  const decisor = lead.nome_decisor || null;

  const TEMPLATES = {
    linkedin_follow: null,
    linkedin_dm: `Oi ${decisor ? decisor.split(' ')[0] : nomePrimeiro}, tudo bem?\n\nVi que a ${lead.nome_escola} é referência na região. Parabéns!\n\nEstou falando com direções de escolas de 150-500 alunos que estão usando ${lead.sistema_atual || 'sistemas separados'} e sentindo o mesmo desconforto: três sistemas soltos, boleto manual, comunicação no WhatsApp pessoal das professoras.\n\nSomos do Lumied — plataforma única que substitui tudo isso.\n\nVale 15min pra eu te mostrar um caso parecido com o de vocês?`,
    email_diagnostico: `Assunto: ${lead.nome_escola} — 15min sobre gestão escolar (não é pitch)\n\nBom dia,\n\nSou Ivyson, fundador da Lumied (plataforma de gestão escolar).\n\nNão estou pedindo reunião de vendas — estou pedindo 15 minutos de diagnóstico. Em troca, te mando um relatório de 1 página com:\n1. Quanto tempo sua equipe gasta por mês conciliando ${lead.sistema_atual || 'seus sistemas'} + planilhas\n2. Quanto de mensalidade atrasada pode ser recuperada com régua de cobrança automática\n3. 3 riscos LGPD que vejo em escolas parecidas com a de vocês\n\nTem 15min esta semana?`,
    whatsapp: `Oi, aqui é Ivyson da Lumied. Te mandei e-mail sobre um diagnóstico rápido para a ${lead.nome_escola}. Topa 15min no Zoom esta semana? Nem precisa ligar câmera.`,
    email_case: `Assunto: Case Maple Bear Caxias — recuperou R$ 47k em 4 meses\n\nA Maple Bear Caxias tinha 12% de inadimplência quando começou com o Lumied. Usando só a régua de cobrança automática + PIX integrado, caíram para 3,8% em 4 meses. Em reais: R$ 47.200 recuperados. O Lumied custou R$ 21,6k no mesmo período. ROI 2,2x só nesse módulo.`,
    ligacao: `Script: "Oi, aqui é Ivyson da Lumied. Te mandei e-mail sobre a Maple Bear ter recuperado R$ 47k de inadimplência. Posso te tomar 90 segundos?"`,
    email_breakup: `Assunto: Encerrando follow-up — ${lead.nome_escola}\n\nImagino que agora não é o momento certo. Vou parar de te escrever. Deixo: lumied.com.br/vs/escolaweb/ e lumied.com.br/blog/ pro caso de serem úteis.`,
  };

  const templateBase = TEMPLATES[lead.canal_proximo] ?? TEMPLATES['email_diagnostico'];

  if (lead.canal_proximo === 'linkedin_follow') {
    return {
      assunto: null,
      corpo: `[Ação manual] Seguir ${lead.nome_escola} no LinkedIn e curtir 2 posts recentes. Sem DM ainda.`,
      observacao: `Lead novo — iniciar sequência com follow no LinkedIn`,
    };
  }

  const prompt = `Você é estrategista de outbound B2B vendendo a Lumied (gestão escolar SaaS) para escolas privadas brasileiras.\n\nLead: ${lead.nome_escola} (${lead.cidade || '?'}/${lead.uf || '?'})\nDecisior: ${decisor || 'direção'}\nAlunos estimados: ${lead.alunos_estimados || '?'}\nSistema atual: ${lead.sistema_atual || '?'}\nTier sugerido Lumied: ${tierInfo.nome} (R$ ${tierInfo.preco_anual_mes}/mês anual)\nToque atual: T${lead.toque_atual || 0} → próximo: T${lead.toque_proximo} (canal: ${lead.canal_proximo})\nOrigem do lead: ${lead.origem || '?'}\n\nTemplate base para o canal "${lead.canal_proximo}":\n${templateBase}\n\nPersonalize o template acima com dados reais do lead. Use o nome da escola, cidade, e sistema atual onde couber.\nSe faltar algum dado (decisor, sistema), use texto genérico que funcione sem o dado ("direção", "sistema atual").\nNUNCA invente números ou dados que não estejam acima.\nMantenha tom consultivo, direto, sem jargão de vendas excessivo.\n\nRetorne SOMENTE JSON válido (sem markdown, sem explicação):\n{"assunto": "string ou null se LinkedIn/WhatsApp/ligação", "corpo": "mensagem completa pronta pra colar (com quebras \\n)", "observacao": "1 linha sobre o estado deste lead"}`;

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
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const raw = data.content?.[0]?.text || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn(`[pulse] Claude falhou para ${lead.nome_escola}: ${e.message}`);
    let assunto = null;
    let corpo = templateBase;
    if (['email_diagnostico','email_case','email_breakup'].includes(lead.canal_proximo)) {
      const lines = templateBase.split('\n');
      if (lines[0].startsWith('Assunto:')) {
        assunto = lines[0].replace('Assunto:', '').trim();
        corpo = lines.slice(2).join('\n').trim();
      }
    }
    return { assunto, corpo, observacao: '[fallback — Claude falhou]' };
  }
}

// ── Passo 3: Montar HTML e CSV ──
function montarOutput(leads, mensagens) {
  const dataFormatada = TODAY_ISO;
  const novos = leads.filter(l => l.toque_atual === 0 || l.status === 'novo').length;
  const breakup = leads.filter(l => l.canal_proximo === 'email_breakup').length;

  const linhas = leads.map((lead, i) => {
    const msg = mensagens[i] || {};
    const corpo = (msg.corpo || '').replace(/\n/g, '<br>');
    const waLink = lead.wa_link_template || (lead.telefone ? `https://wa.me/${String(lead.telefone).replace(/\D/g, '')}` : null);
    const crmLink = `https://admin.lumied.com.br/#lead-${lead.id}`;
    const tierNome = lead.tier_info?.nome || lead.tier_sugerido || '?';
    const tierPreco = lead.tier_info?.preco_anual_mes || '?';
    return `<tr>
      <td><b>${esc(lead.nome_escola)}</b><br><small>${esc(lead.cidade || '')}/${esc(lead.uf || '')}</small></td>
      <td>${esc(tierNome)}<br><small>R$ ${tierPreco}/mês</small></td>
      <td>T${lead.toque_atual || 0} → T${lead.toque_proximo}</td>
      <td>${esc(lead.canal_proximo)}</td>
      <td style="max-width:340px;font-size:12px">${msg.assunto ? `<b>${esc(msg.assunto)}</b><br>` : ''}${corpo}<br><small style="color:#888">${esc(msg.observacao || '')}</small></td>
      <td style="white-space:nowrap">${waLink ? `<a href="${esc(waLink)}" style="margin-right:8px">WhatsApp</a>` : ''}<a href="${esc(crmLink)}">CRM</a></td>
    </tr>`;
  }).join('\n');

  const html = `<h2 style="font-family:sans-serif">Pulse Outbound — ${dataFormatada}</h2>
<p style="font-family:sans-serif">${leads.length} leads aguardando ação &middot; ${novos} novos &middot; ${breakup} em break-up</p>
<table border="1" cellpadding="8" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr style="background:#6B3FA0;color:#fff">
    <th>Escola</th><th>Tier</th><th>Toque</th><th>Canal</th><th>Mensagem</th><th>Links</th>
  </tr>
  ${linhas}
</table>
<p style="font-family:sans-serif;font-size:12px;color:#888;margin-top:16px">Gerado automaticamente pelo Outbound Pulse Lumied &middot; ${new Date().toISOString()}</p>`;

  const csvHeader = 'escola,decisor,cidade,uf,alunos,tier,toque_proximo,canal,assunto,mensagem,wa_link,crm_link\n';
  const csvLinhas = leads.map((lead, i) => {
    const msg = mensagens[i] || {};
    const waLink = lead.wa_link_template || (lead.telefone ? `https://wa.me/${String(lead.telefone).replace(/\D/g, '')}` : '');
    const crmLink = `https://admin.lumied.com.br/#lead-${lead.id}`;
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
      csvQuote(crmLink),
    ].join(',');
  }).join('\n');

  return { html, csv: csvHeader + csvLinhas, novos, breakup };
}

// ── Envio via gtm.pulse_send_email (RESEND_API_KEY fica na edge function) ──
async function gtmSendEmail({ subject, html, csvBase64, csvFilename }) {
  const body = {
    action: 'pulse_send_email',
    to: 'ivyson@gmail.com',
    subject,
    html,
  };
  if (csvBase64) {
    body.csv_b64 = csvBase64;
    body.csv_filename = csvFilename || `pulse-${TODAY_ISO}.csv`;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gtm`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CRON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pulse_send_email HTTP ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data?.data?.resend_id || data?.resend_id || null;
}

// ── Passo 4: Enviar e-mail via gtm.pulse_send_email ──
async function enviarEmail(html, csvBase64, total) {
  console.log('[pulse] Passo 4: Enviando e-mail via gtm.pulse_send_email...');
  const subject = `Pulse Outbound — ${TODAY_ISO} · ${total} leads`;
  return gtmSendEmail({ subject, html, csvBase64, csvFilename: `pulse-${TODAY_ISO}.csv` });
}

// ── Passo 5: Atualizar próximo passo de cada lead ──
async function atualizarLead(lead) {
  const intervalo = CANAL_INTERVALO[lead.canal_proximo] ?? 3;
  const proximoPassoEm = addDays(TODAY_ISO, intervalo);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gtm`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CRON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'lead_update_service',
        id: lead.id,
        proximo_passo: `Aguardando resposta de ${lead.canal_proximo}`,
        proximo_passo_em: proximoPassoEm,
      }),
    });
    if (!res.ok) { console.warn(`[pulse] lead_update_service falhou ${lead.id}: HTTP ${res.status}`); return false; }
    return true;
  } catch (e) {
    console.warn(`[pulse] lead_update_service erro ${lead.id}: ${e.message}`);
    return false;
  }
}

// ── Main ──
async function main() {
  console.log(`[pulse] Iniciando Outbound Pulse — ${TODAY_ISO}`);

  let leads, total;
  try {
    ({ leads, total } = await pullLeads());
  } catch (e) {
    console.error(`[pulse] FALHA ao puxar leads: ${e.message}`);
    try {
      await gtmSendEmail({
        subject: `[ERRO] Pulse Outbound — ${TODAY_ISO}`,
        html: `<p>O agente de outbound falhou ao puxar leads:</p><pre>${e.message}</pre>`,
      });
    } catch {}
    process.exit(1);
  }

  if (total === 0 || leads.length === 0) {
    console.log('[pulse] Fila zerada. Enviando aviso...');
    const resendId = await gtmSendEmail({
      subject: `Pulse Outbound — ${TODAY_ISO} · fila zerada`,
      html: `<p>Nenhum lead pendente para hoje (${TODAY_ISO}).</p><p>Considere capturar leads novos via <code>lead_capture</code> ou abasteça a fila via <code>gtm/lead_capture</code>.</p>`,
    });
    writeFileSync('/tmp/pulse-summary.txt', `Fila zerada — aviso enviado. Resend ID: ${resendId}`);
    console.log(`\n✓ Fila zerada. Resend ID: ${resendId}`);
    return;
  }

  console.log(`[pulse] Passo 2: Gerando mensagens para ${leads.length} leads...`);
  const mensagens = [];
  for (const lead of leads) {
    process.stdout.write(`  → ${lead.nome_escola} (${lead.canal_proximo})... `);
    mensagens.push(await gerarMensagem(lead));
    console.log('OK');
  }

  console.log('[pulse] Passo 3: Montando HTML e CSV...');
  const { html, csv, novos, breakup } = montarOutput(leads, mensagens);

  let resendId = null;
  try {
    resendId = await enviarEmail(html, toBase64(csv), leads.length);
    console.log(`[pulse]   → Resend ID: ${resendId}`);
  } catch (e) {
    console.error(`[pulse] FALHA ao enviar e-mail: ${e.message}`);
  }

  console.log('[pulse] Passo 5: Atualizando leads...');
  let atualizados = 0;
  for (const lead of leads) {
    if (await atualizarLead(lead)) atualizados++;
  }
  console.log(`[pulse]   → ${atualizados}/${leads.length} atualizados`);

  const summary = [
    `OK Pulse enviado: ${leads.length} leads`,
    `  Novos: ${novos}  ·  Break-up: ${breakup}`,
    `  E-mail Resend ID: ${resendId || 'N/A'}`,
    `  Leads atualizados: ${atualizados}/${leads.length}`,
  ].join('\n');

  writeFileSync('/tmp/pulse-summary.txt', summary);
  console.log('\n' + summary.replace('OK', '✓'));
}

main().catch(e => { console.error('[pulse] Erro não tratado:', e); process.exit(1); });
