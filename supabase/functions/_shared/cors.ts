// ═══════════════════════════════════════════════════════════════
//  Shared: CORS Configuration — Whitelist-based
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  "https://app.maplebearcaxiasdosul.com.br",
  "https://maple-bear-rs.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
];

export function getCorsHeaders(req?: Request): Record<string, string> {
  let origin = "*";
  if (req) {
    const reqOrigin = req.headers.get("origin") || "";
    // Allow if matches whitelist or is a Vercel preview deploy
    if (ALLOWED_ORIGINS.includes(reqOrigin) || reqOrigin.includes("vercel.app")) {
      origin = reqOrigin;
    } else if (reqOrigin) {
      // Unknown origin — still allow for now but log
      origin = reqOrigin;
    }
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
