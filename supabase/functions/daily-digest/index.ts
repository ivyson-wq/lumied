// ═══════════════════════════════════════════════════════════════
//  Edge Function: daily-digest
//  Gera e envia resumo diário para pais (email/push)
//  Chamado via cron às 17h ou manualmente
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { successResponse, errorResponse, corsResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("daily-digest");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  // Service role authentication check
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader !== serviceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const action = (body.action as string) || "generate";

  const hoje = new Date().toISOString().split("T")[0];

  if (action === "generate" || action === "daily_digest_generate") {
    // 1. Buscar todos os registros de agenda de hoje (publicados)
    const { data: registros } = await sb
      .from("agenda_registros")
      .select("*, series(nome), professoras(nome), agenda_itens(tipo, titulo, descricao, valor)")
      .eq("data", hoje)
      .eq("publicado", true);

    if (!registros || registros.length === 0) {
      log.info("Nenhum registro de agenda hoje", { action: "daily_digest" });
      return successResponse({ message: "Nenhum registro de agenda para hoje.", enviados: 0 });
    }

    // 2. Agrupar por aluno/família
    const porFamilia: Record<string, { nome: string; itens: any[] }> = {};
    for (const reg of registros) {
      const email = reg.aluno_email;
      if (!email) continue; // registro de turma inteira, não de aluno específico
      if (!porFamilia[email]) porFamilia[email] = { nome: reg.aluno_nome || "seu filho", itens: [] };
      for (const item of reg.agenda_itens || []) {
        porFamilia[email].itens.push(item);
      }
    }

    // 3. Gerar digest para cada família
    let enviados = 0;
    for (const [email, dados] of Object.entries(porFamilia)) {
      if (dados.itens.length === 0) continue;

      // Gerar HTML do digest
      const tipoIcons: Record<string, string> = {
        atividade: "📚", refeicao: "🍽️", sono: "😴",
        humor: "😊", foto: "📸", observacao: "📝"
      };

      let htmlItens = dados.itens.map(item => {
        const icon = tipoIcons[item.tipo] || "📌";
        return `<tr>
          <td style="padding:8px;font-size:20px;width:30px;">${icon}</td>
          <td style="padding:8px;">
            <strong style="font-size:14px;color:#1a1a1a;">${item.titulo || item.tipo}</strong>
            ${item.descricao ? `<br><span style="font-size:13px;color:#666;">${item.descricao}</span>` : ""}
            ${item.valor ? `<br><span style="font-size:12px;color:#1a6bb5;">${item.valor}</span>` : ""}
          </td>
        </tr>`;
      }).join("");

      const htmlEmail = `
        <div style="max-width:500px;margin:0 auto;font-family:'Segoe UI',system-ui,sans-serif;">
          <div style="background:#C8102E;padding:20px;border-radius:16px 16px 0 0;text-align:center;color:#fff;">
            <div style="font-size:28px;margin-bottom:4px;">🍁</div>
            <h2 style="margin:0;font-size:18px;">Resumo do Dia</h2>
            <p style="margin:4px 0 0;font-size:13px;opacity:.8;">${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e2dbd1;border-top:none;">
            <p style="font-size:15px;color:#1a1a1a;margin:0 0 16px;">
              Olá! Veja o que <strong>${dados.nome}</strong> fez hoje na escola:
            </p>
            <table style="width:100%;border-collapse:collapse;">
              ${htmlItens}
            </table>
          </div>
          <div style="background:#f0ece6;padding:16px;border-radius:0 0 16px 16px;text-align:center;border:1px solid #e2dbd1;border-top:none;">
            <a href="${Deno.env.get('APP_URL') || 'https://app.maplebearcaxiasdosul.com.br'}" style="display:inline-block;padding:10px 24px;background:#C8102E;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
              Ver mais no Portal
            </a>
            <p style="margin:12px 0 0;font-size:11px;color:#999;">
              Lumied — Gestão Escolar Inteligente
            </p>
          </div>
        </div>
      `;

      // 4. Enfileirar na notificacao_queue
      await sb.from("notificacao_queue").insert({
        destinatario_email: email,
        canal: "email",
        categoria: "informativo",
        titulo: `Resumo do dia de ${dados.nome}`,
        corpo: htmlEmail,
        dados: { tipo: "daily_digest", aluno_nome: dados.nome, total_itens: dados.itens.length },
        lote_id: `digest_${hoje}`,
      });

      // 5. Também enfileirar push notification
      await sb.from("notificacao_queue").insert({
        destinatario_email: email,
        canal: "push",
        categoria: "informativo",
        titulo: `📅 O dia de ${dados.nome}`,
        corpo: `${dados.itens.length} atividades registradas hoje. Abra para ver!`,
        dados: { tipo: "daily_digest", url: "/familia.html" },
        lote_id: `digest_push_${hoje}`,
      });

      enviados++;
    }

    // 6. Tentar enviar emails da queue (via send-email function)
    const SEND_EMAIL_URL = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";
    const { data: emailQueue } = await sb.from("notificacao_queue")
      .select("*")
      .eq("canal", "email")
      .eq("lote_id", `digest_${hoje}`)
      .eq("enviado", false);

    for (const notif of emailQueue || []) {
      try {
        await fetch(SEND_EMAIL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            to: notif.destinatario_email,
            subject: notif.titulo,
            html: notif.corpo,
          }),
        });
        await sb.from("notificacao_queue").update({ enviado: true, enviado_em: new Date().toISOString() }).eq("id", notif.id);
      } catch (e) {
        log.error("Falha ao enviar email digest", { error: (e as Error).message, metadata: { email: notif.destinatario_email } });
      }
    }

    log.info("Daily digest gerado", { metadata: { data: hoje, enviados } });
    return successResponse({ data: hoje, enviados, registros: registros.length });
  }

  return errorResponse("NOT_FOUND", "Action desconhecida: " + action);
});
