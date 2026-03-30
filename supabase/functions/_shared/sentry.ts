// ══════════════════════════════════════════════════════
//  Shared: Sentry Error Reporting for Edge Functions
//  Uses Sentry HTTP API (envelope endpoint) — no npm deps needed.
// ══════════════════════════════════════════════════════

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") ||
  "https://1af517a6f172fe6b386630dc285498fb@o4511133449519104.ingest.us.sentry.io/4511133473767424";

interface SentryParsedDSN {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDSN(dsn: string): SentryParsedDSN | null {
  try {
    const url = new URL(dsn);
    return {
      publicKey: url.username,
      host: url.hostname,
      projectId: url.pathname.replace("/", ""),
    };
  } catch {
    return null;
  }
}

const parsed = parseDSN(SENTRY_DSN);

/**
 * Send an error event to Sentry via the HTTP envelope endpoint.
 */
export async function captureException(
  error: Error | string,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!parsed) {
    console.error("[sentry] Invalid DSN — cannot report error.");
    return;
  }

  const now = Date.now() / 1000;
  const eventId = crypto.randomUUID().replace(/-/g, "");

  const errObj = typeof error === "string" ? new Error(error) : error;

  const event = {
    event_id: eventId,
    timestamp: now,
    platform: "node",
    server_name: "supabase-edge",
    environment: Deno.env.get("ENVIRONMENT") || "production",
    release: Deno.env.get("SENTRY_RELEASE") || "maple-bear-rs-edge@unknown",
    exception: {
      values: [
        {
          type: errObj.name || "Error",
          value: errObj.message,
          stacktrace: errObj.stack
            ? {
                frames: parseStack(errObj.stack),
              }
            : undefined,
        },
      ],
    },
    tags: {
      runtime: "deno",
      service: "edge-functions",
      ...(extra?.tags as Record<string, string> || {}),
    },
    extra: extra || {},
  };

  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    dsn: SENTRY_DSN,
  });
  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
  });
  const envelope = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}`;

  const url = `https://${parsed.host}/api/${parsed.projectId}/envelope/`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=maple-bear-edge/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: envelope,
    });
    if (!resp.ok) {
      console.error(`[sentry] Failed to send event: ${resp.status} ${resp.statusText}`);
    }
  } catch (e) {
    console.error("[sentry] Network error sending to Sentry:", e);
  }
}

/**
 * Capture a simple message to Sentry.
 */
export async function captureMessage(
  message: string,
  level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!parsed) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    server_name: "supabase-edge",
    environment: Deno.env.get("ENVIRONMENT") || "production",
    release: Deno.env.get("SENTRY_RELEASE") || "maple-bear-rs-edge@unknown",
    level,
    message: { formatted: message },
    tags: { runtime: "deno", service: "edge-functions" },
    extra: extra || {},
  };

  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    dsn: SENTRY_DSN,
  });
  const itemHeader = JSON.stringify({ type: "event", content_type: "application/json" });
  const envelope = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}`;

  const url = `https://${parsed.host}/api/${parsed.projectId}/envelope/`;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=maple-bear-edge/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: envelope,
    });
  } catch (e) {
    console.error("[sentry] Network error:", e);
  }
}

/**
 * Parse a JS stack trace string into Sentry frame objects.
 */
function parseStack(stack: string): Array<Record<string, unknown>> {
  const lines = stack.split("\n").slice(1);
  const frames: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
    if (match) {
      frames.push({ function: match[1], filename: match[2], lineno: parseInt(match[3]), colno: parseInt(match[4]), in_app: !match[2].includes("node_modules") && !match[2].includes("deno") });
      continue;
    }
    const match2 = line.match(/at\s+(.+?):(\d+):(\d+)/);
    if (match2) {
      frames.push({ filename: match2[1], lineno: parseInt(match2[2]), colno: parseInt(match2[3]), in_app: true });
    }
  }
  return frames.reverse(); // Sentry expects most recent frame last
}
