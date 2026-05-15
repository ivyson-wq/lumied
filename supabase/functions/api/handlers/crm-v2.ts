// ═══════════════════════════════════════════════════════════════
//  CRM v2 handler — Chrome Extension 1.7.0 (mig 340)
//  Actions: score IA, sentiment, tags, templates mídia,
//  cadências, snooze, broadcast, WA check, bulk import, NLP.
//
//  Convenção: todas as actions filtram por sessionEscolaId
//  (tenant isolation). Validações leves; o trigger no banco
//  é a defesa final.
// ═══════════════════════════════════════════════════════════════
import { type Any, type GerenteCtx, sanitizeForPrompt } from "../_lib.ts";
import { askClaude } from "../../_shared/ai.ts";
import { createLogger, sanitizePgError } from "../../_shared/mod.ts";

const log = createLogger("crm-v2");

const SCORE_SYSTEM = `Você é um qualificador de leads para uma escola brasileira (educação infantil/fundamental).
Dada uma conversa de WhatsApp e dados do lead, retorne JSON puro com:
{
  "score": 1-5 (1=frio sem interesse claro, 5=quente pronto pra matrícula),
  "motivo": "frase curta em pt-BR explicando por que esse score"
}
Considere: explicitou interesse? perguntou valor/visita? mencionou criança específica? respondeu rapidamente? Não invente fatos.`;

const SENTIMENT_SYSTEM = `Você analisa tom de conversa WhatsApp entre escola e família.
Retorne JSON puro com:
{
  "sentiment": "quente" | "morno" | "frio" | "em_risco",
  "motivo": "frase curta em pt-BR"
}
"em_risco" = sinais de objeção forte, reclamação, comparação desfavorável, ou silêncio prolongado após proposta.`;

const NLP_SYSTEM = `Você extrai dados estruturados de conversas WhatsApp entre escola e família.
Retorne SOMENTE JSON puro (sem markdown, sem texto extra) no formato:
{
  "nome_responsavel": "Nome completo ou null",
  "nome_crianca": "Nome ou null",
  "data_nascimento": "AAAA-MM-DD ou null",
  "idade_anos": número ou null,
  "idade_meses": número ou null,
  "serie_interesse": "string ou null",
  "tem_irmaos_na_escola": true/false/null,
  "urgencia": "alta|media|baixa|null",
  "objecoes": ["lista de objeções detectadas, vazia se nenhuma"]
}
Nunca invente. Se não há informação clara, retorne null. Datas só completas (dia+mês+ano).`;

function parseJsonSafe<T = Any>(text: string): T | null {
  if (!text) return null;
  // Remove markdown fences
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Find first { ... last }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  try { return JSON.parse(cleaned.slice(first, last + 1)) as T; } catch { return null; }
}

