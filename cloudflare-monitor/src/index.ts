// ============================================================================
// Lumied Monitor — Cloudflare Worker
// Monitors: Vercel site, Supabase, GitHub CI, Sentry, Vercel deploys
// Alerts via Resend email + Claude API for automated investigation
// ============================================================================

interface Env {
  MONITOR_KV: KVNamespace;
  LUMIED_URL: string;
  SUPABASE_URL: string;
  SUPABASE_HEALTH_URL: string;
  GITHUB_REPO: string;
  SENTRY_ORG: string;
  GITHUB_TOKEN: string;
  SENTRY_AUTH_TOKEN: string;
  VERCEL_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  SUPABASE_ANON_KEY: string;
}

type AlertLevel = "ok" | "warning" | "critical";

interface CheckResult {
  service: string;
  status: AlertLevel;
  latencyMs: number;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

interface Alert {
  service: string;
  status: AlertLevel;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

interface DashboardData {
  checks: CheckResult[];
  lastRun: string;
  summary: { ok: number; warning: number; critical: number };
}

const FETCH_TIMEOUT = 5000;
const SLOW_THRESHOLD = 3000;
const ALERT_COOLDOWN_SECONDS = 1800; // 30 min between duplicate alerts

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Health Checks
// ---------------------------------------------------------------------------

async function checkSite(env: Env): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await fetchWithTimeout(`${env.LUMIED_URL}/site/`);
    const latency = Date.now() - start;
    if (!resp.ok) {
      return {
        service: "Vercel/Site",
        status: "critical",
        latencyMs: latency,
        message: `HTTP ${resp.status} ${resp.statusText}`,
        timestamp: now(),
        details: { httpStatus: resp.status },
      };
    }
    return {
      service: "Vercel/Site",
      status: latency > SLOW_THRESHOLD ? "warning" : "ok",
      latencyMs: latency,
      message: latency > SLOW_THRESHOLD ? `Slow response (${latency}ms)` : "OK",
      timestamp: now(),
    };
  } catch (err) {
    return {
      service: "Vercel/Site",
      status: "critical",
      latencyMs: Date.now() - start,
      message: `Fetch failed: ${(err as Error).message}`,
      timestamp: now(),
    };
  }
}

async function checkSupabaseHealth(env: Env): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await fetchWithTimeout(env.SUPABASE_HEALTH_URL, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
    });
    const latency = Date.now() - start;
    if (!resp.ok) {
      return {
        service: "Supabase Health",
        status: "critical",
        latencyMs: latency,
        message: `HTTP ${resp.status}`,
        timestamp: now(),
      };
    }
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      /* ignore parse errors — 200 is enough */
    }
    return {
      service: "Supabase Health",
      status: latency > SLOW_THRESHOLD ? "warning" : "ok",
      latencyMs: latency,
      message: latency > SLOW_THRESHOLD ? `Slow (${latency}ms)` : "OK",
      timestamp: now(),
      details: body ? { body } : undefined,
    };
  } catch (err) {
    return {
      service: "Supabase Health",
      status: "critical",
      latencyMs: Date.now() - start,
      message: `Fetch failed: ${(err as Error).message}`,
      timestamp: now(),
    };
  }
}

async function checkSupabaseAuth(env: Env): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await fetchWithTimeout(
      `${env.SUPABASE_URL}/auth/v1/settings`,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
        },
      }
    );
    const latency = Date.now() - start;
    if (!resp.ok) {
      return {
        service: "Supabase Auth",
        status: resp.status === 401 ? "warning" : "critical",
        latencyMs: latency,
        message: `HTTP ${resp.status}`,
        timestamp: now(),
      };
    }
    return {
      service: "Supabase Auth",
      status: latency > SLOW_THRESHOLD ? "warning" : "ok",
      latencyMs: latency,
      message: latency > SLOW_THRESHOLD ? `Slow (${latency}ms)` : "OK",
      timestamp: now(),
    };
  } catch (err) {
    return {
      service: "Supabase Auth",
      status: "critical",
      latencyMs: Date.now() - start,
      message: `Fetch failed: ${(err as Error).message}`,
      timestamp: now(),
    };
  }
}

