// ═══════════════════════════════════════════════════════════════
//  Edge Function: lumied-ai — Inteligência Operacional Nativa
//  Gera insights, responde perguntas, analisa dados, prevê tendências
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, authProfessora, type Middleware } from "../_shared/router.ts";
import { successResponse, AppError, sanitizePgError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { askClaude, askClaudeWithTools, SYSTEM_PROMPTS, buildContextFromData } from "../_shared/ai.ts";
import { STAFF_GTM_SYSTEM_PROMPT } from "../_shared/playbooks.ts";
import { isFlagOn } from "../_shared/flags.ts";
import { McpServer, type McpScope } from "../_shared/mcp.ts";
import { staffTools } from "../mcp/tools_staff.ts";
import { gerenteTools } from "../mcp/tools_gerente.ts";
import { complianceTools } from "../mcp/tools_compliance.ts";
import { devTools } from "../mcp/tools_dev.ts";

const log = createLogger("lumied-ai");

// Helper: extrai budget ctx do router ctx para passar ao askClaude*
// deno-lint-ignore no-explicit-any
const bCtx = (ctx: any) => ({ sb: ctx.sb, escolaId: ctx.escola_id ?? null });

// ── Helpers ────────────────────────────────────────────────────
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Neutralize prompt-injection attempts in free-text inserted into Claude prompts.
// Strips instruction-like prefixes and caps length.
function sanitizeForPrompt(v: unknown, max = 1000): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    // naive strip of instruction-like lines
    .replace(/^(system|assistant|ignore[^\n]*instructions)/gim, "[$1]")
    .slice(0, max);
}

const router = new Router("lumied-ai");
router.useGlobal(rateLimit({ maxRequests: 30, windowMs: 60000 }));

// ─── Shared MCP server (used by ai_perguntar_mcp) ───
const mcpServer = new McpServer("lumied-ai-mcp", "1.0.0");
mcpServer.registerAll(staffTools);
mcpServer.registerAll(gerenteTools);
mcpServer.registerAll(complianceTools);
mcpServer.registerAll(devTools);

// Auth flexível: tenta legado, fallback sessão unificada
const authFlexivel: Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || (ctx.body._prof_token as string) || null;
  if (!token || typeof token !== "string" || token.length > 200) {
    throw new AppError("AUTH_REQUIRED", "Token obrigatório.");
  }
  // Try gerente_sessoes (gerentes has escola_id via migration 074)
  const { data: gs } = await ctx.sb.from("gerente_sessoes")
    .select("*, gerentes(id, nome, email, escola_id)")
    .eq("token", token).maybeSingle();
  if (gs && new Date(gs.expira_em) >= new Date()) {
    const g = (gs as any).gerentes;
    ctx.user = { ...g, tipo: "gerente" };
    if (g?.escola_id) ctx.escola_id = g.escola_id;
    return next();
  }
  // Try professora_sessoes
  const { data: ps } = await ctx.sb.from("professora_sessoes")
    .select("*, professoras(id, nome, email, serie_id, escola_id)")
    .eq("token", token).maybeSingle();
  if (ps && new Date(ps.expira_em) >= new Date()) {
    const p = (ps as any).professoras;
    ctx.user = { ...p, tipo: "professora" };
    if (p?.escola_id) ctx.escola_id = p.escola_id;
    return next();
  }
  // Try secretaria_sessoes
  const { data: ss } = await ctx.sb.from("secretaria_sessoes")
    .select("*, secretarias(id, nome, email, escola_id)")
    .eq("token", token).maybeSingle();
  if (ss && new Date(ss.expira_em) >= new Date()) {
    const s = (ss as any).secretarias;
    ctx.user = { ...s, tipo: "secretaria" };
    if (s?.escola_id) ctx.escola_id = s.escola_id;
    return next();
  }
  // Try sessões unificadas
  const { data: us } = await ctx.sb.from("sessoes")
    .select("usuario_id, expira_em")
    .eq("token", token).maybeSingle();
  if (us && new Date(us.expira_em) >= new Date()) {
    const { data: u } = await ctx.sb.from("usuarios")
      .select("id, nome, email, papeis, papel, escola_id")
      .eq("id", us.usuario_id).maybeSingle();
    if (u) {
      ctx.user = { ...u, tipo: "unificado" };
      if ((u as any).escola_id) ctx.escola_id = (u as any).escola_id;
      return next();
    }
  }
  throw new AppError("AUTH_INVALID", "Sessão inválida.");
};

