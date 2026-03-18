import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TURNO_LABELS: Record<string, string> = {
  integral_5x: "Integral · 5× na semana — R$ 4.395,00 — início 07:30h",
  integral_4x: "Integral · 4× na semana — R$ 4.303,57 — início 07:30h",
  integral_3x: "Integral · 3× na semana — R$ 4.072,13 — início 07:30h",
  integral_2x: "Integral · 2× na semana — R$ 3.760,70 — início 07:30h",
  integral_1x: "Integral · 1× na semana — R$ 3.300,00 — início 07:30h",
  semi_5x:     "Semi-Integral · 5× na semana — R$ 4.030,00 — início 09:45h",
  semi_4x:     "Semi-Integral · 4× na semana — R$ 3.991,57 — início 09:45h",
  semi_3x:     "Semi-Integral · 3× na semana — R$ 3.773,13 — início 09:45h",
  semi_2x:     "Semi-Integral · 2× na semana — R$ 3.534,70 — início 09:45h",
  semi_1x:     "Semi-Integral · 1× na semana — R$ 3.196,27 — início 09:45h",
  tarde:       "Apenas a Tarde — início 13:30h (13:10h para Ens. Fundamental)",
  diaria:      "Diária — R$ 150,00",
};

function mesVigencia(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function buildHtml(d: { nomeResp: string; nomeCrianca: string; turno: string; email: string; serie?: string; diasSemana?: string[]; isManager?: boolean }): string {
  const turnoLabel = TURNO_LABELS[d.turno] ?? d.turno;
  const mes = mesVigencia();
  const intro = d.isManager
    ? `<p style="font-size:16px;color:#333;">Nova solicitação de alteração de turno recebida.</p>`
    : `<p style="font-size:16px;color:#333;">Olá, <strong>${d.nomeResp}</strong>!</p>
       <p style="color:#555;line-height:1.7;">Recebemos sua solicitação. Lembramos que <strong>a alteração será válida a partir de ${mes}</strong>.</p>`;
  const diasRow = d.diasSemana && d.diasSemana.length
    ? `<tr><td style="padding:5px 0;color:#888;">Dias da semana</td><td><strong>${d.diasSemana.join(', ')}</strong></td></tr>`
    : '';
  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:auto;border:1px solid #e0d5c5;border-radius:8px;overflow:hidden;">
  <div style="background:#C8102E;padding:28px 32px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:20px;letter-spacing:1px;">🍁 Maple Bear Bento Gonçalves</h1>
    <p style="color:#ffcdd2;margin:6px 0 0;font-size:13px;">${d.isManager ? "Notificação — Nova Solicitação" : "Confirmação de Solicitação"}</p>
  </div>
  <div style="padding:32px;background:#fff;">
    ${intro}
    <div style="background:#fdf6f0;border-left:4px solid #C8102E;padding:20px 24px;border-radius:4px;margin:24px 0;">
      <h3 style="margin:0 0 12px;color:#C8102E;font-size:13px;text-transform:uppercase;letter-spacing:.5px;">Detalhes</h3>
      <table style="width:100%;font-size:14px;color:#444;border-collapse:collapse;">
        <tr><td style="padding:5px 0;color:#888;width:140px;">Responsável</td><td><strong>${d.nomeResp}</strong></td></tr>
        <tr><td style="padding:5px 0;color:#888;">Criança</td><td><strong>${d.nomeCrianca}</strong></td></tr>
        ${d.serie ? `<tr><td style="padding:5px 0;color:#888;">Série</td><td>${d.serie}</td></tr>` : ""}
        <tr><td style="padding:5px 0;color:#888;">Turno</td><td><strong>${turnoLabel}</strong></td></tr>
        ${diasRow}
        <tr><td style="padding:5px 0;color:#888;">Vigência</td><td>${mes}</td></tr>
        <tr><td style="padding:5px 0;color:#888;">E-mail</td><td>${d.email}</td></tr>
      </table>
    </div>
    <p style="color:#888;font-size:13px;">Dúvidas? Entre em contato com a escola pelo WhatsApp.</p>
  </div>
  <div style="background:#f5f0ea;padding:14px 32px;text-align:center;font-size:11px;color:#aaa;">
    Este é um e-mail automático — por favor, não responda.<br>
    Maple Bear Bento Gonçalves · Bento Gonçalves, RS, Brasil
  </div>
</div>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { nomeResp, nomeCrianca, turno, email, serie, diasSemana } = await req.json();
    if (!nomeResp || !nomeCrianca || !turno || !email) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios ausentes" }), { status: 400, headers: CORS });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: gerentes } = await admin.from("gerentes").select("email");
    const gerenteEmails = (gerentes ?? []).map((g: { email: string }) => g.email);

    const client = new SmtpClient();
    await client.connectTLS({ hostname: "smtp.gmail.com", port: 465, username: Deno.env.get("GMAIL_USER")!, password: Deno.env.get("GMAIL_APP_PASS")! });

    const from = `"Maple Bear" <${Deno.env.get("GMAIL_USER")}>`;
    const replyTo = `"Não responda" <no-reply@${Deno.env.get("GMAIL_USER")!.split("@")[1]}>`;

    await client.send({ from, to: email, replyTo, subject: `✅ Solicitação confirmada — ${nomeCrianca}`, content: " ", html: buildHtml({ nomeResp, nomeCrianca, turno, email, serie, diasSemana }) });

    for (const gEmail of gerenteEmails) {
      await client.send({ from, to: gEmail, replyTo, subject: `📋 Nova solicitação — ${nomeCrianca}`, content: " ", html: buildHtml({ nomeResp, nomeCrianca, turno, email, serie, diasSemana, isManager: true }) });
    }

    await client.close();
    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
