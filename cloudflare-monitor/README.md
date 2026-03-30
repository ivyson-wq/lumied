# Lumied Monitor - Cloudflare Worker

Monitors the Lumied SaaS platform (site, Supabase, GitHub CI, Sentry, Vercel) every 15 minutes. Sends critical alerts via email (Resend) and triggers Claude for automated investigation.

## Required Secrets

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put SENTRY_AUTH_TOKEN
wrangler secret put VERCEL_TOKEN
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put SUPABASE_ANON_KEY
```

## KV Namespace Setup

```bash
wrangler kv:namespace create "MONITOR_KV"
```

Then update the `id` in `wrangler.toml` with the returned namespace ID.

## Deploy

```bash
npm install
wrangler deploy
```

## Local Development

```bash
npm run dev
```

## Endpoints

- `GET /status` - JSON status dashboard
- `GET /status/html` - HTML status page
