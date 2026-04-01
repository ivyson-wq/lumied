// ═══════════════════════════════════════════════════════
//  Handler: Menu e Roteamento por Departamento
// ═══════════════════════════════════════════════════════
import { detectDepartment } from '../utils/nlp.js';
import {
  buildMenuMessage, buildSubmenuMatriculas, buildTransferMessage,
  buildFallbackMessage, buildSessionClosedMessage,
} from '../utils/templates.js';

export async function handleMenu(phone, message, conversation, { meta, db, chatwoot, config }) {
  const departments = await db.getDepartments();
  const routingKeywords = await db.getRoutingKeywords();
  const step = conversation?.current_step || 'greeting';
  const contactName = conversation?.contact_name || 'você';

  // ── Timeout: encerrar sessões inativas ──
  if (conversation?.last_message_at) {
    const lastMsg = new Date(conversation.last_message_at);
    const minutesSince = (Date.now() - lastMsg.getTime()) / 60000;
    const timeout = config?.session_timeout_minutes || 10;
    if (minutesSince > timeout && step !== 'greeting' && step !== 'closed') {
      await db.upsertConversation(phone, { current_step: 'greeting', context: {} });
      // Tratar como nova conversa
    }
  }

  // ── "voltar" — retorna ao menu ──
  if (message.toLowerCase().trim() === 'voltar' || message.trim() === '↩️') {
    await meta.sendText(phone, buildMenuMessage(contactName, config?.escola_nome || 'Maple Bear', departments, conversation?.last_dept));
    await db.upsertConversation(phone, { current_step: 'menu' });
    return;
  }

  // ── Step: greeting (coletar nome se não tem) ──
  if (step === 'greeting' && !conversation?.contact_name) {
    // Tentar identificar pelo SaaS (família por telefone)
    // Se não encontrar, pedir o nome (já feito no incoming.js)
    // Se já tem nome, ir para menu
  }

  // ── Step: collecting_name ──
  if (step === 'collecting_name') {
    const name = message.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    await db.upsertConversation(phone, { contact_name: name, current_step: 'menu' });
    await meta.sendText(phone, buildMenuMessage(name, config?.escola_nome || 'Maple Bear', departments));
    return;
  }

  // ── Roteamento por palavra-chave (ANTES do menu) ──
  const detectedDept = detectDepartment(message, routingKeywords);
  if (detectedDept && step !== 'human') {
    const dept = departments.find(d => d.shortcut === detectedDept);
    if (dept) {
      await routeToDepartment(phone, contactName, dept, message, { meta, db, chatwoot });
      return;
    }
  }

  // ── Step: menu — processar seleção numérica ──
  const trimmed = message.trim();
  if (step === 'menu' || step === 'greeting') {
    const dept = departments.find(d => d.shortcut === trimmed);
    if (dept) {
      // Submenu para matrículas
      if (dept.shortcut === '1') {
        await meta.sendText(phone, buildSubmenuMatriculas());
        await db.upsertConversation(phone, { current_step: 'submenu_1', last_dept: '1' });
        return;
      }
      await routeToDepartment(phone, contactName, dept, message, { meta, db, chatwoot });
      return;
    }

    // Se não é número válido e é greeting, mostrar menu
    if (step === 'greeting') {
      await meta.sendText(phone, buildMenuMessage(contactName, config?.escola_nome || 'Maple Bear', departments, conversation?.last_dept));
      await db.upsertConversation(phone, { current_step: 'menu' });
      return;
    }

    // Fallback
    await meta.sendText(phone, buildFallbackMessage());
    return;
  }

  // ── Step: submenu_1 (Matrículas) ──
  if (step === 'submenu_1') {
    if (['1', '2', '3'].includes(trimmed)) {
      const dept = departments.find(d => d.shortcut === '1');
      const subLabels = { '1': 'Conhecer a escola', '2': 'Interesse em matrícula', '3': 'Rematrícula' };
      const subMsg = `${contactName} escolheu: *${subLabels[trimmed]}*`;
      await routeToDepartment(phone, contactName, dept, subMsg, { meta, db, chatwoot });
      return;
    }
    // Voltar ao menu
    await meta.sendText(phone, buildMenuMessage(contactName, config?.escola_nome || 'Maple Bear', departments));
    await db.upsertConversation(phone, { current_step: 'menu' });
    return;
  }

  // ── Step: human — mensagem já está com atendente ──
  if (step === 'human') {
    // Encaminhar para Chatwoot
    const contact = await chatwoot.findOrCreateContact(phone, contactName);
    if (contact) {
      // Buscar conversa aberta ou criar
      await chatwoot.sendMessage(contact.id, message, 'incoming');
    }
    await db.logMessage(phone, 'inbound', message, { department: conversation?.last_dept });
    return;
  }

  // ── Default: mostrar menu ──
  await meta.sendText(phone, buildMenuMessage(contactName, config?.escola_nome || 'Maple Bear', departments, conversation?.last_dept));
  await db.upsertConversation(phone, { current_step: 'menu' });
}

async function routeToDepartment(phone, contactName, dept, originalMessage, { meta, db, chatwoot }) {
  // Verificar horário de funcionamento
  const now = new Date();
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  const brMin = now.getUTCMinutes();
  const currentTime = `${String(brHour).padStart(2, '0')}:${String(brMin).padStart(2, '0')}`;

  if (dept.active_from && dept.active_until) {
    if (currentTime < dept.active_from || currentTime > dept.active_until) {
      await meta.sendText(phone, dept.off_hours_msg || `Nosso atendimento de ${dept.name} funciona das ${dept.active_from} às ${dept.active_until}.`);
      await db.upsertConversation(phone, { current_step: 'closed', last_dept: dept.shortcut });
      return;
    }
  }

  // Transferir para Chatwoot
  const contact = await chatwoot.findOrCreateContact(phone, contactName);
  if (contact) {
    const conv = await chatwoot.createConversation(contact.id, dept.name);
    if (conv) {
      await chatwoot.sendMessage(conv.id, `📋 *${dept.name}*\n\nMensagem original: ${originalMessage}`, 'incoming');
    }
  }

  await meta.sendText(phone, buildTransferMessage(dept.name));
  await db.upsertConversation(phone, { current_step: 'human', last_dept: dept.shortcut });
  await db.logMessage(phone, 'inbound', originalMessage, { department: dept.name });
}