async function checkGitHubCI(env: Env): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await fetchWithTimeout(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs?per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "lumied-monitor",
        },
      }
    );
    const latency = Date.now() - start;
    if (!resp.ok) {
      return {
        service: "GitHub CI",
        status: "warning",
        latencyMs: latency,
        message: `API returned HTTP ${resp.status}`,
        timestamp: now(),
      };
    }
    const data = (await resp.json()) as {
      workflow_runs: Array<{
        id: number;
        conclusion: string | null;
        status: string;
        name: string;
      }>;
    };
    const runs = data.workflow_runs ?? [];
    const failed = runs.filter((r) => r.conclusion === "failure");
    if (failed.length > 0) {
      return {
        service: "GitHub CI",
        status: "critical",
        latencyMs: latency,
        message: `${failed.length} failed run(s): ${failed.map((r) => `${r.name} (#${r.id})`).join(", ")}`,
        timestamp: now(),
        details: { failedRuns: failed.map((r) => ({ id: r.id, name: r.name })) },
      };
    }
    return {
      service: "GitHub CI",
      status: "ok",
      latencyMs: latency,
      message: "OK",
      timestamp: now(),
    };
  } catch (err) {
    return {
      service: "GitHub CI",
      status: "warning",
      latencyMs: Date.now() - start,
      message: `Fetch failed: ${(err as Error).message}`,
      timestamp: now(),
    };
  }
}