// Require the cron-service-role key in the Authorization header for internal endpoints
function requireServiceAuth(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new AppError("AUTH_REQUIRED", "Autorização obrigatória.");
  if (token !== serviceKey && (!cronKey || token !== cronKey)) {
    throw new AppError("AUTH_INVALID", "Autorização inválida.");
  }
}

// ═══════════════════════════════════════════════════════
//  ASSISTENTE — Pergunta livre com contexto de dados
// ═══════════════════════════════════════════════════════

router.on("ai_perguntar", authFlexivel, async (ctx) => {
  const pergunta = str((ctx.body as any).pergunta, 2000);
  const portalRaw = (ctx.body as any).portal;
  const portal = typeof portalRaw === "string" && SYSTEM_PROMPTS[portalRaw as keyof typeof SYSTEM_PROMPTS]
    ? portalRaw : "gerente";
  if (!pergunta) throw new AppError("VALIDATION_FAILED", "Pergunta obrigatória.");

  // Coletar contexto real do banco — scoped por escola
  const contexto = await coletarContexto(ctx.sb, portal, ctx.escola_id);
  const system = SYSTEM_PROMPTS[portal as keyof typeof SYSTEM_PROMPTS] || SYSTEM_PROMPTS.gerente;

  const prompt = `CONTEXTO DA ESCOLA (dados reais):
${buildContextFromData(contexto)}

PERGUNTA DO USUÁRIO:
${sanitizeForPrompt(pergunta, 2000)}`;

  const resposta = await askClaude(prompt, { system, maxTokens: 600, budget: bCtx(ctx) });
  if (!resposta) throw new AppError("INTERNAL_ERROR", "IA indisponível no momento.");
  if (resposta.blocked) throw new AppError("QUOTA_EXCEEDED", resposta.blocked === 'cap_atingido' ? "Limite mensal de IA atingido." : "IA em manutenção.");

  // Registrar conversa
  await ctx.sb.from("ia_conversas").insert({
    portal, usuario_id: ctx.user?.id, usuario_nome: ctx.user?.nome,
    mensagens: [
      { role: "user", content: pergunta, ts: new Date().toISOString() },
      { role: "assistant", content: resposta.text, ts: new Date().toISOString() },
    ],
    total_mensagens: 2,
    tokens_total: resposta.tokens_input + resposta.tokens_output,
    custo_total: resposta.cost,
  });

  return successResponse({ resposta: resposta.text, tokens: resposta.tokens_input + resposta.tokens_output });
});

// ═══════════════════════════════════════════════════════
//  MCP — Pergunta com tool use (agentic)
//  A IA chama tools MCP automaticamente para coletar
//  contexto real antes de responder
// ═══════════════════════════════════════════════════════

router.on("ai_perguntar_mcp", authFlexivel, async (ctx) => {
  const pergunta = str((ctx.body as any).pergunta, 2000);
  const portalRaw = (ctx.body as any).portal;
  const portal = typeof portalRaw === "string" && SYSTEM_PROMPTS[portalRaw as keyof typeof SYSTEM_PROMPTS]
    ? portalRaw : "gerente";
  if (!pergunta) throw new AppError("VALIDATION_FAILED", "Pergunta obrigatória.");

  // Map user tipo → MCP scope
  const tipoParaScope: Record<string, McpScope> = {
    gerente: "gerente",
    professora: "professora",
    secretaria: "secretaria",
    staff: "staff",
    unificado: "gerente", // sessão unificada → assume gerente (checagem fina futura)
  };
  const scope = tipoParaScope[ctx.user?.tipo || ""] || "public";

  const tools = mcpServer.asClaudeTools(scope);
  if (tools.length === 0) {
    throw new AppError("FORBIDDEN", "Sem tools disponíveis para este perfil.");
  }

  const mcpCtx = { sb: ctx.sb, user: ctx.user ?? null, scope, req: ctx.req };
  // deno-lint-ignore no-explicit-any
  const executor = async (name: string, args: Record<string, any>) => {
    if (!mcpServer.canCall(name, scope)) {
      throw new Error(`Tool '${name}' não permitida para scope '${scope}'`);
    }
    const tool = mcpServer.getTool(name)!;
    return await tool.handler(args, mcpCtx);
  };

  const system = SYSTEM_PROMPTS[portal as keyof typeof SYSTEM_PROMPTS] ||
    SYSTEM_PROMPTS.gerente;
  const resposta = await askClaudeWithTools(sanitizeForPrompt(pergunta, 2000), tools, executor, {
    system: system +
      "\n\nVocê tem ferramentas (tools) que consultam dados reais da escola. " +
      "SEMPRE use as tools antes de responder perguntas sobre números, alunos, finanças ou compliance. " +
      "Nunca invente dados — se não tiver uma tool adequada, diga isso ao usuário.",
    maxTokens: 1024,
    maxTurns: 5,
    budget: bCtx(ctx),
  });

  if (!resposta) throw new AppError("INTERNAL_ERROR", "IA indisponível no momento.");

  // Registrar conversa
  await ctx.sb.from("ia_conversas").insert({
    portal,
    usuario_id: ctx.user?.id,
    usuario_nome: ctx.user?.nome,
    mensagens: [
      { role: "user", content: pergunta, ts: new Date().toISOString() },
      {
        role: "assistant",
        content: resposta.text,
        tool_calls: resposta.tool_calls.map((t) => t.name),
        ts: new Date().toISOString(),
      },
    ],
    total_mensagens: 2,
    tokens_total: resposta.tokens_input + resposta.tokens_output,
    custo_total: resposta.cost,
  });

  return successResponse({
    resposta: resposta.text,
    tools_called: resposta.tool_calls.map((t) => ({ name: t.name, input: t.input })),
    tokens: resposta.tokens_input + resposta.tokens_output,
    custo: resposta.cost,
  });
});

