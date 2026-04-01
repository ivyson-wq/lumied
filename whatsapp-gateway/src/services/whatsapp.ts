import type { Env } from '../types';

const GRAPH_URL = 'https://graph.facebook.com/v19.0';

async function chamarApi(env: Env, phoneId: string, para: string, payload: object): Promise<any> {
  const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...payload }),
  });
  if (!res.ok) { console.error(`[WA] API error → ${para}:`, await res.text()); return null; }
  return res.json();
}

export async function enviarTextoLivre(env: Env, phoneId: string, para: string, texto: string) {
  return chamarApi(env, phoneId, para, { type: 'text', text: { body: texto } });
}

export async function enviarMensagemComBotao(env: Env, phoneId: string, para: string, corpo: string, botaoId: string, botaoLabel: string) {
  return chamarApi(env, phoneId, para, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: corpo },
      action: { buttons: [{ type: 'reply', reply: { id: botaoId, title: botaoLabel.substring(0, 20) } }] },
    },
  });
}

export async function enviarBotoesEvento(env: Env, phoneId: string, para: string, corpo: string, eventoId: string) {
  return chamarApi(env, phoneId, para, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: corpo },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `evento_${eventoId}_confirmado`, title: '✅ Confirmo' } },
          { type: 'reply', reply: { id: `evento_${eventoId}_recusado`, title: '❌ Não vou' } },
        ],
      },
    },
  });
}

export async function enviarTemplate(env: Env, phoneId: string, para: string, nomeTemplate: string, parametros: string[]) {
  return chamarApi(env, phoneId, para, {
    type: 'template',
    template: {
      name: nomeTemplate,
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: parametros.map(p => ({ type: 'text', text: p })) }],
    },
  });
}

export async function marcarComoLida(env: Env, phoneId: string, messageId: string) {
  const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  });
  return res.ok;
}
