// ═══════════════════════════════════════════════════════
//  Meta Cloud API — WhatsApp Business
// ═══════════════════════════════════════════════════════

// Fetch wrapper with a hard timeout — a stuck Meta response must not
// hang the whole worker invocation until the CPU limit fires.
async function fetchWithTimeout(url, init, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
    // Fail closed if the token is not configured — otherwise we'd send
    // `Authorization: Bearer undefined` to Meta.
    if (!this.token || !this.phoneId) {
      console.error('[META] Missing META_ACCESS_TOKEN or META_PHONE_NUMBER_ID');
      return null;
    }
    try {
      const resp = await fetchWithTimeout(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, 10000);
      let data = null;
      try { data = await resp.json(); } catch { /* ignore */ }
      if (!resp.ok) {
        // Do NOT dump the full body — templates and Authorization are not
        // there (we strip via JSON.stringify of `data`), but error payloads
        // from Meta sometimes echo the original request.
        console.error('[META] Error status:', resp.status);
      }
      return data;
    } catch (err) {
      console.error('[META] Fetch error:', err?.message || 'unknown');
      return null;
    }
  }
}
