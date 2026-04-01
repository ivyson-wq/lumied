// ═══════════════════════════════════════════════════════
//  NLP — Análise de palavras-chave e urgência
// ═══════════════════════════════════════════════════════

/**
 * Normaliza texto: lowercase, remove acentos
 */
export function normalize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Detecta urgência na mensagem
 * @returns {{ isUrgent: boolean, reason: string|null }}
 */
export function detectUrgency(message, urgencyKeywords, context = {}) {
  const normalized = normalize(message);

  // 1. Comando direto "URGENTE"
  if (message.toUpperCase().includes('URGENTE')) {
    return { isUrgent: true, reason: 'comando_direto' };
  }

  // 2. Palavras-chave de urgência
  for (const kw of urgencyKeywords) {
    if (normalized.includes(normalize(kw.keyword))) {
      return { isUrgent: true, reason: `keyword:${kw.keyword}` };
    }
  }

  // 3. Análise contextual: exclamações em horário atípico
  const hour = new Date().getUTCHours() - 3; // BRT = UTC-3
  const isOffHours = hour < 7 || hour > 19;
  const hasExclamation = (message.match(/!/g) || []).length >= 2;
  if (isOffHours && hasExclamation && message.length < 50) {
    return { isUrgent: true, reason: 'exclamacao_horario_atipico' };
  }

  // 4. Análise contextual: mensagens rápidas sem resposta
  if (context.recentMessages >= 2 && context.timeSinceLastMinutes < 2) {
    return { isUrgent: true, reason: 'mensagens_rapidas_sem_resposta' };
  }

  return { isUrgent: false, reason: null };
}

/**
 * Detecta departamento por palavras-chave na mensagem
 * @returns {string|null} shortcut do departamento ou null
 */
export function detectDepartment(message, routingKeywords) {
  const normalized = normalize(message);

  for (const rk of routingKeywords) {
    if (normalized.includes(normalize(rk.keyword))) {
      return rk.department_shortcut;
    }
  }

  return null;
}

/**
 * Detecta intenção de autoatendimento
 * @returns {{ type: string, keywords: string[] } | null}
 */
export function detectAutoservice(message) {
  const n = normalize(message);

  const patterns = {
    balance: ['mensalidade', 'boleto', 'pagamento', 'saldo', 'segunda via', 'pagar', 'pix', 'debito', 'valor mensalidade'],
    attendance: ['chegou', 'presenca', 'foi hoje', 'presente', 'faltou', 'chamada'],
    events: ['evento', 'reuniao', 'calendario', 'agenda', 'proximo evento', 'festa'],
  };

  for (const [type, keywords] of Object.entries(patterns)) {
    const matched = keywords.filter(kw => n.includes(normalize(kw)));
    if (matched.length > 0) {
      return { type, keywords: matched };
    }
  }

  return null;
}
