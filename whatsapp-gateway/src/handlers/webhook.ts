import type { Env, WhatsAppWebhookPayload, Familia } from '../types';
import { getSupabase } from '../services/supabase';
import { routeParaProf } from '../services/router';
import { enviarTextoLivre, enviarMensagemComBotao, marcarComoLida } from '../services/whatsapp';
import { ativarEstouACaminho } from '../features/estou-a-caminho';
import { processarConfirmacao } from '../features/confirmacao';
import { processarFaq } from '../features/faq-bot';
import { processarDocumento, processarConfirmacaoDocumento } from '../features/documento-intake';

const KEYWORDS_ESTOU_A_CAMINHO = ['A CAMINHO', 'ACAMINHO', 'BUSCA', 'BUSCANDO', 'ESTOU INDO', 'JA ESTOU'];

export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  // Meta requires us to return 200 even on errors — otherwise Meta retries
  // the same payload up to 24h and may disable the webhook after enough
  // failures. We therefore wrap everything in a top-level try/catch and log
  // to console; the request is always acknowledged.
  let body: WhatsAppWebhookPayload;
  try {
    body = await req.json() as WhatsAppWebhookPayload;
  } catch (err) {
    console.error('[WEBHOOK] Invalid JSON body:', (err as Error).message);
    return new Response('OK', { status: 200 });
  }

  try {
    return await processWebhook(body, env);
  } catch (err) {
    console.error('[WEBHOOK] Unhandled error:', (err as Error).message);
    // Always return 200 so Meta does not retry indefinitely.
    return new Response('OK', { status: 200 });
  }
}