// ═══════════════════════════════════════════════════════
//  GTM/CS — Pergunta ancorada nos playbooks comerciais
//  Apenas staff ou usuários com papel comercial/cs
// ═══════════════════════════════════════════════════════

router.on("ai_perguntar_gtm", authFlexivel, async (ctx) => {
  const pergunta = str((ctx.body as any).pergunta, 2000);
  if (!pergunta) throw new AppError("VALIDATION_FAILED", "Pergunta obrigatória.");

  const tipo = ctx.user?.tipo;
  const papeis: string[] = (ctx.user as any)?.papeis || [];
  const papel: string = (ctx.user as any)?.papel || "";
  const papelStr = [...papeis, papel].join(",").toLowerCase();
  const staffLike = tipo === "staff" || papelStr.includes("comercial") || papelStr.includes("cs") || papelStr.includes("gerente") || papelStr.includes("diretor");
  if (!staffLike) throw new AppError("FORBIDDEN", "Recurso disponível para staff, comercial, CS, gerente e diretor.");

  const prompt = `PERGUNTA:\n${sanitizeForPrompt(pergunta, 2000)}`;
  const resposta = await askClaude(prompt, {
    system: STAFF_GTM_SYSTEM_PROMPT,
    maxTokens: 800,
    budget: bCtx(ctx),
  });
  if (!resposta) throw new AppError("INTERNAL_ERROR", "IA indisponível no momento.");
  if (resposta.blocked) throw new AppError("QUOTA_EXCEEDED", resposta.blocked === 'cap_atingido' ? "Limite mensal de IA atingido." : "IA em manutenção.");

  // Registrar conversa (portal "gtm" — separa de gerente/professora)
  await ctx.sb.from("ia_conversas").insert({
    portal: "gtm",
    usuario_id: ctx.user?.id,
    usuario_nome: ctx.user?.nome,
    mensagens: [
      { role: "user", content: pergunta, ts: new Date().toISOString() },
      { role: "assistant", content: resposta.text, ts: new Date().toISOString() },
    ],
    total_mensagens: 2,
    tokens_total: resposta.tokens_input + resposta.tokens_output,
    custo_total: resposta.cost,
  });

  return successResponse({
    resposta: resposta.text,
    tokens: resposta.tokens_input + resposta.tokens_output,
    custo: resposta.cost,
  });
});

// Professora também pode perguntar
router.on("ai_perguntar_prof", authFlexivel, async (ctx) => {
  const pergunta = str((ctx.body as any).pergunta, 2000);
  if (!pergunta) throw new AppError("VALIDATION_FAILED", "Pergunta obrigatória.");
  // Restrict to teachers only (this endpoint gives turma-specific context)
  if (ctx.user?.tipo !== "professora" && ctx.user?.tipo !== "unificado") {
    throw new AppError("FORBIDDEN", "Apenas professoras podem usar este recurso.");
  }
  // Feature flag: rollout controlado (% e allow-list de escolas)
  if (!(await isFlagOn(ctx.sb, 'beta_lumi_ai_professora', ctx.escola_id))) {
    throw new AppError("FORBIDDEN", "Recurso em rollout restrito para sua escola.");
  }

  const contexto = await coletarContextoProfessora(ctx.sb, ctx.user?.id);
  const prompt = `CONTEXTO (dados reais da turma):
${buildContextFromData(contexto)}

PERGUNTA DA PROFESSORA:
${sanitizeForPrompt(pergunta, 2000)}`;

  const resposta = await askClaude(prompt, { system: SYSTEM_PROMPTS.professora, maxTokens: 400, budget: bCtx(ctx) });
  if (!resposta) throw new AppError("INTERNAL_ERROR", "IA indisponível.");

  return successResponse({ resposta: resposta.text });
});