async function checkSentry(env: Env): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await fetchWithTimeout(
      `https://sentry.io/api/0/organizations/${env.SENTRY_ORG}/issues/?query=is:unresolved&statsPeriod=1h`,
      {
        headers: {
          Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`,
        },
      }
    );
    const latency = Date.now() - start;
    if (!resp.ok) {
      return {
        service: "Sentry",
        status: "warning",
        latencyMs: latency,
        message: `API returned HTTP ${resp.status}`,
        timestamp: now(),
      };
    }
    const issues = (await resp.json()) as Array<{ title: string; count: string }>;
    const count = issues.length;
    if (count >= 10) {
      return {
        service: "Sentry",
        status: "critical",
        latencyMs: latency,
        message: `${count} unresolved issues in the last hour`,
        timestamp: now(),
        details: { count, titles: issues.slice(0, 5).map((i) => i.title) },
      };
    }
    if (count >= 3) {
      return {
        service: "Sentry",
        status: "warning",
        latencyMs: latency,
        message: `${count} unresolved issues in the last hour`,
        timestamp: now(),
        details: { count, titles: issues.slice(0, 5).map((i) => i.title) },
      };
    }
    return {
      service: "Sentry",
      status: "ok",
      latencyMs: latency,
      message: count === 0 ? "No issues" : `${count} issue(s)`,
      timestamp: now(),
    };
  } catch (err) {
    return {
      service: "Sentry",
      status: "warning",
      latencyMs: Date.now() - start,
      message: `Fetch failed: ${(err as Error).message}`,
      timestamp: now(),
    };
  }
}

async function checkVercelDeploys(env: Env): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await fetchWithTimeout(
      "https://api.vercel.com/v6/deployments?limit=3",
      {
        headers: {
          Authorization: `Bearer ${env.VERCEL_TOKEN}`,
        },
      }
    );
    const latency = Date.now() - start;
    if (!resp.ok) {
      return {
        service: "Vercel Deploys",
        status: "warning",
        latencyMs: latency,
        message: `API returned HTTP ${resp.status}`,
        timestamp: now(),
      };
    }
    const data = (await resp.json()) as {
      deployments: Array<{ uid: string; state: string; url: string; created: number }>;
    };
    const deploys = data.deployments ?? [];
    const failed = deploys.filter((d) => d.state === "ERROR");
    if (failed.length > 0) {
      return {
        service: "Vercel Deploys",
        status: "critical",
        latencyMs: latency,
        message: `${failed.length} failed deployment(s)`,
        timestamp: now(),
        details: { failed: failed.map((d) => ({ uid: d.uid, url: d.url })) },
      };
    }
    return {
      service: "Vercel Deploys",
      status: "ok",
      latencyMs: latency,
      message: "OK",
      timestamp: now(),
    };
  } catch (err) {
    return {
      service: "Vercel Deploys",
      status: "warning",
      latencyMs: Date.now() - start,
      message: `Fetch failed: ${(err as Error).message}`,
      timestamp: now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

async function runAllChecks(env: Env): Promise<CheckResult[]> {
  const results = await Promise.allSettled([
    checkSite(env),
    checkSupabaseHealth(env),
    checkSupabaseAuth(env),
    checkGitHubCI(env),
    checkSentry(env),
    checkVercelDeploys(env),
  ]);

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const services = [
      "Vercel/Site",
      "Supabase Health",
      "Supabase Auth",
      "GitHub CI",
      "Sentry",
      "Vercel Deploys",
    ];
    return {
      service: services[i],
      status: "critical" as AlertLevel,
      latencyMs: 0,
      message: `Check crashed: ${(r.reason as Error)?.message ?? "unknown"}`,
      timestamp: now(),
    };
  });
}

// ---------------------------------------------------------------------------
// Alert prompts for Claude
// ---------------------------------------------------------------------------

function buildPrompt(alert: Alert): string {
  const details = alert.details ?? {};

  switch (alert.service) {
    case "GitHub CI": {
      const runs = (details.failedRuns as Array<{ id: number }>) ?? [];
      const runId = runs[0]?.id ?? "unknown";
      return `O CI do repo ivyson-wq/maple-bear-rs falhou no run ${runId}. Verifique os logs do GitHub Actions, identifique o erro e sugira a correcao.`;
    }
    case "Vercel Deploys":
      return "O deploy mais recente do Vercel falhou. Verifique o status do deployment e os logs de build.";
    case "Supabase Health":
    case "Supabase Auth":
      return "O health check do Supabase retornou erro. Verifique o status das Edge Functions e do banco de dados.";
    case "Sentry": {
      const count = details.count ?? 0;
      const titles = (details.titles as string[]) ?? [];
      return `O Sentry detectou ${count} erros nao resolvidos na ultima hora. Os principais issues sao: ${titles.join("; ")}. Investigue e corrija os bugs criticos.`;
    }
    case "Vercel/Site": {
      const httpStatus = details.httpStatus ?? "N/A";
      return `O site lumied.com.br esta retornando HTTP ${httpStatus}. Verifique DNS, Vercel e Cloudflare.`;
    }
    default:
      return `O servico ${alert.service} esta com problema: ${alert.message}. Investigue e sugira uma solucao.`;
  }
}

// ---------------------------------------------------------------------------
// Claude trigger
// ---------------------------------------------------------------------------

async function triggerClaude(env: Env, alert: Alert): Promise<void> {
  const prompt = buildPrompt(alert);
  try {
    await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      15000 // longer timeout for Claude API
    );
  } catch (err) {
    console.error(`Claude trigger failed for ${alert.service}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Email via Resend
// ---------------------------------------------------------------------------

function buildEmailHtml(alert: Alert): string {
  const color = alert.status === "critical" ? "#dc2626" : "#f59e0b";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:${color};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">[${alert.status.toUpperCase()}] ${alert.service}</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 8px 8px">
    <p><strong>Service:</strong> ${alert.service}</p>
    <p><strong>Status:</strong> ${alert.status}</p>
    <p><strong>Message:</strong> ${alert.message}</p>
    <p><strong>Time:</strong> ${alert.timestamp}</p>
    ${alert.details ? `<pre style="background:#f3f4f6;padding:12px;border-radius:4px;overflow-x:auto;font-size:13px">${JSON.stringify(alert.details, null, 2)}</pre>` : ""}
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">
    <p style="color:#6b7280;font-size:13px">Lumied Monitor &mdash; Cloudflare Worker</p>
  </div>
</body>
</html>`;
}

async function sendEmail(env: Env, alert: Alert): Promise<void> {
  try {
    await fetchWithTimeout(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "monitor@lumied.com.br",
          to: "ivyson@gmail.com",
          subject: `[CRITICAL] Lumied Monitor: ${alert.service} is down`,
          html: buildEmailHtml(alert),
        }),
      },
      10000
    );
  } catch (err) {
    console.error(`Email send failed for ${alert.service}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Alert dedup + dispatch
// ---------------------------------------------------------------------------

async function shouldAlert(kv: KVNamespace, alert: Alert): Promise<boolean> {
  const key = `alert:${alert.service}`;
  const last = await kv.get(key);
  if (last) {
    const lastTime = new Date(last).getTime();
    if (Date.now() - lastTime < ALERT_COOLDOWN_SECONDS * 1000) {
      return false; // cooldown — already alerted recently
    }
  }
  await kv.put(key, alert.timestamp, { expirationTtl: ALERT_COOLDOWN_SECONDS * 2 });
  return true;
}

async function processAlerts(env: Env, checks: CheckResult[]): Promise<void> {
  const critical = checks.filter((c) => c.status === "critical");
  for (const check of critical) {
    const alert: Alert = {
      service: check.service,
      status: check.status,
      message: check.message,
      timestamp: check.timestamp,
      details: check.details,
    };
    const should = await shouldAlert(env.MONITOR_KV, alert);
    if (!should) {
      console.log(`Skipping duplicate alert for ${alert.service}`);
      continue;
    }
    console.log(`CRITICAL alert for ${alert.service}: ${alert.message}`);
    // Fire email and Claude in parallel
    await Promise.allSettled([sendEmail(env, alert), triggerClaude(env, alert)]);
  }
}

// ---------------------------------------------------------------------------
// KV persistence
// ---------------------------------------------------------------------------

async function storeDashboard(kv: KVNamespace, checks: CheckResult[]): Promise<void> {
  const summary = { ok: 0, warning: 0, critical: 0 };
  for (const c of checks) summary[c.status]++;
  const data: DashboardData = { checks, lastRun: now(), summary };
  await kv.put("dashboard:latest", JSON.stringify(data), { expirationTtl: 86400 });

  // Append to history (keep last 100 entries)
  const historyRaw = await kv.get("dashboard:history");
  const history: DashboardData[] = historyRaw ? JSON.parse(historyRaw) : [];
  history.unshift(data);
  if (history.length > 100) history.length = 100;
  await kv.put("dashboard:history", JSON.stringify(history), { expirationTtl: 604800 });
}

async function getDashboard(kv: KVNamespace): Promise<DashboardData | null> {
  const raw = await kv.get("dashboard:latest");
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------------------
// HTML Dashboard
// ---------------------------------------------------------------------------

function buildStatusHtml(data: DashboardData | null): string {
  if (!data) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lumied Monitor</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center;color:#6b7280">
<h1>Lumied Monitor</h1><p>No data yet. Wait for the first cron run.</p></body></html>`;
  }

  const dot = (s: AlertLevel) =>
    s === "ok"
      ? '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#22c55e"></span>'
      : s === "warning"
        ? '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f59e0b"></span>'
        : '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#dc2626"></span>';

  const rows = data.checks
    .map(
      (c) => `
    <tr>
      <td style="padding:10px 14px">${dot(c.status)}</td>
      <td style="padding:10px 14px;font-weight:500">${c.service}</td>
      <td style="padding:10px 14px">${c.status.toUpperCase()}</td>
      <td style="padding:10px 14px">${c.latencyMs}ms</td>
      <td style="padding:10px 14px;color:#6b7280;font-size:13px">${c.message}</td>
      <td style="padding:10px 14px;color:#9ca3af;font-size:12px">${c.timestamp}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lumied Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; padding: 24px; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #6b7280; margin-bottom: 20px; font-size: 14px; }
    .summary { display: flex; gap: 12px; margin-bottom: 20px; }
    .summary-card { padding: 12px 20px; border-radius: 8px; color: #fff; font-weight: 600; font-size: 18px; }
    .summary-card span { display: block; font-size: 12px; font-weight: 400; opacity: 0.85; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    th { text-align: left; padding: 10px 14px; background: #f3f4f6; font-size: 13px; color: #374151; }
    tr:not(:last-child) td { border-bottom: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Lumied Monitor</h1>
    <p class="subtitle">Last run: ${data.lastRun}</p>
    <div class="summary">
      <div class="summary-card" style="background:#22c55e"><span>OK</span>${data.summary.ok}</div>
      <div class="summary-card" style="background:#f59e0b"><span>Warning</span>${data.summary.warning}</div>
      <div class="summary-card" style="background:#dc2626"><span>Critical</span>${data.summary.critical}</div>
    </div>
    <table>
      <thead><tr><th></th><th>Service</th><th>Status</th><th>Latency</th><th>Message</th><th>Checked</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/status/html") {
    const data = await getDashboard(env.MONITOR_KV);
    return new Response(buildStatusHtml(data), {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  }

  if (url.pathname === "/status") {
    const data = await getDashboard(env.MONITOR_KV);
    return new Response(JSON.stringify(data ?? { error: "no data yet" }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname === "/run") {
    await handleCron(env);
    const data = await getDashboard(env.MONITOR_KV);
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fallback — redirect to HTML dashboard
  return Response.redirect(`${url.origin}/status/html`, 302);
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

async function handleCron(env: Env): Promise<void> {
  console.log("Lumied Monitor cron starting...");
  const checks = await runAllChecks(env);
  await storeDashboard(env.MONITOR_KV, checks);
  await processAlerts(env, checks);
  const summary = checks.map((c) => `${c.service}: ${c.status}`).join(" | ");
  console.log(`Cron complete: ${summary}`);
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error(`Request handler error: ${(err as Error).message}`);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      handleCron(env).catch((err) =>
        console.error(`Cron handler error: ${(err as Error).message}`)
      )
    );
  },
} satisfies ExportedHandler<Env>;
