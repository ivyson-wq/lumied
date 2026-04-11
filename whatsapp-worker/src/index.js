// ═══════════════════════════════════════════════════════
//  WhatsApp Worker — Entry Point
//  Cloudflare Worker: webhook Meta Cloud API + cron push
// ═══════════════════════════════════════════════════════
import { handleIncoming } from './handlers/incoming.js';
import { handlePushMessages } from './handlers/push.js';
import { MetaAPI } from './services/meta.js';
import { SupabaseClient } from './services/supabase.js';
import { SaasAPI } from './services/saas.js';
import { ChatwootAPI } from './services/chatwoot.js';

/**
 * Verify Meta webhook signature (X-Hub-Signature-256)
 * HMAC-SHA256(META_APP_SECRET, raw_body) — compared in constant time.
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
async function verifyWebhookSignature(request, body, appSecret) {
  // Fail closed: if the secret is not configured, we cannot verify — reject.
  if (!appSecret) {
    console.error('[WEBHOOK] META_APP_SECRET not configured — rejecting request');
    return false;
  }
  const signature = request.headers.get('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Timing-safe comparison
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  // ── HTTP Handler (Webhook da Meta) ──
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Webhook verification (GET)
    if (request.method === 'GET' && url.pathname === '/webhook') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      const expectedToken = env.WHATSAPP_VERIFY_TOKEN || env.META_VERIFY_TOKEN;
      if (mode === 'subscribe' && expectedToken && token === expectedToken) {
        console.log('[WEBHOOK] Verification successful');
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    // Webhook messages (POST)
    if (request.method === 'POST' && url.pathname === '/webhook') {
      try {
        const rawBody = await request.text();

        // Verify Meta webhook signature (HMAC-SHA256 over raw body)
        // MUST run before any other processing — fails closed if secret missing.
        if (!(await verifyWebhookSignature(request, rawBody, env.META_APP_SECRET))) {
          console.error('[WEBHOOK] Invalid or missing signature — rejecting request');
          return new Response('Forbidden', { status: 403 });
        }

        const body = JSON.parse(rawBody);
        const services = initServices(env);

        // Processar cada mensagem recebida
        const entries = body?.entry || [];
        for (const entry of entries) {
          const changes = entry?.changes || [];
          for (const change of changes) {
            if (change.field !== 'messages') continue;
            const messages = change.value?.messages || [];

            for (const msg of messages) {
              const phone = msg.from; // número do remetente
              const messageId = msg.id;

              // Extrair texto da mensagem
              let text = '';
              if (msg.type === 'text') {
                text = msg.text?.body || '';
              } else if (msg.type === 'interactive') {
                text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
              } else if (msg.type === 'image' || msg.type === 'audio' || msg.type === 'document') {
                text = msg.caption || '[mídia recebida]';
              }

              if (text) {
                await handleIncoming(phone, text, messageId, services);
              }
            }

            // Processar status updates (delivered, read)
            const statuses = change.value?.statuses || [];
            for (const status of statuses) {
              console.log(`[STATUS] ${status.recipient_id}: ${status.status}`);
            }
          }
        }

        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error('[WEBHOOK] Error processing:', err);
        return new Response('OK', { status: 200 }); // Sempre retornar 200 para a Meta
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  // ── Cron Handler (Push Messages a cada 30 min) ──
  async scheduled(event, env, ctx) {
    const services = initServices(env);
    try {
      const result = await handlePushMessages(services);
      console.log(`[CRON] Push messages sent: ${result.sent}`);
    } catch (err) {
      console.error('[CRON] Error:', err);
    }
  },
};

function initServices(env) {
  return {
    meta: new MetaAPI(env),
    db: new SupabaseClient(env),
    saas: new SaasAPI(env),
    chatwoot: new ChatwootAPI(env),
  };
}