// ═══════════════════════════════════════════════════════
//  INSIGHTS — Geração automática diária
// ═══════════════════════════════════════════════════════

router.on("gerar_insights_diarios", async (ctx) => {
  // Internal-only: only the cron (service role key) can trigger this
  requireServiceAuth(ctx.req);
  const dados = await coletarContexto(ctx.sb, "gerente");
  const insights: any[] = [];

  // 1. Análise financeira
  if (dados.inadimplencia_pct > 5) {
    const ai = await askClaude(
      `A inadimplência da escola está em ${dados.inadimplencia_pct}%. Total em aberto: R$ ${dados.total_em_aberto}. ${dados.total_alunos} alunos. Gere 1 insight com análise e ação sugerida.`,
      { system: SYSTEM_PROMPTS.gerente, maxTokens: 200, budget: bCtx(ctx) }
    );
    if (ai) insights.push({
      portal: "gerente", categoria: "alerta", modulo: "financeiro",
      titulo: `Inadimplência em ${dados.inadimplencia_pct}%`,
      descricao: ai.text, impacto: dados.inadimplencia_pct > 10 ? "alto" : "medio",
      acao_sugerida: "Revisar régua de cobrança e contatar famílias em atraso",
      acao_tipo: "revisar_dados", confianca: 0.90,
      tokens_usados: ai.tokens_input + ai.tokens_output, custo_estimado: ai.cost,
    });
  }

  // 2. Frequência — alunos em risco
  if (dados.alunos_frequencia_baixa > 0) {
    const ai = await askClaude(
      `${dados.alunos_frequencia_baixa} alunos têm frequência abaixo de 75% este mês. Total de alunos: ${dados.total_alunos}. Gere 1 insight com análise e ação.`,
      { system: SYSTEM_PROMPTS.gerente, maxTokens: 200, budget: bCtx(ctx) }
    );
    if (ai) insights.push({
      portal: "gerente", categoria: "alerta", modulo: "frequencia",
      titulo: `${dados.alunos_frequencia_baixa} alunos com frequência crítica`,
      descricao: ai.text, impacto: "alto",
      acao_sugerida: "Agendar reunião com famílias dos alunos em risco",
      acao_tipo: "agendar_reuniao", confianca: 0.85,
    });
  }

  // 3. CRM — leads parados
  if (dados.leads_parados > 0) {
    insights.push({
      portal: "gerente", categoria: "oportunidade", modulo: "crm",
      titulo: `${dados.leads_parados} leads sem contato há 7+ dias`,
      descricao: `Existem ${dados.leads_parados} famílias interessadas que não receberam follow-up nos últimos 7 dias. Cada dia sem contato reduz a chance de conversão em ~10%.`,
      impacto: "medio", acao_sugerida: "Abrir CRM e fazer follow-up dos leads parados",
      acao_tipo: "revisar_dados", confianca: 0.95,
    });
  }

  // 4. Compliance — prazos próximos
  if (dados.prazos_proximos > 0) {
    insights.push({
      portal: "gerente", categoria: "alerta", modulo: "compliance",
      titulo: `${dados.prazos_proximos} prazo(s) de compliance nos próximos 30 dias`,
      descricao: `Há obrigações regulatórias vencendo em breve. Verifique o calendário de compliance para evitar multas ou pendências legais.`,
      impacto: "alto", acao_sugerida: "Acessar Compliance → Calendário",
      acao_tipo: "revisar_dados", confianca: 0.99,
    });
  }

  // 5. Resumo diário inteligente
  const resumoAi = await askClaude(
    `Dados da escola hoje:
- ${dados.total_alunos} alunos, ${dados.presentes_hoje || '?'} presentes hoje
- ${dados.mensagens_enviadas_semana || 0} mensagens enviadas esta semana
- ${dados.boletos_vencendo_semana || 0} boletos vencem esta semana
- CRM: ${dados.leads_novos_semana || 0} leads novos esta semana

Gere um resumo de 2-3 frases sobre o dia da escola. Tom: direto e útil.`,
    { system: SYSTEM_PROMPTS.gerente, maxTokens: 150, budget: bCtx(ctx) }
  );
  if (resumoAi) insights.push({
    portal: "gerente", categoria: "resumo", modulo: "geral",
    titulo: "Resumo do dia",
    descricao: resumoAi.text, impacto: "baixo",
    confianca: 0.80, expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    tokens_usados: resumoAi.tokens_input + resumoAi.tokens_output, custo_estimado: resumoAi.cost,
  });

  // Salvar insights
  for (const insight of insights) {
    await ctx.sb.from("ia_insights").insert(insight);
  }

  return successResponse({ gerados: insights.length });
});

