// Google Calendar integration — stub
// Real implementation requires service-account credentials in env.
// Returns { success: false } when GOOGLE_SERVICE_ACCOUNT_KEY is not set.

export interface CreateCalendarEventInput {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  durationMin: number;
  timeZone?: string;
}

export interface CreateCalendarEventResult {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  error?: string;
}

async function getAccessToken(): Promise<string | null> {
  const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!keyJson) return null;
  let key: { client_email: string; private_key: string };
  try {
    key = JSON.parse(keyJson);
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const b64u = (s: string) =>
    btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encoded = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claim))}`;

  const pem = key.private_key.replace(/\\n/g, "\n");
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(encoded),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${encoded}.${sigB64}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) return null;
  const tok = await tokenRes.json();
  return tok.access_token || null;
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CreateCalendarEventResult> {
  try {
    const token = await getAccessToken();
    if (!token) return { success: false, error: "Google Calendar não configurado" };

    const start = new Date(input.startDateTime);
    const end = new Date(start.getTime() + input.durationMin * 60_000);
    const tz = input.timeZone || "America/Sao_Paulo";

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          location: input.location,
          start: { dateTime: start.toISOString(), timeZone: tz },
          end: { dateTime: end.toISOString(), timeZone: tz },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    return { success: true, eventId: data.id, htmlLink: data.htmlLink };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
