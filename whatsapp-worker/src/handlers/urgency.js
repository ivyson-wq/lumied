// ═══════════════════════════════════════════════════════
//  Handler: Detecção e Tratamento de Urgência
//  Executado ANTES de qualquer menu
// ═══════════════════════════════════════════════════════
import { detectUrgency } from '../utils/nlp.js';
import { buildUrgencyMessage } from '../utils/templates.js';

/**
 * Verifica se a mensagem é urgente e toma ação imediata
 * @returns {boolean} true se urgência detectada (fluxo encerrado)
 */
export async function handleUrgency(phone, message, conversation, { meta, db, chatwoot }) {
  const keywords = await db.getUrgencyKeywords();

  // Contexto: mensagens rápidas
  const context = {};
  if (conversation?.last_message_at) {
    const lastMsg = new Date(conversation.last_message_at);
    context.timeSinceLastMinutes = (Date.now() - lastMsg.getTime()) / 60000;
  }

  const { isUrgent, reason } = detectUrgency(message, keywords, context);

  if (!isUrgent) return false;

  console.log(`[URGENCY] Detected for ${phone}: ${reason}`);

  // 1. Resposta imediata
  await meta.sendText(phone, buildUrgencyMessage());

  // 2. Criar ticket urgente no Chatwoot
  const contactName = conversation?.contact_name || phone;
  const contact = await chatwoot.findOrCreateContact(phone, contactName);
  if (contact) {
    const conv = await chatwoot.createConversation(contact.id, 'URGENTE', true);
    if (conv) {
      await chatwoot.sendMessage(conv.id, `🚨 URGÊNCIA: ${message}`, 'incoming');
      await chatwoot.escalateUrgent(conv.id);
    }
  }

  // 3. Registrar evento
  await db.logMessage(phone, 'inbound', message, {
    urgency_detected: true,
    department: 'URGENTE',
  });

  // 4. Atualizar estado da conversa
  await db.upsertConversation(phone, { current_step: 'human', last_dept: 'URGENTE' });

  return true;
}
