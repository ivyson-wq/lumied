// ═══════════════════════════════════════════════════════
//  Handler: Autoatendimento (saldo, presença, eventos)
//  Integra com SaaS Escolar para respostas automáticas
// ═══════════════════════════════════════════════════════
import { detectAutoservice } from '../utils/nlp.js';
import { buildBalanceMessage, buildAttendanceMessage } from '../utils/templates.js';

/**
 * Tenta resolver a mensagem via autoatendimento (consulta ao SaaS)
 * @returns {boolean} true se resolveu (não precisa ir pro menu)
 */
export async function handleAutoservice(phone, message, conversation, { meta, db, saas }) {
  const intent = detectAutoservice(message);
  if (!intent) return false;

  // Precisa ter família/aluno vinculado
  if (!conversation?.student_id && !conversation?.familia_id) {
    // Tentar vincular pelo telefone
    const family = await saas.getFamilyByPhone(phone);
    if (family?.data) {
      await db.upsertConversation(phone, {
        familia_id: family.data.familia_id,
        student_id: family.data.aluno_id,
        contact_name: conversation?.contact_name || family.data.nome_responsavel,
      });
      conversation = { ...conversation, ...family.data };
    } else {
      // Sem vínculo, não pode fazer autoatendimento
      return false;
    }
  }

  const contactName = conversation?.contact_name || 'você';
  const studentId = conversation?.student_id;

  if (!studentId) return false;

  // ── Consulta de saldo/boleto ──
  if (intent.type === 'balance') {
    const balance = await saas.getStudentBalance(studentId);
    if (balance?.data) {
      const studentName = balance.data.aluno_nome || 'seu filho(a)';
      const items = balance.data.items || [];
      await meta.sendText(phone, buildBalanceMessage(contactName, studentName, items));
      await db.logMessage(phone, 'outbound', `[AUTOSERVICE] Consulta saldo: ${items.length} itens`, { department: 'Financeiro' });
      return true;
    }
    return false;
  }

  // ── Consulta de presença ──
  if (intent.type === 'attendance') {
    const attendance = await saas.getStudentAttendanceToday(studentId);
    if (attendance?.data !== undefined) {
      const studentName = attendance.data?.aluno_nome || 'seu filho(a)';
      await meta.sendText(phone, buildAttendanceMessage(contactName, studentName, attendance.data));
      await db.logMessage(phone, 'outbound', `[AUTOSERVICE] Consulta presença`, { department: 'Pedagogia' });
      return true;
    }
    return false;
  }

  // ── Consulta de eventos ──
  if (intent.type === 'events') {
    const events = await saas.getClassEvents(conversation?.class_id);
    if (events?.data?.length > 0) {
      let msg = `📅 Próximos eventos:\n\n`;
      for (const ev of events.data.slice(0, 5)) {
        const data = new Date(ev.data).toLocaleDateString('pt-BR');
        msg += `• *${ev.titulo}* — ${data}\n`;
      }
      msg += `\nPosso ajudar em mais alguma coisa?`;
      await meta.sendText(phone, msg);
      await db.logMessage(phone, 'outbound', `[AUTOSERVICE] Consulta eventos`, { department: 'Pedagogia' });
      return true;
    }
    return false;
  }

  return false;
}
