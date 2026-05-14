// Auto-extraído do api/index.ts (Onda 3 do refator).
// Bloco GERENTE preservado verbatim — vars `req`/`admin`/`body`/`action`/`ip`/`ok`/`err`/`cors`/
// `gerente`/`sessionEscolaId`/`token`/`authHeader` vêm do ctx. Returns Response quando uma
// action matcha; null pra fall-through.
import {
  generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode,
  getModulosHabilitados, getEscolaPadrao,
  resolveEscolaId,
  checkRateLimit, checkRateLimitDb, getClientIP,
  sanitizeBody, getCorsHeaders, createLogger,
  hashSenhaV1 as hashSenha, hashSenha as hashSenhaProf, verificarSenhaAuto, gerarToken, validarSessao as _validarSessao,
  resolveUsuario, sanitizePgError, logAudit, isFlagOn,
  cacheGet, cacheSet,
} from "../../_shared/mod.ts";
import { askClaude, askClaudeWithTools, SYSTEM_PROMPTS } from "../../_shared/ai.ts";
import { McpServer } from "../../_shared/mcp.ts";
import { gerenteTools } from "../../mcp/tools_gerente.ts";
import { createCalendarEvent } from "../../_shared/gcal.ts";
import { type Any, type GerenteCtx, escapeHtml, sanitizeHeaderValue, sha256Hex, sanitizeForPrompt, timingSafeEqual, validarSessao } from "../_lib.ts";

const log = createLogger("api");

// Module-level McpServer for ia_consulta_rapida (subset of gerente tools)
const _iaRapidaTools = ["kpis_resumo_dia", "buscar_aluno", "alunos_frequencia_critica", "leads_parados"];
const _iaRapidaServer = new McpServer("api-ia-rapida", "1.0.0");
_iaRapidaServer.registerAll(gerenteTools.filter(t => _iaRapidaTools.includes(t.name)));