// ═══════════════════════════════════════════════════════
//  INSIGHTS — Listar para o portal
// ═══════════════════════════════════════════════════════

router.on("ai_insights_list", authGerente, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const portal = str(b.portal, 40) ?? "gerente";
  const categoria = str(b.categoria, 40);
  let q = ctx.sb.from("ia_insights")
    .select("*")
    .eq("portal", portal)
    .eq("status", "ativa")
    .order("criado_em", { ascending: false });
  if (categoria) q = q.eq("categoria", categoria);
  const { data, error } = await q.limit(20);
  if (error) { log.apiError("ai_insights_list", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse(data ?? []);
});

router.on("ai_insight_acao", authGerente, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const id = str(b.id, 64);
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const STATUS_OK = new Set(["lida", "descartada", "executada", "ativa"]);
  const novoStatus = str(b.status, 40) ?? "lida";
  if (!STATUS_OK.has(novoStatus)) throw new AppError("VALIDATION_FAILED", "Status inválido.");
  const { error } = await ctx.sb.from("ia_insights").update({
    status: novoStatus,
    ...(novoStatus === "lida" ? { lida_em: new Date().toISOString() } : {}),
    ...(novoStatus === "executada" ? { executada_em: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (error) { log.apiError("ai_insight_acao", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════
//  AÇÕES INTELIGENTES ESPECÍFICAS
// ═══════════════════════════════════════════════════════

// Redigir comunicado para famílias
router.on("ai_redigir_comunicado", authGerente, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const assunto = str(b.assunto, 300);
  const TOM_OK = new Set(["profissional_amigavel", "formal", "casual"]);
  const tomRaw = str(b.tom, 40) ?? "profissional_amigavel";
  const tom = TOM_OK.has(tomRaw) ? tomRaw : "profissional_amigavel";
  const contexto_extra = sanitizeForPrompt(b.contexto_extra, 1000);
  if (!assunto) throw new AppError("VALIDATION_FAILED", "Assunto obrigatório.");
  const ai = await askClaude(
    `Redija um comunicado escolar para os pais sobre: "${sanitizeForPrompt(assunto, 300)}". ${contexto_extra}
Tom: ${tom}. Máximo 5 linhas. Comece com saudação. Termine com assinatura "Equipe [escola]".`,
    { system: "Você é redator de comunicados escolares. Escreva em português brasileiro, tom adequado ao público (famílias).", maxTokens: 300, budget: bCtx(ctx) }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ texto: ai.text });
});

// Analisar turma (para professora)
router.on("ai_analisar_turma", authProfessora, async (ctx) => {
  const dados = await coletarContextoProfessora(ctx.sb, ctx.user?.id);
  const ai = await askClaude(
    `Dados da turma:\n${buildContextFromData(dados)}\n\nFaça uma análise breve: pontos fortes, pontos de atenção e 1 sugestão pedagógica.`,
    { system: SYSTEM_PROMPTS.professora, maxTokens: 300, budget: bCtx(ctx) }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ analise: ai.text });
});

// Gerar parecer BNCC
router.on("ai_parecer_bncc", authProfessora, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const aluno_nome = str(b.aluno_nome, 200);
  if (!aluno_nome) throw new AppError("VALIDATION_FAILED", "aluno_nome obrigatório.");
  const notasJson = (() => {
    try {
      const raw = b.notas && typeof b.notas === "object" ? JSON.stringify(b.notas) : "{}";
      return raw.slice(0, 2000);
    } catch { return "{}"; }
  })();
  const freq = num(b.frequencia);
  const observacoes = sanitizeForPrompt(b.observacoes, 1000);
  const ai = await askClaude(
    `Gere um parecer pedagógico (estilo BNCC) para o aluno ${sanitizeForPrompt(aluno_nome, 200)}.
Notas: ${notasJson}
Frequência: ${freq ?? "?"}%
Observações da professora: ${observacoes || "Nenhuma"}

Parecer deve ter 3-4 frases, mencionando competências da BNCC.
Tom: profissional, positivo, construtivo.`,
    { system: "Você é especialista em pareceres pedagógicos escolares alinhados à BNCC. Escreva em português brasileiro.", maxTokens: 300, budget: bCtx(ctx) }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ parecer: ai.text });
});

// Prever inadimplência
router.on("ai_previsao_inadimplencia", authGerente, async (ctx) => {
  const dados = await coletarContexto(ctx.sb, "gerente", ctx.escola_id);
  const ai = await askClaude(
    `Dados financeiros da escola:
- Inadimplência atual: ${dados.inadimplencia_pct}%
- Total em aberto: R$ ${dados.total_em_aberto}
- Alunos: ${dados.total_alunos}
- Mês atual: ${new Date().getMonth() + 1}
- Boletos vencendo esta semana: ${dados.boletos_vencendo_semana}

Com base nesses dados, qual a tendência para o próximo mês? Sugira ações preventivas.`,
    { system: SYSTEM_PROMPTS.gerente, maxTokens: 300, budget: bCtx(ctx) }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ previsao: ai.text });
});

// ═══════════════════════════════════════════════════════
//  COLETA DE CONTEXTO (dados reais do banco)
// ═══════════════════════════════════════════════════════

async function safeQuery(promise: Promise<any>): Promise<any> {
  try { return await promise; } catch { return { data: null, count: 0 }; }
}

async function coletarContexto(sb: any, _portal: string, escolaId?: string) {
  const hoje = new Date().toISOString().split("T")[0];
  const semanaAtras = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  // Scope every query by escola when an escola id is available.
  const scope = <T>(q: any): T => (escolaId ? q.eq("escola_id", escolaId) : q);

  const [alunos, boletos, leads, compliance, frequencia] = await Promise.all([
    safeQuery(scope(sb.from("alunos").select("*", { count: "exact", head: true }).eq("ativo", true))),
    safeQuery(scope(sb.from("boletos").select("valor, status, vencimento").eq("status", "pendente")).limit(1000)),
    safeQuery(scope(sb.from("crm_leads").select("id, atualizado_em").order("atualizado_em", { ascending: false })).limit(1000)),
    safeQuery(scope(sb.from("compliance_calendario").select("*", { count: "exact", head: true }).eq("status", "pendente").lte("data_limite", new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]))),
    safeQuery(scope(sb.from("frequencia").select("presente").eq("data", hoje)).limit(1000)),
  ]);

  const boletosData = boletos?.data || [];
  const totalAberto = boletosData.reduce((s: number, b: any) => s + (Number(b.valor) || 0), 0);
  const leadsData = leads?.data || [];
  const leadsParados = leadsData.filter((l: any) => l.atualizado_em && l.atualizado_em < semanaAtras).length;
  const freqData = frequencia?.data || [];
  const presentes = freqData.filter((f: any) => f.presente).length;

  return {
    total_alunos: alunos?.count || 0,
    presentes_hoje: presentes,
    total_em_aberto: totalAberto.toFixed(2),
    boletos_pendentes: boletosData.length,
    inadimplencia_pct: alunos?.count ? Math.round((boletosData.length / (alunos.count as number)) * 100) : 0,
    boletos_vencendo_semana: boletosData.filter((b: any) => b.vencimento && b.vencimento <= new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]).length,
    leads_total: leadsData.length,
    leads_parados: leadsParados,
    leads_novos_semana: leadsData.filter((l: any) => l.atualizado_em >= semanaAtras).length,
    prazos_proximos: compliance?.count || 0,
    alunos_frequencia_baixa: 0,
  };
}

