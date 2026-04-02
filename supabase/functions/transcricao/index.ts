// ═══════════════════════════════════════════════════════════════
//  Edge Function: transcricao — Whisper API (OpenAI)
//  Professora grava áudio → transcreve → revisa → publica/envia WA
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorResponse, successResponse, AppError } from "../_shared/errors.ts";
import { checkRateLimit, getClientIP } from "../_shared/ratelimit.ts";
import { sanitizeBody } from "../_shared/validation.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const body = await req.json();
    const action = body.action;

    // Rate limit
    const ip = getClientIP(req);
    const rl = checkRateLimit(ip, "transcricao", { maxRequests: 10, windowMs: 60000 });
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Muitas requisições. Tente em alguns segundos." }), { status: 429, headers: CORS });
    }

    // Auth — verificar sessão da professora
    const token = body._prof_token;
    if (!token) return new Response(JSON.stringify({ error: "Token obrigatório." }), { status: 401, headers: CORS });
    const { data: sessao } = await sb.from("professora_sessoes").select("*, professoras(id, nome, email)").eq("token", token).single();
    if (!sessao) return new Response(JSON.stringify({ error: "Sessão inválida." }), { status: 401, headers: CORS });
    if (new Date(sessao.expira_em) < new Date()) return new Response(JSON.stringify({ error: "Sessão expirada." }), { status: 401, headers: CORS });
    const prof = (sessao as any).professoras;

    if (action === "transcrever_audio") {
      const { audio_base64, mime_type } = body;
      if (!audio_base64) return new Response(JSON.stringify({ error: "audio_base64 obrigatório." }), { status: 400, headers: CORS });

      const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_KEY) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY não configurada." }), { status: 500, headers: CORS });
      }

      // Converter base64 para blob
      const base64Data = audio_base64.replace(/^data:audio\/\w+;base64,/, "");
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      // Determinar extensão
      const ext = (mime_type || "audio/webm").includes("mp4") ? "mp4" : "webm";

      // Enviar para Whisper
      const formData = new FormData();
      formData.append("file", new Blob([bytes], { type: mime_type || "audio/webm" }), `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "pt");
      formData.append("response_format", "json");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_KEY}` },
        body: formData,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        console.error("[TRANSCRICAO] Whisper error:", whisperRes.status, errText);
        return new Response(JSON.stringify({ error: "Erro na transcrição: " + whisperRes.status }), { status: 500, headers: CORS });
      }

      const whisperData = await whisperRes.json() as any;
      const transcricao = whisperData.text || "";

      return new Response(JSON.stringify({
        transcricao,
        duracao_estimada: Math.round(bytes.length / 16000), // estimativa grosseira
        professora: prof.nome,
      }), { headers: CORS });
    }

    if (action === "salvar_agenda_audio") {
      const { texto, turma_id, enviar_whatsapp } = body;
      if (!texto) return new Response(JSON.stringify({ error: "Texto obrigatório." }), { status: 400, headers: CORS });

      // Salvar como agenda digital normal
      const { data: agenda, error: agErr } = await sb.from("agenda_digital").insert({
        professora_id: prof.id,
        turma_id,
        conteudo: texto,
        tipo: "audio_transcrito",
        criado_em: new Date().toISOString(),
      }).select().single();

      if (agErr) {
        // Tabela pode não existir — tentar comunicacao
        console.log("[TRANSCRICAO] Agenda insert error (tabela pode não existir):", agErr.message);
      }

      // Se solicitou envio por WhatsApp, criar mensagem para aprovação
      if (enviar_whatsapp && turma_id) {
        await sb.from("wa_mensagens").insert({
          conteudo: texto,
          professora_id: prof.id,
          turma_id,
          status: "aguardando_aprovacao",
        });
      }

      return new Response(JSON.stringify({
        success: true,
        agenda_id: agenda?.id,
        whatsapp_pendente: !!enviar_whatsapp,
      }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Ação desconhecida." }), { status: 400, headers: CORS });
  } catch (e) {
    console.error("[TRANSCRICAO] Error:", e);
    return new Response(JSON.stringify({ error: "Erro interno." }), { status: 500, headers: CORS });
  }
});
