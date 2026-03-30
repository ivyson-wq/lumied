// ═══════════════════════════════════════════════════════════════
//  Health Check Endpoint
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const startTime = Date.now();

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const checks: Record<string, { status: string; latency_ms?: number; error?: string }> = {};

  // 1. Database check
  try {
    const t = Date.now();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { count, error } = await sb.from("escolas").select("*", { count: "exact", head: true });
    checks.database = error
      ? { status: "unhealthy", error: error.message, latency_ms: Date.now() - t }
      : { status: "healthy", latency_ms: Date.now() - t };
  } catch (e) {
    checks.database = { status: "unhealthy", error: (e as Error).message };
  }

  // 2. Storage check
  try {
    const t = Date.now();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await sb.storage.listBuckets();
    checks.storage = error
      ? { status: "unhealthy", error: error.message, latency_ms: Date.now() - t }
      : { status: "healthy", latency_ms: Date.now() - t };
  } catch (e) {
    checks.storage = { status: "unhealthy", error: (e as Error).message };
  }

  const allHealthy = Object.values(checks).every(c => c.status === "healthy");
  const uptimeSeconds = Math.round((Date.now() - startTime) / 1000);

  return new Response(JSON.stringify({
    status: allHealthy ? "healthy" : "degraded",
    version: "2.0.0",
    uptime_seconds: uptimeSeconds,
    timestamp: new Date().toISOString(),
    checks,
  }), {
    status: allHealthy ? 200 : 503,
    headers: CORS,
  });
});