async function processWebhook(body: WhatsAppWebhookPayload, env: Env): Promise<Response> {
  const db = getSupabase(env);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneId = value.metadata?.phone_number_id;

      for (const msg of value.messages ?? []) {
        // Per-message try/catch — one poisoned payload must not break the whole batch.
        try {
        // Basic shape validation. Meta sometimes delivers partial payloads during
        // outages; we'd rather skip than crash.
        if (!msg || typeof msg.from !== 'string' || typeof msg.id !== 'string') {
          console.warn('[WEBHOOK] Dropping malformed message (missing from/id)');
          continue;
        }
        // Minimal E.164 sanity: digits only, 10–15 chars. Meta always sends digits.
        if (!/^[0-9]{10,15}$/.test(msg.from)) {
          console.warn('[WEBHOOK] Dropping message with invalid phone shape');
          continue;
        }
        const waId = msg.from;

        // Marcar como lida
        await marcarComoLida(env, phoneId, msg.id);

        // ── Check if sender is STAFF (coordenação/direção/secretaria) ──
        const { data: staff } = await db
          .from('wa_staff').select('id,escola_id,nome,papel,whatsapp')
          .eq('whatsapp', waId).eq('ativo', true).single();

        if (staff) {
          // Staff member — handle document intake or confirmation

          // Document confirmation buttons (doc_<id>_confirmar / doc_<id>_rejeitar)
          if (msg.type === 'interactive' && msg.interactive?.button_reply?.id?.startsWith('doc_')) {
            await processarConfirmacaoDocumento(db, env, phoneId, waId, msg.interactive.button_reply.id);
            continue;
          }

          // Image or document from staff → document intake
          if (msg.type === 'image' && msg.image) {
            await processarDocumento(db, env, phoneId, staff, {
              id: msg.image.id,
              mime_type: msg.image.mime_type,
              sha256: msg.image.sha256,
            }, msg.image.caption);
            continue;
          }

          if (msg.type === 'document' && msg.document) {
            await processarDocumento(db, env, phoneId, staff, {
              id: msg.document.id,
              mime_type: msg.document.mime_type,
              sha256: msg.document.sha256,
              filename: msg.document.filename,
            }, msg.document.caption);
            continue;
          }

          // Text from staff without media — treat as context for next document
          if (msg.type === 'text') {
            await enviarTextoLivre(env, phoneId, waId,
              `📎 Olá, ${staff.nome}! Para arquivar um documento, envie a *foto* ou *arquivo* (PDF, imagem). ` +
              `Pode incluir uma descrição na legenda.\n\n` +
              `Exemplos:\n` +
              `_📸 Foto do atestado médico da prof. Maria_\n` +
              `_📄 Certificado de primeiros socorros_\n` +
              `_📋 Ata da reunião pedagógica de março_`);
            continue;
          }

          // Other media types from staff — not supported yet
          await enviarTextoLivre(env, phoneId, waId,
            '⚠️ Formato não suportado. Envie como *foto* ou *PDF/documento*.');
          continue;
        }

        // ── Regular flow: family member ──

        // 1. Buscar família
        const { data: familia } = await db
          .from('wa_familias').select('id,nome,whatsapp,aluno_nome,turma_id,escola_id,opt_in,familia_id_saas')
          .eq('whatsapp', waId).single() as { data: Familia | null };

        if (!familia) {
          // ── SDR LEAD CHECK ──
          // Before saying "not registered", check if this number belongs to an SDR lead.
          // If so, forward the message to the SDR Agent for autonomous conversation.
          const sdrHandled = await forwardToSDRAgent(db, env, phoneId, waId, msg);
          if (sdrHandled) continue;

          await enviarTextoLivre(env, phoneId, waId,
            'Olá! Seu número não está cadastrado no sistema da escola. Por favor, entre em contato com a secretaria para vincular seu WhatsApp. 📞');
          continue;
        }

        // 2. Verificar se escola tem módulo ativo
        const { data: escola } = await db
          .from('escolas').select('modulo_whatsapp,whatsapp_phone_id')
          .eq('id', familia.escola_id).single();
        if (!escola?.modulo_whatsapp) continue;

        // 3. Renovar janela de atendimento (24h)
        await renovarJanela(db, familia.id);

        // 4. Classificar e rotear

        // Opt-in inicial
        const textBody = typeof msg.text?.body === 'string' ? msg.text.body : '';
        if (msg.type === 'text' && ['OLÁ', 'OLA', 'OI', 'COMEÇAR', 'COMECAR'].includes(textBody.trim().toUpperCase())) {
          if (!familia.opt_in) {
            await db.from('wa_familias').update({ opt_in: true, opt_in_at: new Date().toISOString() }).eq('id', familia.id).execute();
          }
          await enviarTextoLivre(env, phoneId, waId,
            `Olá, ${familia.nome}! 👋 Bem-vindo ao canal de comunicação da Maple Bear.\n\nVocê receberá comunicados, avisos de eventos e pode tirar dúvidas por aqui.\n\nAluno(a): *${familia.aluno_nome || '—'}*\n\nPara qualquer dúvida, é só digitar! 🍁`);
          await db.from('wa_respostas').insert({ familia_id: familia.id, tipo: 'opt_in', conteudo: textBody, whatsapp_msg_id: msg.id }).select();
          continue;
        }

        // Confirmação de leitura (botão)
        if (msg.type === 'interactive' && msg.interactive?.button_reply?.id === 'confirmar_leitura') {
          await db.from('wa_respostas').insert({
            familia_id: familia.id, tipo: 'confirmacao_leitura',
            conteudo: 'Li e confirmo', whatsapp_msg_id: msg.id,
          }).select();
          await enviarTextoLivre(env, phoneId, waId, '✅ Confirmado! Obrigado.');
          continue;
        }

        // Confirmação de evento (botões)
        if (msg.type === 'interactive' && msg.interactive?.button_reply?.id?.startsWith('evento_')) {
          await processarConfirmacao(db, env, phoneId, familia as any, msg);
          continue;
        }

        // Estou a caminho (keyword)
        if (msg.type === 'text' && textBody) {
          const texto = textBody.trim().toUpperCase();
          if (KEYWORDS_ESTOU_A_CAMINHO.some(k => texto.includes(k))) {
            await ativarEstouACaminho(env, phoneId, familia as any);
            await db.from('wa_respostas').insert({ familia_id: familia.id, tipo: 'estou_a_caminho', conteudo: textBody, whatsapp_msg_id: msg.id }).select();
            continue;
          }
        }

        // Texto livre → tentar FAQ bot → se não, rotear para professora
        if (msg.type === 'text') {
          const respondidoPeloBot = await processarFaq(db, env, phoneId, familia as any, msg);
          if (respondidoPeloBot) continue;
        }

        // Rotear para professora
        const professoraId = await routeParaProf(db, familia.id);
        await db.from('wa_respostas').insert({
          familia_id: familia.id,
          professora_id: professoraId,
          tipo: msg.type === 'text' ? 'resposta_texto' : 'duvida_roteada',
          conteudo: msg.text?.body || `[${msg.type}]`,
          whatsapp_msg_id: msg.id,
        }).select();
        } catch (msgErr) {
          // Don't let one bad message poison the whole webhook delivery.
          console.error('[WEBHOOK] Error processing message:', (msgErr as Error).message);
          continue;
        }
      }

      // Status updates (leitura pela família)
      for (const status of value.statuses ?? []) {
        if (status.status === 'read') {
          await db.from('wa_mensagens').update({ status: 'lida_pela_familia' }).eq('whatsapp_msg_id', status.id).execute();
        }
      }
    }
  }

  return new Response('OK', { status: 200 });
}

