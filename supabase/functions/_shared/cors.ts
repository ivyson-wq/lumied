// ═══════════════════════════════════════════════════════════════
//  Shared: CORS Configuration — Whitelist-based
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  "https://app.maplebearcaxiasdosul.com.br",
  "https://maple-bear-rs.vercel.app",
  "https://lumied.com.br",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
];

export function getCorsHeaders(req?: Request): Record<string, string> {
  let origin = ALLOWED_ORIGINS[0]; // Default to primary origin
  if (req) {
    const reqOrigin = req.headers.get("origin") || "";
    if (ALLOWED_ORIGINS.includes(reqOrigin)) {
      origin = reqOrigin;
    } else if (reqOrigin.endsWith(".lumied.com.br")) {
      // Allow any escola subdomain
      origin = reqOrigin;
    } else if (/^https:\/\/maple-bear-rs(-[a-z0-9-]+)?\.vercel\.app$/.test(reqOrigin)) {
      // Allow Vercel preview deploys for this exact project only
      // Matches: maple-bear-rs.vercel.app and maple-bear-rs-<hash>.vercel.app
      // Blocks: maple-bear-attack.vercel.app, evil-maple-bear.vercel.app, etc.
      origin = reqOrigin;
    }
    // Unknown origins are rejected — origin stays as default (not echoed back)
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

export function corsResponse(req?: Request): Response {
  return new Response("ok", { headers: getCorsHeaders(req) });
}