export async function handle(ctx: GerenteCtx): Promise<Response | null> {
  const { admin, body, action, ok, err, gerente, sessionEscolaId } = ctx;
  const b = body as Record<string, Any>;

  // ════════════════ NLP via Claude ══════════════════════════
  if (action === "crm_lead_nlp_extract") {
    const conversa = sanitizeForPrompt(b.conversa as string, 8000);
    if (!conversa) return err("conversa obrigatória.");
    const r = await askClaude(`Extraia dados da conversa abaixo:\n\n${conversa}`, {
      system: NLP_SYSTEM, maxTokens: 400, temperature: 0.1,
      budget: { sb: admin as Any, escolaId: sessionEscolaId },
    });
    if (!r || r.blocked) return ok({ blocked: r?.blocked || "ai_indisponivel", extracted: null });
    const extracted = parseJsonSafe(r.text);
    return ok({ extracted, cost: r.cost });
  }

  // ════════════════ Score IA ════════════════════════════════
  if (action === "crm_lead_score_calc") {
    const { lead_id, conversa } = b;
    if (!lead_id) return err("lead_id obrigatório.");
    const leadRes = await admin.from("crm_leads")
      .select("id, nome_responsavel, nome_crianca, data_nascimento, serie_interesse, origem, observacoes")
      .eq("id", lead_id).eq("escola_id", sessionEscolaId).maybeSingle();
    const lead = leadRes.data as Any;
    if (!lead) return err("Lead não encontrado.", 404);

    const conv = sanitizeForPrompt((conversa as string) || "", 6000);
    const leadCtx = JSON.stringify({
      nome: lead.nome_responsavel, crianca: lead.nome_crianca,
      nascimento: lead.data_nascimento, serie: lead.serie_interesse,
      origem: lead.origem, observacoes: lead.observacoes,
    });
    const r = await askClaude(`Lead: ${leadCtx}\n\nConversa:\n${conv || '(sem mensagens recentes)'}`, {
      system: SCORE_SYSTEM, maxTokens: 200, temperature: 0.2,
      budget: { sb: admin as Any, escolaId: sessionEscolaId },
    });
    if (!r || r.blocked) return ok({ blocked: r?.blocked || "ai_indisponivel" });
    const parsed = parseJsonSafe<{ score: number; motivo: string }>(r.text);
    if (!parsed || typeof parsed.score !== "number") return err("Não foi possível classificar.");
    const score = Math.max(1, Math.min(5, Math.round(parsed.score)));
    await admin.from("crm_leads").update({
      score, score_motivo: parsed.motivo || null,
      score_atualizado_em: new Date().toISOString(),
    } as Any).eq("id", lead_id).eq("escola_id", sessionEscolaId);
    return ok({ score, motivo: parsed.motivo, cost: r.cost });
  }

  // ════════════════ Sentiment ═══════════════════════════════
  if (action === "crm_lead_sentiment_analyze") {
    const { lead_id, conversa } = b;
    if (!lead_id) return err("lead_id obrigatório.");
    const { data: lead } = await admin.from("crm_leads").select("id")
      .eq("id", lead_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!lead) return err("Lead não encontrado.", 404);
    const conv = sanitizeForPrompt((conversa as string) || "", 6000);
    if (!conv) return err("conversa obrigatória.");
    const r = await askClaude(`Conversa:\n${conv}`, {
      system: SENTIMENT_SYSTEM, maxTokens: 150, temperature: 0.2,
      budget: { sb: admin as Any, escolaId: sessionEscolaId },
    });
    if (!r || r.blocked) return ok({ blocked: r?.blocked || "ai_indisponivel" });
    const parsed = parseJsonSafe<{ sentiment: string; motivo: string }>(r.text);
    const valid = ["quente", "morno", "frio", "em_risco"];
    if (!parsed || !valid.includes(parsed.sentiment)) return err("Não foi possível analisar.");
    await admin.from("crm_leads").update({
      sentiment: parsed.sentiment, sentiment_motivo: parsed.motivo || null,
      sentiment_atualizado_em: new Date().toISOString(),
    } as Any).eq("id", lead_id).eq("escola_id", sessionEscolaId);
    return ok({ sentiment: parsed.sentiment, motivo: parsed.motivo, cost: r.cost });
  }

  // ════════════════ Tags ════════════════════════════════════
  if (action === "crm_tags_list") {
    const { data } = await admin.from("crm_tags").select("*")
      .eq("escola_id", sessionEscolaId).order("nome");
    return ok(data ?? []);
  }
  if (action === "crm_tag_save") {
    const { id, nome, cor, descricao } = b;
    if (!nome) return err("nome obrigatório.");
    if (id) {
      const { error } = await admin.from("crm_tags").update({ nome, cor, descricao })
        .eq("id", id).eq("escola_id", sessionEscolaId);
      if (error) return err(sanitizePgError(error));
    } else {
      const { error } = await admin.from("crm_tags").insert({
        nome, cor: cor || "#6b7280", descricao, escola_id: sessionEscolaId,
      });
      if (error) return err(sanitizePgError(error));
    }
    return ok({ success: true });
  }
  if (action === "crm_tag_delete") {
    if (!b.id) return err("id obrigatório.");
    await admin.from("crm_tags").delete().eq("id", b.id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_lead_tags_get") {
    if (!b.lead_id) return err("lead_id obrigatório.");
    const { data } = await admin.from("crm_lead_tags")
      .select("tag_id, crm_tags(id, nome, cor)")
      .eq("lead_id", b.lead_id).eq("escola_id", sessionEscolaId);
    return ok(data ?? []);
  }
  if (action === "crm_lead_tag_add") {
    const { lead_id, tag_id } = b;
    if (!lead_id || !tag_id) return err("lead_id e tag_id obrigatórios.");
    // valida tenant nas duas pontas
    const { data: lead } = await admin.from("crm_leads").select("id")
      .eq("id", lead_id).eq("escola_id", sessionEscolaId).maybeSingle();
    const { data: tag } = await admin.from("crm_tags").select("id")
      .eq("id", tag_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!lead || !tag) return err("Lead ou tag não encontrados.", 404);
    await admin.from("crm_lead_tags").upsert({
      lead_id, tag_id, escola_id: sessionEscolaId,
    }, { onConflict: "lead_id,tag_id" });
    return ok({ success: true });
  }
  if (action === "crm_lead_tag_remove") {
    const { lead_id, tag_id } = b;
    if (!lead_id || !tag_id) return err("lead_id e tag_id obrigatórios.");
    await admin.from("crm_lead_tags").delete()
      .eq("lead_id", lead_id).eq("tag_id", tag_id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ════════════════ Templates com mídia (extensão) ══════════
  // crm_template_save já existe (gerente-B); este complementa com mídia.
  if (action === "crm_template_save_v2") {
    const { id, nome, categoria, conteudo, variaveis, midia_url, midia_tipo, midia_nome } = b;
    if (!nome || !conteudo) return err("nome e conteudo obrigatórios.");
    const dataObj = {
      nome, categoria: categoria || "geral", conteudo,
      variaveis: variaveis || [],
      midia_url: midia_url || null,
      midia_tipo: midia_tipo || null,
      midia_nome: midia_nome || null,
    };
    if (id) {
      const { error } = await admin.from("crm_templates").update(dataObj)
        .eq("id", id).eq("escola_id", sessionEscolaId);
      if (error) return err(sanitizePgError(error));
    } else {
      const { error } = await admin.from("crm_templates")
        .insert({ ...dataObj, escola_id: sessionEscolaId });
      if (error) return err(sanitizePgError(error));
    }
    return ok({ success: true });
  }
  if (action === "crm_template_delete") {
    if (!b.id) return err("id obrigatório.");
    await admin.from("crm_templates").update({ ativo: false })
      .eq("id", b.id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_template_track_use") {
    if (!b.template_id) return err("template_id obrigatório.");
    // increment usos + ultimo_uso_em
    const { data: t } = await admin.from("crm_templates").select("usos")
      .eq("id", b.template_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!t) return err("Template não encontrado.", 404);
    await admin.from("crm_templates").update({
      usos: (t.usos || 0) + 1,
      ultimo_uso_em: new Date().toISOString(),
    }).eq("id", b.template_id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_templates_analytics") {
    const { data } = await admin.from("crm_templates")
      .select("id, nome, categoria, usos, respostas, conversoes, ultimo_uso_em")
      .eq("escola_id", sessionEscolaId).eq("ativo", true).order("usos", { ascending: false });
    const list = (data || []).map((t: Any) => ({
      ...t,
      taxa_resposta: t.usos > 0 ? Math.round((t.respostas / t.usos) * 100) : 0,
      taxa_conversao: t.usos > 0 ? Math.round((t.conversoes / t.usos) * 100) : 0,
    }));
    return ok(list);
  }

  // ════════════════ Cadências ═══════════════════════════════
  if (action === "crm_cadencias_list") {
    const { data } = await admin.from("crm_cadencias").select("*")
      .eq("escola_id", sessionEscolaId).order("criado_em");
    return ok(data ?? []);
  }
  if (action === "crm_cadencia_save") {
    const { id, nome, descricao, passos, parar_quando, ativo } = b;
    if (!nome) return err("nome obrigatório.");
    const passosArr = Array.isArray(passos) ? passos : [];
    const dataObj = {
      nome, descricao: descricao || null,
      passos: passosArr,
      parar_quando: parar_quando || "qualquer_resposta",
      ativo: ativo !== false,
    };
    if (id) {
      const { error } = await admin.from("crm_cadencias").update(dataObj)
        .eq("id", id).eq("escola_id", sessionEscolaId);
      if (error) return err(sanitizePgError(error));
    } else {
      const { error } = await admin.from("crm_cadencias")
        .insert({ ...dataObj, escola_id: sessionEscolaId });
      if (error) return err(sanitizePgError(error));
    }
    return ok({ success: true });
  }
  if (action === "crm_cadencia_delete") {
    if (!b.id) return err("id obrigatório.");
    await admin.from("crm_cadencias").delete().eq("id", b.id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_lead_cadencia_assign") {
    const { lead_id, cadencia_id } = b;
    if (!lead_id || !cadencia_id) return err("lead_id e cadencia_id obrigatórios.");
    const { data: lead } = await admin.from("crm_leads").select("id")
      .eq("id", lead_id).eq("escola_id", sessionEscolaId).maybeSingle();
    const { data: cad } = await admin.from("crm_cadencias").select("id")
      .eq("id", cadencia_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!lead || !cad) return err("Lead ou cadência não encontrados.", 404);
    const { error } = await admin.from("crm_lead_cadencias").upsert({
      lead_id, cadencia_id, escola_id: sessionEscolaId,
      passo_atual: 0, status: "ativa", iniciada_em: new Date().toISOString(),
    }, { onConflict: "lead_id,cadencia_id" });
    if (error) return err(sanitizePgError(error));
    return ok({ success: true });
  }
  if (action === "crm_lead_cadencia_pause" || action === "crm_lead_cadencia_resume" || action === "crm_lead_cadencia_cancel") {
    const { id } = b;
    if (!id) return err("id obrigatório.");
    const novoStatus = action === "crm_lead_cadencia_pause" ? "pausada"
      : action === "crm_lead_cadencia_resume" ? "ativa" : "cancelada";
    await admin.from("crm_lead_cadencias").update({ status: novoStatus })
      .eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_lead_cadencias_list") {
    const { lead_id } = b;
    if (!lead_id) return err("lead_id obrigatório.");
    const { data } = await admin.from("crm_lead_cadencias")
      .select("*, crm_cadencias(nome, passos, parar_quando)")
      .eq("lead_id", lead_id).eq("escola_id", sessionEscolaId);
    return ok(data ?? []);
  }

  // ════════════════ Snooze ══════════════════════════════════
  if (action === "crm_snooze_create") {
    const { lead_id, template_id, agendado_para, mensagem_preview } = b;
    if (!lead_id || !agendado_para) return err("lead_id e agendado_para obrigatórios.");
    const { data: lead } = await admin.from("crm_leads").select("id")
      .eq("id", lead_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!lead) return err("Lead não encontrado.", 404);
    const dt = new Date(agendado_para as string);
    if (isNaN(dt.getTime()) || dt.getTime() <= Date.now()) return err("Data inválida ou no passado.");
    const { data: created, error } = await admin.from("crm_snooze").insert({
      lead_id, template_id: template_id || null,
      agendado_para: dt.toISOString(),
      mensagem_preview: mensagem_preview || null,
      criado_por: gerente?.nome || gerente?.email || "extensao",
      escola_id: sessionEscolaId,
    }).select("id").single();
    if (error) return err(sanitizePgError(error));
    return ok({ success: true, id: created.id });
  }
  if (action === "crm_snooze_list") {
    const { lead_id, pendentes } = b;
    let q = admin.from("crm_snooze").select("*, crm_templates(nome), crm_leads(nome_responsavel, telefone)")
      .eq("escola_id", sessionEscolaId);
    if (lead_id) q = q.eq("lead_id", lead_id);
    if (pendentes) q = q.eq("status", "pendente");
    const { data } = await q.order("agendado_para");
    return ok(data ?? []);
  }
  if (action === "crm_snooze_cancel") {
    if (!b.id) return err("id obrigatório.");
    await admin.from("crm_snooze").update({ status: "cancelado" })
      .eq("id", b.id).eq("escola_id", sessionEscolaId).eq("status", "pendente");
    return ok({ success: true });
  }

  // ════════════════ Broadcasts ══════════════════════════════
  if (action === "crm_broadcast_preview") {
    // calcula quantos leads matcham o filtro
    const f = (b.filtro as Any) || {};
    let q = admin.from("crm_leads").select("id, nome_responsavel, telefone, atualizado_em", { count: "exact" })
      .eq("escola_id", sessionEscolaId).not("telefone", "is", null);
    if (f.estagio_id) q = q.eq("estagio_id", f.estagio_id);
    if (f.sentiment) q = q.eq("sentiment", f.sentiment);
    if (f.origem) q = q.eq("origem", f.origem);
    if (f.parado_dias) {
      const cutoff = new Date(Date.now() - (Number(f.parado_dias) * 86400000)).toISOString();
      q = q.lt("atualizado_em", cutoff);
    }
    const { data, count } = await q.limit(500);
    let leads = data || [];
    // filtro por tag (in-memory, simples)
    if (f.tag_id) {
      const { data: links } = await admin.from("crm_lead_tags")
        .select("lead_id").eq("tag_id", f.tag_id).eq("escola_id", sessionEscolaId);
      const ids = new Set((links || []).map((l: Any) => l.lead_id));
      leads = leads.filter((l: Any) => ids.has(l.id));
    }
    return ok({ total: leads.length, total_sem_filtro_tag: count, sample: leads.slice(0, 20) });
  }
  if (action === "crm_broadcast_create") {
    const { nome, template_id, filtro } = b;
    if (!nome || !template_id) return err("nome e template_id obrigatórios.");
    const { data: t } = await admin.from("crm_templates").select("id")
      .eq("id", template_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!t) return err("Template não encontrado.", 404);
    const { data: created, error } = await admin.from("crm_broadcasts").insert({
      nome, template_id, filtro: filtro || {},
      criado_por: gerente?.nome || "extensao",
      escola_id: sessionEscolaId,
    }).select("id").single();
    if (error) return err(sanitizePgError(error));
    return ok({ success: true, id: created.id });
  }
  if (action === "crm_broadcasts_list") {
    const { data } = await admin.from("crm_broadcasts")
      .select("*, crm_templates(nome)")
      .eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false }).limit(50);
    return ok(data ?? []);
  }
  if (action === "crm_broadcast_envios_pendentes") {
    // a extensão puxa de N em N pra disparar manualmente (operador no WhatsApp Web)
    const { broadcast_id, limit } = b;
    if (!broadcast_id) return err("broadcast_id obrigatório.");
    const { data } = await admin.from("crm_broadcast_envios")
      .select("id, lead_id, crm_leads(nome_responsavel, telefone, nome_crianca)")
      .eq("broadcast_id", broadcast_id).eq("escola_id", sessionEscolaId).eq("status", "pendente")
      .limit(Number(limit) || 10);
    return ok(data ?? []);
  }
  if (action === "crm_broadcast_envio_marcar") {
    const { id, status, motivo_erro } = b;
    if (!id || !status) return err("id e status obrigatórios.");
    if (!["enviado", "erro", "ignorado"].includes(status as string)) return err("status inválido.");
    await admin.from("crm_broadcast_envios").update({
      status, motivo_erro: motivo_erro || null,
      enviado_em: status === "enviado" ? new Date().toISOString() : null,
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    // increment counts no broadcast
    if (status === "enviado" || status === "erro") {
      const { data: env } = await admin.from("crm_broadcast_envios").select("broadcast_id")
        .eq("id", id).maybeSingle();
      if (env?.broadcast_id) {
        const { data: bc } = await admin.from("crm_broadcasts")
          .select("enviados, erros").eq("id", env.broadcast_id).maybeSingle();
        const upd: Any = {};
        if (status === "enviado") upd.enviados = (bc?.enviados || 0) + 1;
        if (status === "erro") upd.erros = (bc?.erros || 0) + 1;
        await admin.from("crm_broadcasts").update(upd)
          .eq("id", env.broadcast_id).eq("escola_id", sessionEscolaId);
      }
    }
    return ok({ success: true });
  }
  if (action === "crm_broadcast_materialize") {
    // resolve filtro → cria N envios pendentes (estado: em_andamento)
    const { broadcast_id } = b;
    if (!broadcast_id) return err("broadcast_id obrigatório.");
    const { data: bc } = await admin.from("crm_broadcasts").select("*")
      .eq("id", broadcast_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!bc) return err("Broadcast não encontrado.", 404);
    if (bc.status !== "rascunho") return err("Broadcast já materializado.");
    const f = bc.filtro || {};
    let q = admin.from("crm_leads").select("id").eq("escola_id", sessionEscolaId).not("telefone", "is", null);
    if (f.estagio_id) q = q.eq("estagio_id", f.estagio_id);
    if (f.sentiment) q = q.eq("sentiment", f.sentiment);
    if (f.origem) q = q.eq("origem", f.origem);
    if (f.parado_dias) {
      const cutoff = new Date(Date.now() - (Number(f.parado_dias) * 86400000)).toISOString();
      q = q.lt("atualizado_em", cutoff);
    }
    const { data: leads } = await q.limit(2000);
    let ids = (leads || []).map((l: Any) => l.id);
    if (f.tag_id) {
      const { data: links } = await admin.from("crm_lead_tags")
        .select("lead_id").eq("tag_id", f.tag_id).eq("escola_id", sessionEscolaId);
      const tagged = new Set((links || []).map((l: Any) => l.lead_id));
      ids = ids.filter((i: string) => tagged.has(i));
    }
    if (!ids.length) {
      await admin.from("crm_broadcasts").update({
        status: "concluido", total_leads: 0, finalizado_em: new Date().toISOString(),
      }).eq("id", broadcast_id);
      return ok({ success: true, total: 0 });
    }
    const rows = ids.map((leadId: string) => ({
      broadcast_id, lead_id: leadId, escola_id: sessionEscolaId, status: "pendente",
    }));
    // insert em lotes de 500
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("crm_broadcast_envios").insert(chunk);
      if (error) { log.error("broadcast_materialize insert err", error); return err(sanitizePgError(error)); }
    }
    await admin.from("crm_broadcasts").update({
      total_leads: ids.length, status: "em_andamento",
    }).eq("id", broadcast_id);
    return ok({ success: true, total: ids.length });
  }
  if (action === "crm_broadcast_cancel") {
    if (!b.id) return err("id obrigatório.");
    await admin.from("crm_broadcasts").update({
      status: "cancelado", finalizado_em: new Date().toISOString(),
    }).eq("id", b.id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ════════════════ WhatsApp number check log ═══════════════
  if (action === "crm_wa_check_log") {
    const { telefone, exists_on_wa } = b;
    if (!telefone || typeof exists_on_wa !== "boolean") return err("telefone e exists_on_wa obrigatórios.");
    await admin.from("crm_wa_checks").insert({
      telefone, exists_on_wa, escola_id: sessionEscolaId,
    });
    return ok({ success: true });
  }
  if (action === "crm_wa_check_cache") {
    const { telefone } = b;
    if (!telefone) return err("telefone obrigatório.");
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await admin.from("crm_wa_checks")
      .select("exists_on_wa, checked_em")
      .eq("escola_id", sessionEscolaId).eq("telefone", telefone)
      .gt("checked_em", cutoff)
      .order("checked_em", { ascending: false }).limit(1).maybeSingle();
    return ok({ cached: data || null });
  }

  // ════════════════ Bulk CSV import ═════════════════════════
  if (action === "crm_bulk_import_create") {
    const { arquivo_nome, linhas } = b;
    if (!Array.isArray(linhas) || !linhas.length) return err("linhas (array) obrigatório.");
    const { data: job, error: jobErr } = await admin.from("crm_bulk_imports").insert({
      arquivo_nome: arquivo_nome || "import.csv",
      total: linhas.length, status: "processando",
      criado_por: gerente?.nome || "extensao", escola_id: sessionEscolaId,
    }).select("id").single();
    if (jobErr) return err(sanitizePgError(jobErr));
    let imported = 0, ignored = 0, errors = 0;
    const detalhes: Any[] = [];
    // busca estágio inicial
    const { data: primEst } = await admin.from("crm_estagios")
      .select("id").eq("escola_id", sessionEscolaId).order("ordem").limit(1).maybeSingle();
    for (const lin of linhas as Any[]) {
      const nome = (lin.nome_responsavel || lin.nome || "").trim();
      let tel = String(lin.telefone || "").replace(/\D/g, "");
      if (/^\d{10,11}$/.test(tel)) tel = "55" + tel;
      if (!nome && !tel) { errors++; detalhes.push({ row: lin, erro: "sem nome nem telefone" }); continue; }
      // dedupe por telefone (mesma escola)
      if (tel) {
        const { data: existing } = await admin.from("crm_leads").select("id")
          .eq("escola_id", sessionEscolaId).eq("telefone", tel).maybeSingle();
        if (existing) { ignored++; detalhes.push({ row: lin, motivo: "telefone já existe" }); continue; }
      }
      const insertObj: Any = {
        nome_responsavel: nome || tel || "Lead sem nome",
        telefone: tel || null,
        email: lin.email || null,
        nome_crianca: lin.nome_crianca || null,
        data_nascimento: lin.data_nascimento || null,
        serie_interesse: lin.serie_interesse || null,
        origem: lin.origem || "csv",
        observacoes: lin.observacoes || `Importado de ${arquivo_nome || "csv"}`,
        estagio_id: primEst?.id || null,
        escola_id: sessionEscolaId,
        atualizado_em: new Date().toISOString(),
      };
      const { error: insErr } = await admin.from("crm_leads").insert(insertObj);
      if (insErr) { errors++; detalhes.push({ row: lin, erro: insErr.message }); }
      else imported++;
    }
    await admin.from("crm_bulk_imports").update({
      importados: imported, ignorados: ignored, erros: errors,
      detalhes: detalhes.slice(0, 50),
      status: errors === linhas.length ? "erro" : "concluido",
    }).eq("id", job.id);
    return ok({ success: true, id: job.id, imported, ignored, errors });
  }
  if (action === "crm_bulk_imports_list") {
    const { data } = await admin.from("crm_bulk_imports").select("*")
      .eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false }).limit(20);
    return ok(data ?? []);
  }

  return null;
}
