// ═══════════════════════════════════════════════════════
//  Handler: Push Messages Comerciais (Lembretes de Reunião)
//  Executado pelo cron a cada 30 minutos
// ═══════════════════════════════════════════════════════

/**
 * Processa lembretes pendentes de reuniões agendadas
 * Chamado pelo scheduled event do Cloudflare Worker
 */
export async function handlePushMessages({ meta, db }) {
  const now = new Date();
  let sent = 0;

  // ── Lembrete 24h antes ──
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const meetings24h = await db.query('wa_scheduled_meetings', {
    filters: {
      'meeting_at': `and(lte.${in24h.toISOString()},gte.${now.toISOString()})`,
      'reminder_24h': 'eq.false',
    },
  });

  if (meetings24h) {
    for (const m of meetings24h) {
      const meetingDate = new Date(m.meeting_at);
      const hoursUntil = (meetingDate - now) / (60 * 60 * 1000);

      // Enviar entre 20h e 28h antes
      if (hoursUntil >= 20 && hoursUntil <= 28) {
        const hora = meetingDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        await meta.sendTemplate(m.contact_phone, 'maple_bear_lembrete_24h', [m.contact_name, hora]);
        await db.update('wa_scheduled_meetings', { id: m.id }, { reminder_24h: true });
        await db.logMessage(m.contact_phone, 'outbound', `[PUSH] Lembrete 24h: ${m.contact_name} às ${hora}`, { template_name: 'maple_bear_lembrete_24h', message_type: 'template' });
        sent++;
      }
    }
  }

  // ── Lembrete 2h antes ──
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const meetings2h = await db.query('wa_scheduled_meetings', {
    filters: {
      'meeting_at': `and(lte.${in2h.toISOString()},gte.${now.toISOString()})`,
      'reminder_2h': 'eq.false',
      'reminder_24h': 'eq.true',
    },
  });

  if (meetings2h) {
    for (const m of meetings2h) {
      const meetingDate = new Date(m.meeting_at);
      const hoursUntil = (meetingDate - now) / (60 * 60 * 1000);

      // Enviar entre 1.5h e 3h antes
      if (hoursUntil >= 1.5 && hoursUntil <= 3) {
        const hora = meetingDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const endereco = m.location || 'Maple Bear Bento Gonçalves';
        await meta.sendTemplate(m.contact_phone, 'maple_bear_lembrete_2h', [m.contact_name, hora, endereco]);
        await db.update('wa_scheduled_meetings', { id: m.id }, { reminder_2h: true });
        await db.logMessage(m.contact_phone, 'outbound', `[PUSH] Lembrete 2h: ${m.contact_name} às ${hora}`, { template_name: 'maple_bear_lembrete_2h', message_type: 'template' });
        sent++;
      }
    }
  }

  // ── Follow-up pós-reunião (30 min depois) ──
  const past30min = new Date(now.getTime() - 30 * 60 * 1000);
  const meetingsFollowup = await db.query('wa_scheduled_meetings', {
    filters: {
      'meeting_at': `lte.${past30min.toISOString()}`,
      'followup_sent': 'eq.false',
      'reminder_2h': 'eq.true',
    },
  });

  if (meetingsFollowup) {
    for (const m of meetingsFollowup) {
      await meta.sendTemplate(m.contact_phone, 'maple_bear_followup', [m.contact_name]);
      await db.update('wa_scheduled_meetings', { id: m.id }, { followup_sent: true });
      await db.logMessage(m.contact_phone, 'outbound', `[PUSH] Follow-up: ${m.contact_name}`, { template_name: 'maple_bear_followup', message_type: 'template' });
      sent++;
    }
  }

  return { sent };
}
