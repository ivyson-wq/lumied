// ═══════════════════════════════════════════════════════
//  Handler: Mensagens Recebidas (Orquestrador Principal)
//  Fluxo: Identificar → Urgência → Autoatendimento → Menu
// ═══════════════════════════════════════════════════════
import { handleUrgency } from './urgency.js';
import { handleAutoservice } from './autoservice.js';
import { handleMenu } from './menu.js';
import { buildGreetingCollectName, buildOffHoursMessage } from '../utils/templates.js';

/**
 * Processa uma mensagem recebida do WhatsApp
 */
export async function handleIncoming(phone, message, messageId, services) {
  const { meta, db, saas, chatwoot } = services;

  // 0. Marcar como lida
  if (messageId) {
    await meta.markAsRead(messageId);
  }

  // 1. Buscar/criar estado da conversa
  let conversation = await db.getConversation(phone);

  // 2. Se não existe, tentar identificar pelo SaaS
  if (!conversation) {
    const family = await saas.getFamilyByPhone(phone);
    if (family?.data) {
      conversation = await db.upsertConversation(phone, {
        contact_name: family.data.nome_responsavel,
        student_id: family.data.aluno_id,
        familia_id: family.data.familia_id,
        current_step: 'menu',
      });
      conversation = await db.getConversation(phone);
    } else {
      // Novo contato — pedir nome
      await db.upsertConversation(phone, { current_step: 'collecting_name' });
      await meta.sendText(phone, buildGreetingCollectName());
      await db.logMessage(phone, 'inbound', message);
      await db.logMessage(phone, 'outbound', '[GREETING] Coletando nome');
      return;
    }
  }

  // 3. Carregar config
  const config = await db.getConfig();

  // 4. Verificar horário comercial (exceto urgências)
  const isBusinessHours = checkBusinessHours(config);

  // 5. MÓDULO 2: Detecção de urgência (ANTES de tudo)
  const wasUrgent = await handleUrgency(phone, message, conversation, services);
  if (wasUrgent) return;

  // 6. Fora do horário? Informar
  if (!isBusinessHours && conversation.current_step !== 'human') {
    await meta.sendText(phone, buildOffHoursMessage(config?.escola_telefone_emergencia));
    await db.logMessage(phone, 'inbound', message);
    return;
  }

  // 7. MÓDULO 4: Autoatendimento (saldo, presença, eventos)
  const wasAutoserviced = await handleAutoservice(phone, message, conversation, services);
  if (wasAutoserviced) return;

  // 8. MÓDULO 1: Menu e roteamento
  await handleMenu(phone, message, conversation, { ...services, config });

  // 9. Log
  await db.logMessage(phone, 'inbound', message);
}

function checkBusinessHours(config) {
  if (!config) return true;
  const now = new Date();
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  const brMin = now.getUTCMinutes();
  const dayOfWeek = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // 1=seg, 7=dom

  // Verificar dia útil
  const businessDays = config.business_days || [1, 2, 3, 4, 5];
  if (!businessDays.includes(dayOfWeek)) return false;

  // Verificar horário
  const currentMinutes = brHour * 60 + brMin;
  const [sh, sm] = (config.business_hours_start || '08:00').split(':').map(Number);
  const [eh, em] = (config.business_hours_end || '18:00').split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}