async function coletarContextoProfessora(sb: any, profId: string | undefined) {
  if (!profId) return {};
  try {
    const { data: prof } = await sb.from("professoras").select("nome, serie_id").eq("id", profId).maybeSingle();
    if (!prof) return { professora: 'Desconhecida', total_alunos_turma: 0 };
    const { data: alunos } = prof?.serie_id
      ? await sb.from("alunos").select("*", { count: "exact", head: true }).eq("serie_id", prof.serie_id).eq("ativo", true)
      : { data: { count: 0 } };
    return {
      professora: prof?.nome || 'Desconhecida',
      total_alunos_turma: (alunos as any)?.count || 0,
    };
  } catch { return { professora: 'Desconhecida', total_alunos_turma: 0 }; }
}

// ═══════════════════════════════════════════════════════
//  ROI — Dashboard de retorno real
// ═══════════════════════════════════════════════════════

router.on("roi_dashboard", authGerente, async (ctx) => {
  const escolaId = ctx.escola_id;
  // Config ROI da escola — maybeSingle evita crash em empty
  const cfgQ = ctx.sb.from("roi_config").select("*");
  const { data: config } = escolaId
    ? await cfgQ.eq("escola_id", escolaId).maybeSingle()
    : await cfgQ.limit(1).maybeSingle();
  const cfg = config || { mensalidade_media_aluno: 2500, salario_medio_admin: 3500, total_staff_admin: 2, custo_hora_admin: 22, taxa_evasao_anterior: 8, taxa_inadimplencia_anterior: 10, operational_savings_rate: 0.30, evasion_reduction_rate: 0.40, default_reduction_rate: 0.20 };

  // Dados reais do mês atual
  const mesAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  let snapQ = ctx.sb.from("roi_snapshots").select("*").eq("mes", mesAtual);
  if (escolaId) snapQ = snapQ.eq("escola_id", escolaId);
  const { data: snapshot } = await snapQ.maybeSingle();

  // Helper — scope table by escola when possível
  const scopeAlunos = () => {
    const q = ctx.sb.from("alunos").select("*", { count: "exact", head: true }).eq("ativo", true);
    return escolaId ? q.eq("escola_id", escolaId) : q;
  };
  const scopeLeads = () => {
    const q = ctx.sb.from("crm_leads").select("*", { count: "exact", head: true });
    return escolaId ? q.eq("escola_id", escolaId) : q;
  };

  // Dados reais do banco
  const [alunos, boletos, msgs, leads] = await Promise.all([
    scopeAlunos(),
    ctx.sb.from("boletos").select("valor, status").eq("status", "pago").gte("criado_em", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()).limit(5000),
    ctx.sb.from("wa_consumo_mensal").select("templates_enviados, textos_livres_enviados").eq("mes", new Date().getMonth() + 1).eq("ano", new Date().getFullYear()).maybeSingle(),
    scopeLeads(),
  ]);

  const totalAlunos = (alunos.count as number) || 0;
  const receitaMensal = totalAlunos * cfg.mensalidade_media_aluno;
  const boletosPagos = (boletos.data || []).length;
  const valorArrecadado = (boletos.data || []).reduce((s: number, b: any) => s + Number(b.valor || 0), 0);
  const waMsgs = ((msgs.data as any)?.templates_enviados || 0) + ((msgs.data as any)?.textos_livres_enviados || 0);

  // Cálculos ROI — NULL-safe
  const staffAdmin = Number(cfg.total_staff_admin) || 0;
  const opSavingsRate = Number(cfg.operational_savings_rate) || 0;
  const custoHora = Number(cfg.custo_hora_admin) || 0;
  const taxaEvasao = Number(cfg.taxa_evasao_anterior) || 0;
  const evasionReduction = Number(cfg.evasion_reduction_rate) || 0;
  const taxaInad = Number(cfg.taxa_inadimplencia_anterior) || 0;
  const defaultReduction = Number(cfg.default_reduction_rate) || 0;
  const mensalidade = Number(cfg.mensalidade_media_aluno) || 0;
  const horasEconMes = Math.round(staffAdmin * 176 * opSavingsRate);
  const econOperacionalMes = horasEconMes * custoHora;
  const alunosRetidosMes = Math.round(totalAlunos * (taxaEvasao / 100) * evasionReduction / 12);
  const evasaoEvitadaMes = alunosRetidosMes * mensalidade;
  const inadEvitadaMes = receitaMensal * (taxaInad / 100) * defaultReduction;
  const totalEconomiaMes = econOperacionalMes + evasaoEvitadaMes + inadEvitadaMes;

  // Histórico (últimos 6 meses)
  let histQ = ctx.sb.from("roi_snapshots").select("mes, valor_economizado_total, horas_economizadas").order("mes", { ascending: false }).limit(6);
  if (escolaId) histQ = histQ.eq("escola_id", escolaId);
  const { data: historico } = await histQ;

  return successResponse({
    mes: mesAtual,
    metricas_reais: { total_alunos: totalAlunos, boletos_pagos: boletosPagos, valor_arrecadado: valorArrecadado, whatsapp_msgs: waMsgs, leads_total: leads.count || 0 },
    roi_estimado: {
      horas_economizadas_mes: horasEconMes,
      economia_operacional_mes: Math.round(econOperacionalMes),
      evasao_evitada_mes: Math.round(evasaoEvitadaMes),
      inadimplencia_evitada_mes: Math.round(inadEvitadaMes),
      total_economia_mes: Math.round(totalEconomiaMes),
      total_economia_anual: Math.round(totalEconomiaMes * 12),
      alunos_retidos_mes: alunosRetidosMes,
    },
    config: cfg,
    historico: historico ?? [],
  });
});

