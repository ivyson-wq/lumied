// ═══════════════════════════════════════════════════════
//  WhatsApp Gateway — Entry Point
//  Cloudflare Worker: webhook + send + cron semanal
// ═══════════════════════════════════════════════════════
import type { Env } from './types';
import { handleWebhook } from './handlers/webhook';
import { handleSend } from './handlers/send';
import { handleCron } from './handlers/cron';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'whatsapp-gateway', ts: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verificação de webhook (GET)
    if (req.method === 'GET' && url.pathname === '/webhook') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    // Webhook de mensagens (POST)
    if (req.method === 'POST' && url.pathname === '/webhook') {
      return handleWebhook(req, env);
    }

    // Envio de mensagens aprovadas (POST — chamado pelo app)
    if (req.method === 'POST' && url.pathname === '/send') {
      return handleSend(req, env);
    }

    return new Response('Not Found', { status: 404 });
  },

  // Cron: relatório semanal (sábados 9h)
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleCron(env);
  },
};
