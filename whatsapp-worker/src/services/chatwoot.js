// ═══════════════════════════════════════════════════════
//  Chatwoot API Client — Handoff para atendente humano
// ═══════════════════════════════════════════════════════

export class ChatwootAPI {
  constructor(env) {
    this.url = env.CHATWOOT_API_URL;
    this.token = env.CHATWOOT_API_TOKEN;
    this.inboxId = env.CHATWOOT_INBOX_ID;
    this.accountId = env.CHATWOOT_ACCOUNT_ID || '1';
  }

  async _request(method, path, body = null) {
    const opts = {
      method,
      headers: {
        'api_access_token': this.token,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const resp = await fetch(`${this.url}/api/v1/accounts/${this.accountId}${path}`, opts);
      if (!resp.ok) {
        console.error('[CHATWOOT] Error:', resp.status, await resp.text());
        return null;
      }
      return resp.json();
    } catch (e) {
      console.error('[CHATWOOT] Fetch error:', e.message);
      return null;
    }
  }

  // Buscar ou criar contato
  async findOrCreateContact(phone, name) {
    // Buscar por telefone
    const search = await this._request('GET', `/contacts/search?q=${encodeURIComponent(phone)}`);
    if (search?.payload?.length > 0) {
      return search.payload[0];
    }
    // Criar novo
    return this._request('POST', '/contacts', {
      name: name || phone,
      phone_number: `+${phone}`,
      inbox_id: this.inboxId,
    });
  }

  // Criar conversa
  async createConversation(contactId, department, isUrgent = false) {
    const labels = isUrgent ? ['URGENTE'] : [];
    return this._request('POST', '/conversations', {
      contact_id: contactId,
      inbox_id: this.inboxId,
      status: 'open',
      custom_attributes: { department, urgent: isUrgent },
      additional_attributes: { department },
      ...(labels.length && { labels }),
    });
  }

  // Enviar mensagem na conversa
  async sendMessage(conversationId, content, messageType = 'incoming') {
    return this._request('POST', `/conversations/${conversationId}/messages`, {
      content,
      message_type: messageType, // 'incoming' = do cliente, 'outgoing' = do atendente
    });
  }

  // Transferir para atendente/departamento com flag de urgência
  async escalateUrgent(conversationId) {
    // Adicionar label URGENTE
    await this._request('POST', `/conversations/${conversationId}/labels`, {
      labels: ['URGENTE'],
    });
    // Notificação via mensagem do sistema
    await this.sendMessage(conversationId, '🚨 URGÊNCIA DETECTADA — Este atendimento requer atenção imediata.', 'activity');
    return true;
  }
}
