// ═══════════════════════════════════════════════════════
//  Templates de mensagem
// ═══════════════════════════════════════════════════════

export function buildMenuMessage(name, schoolName, departments, lastDept = null) {
  let msg = `Olá, ${name}! 👋 Bem-vindo ao ${schoolName}.\n\nComo posso te ajudar?\n\n`;

  // Sugerir último departamento se houver
  if (lastDept) {
    const dept = departments.find(d => d.shortcut === lastDept);
    if (dept) {
      msg += `💡 Da última vez você falou com *${dept.name}*. Quer continuar lá? Digite *${dept.shortcut}*\n\n`;
    }
  }

  for (const dept of departments) {
    const emoji = { '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣', '0': '0️⃣' }[dept.shortcut] || `${dept.shortcut}.`;
    msg += `${emoji}  ${dept.name}\n`;
  }

  msg += `\n🆘 Caso urgente? Digite *URGENTE* a qualquer momento.`;
  return msg;
}

export function buildSubmenuMatriculas() {
  return `📋 *Matrículas*\n\n1️⃣  Quero conhecer a escola\n2️⃣  Tenho interesse em matrícula\n3️⃣  Já sou aluno — rematrícula\n\n↩️  Digite *voltar* para o menu principal`;
}

export function buildTransferMessage(departmentName) {
  return `Repassei para *${departmentName}*! ✅\n\nNormalmente respondem em até 10 minutos durante o horário comercial (8h–18h).\n\nFique à vontade para aguardar aqui. 🙏`;
}

export function buildOffHoursMessage(emergencyPhone) {
  let msg = `Olá! Nosso atendimento funciona de segunda a sexta das 8h às 18h. 🕗\n\nSua mensagem foi registrada e responderemos assim que possível. 😊`;
  if (emergencyPhone) {
    msg += `\n\n🆘 Em caso de emergência com um aluno, ligue: *${emergencyPhone}*`;
  }
  return msg;
}

export function buildUrgencyMessage() {
  return `⚡ Vi que pode ser algo urgente.\n\nEstou te conectando agora com alguém da equipe. Um momento. 🙏`;
}

export function buildGreetingCollectName() {
  return `Olá! 👋 Bem-vindo ao atendimento do Maple Bear.\n\nPara personalizarmos seu atendimento, por favor, me diga seu nome:`;
}

export function buildBalanceMessage(name, studentName, balance) {
  if (!balance || balance.length === 0) {
    return `✅ ${name}, não encontrei nenhuma pendência financeira para *${studentName}*. Tudo em dia! 😊\n\nPosso ajudar em mais alguma coisa?`;
  }

  let msg = `💰 Olá, ${name}! Aqui estão as informações de *${studentName}*:\n\n`;
  for (const item of balance) {
    const status = item.status === 'pago' ? '✅ Pago' : '⏳ Em aberto';
    const venc = item.vencimento ? new Date(item.vencimento).toLocaleDateString('pt-BR') : '—';
    msg += `• ${item.descricao || 'Mensalidade'}: *R$ ${Number(item.valor).toFixed(2)}*\n  Vencimento: ${venc} | ${status}\n`;
  }
  msg += `\nPrecisa de ajuda com o pagamento ou quer falar com o financeiro? Me diga como posso ajudar. 😊`;
  return msg;
}

export function buildAttendanceMessage(name, studentName, attendance) {
  if (!attendance) {
    return `${name}, não encontrei registro de presença de *${studentName}* para hoje. Pode ser que a chamada ainda não tenha sido feita. 📋\n\nPosso ajudar em mais alguma coisa?`;
  }
  if (attendance.presente) {
    const hora = attendance.hora_entrada || '—';
    return `✅ *${studentName}* chegou à escola hoje às ${hora}.\n\nPosso ajudar em mais alguma coisa?`;
  }
  return `📋 *${studentName}* não teve presença registrada hoje.\n\nSe você sabe o motivo, pode enviar o atestado pela escola. Posso ajudar em mais alguma coisa?`;
}

export function buildFallbackMessage() {
  return `Não entendi 😅 Pode digitar o *número da opção* ou me contar o que precisa?`;
}

export function buildSessionClosedMessage() {
  return `Atendimento encerrado. Obrigado por falar conosco! 😊\n\nSe precisar de algo, é só mandar uma mensagem. Até mais! 🍁`;
}