/**
 * Check if the sender is an SDR lead and forward the message to InstaPublisher.
 * Queries the insta_publisher.sdr_leads table for matching phone numbers.
 * If found, POSTs the reply to the SDR webhook for autonomous conversation.
 */
async function forwardToSDRAgent(
  db: any, env: Env, phoneId: string, waId: string, msg: any,
): Promise<boolean> {
  if (!env.SDR_WEBHOOK_URL) return false;

  // Extract message text
  const text = msg.text?.body
    ?? msg.interactive?.button_reply?.title
    ?? msg.interactive?.list_reply?.title
    ?? '';
  if (!text) return false;

  // Check if this phone number is an SDR lead
  // Phone formats: waId is digits only (e.g. "5511999998888")
  // sdr_leads.phone might have formatting, so we check multiple patterns
  const phoneCleaned = waId.replace(/^55/, ''); // remove country code
  const { data: leads } = await db
    .schema('insta_publisher')
    .from('sdr_leads')
    .select('id, company_id')
    .or(`phone.ilike.%${phoneCleaned},contact_phone.ilike.%${phoneCleaned},phone.ilike.%${waId},contact_phone.ilike.%${waId}`)
    .not('stage', 'eq', 'lost')
    .limit(1);

  if (!leads?.length) return false;

  const lead = leads[0];
  console.log(`[SDR] Forwarding WhatsApp reply from ${waId} (lead ${lead.id}) to SDR Agent`);

  // Find the latest outbound WhatsApp touchpoint to this lead
  const { data: touchpoint } = await db
    .schema('insta_publisher')
    .from('sdr_touchpoints')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('channel', 'whatsapp')
    .eq('direction', 'outbound')
    .in('status', ['sent', 'delivered', 'opened'])
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  // Forward to SDR webhook
  try {
    const payload: any = { reply_text: text };

    if (touchpoint) {
      // Has prior outbound → link to touchpoint for conversation context
      payload.touchpoint_id = touchpoint.id;
    } else {
      // No prior outbound — this is an inbound-first contact (lead messaged us)
      // Register as inbound touchpoint
      payload.from_phone = waId;
      payload.lead_id = lead.id;
      payload.channel = 'whatsapp';
    }

    const res = await fetch(env.SDR_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[SDR] Webhook error: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[SDR] Failed to forward to webhook:`, (err as Error).message);
  }

  return true; // Handled — don't send "not registered" message
}

async function renovarJanela(db: any, familiaId: string) {
  const agora = new Date();
  const expira = new Date(agora.getTime() + 24 * 60 * 60 * 1000);

  await db.from('wa_janelas').upsert({
    familia_id: familiaId,
    aberta_em: agora.toISOString(),
    expira_em: expira.toISOString(),
    renovada_em: agora.toISOString(),
    status: 'ativa',
    atualizado_em: agora.toISOString(),
  }, { onConflict: 'familia_id' }).execute();
}
