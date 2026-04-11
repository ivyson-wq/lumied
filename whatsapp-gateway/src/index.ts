// ═══════════════════════════════════════════════════════
//  WhatsApp Gateway — Entry Point
//  Cloudflare Worker: webhook + send + cron semanal
// ═══════════════════════════════════════════════════════
import type { Env } from './types';
import { handleWebhook } from './handlers/webhook';
import { handleSend } from './handlers/send';
import { handleCron } from './handlers/cron';

/**
 * Verify Meta webhook signature (X-Hub-Signature-256)
 * HMAC-SHA256(META_APP_SECRET, raw_body) — compared in constant time.
 * Fails closed: if META_APP_SECRET is not configured, the request is rejected.
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
async function verifyWebhookSignature(req: Request, rawBody: string, appSecret?: string): Promise<boolean> {
  if (!appSecret) {
    console.error('[WEBHOOK] META_APP_SECRET not configured — rejecting request');
    return false;
  }
  const signature = req.headers.get('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
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
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', service: 'whatsapp-gateway', ts: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Verificação de webhook (GET) — timing-safe verify token comparison.
      if (req.method === 'GET' && url.pathname === '/webhook') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        const expected = env.WHATSAPP_VERIFY_TOKEN;
        if (
          mode === 'subscribe' &&
          expected &&
          token &&
          token.length === expected.length &&
          (() => { let d = 0; for (let i = 0; i < token.length; i++) d |= token.charCodeAt(i) ^ expected.charCodeAt(i); return d === 0; })()
        ) {
          return new Response(challenge ?? '', { status: 200 });
        }
        return new Response('Forbidden', { status: 403 });
      }

      // Webhook de mensagens (POST)
      if (req.method === 'POST' && url.pathname === '/webhook') {
        // Verify Meta signature FIRST — fails closed if META_APP_SECRET is missing.
        const rawBody = await req.text();
        if (!(await verifyWebhookSignature(req, rawBody, env.META_APP_SECRET))) {
          console.error('[WEBHOOK] Invalid or missing signature — rejecting');
          return new Response('Forbidden', { status: 403 });
        }
        // Re-create request with parsed body for handler
        const newReq = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: rawBody,
        });
        return handleWebhook(newReq, env);
      }

      // Envio de mensagens aprovadas (POST — chamado pelo app)
      if (req.method === 'POST' && url.pathname === '/send') {
        return handleSend(req, env);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('[FETCH] Unhandled error:', (err as Error).message);
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  // Cron: relatório semanal (sábados 9h). Wrap in try/catch so a single
  // unhandled error does not leave dangling promises / crash the cron.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      handleCron(env).catch((err) => {
        console.error('[CRON] Unhandled error:', (err as Error).message);
      })
    );
  },
};