router.on("roi_config_salvar", authGerente, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  // Whitelist — blocks mass assignment (id, escola_id override, criado_em, etc.)
  const ALLOWED = new Set([
    "custo_mensal_sistemas_anteriores", "salario_medio_admin", "total_staff_admin",
    "mensalidade_media_aluno", "taxa_evasao_anterior", "taxa_inadimplencia_anterior",
    "custo_hora_admin", "operational_savings_rate", "evasion_reduction_rate",
    "conversion_improvement_rate", "default_reduction_rate",
    "minutes_per_digital_enrollment", "minutes_per_communique", "minutes_per_shift_change",
  ]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!ALLOWED.has(k)) continue;
    const n = num(v);
    if (n === null || n < 0) continue;
    fields[k] = n;
  }
  // escola_id vem do contexto autenticado — nunca do body
  const escolaId = ctx.escola_id;
  if (!escolaId) throw new AppError("ESCOLA_REQUIRED", "escola_id não resolvido.");
  const { error } = await ctx.sb.from("roi_config").upsert(
    { escola_id: escolaId, ...fields },
    { onConflict: "escola_id" },
  );
  if (error) { log.apiError("roi_config_salvar", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse({ success: true });
});

router.on("roi_gerar_snapshot", async (ctx) => {
  // Internal-only: cron mensal
  requireServiceAuth(ctx.req);
  const mesAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { data: escolas } = await ctx.sb.from("escolas").select("id").eq("ativo", true);
  let gerados = 0;
  for (const escola of escolas ?? []) {
    const { data: config } = await ctx.sb.from("roi_config").select("*").eq("escola_id", escola.id).maybeSingle();
    const cfg = config || { mensalidade_media_aluno: 2500, total_staff_admin: 2, custo_hora_admin: 22, taxa_evasao_anterior: 8, taxa_inadimplencia_anterior: 10, operational_savings_rate: 0.30, evasion_reduction_rate: 0.40, default_reduction_rate: 0.20 };
    // Scoped por escola — antes contava todos os alunos (cross-tenant)
    const { count: totalAlunos } = await ctx.sb.from("alunos")
      .select("*", { count: "exact", head: true })
      .eq("ativo", true)
      .eq("escola_id", escola.id);
    const n = (totalAlunos as number) || 0;
    const staffAdmin = Number(cfg.total_staff_admin) || 0;
    const opRate = Number(cfg.operational_savings_rate) || 0;
    const custoHora = Number(cfg.custo_hora_admin) || 0;
    const mensalidade = Number(cfg.mensalidade_media_aluno) || 0;
    const taxaEvasao = Number(cfg.taxa_evasao_anterior) || 0;
    const evasionRed = Number(cfg.evasion_reduction_rate) || 0;
    const taxaInad = Number(cfg.taxa_inadimplencia_anterior) || 0;
    const defaultRed = Number(cfg.default_reduction_rate) || 0;
    const horasEcon = Math.round(staffAdmin * 176 * opRate);
    const econOp = horasEcon * custoHora;
    const evasoesEvitadas = Math.round(n * (taxaEvasao / 100) * evasionRed / 12);
    const evasaoEvit = evasoesEvitadas * mensalidade;
    const inadEvit = n * mensalidade * (taxaInad / 100) * defaultRed;
    const { error: upErr } = await ctx.sb.from("roi_snapshots").upsert({
      escola_id: escola.id, mes: mesAtual,
      horas_economizadas: horasEcon,
      minutos_economizados: horasEcon * 60,
      valor_economizado_total: Math.round(econOp + evasaoEvit + inadEvit),
      valor_inadimplencia_evitada: Math.round(inadEvit),
      evasoes_evitadas: evasoesEvitadas,
    }, { onConflict: "escola_id,mes" });
    if (upErr) { log.apiError("roi_gerar_snapshot.upsert", upErr); continue; }
    gerados++;
  }
  return successResponse({ gerados });
});

// ═══════════════════════════════════════════════════════
//  Server
// ═══════════════════════════════════════════════════════
serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
