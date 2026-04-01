// ═══════════════════════════════════════════════════════
//  Meta Cloud API — WhatsApp Business
// ═══════════════════════════════════════════════════════

export class MetaAPI {
  constructor(env) {
    this.token = env.META_ACCESS_TOKEN;
    this.phoneId = env.META_PHONE_NUMBER_ID;
    this.baseUrl = `https://graph.facebook.com/v19.0/${this.phoneId}`;
  }

  async sendText(to, text) {
    return this._send({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async sendTemplate(to, templateName, variables = []) {
    const components = variables.length > 0 ? [{
      type: 'body',
      parameters: variables.map(v => ({ type: 'text', text: String(v) })),
    }] : [];

    return this._send({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components,
      },
    });
  }

  async sendInteractiveButtons(to, bodyText, buttons) {
    return this._send({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b, i) => ({
            type: 'reply',
            reply: { id: b.id || `btn_${i}`, title: b.title.substring(0, 20) },
          })),
        },
      },
    });
  }

  async sendInteractiveList(to, bodyText, buttonText, sections) {
    return this._send({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections,
        },
      },
    });
  }

  async markAsRead(messageId) {
    return this._send({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  async _send(body) {
    const resp = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[META] Error:', JSON.stringify(data));
    }
    return data;
  }
}