export async function handle(ctx: GerenteCtx): Promise<Response | null> {
  const { req, admin, body, action, ip, ok, err, cors: CORS, gerente, sessionEscolaId, token } = ctx;
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  // ═══════════════════════════════════════════════════════════
  //  MATRÍCULA / REMATRÍCULA ONLINE
  // ═══════════════════════════════════════════════════════════

  if (action === "matricula_formulario_get") {
    const { ano, tipo } = body as any;
    const { data } = await admin.from("matricula_formularios").select("*").eq("escola_id", sessionEscolaId).eq("ano", ano || new Date().getFullYear()).eq("tipo", tipo || "nova").eq("ativo", true).maybeSingle();
    return ok(data || { campos: [] });
  }

  if (action === "matricula_formulario_create") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { ano, tipo, titulo, campos } = body as any;
    if (!ano || !tipo) return err("Ano e tipo obrigatórios.");
    const { data, error } = await admin.from("matricula_formularios").upsert({ ano, tipo, titulo, campos: campos || [], escola_id: sessionEscolaId }, { onConflict: "ano,tipo" }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(data);
  }

  if (action === "matricula_submit") {
    const { ano, dados, documentos_base64, escola_id: bodyEscolaId } = body as any;
    if (!dados || !dados.nome_crianca || !dados.email) return err("Dados incompletos.");
    // Deriva escola_id: prefere body, senão resolve via subdomínio do Origin
    let escola_id = bodyEscolaId as string | undefined;
    if (!escola_id) {
      const origin = req.headers.get("origin") || req.headers.get("referer") || "";
      const m = origin.match(/https?:\/\/([a-z0-9-]+)\.lumied\.com\.br/i);
      const subdominio = m?.[1];
      if (subdominio && subdominio !== 'www') {
        const { data: esc } = await admin.from("escolas").select("id").eq("slug", subdominio).eq("ativo", true).maybeSingle();
        if (esc?.id) escola_id = esc.id;
      }
    }
    if (!escola_id) return err("Não foi possível identificar a escola.", 400);
    // Criar matrícula no CRM
    const { data: mat, error } = await admin.from("crm_matriculas").insert({
      nome_crianca: dados.nome_crianca,
      serie: dados.serie_pretendida || dados.serie_proxima || null,
      ano: ano || new Date().getFullYear(),
      status: "reserva",
      nome_responsavel: dados.nome_responsavel || null,
      email: dados.email,
      telefone: dados.telefone || null,
      data_nascimento: dados.data_nascimento || null,
      observacoes: dados.observacoes || null,
      escola_id,
    }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(mat);
  }

  if (action === "matricula_documentos_upload") {
    const { matricula_id, tipo, base64, mime, nome_arquivo } = body as any;
    if (!matricula_id || !tipo || !base64) return err("matricula_id, tipo e base64 obrigatórios.");
    const { data: matCheck } = await admin.from("crm_matriculas").select("id").eq("id", matricula_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!matCheck) return err("Matrícula não encontrada nesta escola.", 403);
    const bytes = Uint8Array.from(atob(base64), (c: string) => c.charCodeAt(0));
    const ext = (mime || "application/pdf").split("/")[1] || "pdf";
    const fileName = `matriculas/${matricula_id}/${Date.now()}_${tipo}.${ext}`;
    const { error: upErr } = await admin.storage.from("documentos").upload(fileName, bytes, { contentType: mime || "application/pdf", upsert: false });
    if (upErr) return err(upErr.message);
    const { data: { publicUrl } } = admin.storage.from("documentos").getPublicUrl(fileName);
    const { data, error } = await admin.from("matricula_documentos").insert({ matricula_id, tipo, nome_arquivo, arquivo_url: publicUrl, escola_id: sessionEscolaId }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(data);
  }

  if (action === "rematricula_gerar_lote") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { ano } = body as any;
    const anoAlvo = ano || new Date().getFullYear() + 1;
    // Buscar famílias ativas
    const { data: familias } = await admin.from("familias").select("email, nome_aluno, nome_responsavel, serie").eq("escola_id", sessionEscolaId);
    if (!familias || familias.length === 0) return ok({ count: 0 });
    let count = 0;
    for (const f of familias) {
      const { error } = await admin.from("crm_matriculas").upsert({
        nome_crianca: f.nome_aluno, serie: f.serie, ano: anoAlvo, status: "reserva",
        nome_responsavel: f.nome_responsavel, email: f.email,
        escola_id: sessionEscolaId,
      }, { onConflict: "email,ano" }).select();
      if (!error) count++;
    }
    return ok({ success: true, count });
  }

  if (action === "matricula_status_list") {
    const { ano, status } = body as any;
    let q = admin.from("crm_matriculas").select("*, matricula_documentos(tipo, validado)").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false });
    if (ano) q = q.eq("ano", ano);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    return ok(data ?? []);
  }

  // ── Módulos habilitados (feature gating) ──

  // ── Indicações B2C (público) ────────────────────────
  if (action === "indicacao_criar") {
    const { indicador_nome, indicador_email, indicador_telefone, lead_nome, lead_telefone, lead_email, lead_serie_interesse, lead_mensagem, codigo_indicacao } = body as any;
    if (!indicador_nome || !indicador_email || !lead_nome || !lead_telefone || !codigo_indicacao) return err("Campos obrigatórios ausentes.");
    const { data: ind, error: insErr } = await admin.from("indicacoes").insert({ indicador_nome, indicador_email, indicador_telefone, lead_nome, lead_telefone, lead_email, lead_serie_interesse, lead_mensagem, codigo_indicacao, ip_origem: ip, escola_id: sessionEscolaId }).select().single();
    if (insErr) return err(insErr.message);
    const { data: primeiroEstagio } = await admin.from("crm_estagios").select("id").order("ordem").limit(1).single();
    if (primeiroEstagio) {
      const { data: crmLead } = await admin.from("crm_leads").insert({ nome_responsavel: lead_nome, email: lead_email, telefone: lead_telefone, serie_interesse: lead_serie_interesse, origem: "indicacao", observacoes: `Indicado por: ${indicador_nome} (${indicador_email}). ${lead_mensagem || ""}`.trim(), estagio_id: primeiroEstagio.id, escola_id: sessionEscolaId }).select("id").single();
      if (crmLead) await admin.from("indicacoes").update({ crm_lead_id: crmLead.id }).eq("id", ind.id).eq("escola_id", sessionEscolaId);
    }
    return ok({ data: ind, success: true });
  }
  if (action === "indicacao_rastrear") {
    const { codigo_indicacao: cod } = body as any;
    if (!cod) return err("Código obrigatório.");
    const { data: indData } = await admin.from("indicacoes").select("lead_nome, status, recompensa_status, recompensa_descricao, criado_em").eq("codigo_indicacao", cod.toUpperCase()).single();
    if (!indData) return err("Indicação não encontrada.", 404);
    return ok({ data: indData });
  }

  // ── Indicações B2B (parceiros) ────────────────────
  if (action === "indicacao_b2b_auth") {
    const { email: authEmail } = body as any;
    if (!authEmail) return err("E-mail obrigatório.");
    const { data: ger } = await admin.from("gerentes").select("id, nome, email").eq("email", authEmail).single();
    if (!ger) return err("E-mail não encontrado.", 404);
    const { data: esc } = await admin.from("escolas").select("id, nome").eq("ativo", true).limit(1).single();
    return ok({ data: { ...ger, escola_id: esc?.id, escola_nome: esc?.nome, is_gerente: true } });
  }
  if (action === "indicacao_b2b_criar") {
    const { indicador_email: ie, indicador_nome: iname, escola_indicadora_id, escola_nome: en, escola_cidade, escola_estado, escola_tipo, contato_nome, contato_telefone, contato_email, contato_cargo, mensagem: msg2, codigo } = body as any;
    if (!ie || !en || !contato_nome || !contato_telefone || !codigo) return err("Campos obrigatórios ausentes.");
    const { data: b2bData, error: b2bErr } = await admin.from("indicacoes_b2b").insert({ escola_indicadora_id, indicador_nome: iname, indicador_email: ie, escola_nome: en, escola_cidade, escola_estado, escola_tipo, contato_nome, contato_telefone, contato_email, contato_cargo, mensagem: msg2, codigo, escola_id: sessionEscolaId }).select().single();
    if (b2bErr) return err(b2bErr.message);
    return ok({ data: b2bData, success: true });
  }
  if (action === "indicacao_b2b_list") {
    const { email: listEmail } = body as any;
    if (!listEmail) return err("E-mail obrigatório.");
    const { data: b2bList } = await admin.from("indicacoes_b2b").select("*").eq("indicador_email", listEmail).order("criado_em", { ascending: false });
    return ok({ data: b2bList ?? [] });
  }
  if (action === "indicacao_b2b_config_salvar") {
    const { bonificacao_demonstracao, bonificacao_contratacao, bonificacao_especial } = body as any;
    await admin.from("indicacoes_b2b_config").update({ bonificacao_demonstracao, bonificacao_contratacao, bonificacao_especial }).eq("programa_ativo", true);
    return ok({ success: true });
  }

  // ── WhatsApp — Endpoints de integração SaaS ────────
  if (action === "wa_family_by_phone") {
    const { phone: waPhone } = body as any;
    if (!waPhone) return err("Phone obrigatório.");
    // Normalizar: remover +55, espaços, hifens. `cleanPhone` contém apenas
    // dígitos (0-9), portanto é seguro interpolar no filtro .or() — não há
    // caracteres que possam quebrar o parser de filtros do PostgREST.
    const cleanPhone = String(waPhone).replace(/\D/g, '').replace(/^55/, '');
    if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 15) return err("Phone inválido.");
    // Buscar família por telefone (pai ou mãe) — queries separadas para evitar interpolação no .or()
    let { data: fam } = await admin.from("familias").select("id, nome_responsavel, email, telefone, alunos(id, nome)").eq("escola_id", sessionEscolaId).ilike("telefone", `%${cleanPhone}%`).limit(1).maybeSingle();
    if (!fam) {
      const { data: fam2 } = await admin.from("familias").select("id, nome_responsavel, email, telefone, alunos(id, nome)").eq("escola_id", sessionEscolaId).ilike("telefone2", `%${cleanPhone}%`).limit(1).maybeSingle();
      fam = fam2;
    }
    if (!fam) return ok({ data: null });
    const aluno = fam.alunos?.[0];
    return ok({ data: { familia_id: fam.id, nome_responsavel: fam.nome_responsavel, email: fam.email, aluno_id: aluno?.id, aluno_nome: aluno?.nome } });
  }

  if (action === "wa_student_balance") {
    const { student_id: sid } = body as any;
    if (!sid) return err("student_id obrigatório.");
    const { data: aluno } = await admin.from("alunos").select("nome").eq("id", sid).eq("escola_id", sessionEscolaId).single();
    const { data: boletos } = await admin.from("boletos").select("descricao, valor, vencimento, status").eq("aluno_id", sid).eq("escola_id", sessionEscolaId).order("vencimento", { ascending: false }).limit(5);
    return ok({ data: { aluno_nome: aluno?.nome, items: boletos ?? [] } });
  }

  if (action === "wa_student_attendance_today") {
    const { student_id: sid } = body as any;
    if (!sid) return err("student_id obrigatório.");
    const today = new Date().toISOString().split("T")[0];
    const { data: aluno } = await admin.from("alunos").select("nome").eq("id", sid).eq("escola_id", sessionEscolaId).single();
    const { data: freq } = await admin.from("frequencia").select("presente, hora_entrada").eq("aluno_id", sid).eq("escola_id", sessionEscolaId).eq("data", today).single();
    return ok({ data: freq ? { aluno_nome: aluno?.nome, presente: freq.presente, hora_entrada: freq.hora_entrada } : null });
  }

  if (action === "wa_class_events") {
    const { class_id: cid } = body as any;
    const { data: eventos } = await admin.from("calendario_eventos").select("titulo, data, descricao").eq("escola_id", sessionEscolaId).gte("data", new Date().toISOString().split("T")[0]).order("data").limit(5);
    return ok({ data: eventos ?? [] });
  }

  if (action === "wa_meetings_scheduled") {
    const { data: meetings } = await admin.from("wa_scheduled_meetings").select("*").eq("escola_id", sessionEscolaId).gte("meeting_at", new Date().toISOString()).eq("followup_sent", false).order("meeting_at");
    return ok({ data: meetings ?? [] });
  }

  // ── Suporte FAQ (público) ─────────────────────────
  if (action === "suporte_faq_list") {
    const { portal: p } = body as any;
    // Use .in() with a strict allow-list to prevent PostgREST .or() injection.
    const ALLOWED_PORTALS = ["todos", "pais", "gerente", "professora", "secretaria", "aluno", "admin"];
    let q = admin.from("suporte_faq").select("id, pergunta, resposta, palavras_chave, categoria").eq("ativo", true).order("ordem");
    if (p && p !== 'todos') {
      if (typeof p !== "string" || !ALLOWED_PORTALS.includes(p)) {
        return err("Portal inválido.");
      }
      q = q.in("portal", ["todos", p]);
    }
    const { data: faqData } = await q;
    return ok({ data: faqData ?? [] });
  }

  // ── Responsável financeiro / Decisões ─────────────
  if (action === "financeiro_resp_get") {
    const { data: escola } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email, resp_financeiro_telefone, resp_financeiro_cargo, resp_financeiro_definido").eq("id", sessionEscolaId).limit(1).single();
    return ok({ data: escola });
  }

  if (action === "financeiro_resp_salvar") {
    const { resp_financeiro_nome, resp_financeiro_email, resp_financeiro_telefone, resp_financeiro_cargo } = body as any;
    if (!resp_financeiro_nome || !resp_financeiro_email) return err("Nome e email do responsável financeiro obrigatórios.");
    // Verificar se já foi definido — só staff Lumied pode alterar depois
    const { data: escolaCheck } = await admin.from("escolas").select("id, resp_financeiro_definido, resp_financeiro_nome, resp_financeiro_email").eq("id", sessionEscolaId).eq("ativo", true).limit(1).single();
    if (escolaCheck?.resp_financeiro_definido) {
      return err("O responsável financeiro já foi definido no onboarding e só pode ser alterado pelo suporte Lumied. Contate suporte@lumied.com.br");
    }
    // Primeira definição (onboarding)
    await admin.from("escolas").update({
      resp_financeiro_nome, resp_financeiro_email, resp_financeiro_telefone, resp_financeiro_cargo,
      resp_financeiro_definido: true, resp_financeiro_definido_em: new Date().toISOString(), resp_financeiro_definido_por: "onboarding",
    }).eq("id", escolaCheck.id);
    await admin.from("resp_financeiro_historico").insert({
      escola_id: escolaCheck.id, acao: "definido", nome_novo: resp_financeiro_nome, email_novo: resp_financeiro_email, alterado_por: "onboarding",
    });
    return ok({ success: true });
  }

  // Staff Lumied (via admin.html): alterar resp financeiro
  if (action === "staff_alterar_resp_financeiro") {
    const { escola_id: eid, resp_financeiro_nome: rfn, resp_financeiro_email: rfe, resp_financeiro_telefone: rft, resp_financeiro_cargo: rfc, motivo: motivoRf, admin_nome: an } = body as any;
    if (!eid || !rfn || !rfe) return err("escola_id, nome e email obrigatórios.");
    const { data: ant } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email").eq("id", eid).single();
    await admin.from("escolas").update({ resp_financeiro_nome: rfn, resp_financeiro_email: rfe, resp_financeiro_telefone: rft, resp_financeiro_cargo: rfc, resp_financeiro_definido_por: `staff:${an || "admin"}` }).eq("id", eid);
    await admin.from("resp_financeiro_historico").insert({ escola_id: eid, acao: "alterado", nome_anterior: ant?.resp_financeiro_nome, email_anterior: ant?.resp_financeiro_email, nome_novo: rfn, email_novo: rfe, alterado_por: `staff:${an || "admin"}`, motivo: motivoRf });
    return ok({ success: true });
  }

  if (action === "financeiro_decisoes_pendentes") {
    const { data } = await admin.from("escola_decisoes_financeiras").select("*").eq("escola_id", sessionEscolaId).eq("status", "pendente").order("criado_em", { ascending: false });
    return ok({ data: data ?? [] });
  }

  if (action === "financeiro_decisoes_list") {
    const { status: st } = body as any;
    let q2 = admin.from("escola_decisoes_financeiras").select("*").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false });
    if (st) q2 = q2.eq("status", st);
    const { data } = await q2.limit(100);
    return ok({ data: data ?? [] });
  }

  if (action === "financeiro_decisao_aprovar") {
    const { id: decId } = body as any;
    if (!decId) return err("ID obrigatório.");
    const { data: decisao } = await admin.from("escola_decisoes_financeiras").select("*").eq("id", decId).single();
    if (!decisao) return err("Decisão não encontrada.", 404);
    if (decisao.status !== "pendente") return err("Decisão já processada.");

    // Buscar resp financeiro
    const { data: escola } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email").eq("id", decisao.escola_id).single();

    await admin.from("escola_decisoes_financeiras").update({
      status: "aprovado",
      aprovado_por: escola?.resp_financeiro_nome || gerente?.nome || "Gerente",
      aprovado_por_email: escola?.resp_financeiro_email,
      aprovado_em: new Date().toISOString(),
      executado: true,
      executado_em: new Date().toISOString(),
    }).eq("id", decId);

    // Se for upgrade, aplicar mudança de plano
    if (decisao.tipo === "upgrade_tier" && decisao.plano_solicitado) {
      const { data: novoPlano } = await admin.from("planos").select("id").eq("slug", decisao.plano_solicitado).single();
      if (novoPlano) await admin.from("escolas").update({ plano_id: novoPlano.id }).eq("id", decisao.escola_id);
    }

    return ok({ success: true, tipo: decisao.tipo });
  }

  if (action === "financeiro_decisao_rejeitar") {
    const { id: decId, motivo } = body as any;
    if (!decId) return err("ID obrigatório.");
    const { data: escola } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email").limit(1).single();
    await admin.from("escola_decisoes_financeiras").update({
      status: "rejeitado", motivo_rejeicao: motivo || "Rejeitado pelo responsável financeiro.",
      aprovado_por: escola?.resp_financeiro_nome || "Gerente", aprovado_em: new Date().toISOString(),
    }).eq("id", decId);
    return ok({ success: true });
  }

  if (action === "financeiro_solicitar_upgrade") {
    const { plano_solicitado, motivo: motivoUp } = body as any;
    if (!plano_solicitado) return err("plano_solicitado obrigatório.");
    const { data: escola } = await admin.from("escolas").select("id, plano_id, planos(slug, preco_mensal)").limit(1).single();
    const { data: novo } = await admin.from("planos").select("slug, nome, preco_mensal").eq("slug", plano_solicitado).single();
    if (!novo) return err("Plano não encontrado.");
    const diff = novo.preco_mensal - ((escola as any).planos?.preco_mensal || 0);
    await admin.from("escola_decisoes_financeiras").insert({
      escola_id: escola.id, tipo: "upgrade_tier",
      descricao: `Upgrade de ${(escola as any).planos?.slug || '?'} para ${novo.nome}. Diferença: +R$ ${diff.toFixed(2)}/mês. ${motivoUp || ''}`,
      valor_estimado: diff, recorrente: true,
      plano_atual: (escola as any).planos?.slug, plano_solicitado,
      solicitado_por: gerente?.nome || "Gerente", solicitado_por_email: gerente?.email,
    });
    return ok({ success: true, diferenca: diff });
  }

  if (action === "financeiro_extras_disponiveis") {
    const { data } = await admin.from("escola_extras").select("*").eq("ativo", true).order("preco");
    return ok({ data: data ?? [] });
  }

  if (action === "financeiro_solicitar_extra") {
    const { extra_id } = body as any;
    if (!extra_id) return err("extra_id obrigatório.");
    const { data: extra } = await admin.from("escola_extras").select("*").eq("id", extra_id).single();
    if (!extra) return err("Extra não encontrado.");
    const { data: escola } = await admin.from("escolas").select("id").eq("ativo", true).limit(1).single();
    await admin.from("escola_decisoes_financeiras").insert({
      escola_id: escola.id, tipo: `addon_${extra.unidade}`,
      descricao: `Contratação: ${extra.nome} — R$ ${extra.preco}/mês. ${extra.descricao}`,
      valor_estimado: extra.preco, recorrente: extra.recorrente,
      quantidade: extra.quantidade, preco_unitario: extra.preco / extra.quantidade,
      solicitado_por: gerente?.nome || "Gerente", solicitado_por_email: gerente?.email,
    });
    return ok({ success: true });
  }

  if (action === "financeiro_wa_consumo") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const mes = new Date().getMonth() + 1;
    const ano = new Date().getFullYear();
    const { data } = await admin.from("wa_consumo_mensal").select("*").eq("escola_id", gerente.escola_id).eq("mes", mes).eq("ano", ano).limit(1).maybeSingle();
    const { data: alertas } = await admin.from("wa_consumo_alertas").select("*").eq("escola_id", gerente.escola_id).order("criado_em", { ascending: false }).limit(10);
    return ok({ consumo: data, alertas: alertas ?? [] });
  }

  // ── Contratos Digitais ──────────────────────────────────────
  if (action === "contrato_templates_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("contrato_templates").select("*").eq("escola_id", gerente.escola_id).eq("ativo", true).order("nome");
    return ok(data ?? []);
  }

  if (action === "contrato_template_create") {
    const { nome, tipo, html_template, variaveis } = body as any;
    if (!nome || !html_template) return err("nome e html_template obrigatórios.");
    const { data, error } = await admin.from("contrato_templates").insert({ nome, tipo: tipo || 'matricula', html_template, variaveis: variaveis || [], escola_id: sessionEscolaId }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(data);
  }

  if (action === "contrato_template_update") {
    const { id, nome, html_template, variaveis, ativo } = body as any;
    if (!id) return err("id obrigatório.");
    const fields: any = {};
    if (nome !== undefined) fields.nome = nome;
    if (html_template !== undefined) fields.html_template = html_template;
    if (variaveis !== undefined) fields.variaveis = variaveis;
    if (ativo !== undefined) fields.ativo = ativo;
    const { error } = await admin.from("contrato_templates").update(fields).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  if (action === "contrato_gerar") {
    const { template_id, familia_email, familia_nome, dados, matricula_id } = body as any;
    if (!template_id || !familia_email) return err("template_id e familia_email obrigatórios.");

    // Get template
    const { data: tpl } = await admin.from("contrato_templates").select("*").eq("id", template_id).single();
    if (!tpl) return err("Template não encontrado.", 404);

    // Render HTML with variables
    let html = tpl.html_template;
    const vars = dados || {};
    vars.familia_nome = familia_nome || vars.familia_nome || '';
    vars.familia_email = familia_email;
    vars.data_hoje = new Date().toLocaleDateString('pt-BR');
    vars.ano_letivo = new Date().getFullYear().toString();
    for (const [key, val] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
    }

    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data: contrato, error } = await admin.from("contratos").insert({
      template_id, familia_email: familia_email.toLowerCase().trim(),
      familia_nome: familia_nome || '', matricula_id: matricula_id || null,
      dados_preenchidos: vars, html_renderizado: html, status: 'rascunho',
      escola_id: gerente.escola_id,
    }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(contrato);
  }

  if (action === "contrato_enviar") {
    const { id } = body as any;
    if (!id) return err("id obrigatório.");
    const { error } = await admin.from("contratos").update({ status: 'enviado', enviado_em: new Date().toISOString() }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // TODO: send email notification to familia
    return ok({ success: true });
  }

  if (action === "contratos_list") {
    const { data } = await admin.from("contratos").select("*, contrato_templates(nome, tipo), contrato_assinaturas(id, tipo, nome_signatario, assinado_em)").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }

  if (action === "contrato_delete") {
    const { id } = body as any;
    const { data: c } = await admin.from("contratos").select("status").eq("id", id).eq("escola_id", sessionEscolaId).single();
    if (c?.status === 'assinado') return err("Contrato assinado não pode ser excluído.");
    await admin.from("contratos").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Risk scores ──────────────────────────────────────
  if (action === "risk_scores_list") {
    const { filtro } = body as { filtro?: string };
    let q = admin.from("aluno_risk_scores")
      .select("aluno_email, aluno_nome, score, score_frequencia, score_notas, score_engajamento_pais, score_tendencia, fatores, calculado_em")
      .eq("escola_id", sessionEscolaId)
      .order("score", { ascending: false });
    if (filtro === "alto") q = q.gte("score", 80);
    else if (filtro === "medio") q = q.gte("score", 60).lt("score", 80);
    const { data } = await q;
    return ok(data ?? []);
  }


  // ═══════════════════════════════════════════════════════════════
  //  ENGAGEMENT SCORE — Score de Engajamento das Famílias (0-100)
  // ═══════════════════════════════════════════════════════════════

  if (action === "calcular_engagement") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    if (!gerente.escola_id) return err("Sessão sem escola associada.", 403);
    const escolaId = gerente.escola_id;

    // Busca todas as famílias ativas da escola
    const { data: familias } = await admin
      .from("familias")
      .select("email, nome_responsavel")
      .eq("escola_id", escolaId);
    if (!familias?.length) return ok({ calculadas: 0 });

    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
    let calculadas = 0;

    for (const fam of familias) {
      if (!fam.email) continue;

      // ── app_usage: sessões nos últimos 30 dias ──
      const { count: sessoes } = await admin
        .from("sessoes")
        .select("id", { count: "exact", head: true })
        .eq("escola_id", escolaId)
        .gte("criado_em", d30)
        .eq("email", fam.email);
      const cnt = sessoes ?? 0;
      const score_app_usage = cnt === 0 ? 0 : cnt <= 3 ? 30 : cnt <= 10 ? 60 : cnt < 30 ? 90 : 100;

      // ── pagamento: dias de atraso médio nos boletos ──
      const { data: boletos } = await admin
        .from("boletos")
        .select("vencimento, pago_em")
        .eq("escola_id", escolaId)
        .eq("familia_email", fam.email)
        .eq("status", "pago")
        .limit(10)
        .order("vencimento", { ascending: false });
      let score_pagamento = 50; // sem boletos = neutro
      if (boletos?.length) {
        const avgDias = boletos.reduce((acc: number, b: any) => {
          if (!b.pago_em) return acc;
          const diff = (new Date(b.pago_em).getTime() - new Date(b.vencimento).getTime()) / 86400_000;
          return acc + Math.max(0, diff);
        }, 0) / boletos.length;
        score_pagamento = avgDias <= 0 ? 100 : avgDias <= 5 ? 70 : avgDias <= 15 ? 40 : 10;
      }

      // ── comunicacao: taxa de resposta a mensagens nos últimos 30 dias ──
      const { count: enviadas } = await admin
        .from("mensagens")
        .select("id", { count: "exact", head: true })
        .eq("escola_id", escolaId)
        .eq("destinatario_email", fam.email)
        .gte("criado_em", d30);
      const { count: respondidas } = await admin
        .from("mensagens")
        .select("id", { count: "exact", head: true })
        .eq("escola_id", escolaId)
        .eq("remetente_email", fam.email)
        .gte("criado_em", d30);
      let score_comunicacao = 50;
      if ((enviadas ?? 0) > 0) {
        const taxa = Math.min(1, (respondidas ?? 0) / (enviadas ?? 1));
        score_comunicacao = taxa >= 1 ? 100 : taxa >= 0.75 ? 80 : taxa >= 0.5 ? 50 : 20;
      }

      // ── presenca: última reunião agendada ──
      const { data: reunioes } = await admin
        .from("reunioes_agenda")
        .select("id, confirmado")
        .eq("escola_id", escolaId)
        .eq("familia_email", fam.email)
        .order("data_hora", { ascending: false })
        .limit(1);
      let score_presenca = 60; // sem reuniões = neutro
      if (reunioes?.length) {
        score_presenca = reunioes[0].confirmado ? 100 : 30;
      }

      const score = Math.round(
        score_app_usage * 0.30 +
        score_pagamento * 0.25 +
        score_comunicacao * 0.25 +
        score_presenca * 0.20
      );

      // Busca score anterior para calcular trend
      const { data: prev } = await admin
        .from("familia_engagement")
        .select("score")
        .eq("escola_id", escolaId)
        .eq("familia_email", fam.email)
        .maybeSingle();
      const score_anterior = prev?.score ?? score;
      const diff = score - score_anterior;
      const trend = diff > 10 ? "subindo" : diff < -10 ? "descendo" : "estavel";

      await admin.from("familia_engagement").upsert({
        escola_id: escolaId,
        familia_email: fam.email,
        familia_nome: fam.nome_responsavel,
        score,
        score_app_usage,
        score_pagamento,
        score_comunicacao,
        score_presenca,
        trend,
        score_anterior,
        detalhes: { sessoes: cnt, boletos_analisados: boletos?.length ?? 0, mensagens_enviadas: enviadas ?? 0, mensagens_respondidas: respondidas ?? 0 },
        calculado_em: now.toISOString(),
      }, { onConflict: "escola_id,familia_email" });

      calculadas++;
    }

    return ok({ calculadas });
  }

  if (action === "calcular_engagement_todas_escolas") {
    const cronEnvKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const isAuthorized = (cronEnvKey && authHeader === cronEnvKey) || (svcKey && authHeader === svcKey);
    if (!isAuthorized) return err("Não autorizado.", 401);

    const { data: escolas } = await admin.from("escolas").select("id").eq("ativo", true);
    if (!escolas?.length) return ok({ escolas_processadas: 0, calculadas: 0 });

    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
    let totalEscolas = 0;
    let totalCalculadas = 0;

    for (const escola of escolas) {
      const eid = escola.id;
      const { data: familias } = await admin.from("familias").select("email, nome_responsavel").eq("escola_id", eid);
      if (!familias?.length) continue;

      const upserts = [];
      for (const fam of familias) {
        if (!fam.email) continue;
        const { count: sessoes } = await admin.from("sessoes").select("id", { count: "exact", head: true }).eq("escola_id", eid).gte("criado_em", d30).eq("email", fam.email);
        const cnt = sessoes ?? 0;
        const score_app_usage = cnt === 0 ? 0 : cnt <= 3 ? 30 : cnt <= 10 ? 60 : cnt < 30 ? 90 : 100;

        const { data: boletos } = await admin.from("boletos").select("vencimento, pago_em").eq("escola_id", eid).eq("familia_email", fam.email).eq("status", "pago").limit(10).order("vencimento", { ascending: false });
        let score_pagamento = 50;
        if (boletos?.length) {
          const avgDias = boletos.reduce((acc: number, b: any) => { if (!b.pago_em) return acc; return acc + Math.max(0, (new Date(b.pago_em).getTime() - new Date(b.vencimento).getTime()) / 86400_000); }, 0) / boletos.length;
          score_pagamento = avgDias <= 0 ? 100 : avgDias <= 5 ? 70 : avgDias <= 15 ? 40 : 10;
        }

        const { count: enviadas } = await admin.from("mensagens").select("id", { count: "exact", head: true }).eq("escola_id", eid).eq("destinatario_email", fam.email).gte("criado_em", d30);
        const { count: respondidas } = await admin.from("mensagens").select("id", { count: "exact", head: true }).eq("escola_id", eid).eq("remetente_email", fam.email).gte("criado_em", d30);
        let score_comunicacao = 50;
        if ((enviadas ?? 0) > 0) { const taxa = Math.min(1, (respondidas ?? 0) / (enviadas ?? 1)); score_comunicacao = taxa >= 1 ? 100 : taxa >= 0.75 ? 80 : taxa >= 0.5 ? 50 : 20; }

        const { data: reunioes } = await admin.from("reunioes_agenda").select("confirmado").eq("escola_id", eid).eq("familia_email", fam.email).order("data_hora", { ascending: false }).limit(1);
        const score_presenca = reunioes?.length ? (reunioes[0].confirmado ? 100 : 30) : 60;

        const score = Math.round(score_app_usage * 0.30 + score_pagamento * 0.25 + score_comunicacao * 0.25 + score_presenca * 0.20);
        const { data: prev } = await admin.from("familia_engagement").select("score").eq("escola_id", eid).eq("familia_email", fam.email).maybeSingle();
        const score_anterior = prev?.score ?? score;
        const diff = score - score_anterior;
        const trend = diff > 10 ? "subindo" : diff < -10 ? "descendo" : "estavel";
        upserts.push({ escola_id: eid, familia_email: fam.email, familia_nome: fam.nome_responsavel, score, score_app_usage, score_pagamento, score_comunicacao, score_presenca, trend, score_anterior, detalhes: { sessoes: cnt, boletos_analisados: boletos?.length ?? 0, mensagens_enviadas: enviadas ?? 0, mensagens_respondidas: respondidas ?? 0 }, calculado_em: now.toISOString() });
      }

      if (upserts.length > 0) {
        await admin.from("familia_engagement").upsert(upserts, { onConflict: "escola_id,familia_email" });
        totalCalculadas += upserts.length;
      }
      totalEscolas++;
    }

    return ok({ escolas_processadas: totalEscolas, calculadas: totalCalculadas });
  }

  if (action === "engagement_list") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    if (!gerente.escola_id) return err("Sessão sem escola associada.", 403);
    const { trend } = body as any;

    let query = admin
      .from("familia_engagement")
      .select("*")
      .eq("escola_id", gerente.escola_id)
      .order("score", { ascending: true });

    if (trend && ["subindo", "descendo", "estavel"].includes(trend)) {
      query = query.eq("trend", trend);
    }

    const { data } = await query;
    return ok(data ?? []);
  }

  if (action === "engagement_dashboard") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    if (!gerente.escola_id) return err("Sessão sem escola associada.", 403);

    const { data: rows } = await admin
      .from("familia_engagement")
      .select("score, trend")
      .eq("escola_id", gerente.escola_id);

    if (!rows?.length) return ok({ avg_score: 0, total: 0, alto: 0, medio: 0, baixo: 0, subindo: 0, estavel: 0, descendo: 0 });

    const total = rows.length;
    const avg_score = Math.round(rows.reduce((s: number, r: any) => s + r.score, 0) / total);
    const alto = rows.filter((r: any) => r.score > 70).length;
    const medio = rows.filter((r: any) => r.score >= 40 && r.score <= 70).length;
    const baixo = rows.filter((r: any) => r.score < 40).length;
    const subindo = rows.filter((r: any) => r.trend === "subindo").length;
    const estavel = rows.filter((r: any) => r.trend === "estavel").length;
    const descendo = rows.filter((r: any) => r.trend === "descendo").length;

    return ok({ avg_score, total, alto, medio, baixo, subindo, estavel, descendo });
  }

  // ── IA: Consulta rápida (Ctrl+K natural language search) ──────
  if (action === "ia_consulta_rapida") {
    const perguntaRaw = typeof body.pergunta === 'string' ? body.pergunta.trim().slice(0, 500) : '';
    if (!perguntaRaw) return err("Pergunta obrigatória.");

    // Rate limit: 10 queries per minute per user
    const userId = (gerente as any).id || (gerente as any).email || ip;
    const rlAi = await checkRateLimitDb(admin, String(userId), "ia_consulta_rapida", { windowMs: 60000, maxRequests: 10 });
    if (!rlAi.allowed) return err(`Limite de consultas IA atingido. Tente novamente em ${rlAi.retryAfterSeconds}s.`, 429);

    // Feature flag: ia_ativa
    const iaAtiva = await isFlagOn(admin, 'ia_ativa', sessionEscolaId);
    if (!iaAtiva) return err("IA não disponível neste plano.", 403);

    // Sanitize prompt injection
    const pergunta = perguntaRaw
      .replace(/ /g, '')
      .replace(/\r/g, '')
      .replace(/^(system|assistant|ignore[^\n]*instructions)/gim, '[$1]');

    // Claude tool definitions scoped to this action
    const quickTools = [
      {
        name: "kpis_resumo_dia",
        description: "Resumo do dia da escola: total alunos ativos, presentes hoje, boletos vencendo esta semana, leads no CRM, tickets abertos.",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "buscar_aluno",
        description: "Busca ficha de um aluno por nome (busca parcial). Retorna dados pessoais, turma, responsável, frequência.",
        input_schema: { type: "object", required: ["nome"], properties: { nome: { type: "string", description: "Nome ou parte do nome" } } },
      },
      {
        name: "alunos_frequencia_critica",
        description: "Lista alunos com frequência abaixo de um limiar (default 75%) no mês atual. Útil para identificar risco de evasão.",
        input_schema: { type: "object", properties: { limiar_pct: { type: "integer", default: 75, minimum: 0, maximum: 100 } } },
      },
      {
        name: "leads_parados",
        description: "Lista leads do CRM sem follow-up há mais de N dias (default 7).",
        input_schema: { type: "object", properties: { dias: { type: "integer", default: 7, minimum: 1 } } },
      },
    ];

    // Tool executor with explicit escola_id scoping (bypasses RLS since service role)
    // deno-lint-ignore no-explicit-any
    const executor = async (name: string, args: Record<string, any>): Promise<unknown> => {
      const eid = sessionEscolaId;
      if (name === "kpis_resumo_dia") {
        const hoje = new Date().toISOString().split("T")[0];
        const semanaFrente = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
        const [alunos, presentes, boletos, leads, tickets] = await Promise.all([
          admin.from("alunos").select("id", { count: "exact", head: true }).eq("ativo", true).eq("escola_id", eid),
          admin.from("frequencia").select("presente").eq("data", hoje).eq("escola_id", eid).limit(2000),
          admin.from("boletos").select("valor").eq("status", "pendente").lte("vencimento", semanaFrente).eq("escola_id", eid),
          admin.from("crm_leads").select("id", { count: "exact", head: true }).eq("status", "novo").eq("escola_id", eid),
          admin.from("tickets").select("id", { count: "exact", head: true }).in("status", ["aberto", "escalado"]).eq("escola_id", eid),
        ]);
        // deno-lint-ignore no-explicit-any
        const presData = (presentes.data || []) as any[];
        // deno-lint-ignore no-explicit-any
        const boletosData = (boletos.data || []) as any[];
        const totalBoletos = boletosData.reduce((s: number, b: { valor: unknown }) => s + (Number(b.valor) || 0), 0);
        return {
          data: hoje,
          total_alunos_ativos: alunos.count || 0,
          presentes_hoje: presData.filter((f) => f.presente).length,
          ausentes_hoje: presData.filter((f) => !f.presente).length,
          boletos_vencendo_7d: { quantidade: boletosData.length, total_valor: totalBoletos.toFixed(2) },
          leads_novos: leads.count || 0,
          tickets_abertos: tickets.count || 0,
        };
      }
      if (name === "buscar_aluno") {
        const nome = String(args.nome || '').slice(0, 100);
        if (!nome) throw new Error("Nome obrigatório");
        const { data } = await admin.from("alunos")
          .select("id, nome, responsavel_nome, serie, data_nascimento, turno, ativo")
          .ilike("nome", `%${nome}%`).eq("ativo", true).eq("escola_id", eid).limit(10);
        return { encontrados: data?.length || 0, alunos: data || [] };
      }
      if (name === "alunos_frequencia_critica") {
        const limiar = Math.min(100, Math.max(0, Number(args.limiar_pct ?? 75)));
        const primeiroDia = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
        const { data } = await admin.from("frequencia")
          .select("aluno_id, aluno_nome, presente").gte("data", primeiroDia).eq("escola_id", eid).limit(5000);
        // deno-lint-ignore no-explicit-any
        const porAluno = new Map<string, any>();
        for (const r of data || []) {
          // deno-lint-ignore no-explicit-any
          const rr = r as any;
          const cur = porAluno.get(rr.aluno_id) || { aluno_id: rr.aluno_id, nome: rr.aluno_nome, total: 0, presentes: 0 };
          cur.total += 1;
          if (rr.presente) cur.presentes += 1;
          porAluno.set(rr.aluno_id, cur);
        }
        const criticos = [...porAluno.values()]
          .map(a => ({ ...a, pct: a.total > 0 ? Math.round((a.presentes / a.total) * 100) : 0 }))
          .filter(a => a.pct < limiar)
          .sort((a, b) => a.pct - b.pct);
        return { limiar_pct: limiar, total: criticos.length, alunos: criticos };
      }
      if (name === "leads_parados") {
        const dias = Math.max(1, Number(args.dias ?? 7));
        const limite = new Date(Date.now() - dias * 86400000).toISOString();
        const { data } = await admin.from("crm_leads")
          .select("id, nome, email, telefone, status, atualizado_em, origem")
          .lt("atualizado_em", limite)
          .not("status", "in", "(convertido,perdido)")
          .eq("escola_id", eid)
          .order("atualizado_em", { ascending: true })
          .limit(50);
        return { dias, total: data?.length || 0, leads: data || [] };
      }
      throw new Error(`Ferramenta desconhecida: ${name}`);
    };

    try {
      const aiPromise = askClaudeWithTools(pergunta, quickTools, executor, {
        system: SYSTEM_PROMPTS.gerente,
        model: "claude-haiku-4-5-20251001",
        maxTokens: 600,
        maxTurns: 4,
        budget: { sb: admin, escolaId: sessionEscolaId },
      });
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10000)
      );
      const result = await Promise.race([aiPromise, timeoutPromise]);
      if (!result) return err("IA indisponível no momento. Tente novamente.");
      return ok({
        resposta: result.text,
        dados: result.tool_calls.length > 0 ? result.tool_calls.map(t => t.output) : undefined,
      });
    } catch (e) {
      if ((e as Error).message === 'timeout') return err("A consulta demorou muito. Tente uma pergunta mais simples.", 408);
      console.error("[api] ia_consulta_rapida error:", e);
      return err("Erro ao processar consulta IA.");
    }
  }

  // ── Risk Scores: Calcular (cron/admin only) ──
  if (action === 'calcular_risk_scores') {
    const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const isAuthorized = (cronKey && authHeader === cronKey) || (svcKey && authHeader === svcKey);
    if (!isAuthorized) return err("Unauthorized", 401);

    const anoAtual = new Date().getFullYear();
    const limite30d = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const now = Date.now();

    const { data: escolas } = await admin.from("escolas").select("id").eq("ativo", true);
    if (!escolas?.length) return ok({ calculados: 0, alto_risco: 0 });

    let totalCalculados = 0;
    let totalAltoRisco = 0;

    for (const escola of escolas) {
      const eid = escola.id;

      const { data: alunos } = await admin.from("familias")
        .select("email, nome_aluno")
        .eq("escola_id", eid);
      if (!alunos?.length) continue;

      // Attendance: chamadas in last 30 days
      const { data: chamadas } = await admin.from("frequencia_chamadas")
        .select("id")
        .eq("escola_id", eid)
        .gte("data", limite30d);
      const chamadaIds = (chamadas || []).map((c: { id: string }) => c.id);
      const totalAulas = chamadaIds.length;
      const faltasMap: Record<string, number> = {};
      if (chamadaIds.length > 0) {
        const { data: registros } = await admin.from("frequencia_registros")
          .select("aluno_email")
          .in("chamada_id", chamadaIds)
          .eq("status", "A");
        for (const r of registros || []) faltasMap[(r as { aluno_email: string }).aluno_email] = (faltasMap[(r as { aluno_email: string }).aluno_email] || 0) + 1;
      }

      // Grades: boletins for current year
      const { data: boletins } = await admin.from("boletins")
        .select("aluno_email, media_geral, gerado_em")
        .eq("escola_id", eid)
        .eq("ano", anoAtual)
        .order("gerado_em", { ascending: false });
      const notasMap: Record<string, number[]> = {};
      for (const b of boletins || []) {
        const be = b as { aluno_email: string; media_geral: number | null; gerado_em: string };
        if (!notasMap[be.aluno_email]) notasMap[be.aluno_email] = [];
        if (notasMap[be.aluno_email].length < 5 && be.media_geral != null) notasMap[be.aluno_email].push(Number(be.media_geral));
      }

      // Family engagement: last chat message per family
      const emails = alunos.map((a: { email: string }) => a.email);
      const { data: chatMsgs } = await admin.from("chat_mensagens")
        .select("remetente_id, criado_em")
        .eq("remetente_tipo", "pais")
        .in("remetente_id", emails)
        .order("criado_em", { ascending: false });
      const lastMsgMap: Record<string, number> = {};
      for (const m of chatMsgs || []) {
        const me = m as { remetente_id: string; criado_em: string };
        if (!lastMsgMap[me.remetente_id]) lastMsgMap[me.remetente_id] = new Date(me.criado_em).getTime();
      }

      const upserts = [];
      for (const aluno of alunos) {
        const ae = aluno as { email: string; nome_aluno: string };
        const email = ae.email;

        const nFaltas = faltasMap[email] || 0;
        const score_frequencia = totalAulas > 0 ? Math.max(0, Math.round(100 - (nFaltas / totalAulas * 100))) : 100;

        const notasList = notasMap[email] || [];
        const score_notas = notasList.length > 0
          ? Math.round(Math.min(100, Math.max(0, (notasList.reduce((a: number, b: number) => a + b, 0) / notasList.length) * 10)))
          : 50;

        const lastMsgTs = lastMsgMap[email];
        const daysSince = lastMsgTs ? (now - lastMsgTs) / 86400000 : 999;
        const score_engajamento_pais = daysSince < 7 ? 80 : daysSince < 30 ? 50 : 20;

        let score_tendencia = 50;
        if (notasList.length >= 2) {
          const diff = notasList[0] - notasList[notasList.length - 1];
          if (diff > 0.5) score_tendencia = 80;
          else if (diff < -0.5) score_tendencia = 20;
        }

        const componentScore = score_frequencia * 0.35 + score_notas * 0.30 + score_engajamento_pais * 0.20 + score_tendencia * 0.15;
        const score = Math.round(Math.max(0, Math.min(100, 100 - componentScore)));

        const fatores: { tipo: string; detalhe: string }[] = [];
        if (score_frequencia < 60) fatores.push({ tipo: "frequencia", detalhe: `Frequência baixa (score ${score_frequencia})` });
        if (score_notas < 50) fatores.push({ tipo: "notas", detalhe: `Média abaixo do esperado (score ${score_notas})` });
        if (score_engajamento_pais < 30) fatores.push({ tipo: "engajamento", detalhe: "Família sem atividade recente" });
        if (score_tendencia < 30) fatores.push({ tipo: "tendencia", detalhe: "Notas em queda" });

        upserts.push({ escola_id: eid, aluno_email: email, aluno_nome: ae.nome_aluno, score, score_frequencia, score_notas, score_engajamento_pais, score_tendencia, fatores, calculado_em: new Date().toISOString() });
        if (score >= 80) totalAltoRisco++;
      }

      if (upserts.length > 0) {
        await admin.from("aluno_risk_scores").upsert(upserts, { onConflict: "escola_id,aluno_email" });
        totalCalculados += upserts.length;
      }
    }

    return ok({ calculados: totalCalculados, alto_risco: totalAltoRisco });
  }

  // ── Risk Scores: Listar (gerente) ──
  if (action === 'risk_scores_list') {
    const token = req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const sessao = await validarSessao(admin, token);
    if (!sessao) return err("Sessão inválida.", 401);
    const escolaId = await resolveEscolaId(req, admin, sessao, body);
    if (!escolaId) return err("Escola não resolvida.", 400);

    const filtro = (body.filtro as string) || 'todos';
    let q = admin.from("aluno_risk_scores")
      .select("aluno_email, aluno_nome, score, score_frequencia, score_notas, score_engajamento_pais, score_tendencia, fatores, calculado_em")
      .eq("escola_id", escolaId)
      .order("score", { ascending: false })
      .limit(200);
    if (filtro === 'alto') q = q.gte("score", 80);
    else if (filtro === 'medio') q = q.gte("score", 60).lt("score", 80);
    const { data } = await q;
    return ok(data || []);
  }

  // ── IA: Consulta rápida natural language (Ctrl+K) ──
  // gerente + sessionEscolaId are already validated by the shared auth block above.
  if (action === 'ia_consulta_rapida') {
    const pergunta = typeof body.pergunta === "string" ? body.pergunta.trim() : "";
    if (!pergunta || pergunta.length > 2000) return err("Pergunta inválida.");

    // Feature flag guard
    const iaAtiva = await isFlagOn(admin, "ia_ativa", sessionEscolaId);
    if (!iaAtiva) return err("IA não habilitada para esta escola.", 403);

    // Rate limit: 10 req/min per user (DB-backed)
    const userId = String((gerente as any).id || ip);
    const rl = await checkRateLimitDb(admin, userId, "ia_consulta_rapida", { maxRequests: 10, windowMs: 60000 });
    if (!rl.allowed) return err(`Aguarde ${rl.retryAfterSeconds}s antes de nova consulta.`, 429);

    const tools = _iaRapidaServer.asClaudeTools("gerente");
    const mcpCtx = { sb: admin, user: gerente, scope: "gerente" as const, req };
    // deno-lint-ignore no-explicit-any
    const executor = async (name: string, args: Record<string, any>) => {
      if (!_iaRapidaServer.canCall(name, "gerente")) throw new Error(`Tool '${name}' não permitida.`);
      const tool = _iaRapidaServer.getTool(name)!;
      return await tool.handler(args, mcpCtx);
    };

    const resposta = await askClaudeWithTools(sanitizeForPrompt(pergunta, 2000), tools, executor, {
      system: (SYSTEM_PROMPTS.gerente || "") +
        "\n\nVocê tem ferramentas que consultam dados reais da escola. " +
        "SEMPRE use as tools antes de responder sobre números, alunos ou frequência. " +
        "Respostas concisas (máx 3 parágrafos). Nunca invente dados.",
      maxTokens: 512,
      maxTurns: 4,
      budget: { sb: admin, escolaId: sessionEscolaId },
    });

    if (!resposta) return err("IA indisponível no momento.", 503);
    if ((resposta as { stop_reason?: string }).stop_reason === "blocked") {
      return err(resposta.text || "IA bloqueada.", 503);
    }

    return ok({ resposta: resposta.text, dados: resposta.tool_calls?.length ? resposta.tool_calls.map(t => ({ tool: t.name, result: t.output })) : undefined });
  }

  return null
}
