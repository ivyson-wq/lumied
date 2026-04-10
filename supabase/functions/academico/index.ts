// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: academico
//  Notas, Frequência, Diário de Classe, Documentos, Relatórios,
//  Portal do Aluno, Banco de Provas
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getModulosHabilitados, getEscolaPadrao, requireModulo } from "../_shared/modulos.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIP } from "../_shared/ratelimit.ts";
import { sanitizeBody } from "../_shared/validation.ts";
import { validarSessao } from "../_shared/auth.ts";
import { captureException } from "../_shared/sentry.ts";

// CORS set dynamically per request inside serve()
let CORS: Record<string, string> = getCorsHeaders();

const ok  = (data: unknown)        => new Response(JSON.stringify(data),        { headers: { ...CORS, "Content-Type": "application/json" } });
const err = (msg: string, s = 400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Validar sessão de gerente (via shared auth) ──
async function validarSessaoGerente(sb: ReturnType<typeof createClient>, token: string | null) {
  return validarSessao(sb, "gerente_sessoes", "gerentes", "gerente_id", token);
}

// ── Validar sessão de professora (via shared auth) ──
async function validarSessaoProf(sb: ReturnType<typeof createClient>, token: string | null) {
  return validarSessao(sb, "professora_sessoes", "professoras", "professora_id", token, "id, nome, email, serie_id");
}

// ── Validar sessão de aluno ──
// Aceita:
//   1) Token da tabela aluno_sessoes (login aluno email+senha)
//   2) JWT Supabase Auth (Bearer) — caso o portal use auth nativo
// Retorna { id, email, nome, serie } do aluno autenticado, ou null
async function validarSessaoAluno(
  sb: ReturnType<typeof createClient>,
  token: string | null,
): Promise<{ id: string; email: string; nome: string; serie?: string } | null> {
  if (!token) return null;
  // 1) Tenta aluno_sessoes
  const { data: sessao } = await sb
    .from("aluno_sessoes")
    .select("aluno_id, expira_em")
    .eq("token", token)
    .maybeSingle();
  if (sessao && new Date((sessao as any).expira_em) >= new Date()) {
    const { data: aluno } = await sb
      .from("alunos_login")
      .select("id, email, aluno_nome, serie")
      .eq("id", (sessao as any).aluno_id)
      .maybeSingle();
    if (aluno) {
      return {
        id: (aluno as any).id,
        email: (aluno as any).email,
        nome: (aluno as any).aluno_nome,
        serie: (aluno as any).serie,
      };
    }
  }
  // 2) Tenta Supabase Auth JWT
  try {
    const { data: { user } } = await sb.auth.getUser(token);
    if (user?.email) {
      return {
        id: user.id,
        email: user.email.toLowerCase().trim(),
        nome: (user.user_metadata as any)?.full_name || user.email,
      };
    }
  } catch (_) { /* ignore */ }
  return null;
}

serve(async (req: Request) => {
  CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return err("Body inválido"); }

  // Rate limiting
  const reqAction = (body.action as string) || '';
  const ip = getClientIP(req);
  const rl = checkRateLimit(ip, reqAction.startsWith("login") ? "login" : "api");
  if (!rl.allowed) return err(`Tente novamente em ${rl.retryAfterSeconds}s.`, 429);

  // Sanitize
  body = sanitizeBody(body) as Record<string, unknown>;

  const { action } = body;
  const token = (body._token as string) || null;
  const profToken = (body._prof_token as string) || null;
  const alunoToken = (body._aluno_token as string) || null;

  // Resolve enabled modules
  let enabledModules: Set<string>;
  try {
    const escolaId = await getEscolaPadrao(sb);
    enabledModules = escolaId ? await getModulosHabilitados(sb, escolaId) : new Set();
  } catch { enabledModules = new Set(); }

  // ═══════════════════════════════════════════════════════════
  //  NOTAS / BOLETIM / CONCEITOS
  // ═══════════════════════════════════════════════════════════

  // ── Config de notas ──
  if (action === "notas_config_get") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { data } = await sb.from("notas_config").select("*").limit(1).single();
    return ok(data || {});
  }

  if (action === "notas_config_update") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { tipo_avaliacao, media_aprovacao, conceitos_escala, conceito_minimo, formula_media, permite_recuperacao, peso_recuperacao, periodos_tipo } = body as any;
    const fields: any = { atualizado_em: new Date().toISOString() };
    if (tipo_avaliacao !== undefined) fields.tipo_avaliacao = tipo_avaliacao;
    if (media_aprovacao !== undefined) fields.media_aprovacao = media_aprovacao;
    if (conceitos_escala !== undefined) fields.conceitos_escala = conceitos_escala;
    if (conceito_minimo !== undefined) fields.conceito_minimo = conceito_minimo;
    if (formula_media !== undefined) fields.formula_media = formula_media;
    if (permite_recuperacao !== undefined) fields.permite_recuperacao = permite_recuperacao;
    if (peso_recuperacao !== undefined) fields.peso_recuperacao = peso_recuperacao;
    if (periodos_tipo !== undefined) fields.periodos_tipo = periodos_tipo;
    const { data: existing } = await sb.from("notas_config").select("id").limit(1).single();
    if (existing) { await sb.from("notas_config").update(fields).eq("id", existing.id); }
    else { await sb.from("notas_config").insert(fields); }
    return ok({ success: true });
  }

  // ── Períodos ──
  if (action === "notas_periodos_list") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const ano = (body.ano as number) || new Date().getFullYear();
    const { data } = await sb.from("notas_periodos").select("*").eq("ano", ano).order("numero");
    return ok(data ?? []);
  }

  if (action === "notas_periodos_create") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { nome, numero, ano, data_inicio, data_fim } = body as any;
    if (!nome || !numero || !ano) return err("Nome, número e ano obrigatórios.");
    const { data, error } = await sb.from("notas_periodos").insert({ nome, numero, ano, data_inicio, data_fim }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "notas_periodos_update") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token;
    const { error } = await sb.from("notas_periodos").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "notas_periodos_delete") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id } = body as { id: string };
    const { error } = await sb.from("notas_periodos").delete().eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ── Disciplinas ──
  if (action === "notas_disciplinas_list") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { serie_id } = body as any;
    let q = sb.from("notas_disciplinas").select("*, series(nome), professoras(nome)").eq("ativo", true).order("nome");
    if (serie_id) q = q.eq("serie_id", serie_id);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "notas_disciplinas_create") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { nome, serie_id, professora_id, carga_horaria } = body as any;
    if (!nome) return err("Nome obrigatório.");
    const { data, error } = await sb.from("notas_disciplinas").insert({ nome, serie_id, professora_id, carga_horaria }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "notas_disciplinas_update") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token;
    const { error } = await sb.from("notas_disciplinas").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "notas_disciplinas_delete") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id } = body as { id: string };
    const { error } = await sb.from("notas_disciplinas").update({ ativo: false }).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ── Avaliações ──
  if (action === "notas_avaliacoes_list") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { disciplina_id, periodo_id } = body as any;
    let q = sb.from("notas_avaliacoes").select("*, notas_disciplinas(nome, serie_id), notas_periodos(nome, numero)").order("data_avaliacao", { ascending: false });
    if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
    if (periodo_id) q = q.eq("periodo_id", periodo_id);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "notas_avaliacoes_create") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    // Professora ou gerente pode criar
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { disciplina_id, periodo_id, nome, tipo, peso, data_avaliacao, valor_maximo } = body as any;
    if (!disciplina_id || !periodo_id || !nome) return err("Disciplina, período e nome obrigatórios.");
    const { data, error } = await sb.from("notas_avaliacoes").insert({
      disciplina_id, periodo_id, nome, tipo: tipo || "prova", peso: peso || 1.0,
      data_avaliacao, valor_maximo: valor_maximo || 10.0
    }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "notas_avaliacoes_update") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token; delete fields._prof_token;
    const { error } = await sb.from("notas_avaliacoes").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "notas_avaliacoes_delete") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id } = body as { id: string };
    const { error } = await sb.from("notas_avaliacoes").delete().eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ── Lançamento de notas (batch upsert) ──
  if (action === "notas_lancamentos_upsert") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);

    const { avaliacao_id, lancamentos } = body as { avaliacao_id: string; lancamentos: Array<{ aluno_email: string; aluno_nome: string; valor?: number; conceito?: string; observacao?: string }> };
    if (!avaliacao_id || !Array.isArray(lancamentos)) return err("avaliacao_id e lancamentos[] obrigatórios.");

    const rows = lancamentos.map(l => ({
      avaliacao_id,
      aluno_email: l.aluno_email,
      aluno_nome: l.aluno_nome,
      valor: l.valor ?? null,
      conceito: l.conceito ?? null,
      observacao: l.observacao ?? null,
      lancado_por: prof?.id ?? null,
      lancado_em: new Date().toISOString(),
    }));

    const { error } = await sb.from("notas_lancamentos").upsert(rows, { onConflict: "avaliacao_id,aluno_email" });
    if (error) return err(error.message);
    return ok({ success: true, count: rows.length });
  }

  if (action === "notas_lancamentos_list") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { avaliacao_id } = body as any;
    if (!avaliacao_id) return err("avaliacao_id obrigatório.");
    const { data } = await sb.from("notas_lancamentos").select("*").eq("avaliacao_id", avaliacao_id).order("aluno_nome");
    return ok(data ?? []);
  }

  // ── Calcular médias de um aluno por disciplina/período ──
  if (action === "notas_calcular_media") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { aluno_email, disciplina_id, periodo_id } = body as any;
    if (!aluno_email || !disciplina_id || !periodo_id) return err("aluno_email, disciplina_id e periodo_id obrigatórios.");

    // Buscar avaliações do período/disciplina
    const { data: avaliacoes } = await sb.from("notas_avaliacoes").select("id, peso, tipo, valor_maximo").eq("disciplina_id", disciplina_id).eq("periodo_id", periodo_id);
    if (!avaliacoes || avaliacoes.length === 0) return ok({ media: null, message: "Sem avaliações." });

    // Buscar notas do aluno
    const avalIds = avaliacoes.map(a => a.id);
    const { data: notas } = await sb.from("notas_lancamentos").select("avaliacao_id, valor").eq("aluno_email", aluno_email).in("avaliacao_id", avalIds);
    if (!notas || notas.length === 0) return ok({ media: null, message: "Sem notas lançadas." });

    // Buscar config
    const { data: config } = await sb.from("notas_config").select("*").limit(1).single();
    const formula = config?.formula_media || "aritmetica";

    // Separar normais e recuperação
    const normais = avaliacoes.filter(a => a.tipo !== "recuperacao");
    const recup = avaliacoes.filter(a => a.tipo === "recuperacao");

    let media: number;
    if (formula === "ponderada") {
      let somaPN = 0, somaPesos = 0;
      for (const av of normais) {
        if (!av.valor_maximo || av.valor_maximo <= 0) continue;
        const nota = notas.find(n => n.avaliacao_id === av.id);
        if (nota && nota.valor !== null) {
          somaPN += (nota.valor / av.valor_maximo) * 10 * av.peso;
          somaPesos += av.peso;
        }
      }
      media = somaPesos > 0 ? somaPN / somaPesos : 0;
    } else {
      let soma = 0, count = 0;
      for (const av of normais) {
        if (!av.valor_maximo || av.valor_maximo <= 0) continue;
        const nota = notas.find(n => n.avaliacao_id === av.id);
        if (nota && nota.valor !== null) {
          soma += (nota.valor / av.valor_maximo) * 10;
          count++;
        }
      }
      media = count > 0 ? soma / count : 0;
    }

    // Aplicar recuperação se houver
    if (recup.length > 0 && config?.permite_recuperacao) {
      const pesoRecup = config.peso_recuperacao || 0.4;
      for (const av of recup) {
        if (!av.valor_maximo || av.valor_maximo <= 0) continue;
        const nota = notas.find(n => n.avaliacao_id === av.id);
        if (nota && nota.valor !== null) {
          const notaRecup = (nota.valor / av.valor_maximo) * 10;
          if (notaRecup > media) {
            media = media * (1 - pesoRecup) + notaRecup * pesoRecup;
          }
        }
      }
    }

    media = Math.round(media * 100) / 100;
    const aprovado = media >= (config?.media_aprovacao || 7);

    return ok({ media, aprovado, formula });
  }

  // ── Boletim: gerar para um aluno (todos os períodos/disciplinas) ──
  if (action === "boletim_gerar") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);

    const { aluno_email, aluno_nome, periodo_id, ano } = body as any;
    if (!aluno_email || !aluno_nome || !periodo_id || !ano) return err("aluno_email, aluno_nome, periodo_id e ano obrigatórios.");

    // Buscar todas as disciplinas
    const { data: disciplinas } = await sb.from("notas_disciplinas").select("id, nome, serie_id").eq("ativo", true);
    if (!disciplinas) return ok({ dados: { disciplinas: [] } });

    const disciplinasResult = [];
    for (const disc of disciplinas) {
      const { data: avaliacoes } = await sb.from("notas_avaliacoes").select("id, nome, tipo, peso, valor_maximo").eq("disciplina_id", disc.id).eq("periodo_id", periodo_id);
      const avalIds = (avaliacoes || []).map(a => a.id);
      const { data: notas } = avalIds.length > 0
        ? await sb.from("notas_lancamentos").select("avaliacao_id, valor, conceito").eq("aluno_email", aluno_email).in("avaliacao_id", avalIds)
        : { data: [] };

      if (!notas || notas.length === 0) continue;

      const avaliacoesResult = (avaliacoes || []).map(av => {
        const nota = (notas || []).find(n => n.avaliacao_id === av.id);
        return { nome: av.nome, tipo: av.tipo, peso: av.peso, valor: nota?.valor, conceito: nota?.conceito };
      });

      // Calcular média simples
      const vals = avaliacoesResult.filter(a => a.valor !== null && a.valor !== undefined && a.tipo !== "recuperacao").map(a => a.valor as number);
      const media = vals.length > 0 ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null;

      disciplinasResult.push({ nome: disc.nome, media, avaliacoes: avaliacoesResult });
    }

    const mediaGeral = disciplinasResult.filter(d => d.media !== null).length > 0
      ? Math.round((disciplinasResult.filter(d => d.media !== null).reduce((s, d) => s + (d.media as number), 0) / disciplinasResult.filter(d => d.media !== null).length) * 100) / 100
      : null;

    const dados = { disciplinas: disciplinasResult };

    // Upsert boletim
    const { data: boletim, error } = await sb.from("boletins").upsert({
      aluno_email, aluno_nome, periodo_id, ano, dados, media_geral: mediaGeral,
      status: "gerado", gerado_por: gerente.nome, gerado_em: new Date().toISOString()
    }, { onConflict: "aluno_email,periodo_id" }).select().single();

    if (error) return err(error.message);
    return ok(boletim);
  }

  // ── Boletim: consultar (para pais) ──
  if (action === "boletim_get") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { aluno_email, ano } = body as any;
    if (!aluno_email) return err("aluno_email obrigatório.");
    const anoFiltro = ano || new Date().getFullYear();
    const { data } = await sb.from("boletins").select("*, notas_periodos(nome, numero)").eq("aluno_email", aluno_email).eq("ano", anoFiltro).order("notas_periodos(numero)");
    return ok(data ?? []);
  }

  // ── Lista alunos por série (para grid de notas) ──
  if (action === "notas_alunos_serie") {
    const blocked = requireModulo(enabledModules, "notas"); if (blocked) return blocked;
    const { serie_id } = body as any;
    if (!serie_id) return err("serie_id obrigatório.");
    // Buscar alunos (famílias) da série
    const { data } = await sb.from("familias").select("email, nome_aluno, nome_responsavel, serie").order("nome_aluno");
    // Filtrar por série — familias.serie é text, series.nome é text
    const { data: serie } = await sb.from("series").select("nome").eq("id", serie_id).single();
    if (!serie) return ok([]);
    const alunos = (data || []).filter(f => f.serie === serie.nome);
    return ok(alunos);
  }

  // ═══════════════════════════════════════════════════════════
  //  CONTROLE DE FREQUÊNCIA / CHAMADA
  // ═══════════════════════════════════════════════════════════

  if (action === "frequencia_config_get") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const { data } = await sb.from("frequencia_config").select("*").limit(1).single();
    return ok(data || {});
  }

  if (action === "frequencia_config_update") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { limite_faltas_percent, alerta_percent } = body as any;
    const { data: existing } = await sb.from("frequencia_config").select("id").limit(1).single();
    const fields: any = { atualizado_em: new Date().toISOString() };
    if (limite_faltas_percent !== undefined) fields.limite_faltas_percent = limite_faltas_percent;
    if (alerta_percent !== undefined) fields.alerta_percent = alerta_percent;
    if (existing) await sb.from("frequencia_config").update(fields).eq("id", existing.id);
    else await sb.from("frequencia_config").insert(fields);
    return ok({ success: true });
  }

  if (action === "frequencia_chamada_create") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { serie_id, disciplina_id, data: dataStr, horario } = body as any;
    if (!serie_id || !dataStr) return err("serie_id e data obrigatórios.");
    const { data, error } = await sb.from("frequencia_chamadas").insert({
      serie_id, disciplina_id: disciplina_id || null, data: dataStr,
      horario: horario || null, professora_id: prof?.id || null
    }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "frequencia_chamada_list") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const { serie_id, data_inicio, data_fim } = body as any;
    let q = sb.from("frequencia_chamadas").select("*, series(nome), notas_disciplinas(nome), professoras(nome)").order("data", { ascending: false });
    if (serie_id) q = q.eq("serie_id", serie_id);
    if (data_inicio) q = q.gte("data", data_inicio);
    if (data_fim) q = q.lte("data", data_fim);
    q = q.limit(100);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "frequencia_registros_upsert") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { chamada_id, registros } = body as { chamada_id: string; registros: Array<{ aluno_email: string; aluno_nome: string; status: string; observacao?: string }> };
    if (!chamada_id || !Array.isArray(registros)) return err("chamada_id e registros[] obrigatórios.");
    const rows = registros.map(r => ({
      chamada_id, aluno_email: r.aluno_email, aluno_nome: r.aluno_nome,
      status: r.status || "P", observacao: r.observacao || null
    }));
    const { error } = await sb.from("frequencia_registros").upsert(rows, { onConflict: "chamada_id,aluno_email" });
    if (error) return err(error.message);
    return ok({ success: true, count: rows.length });
  }

  if (action === "frequencia_registros_list") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const { chamada_id } = body as any;
    if (!chamada_id) return err("chamada_id obrigatório.");
    const { data } = await sb.from("frequencia_registros").select("id, chamada_id, aluno_email, aluno_nome, status, observacao").eq("chamada_id", chamada_id).order("aluno_nome");
    return ok(data ?? []);
  }

  if (action === "frequencia_relatorio_aluno") {
    const blocked = requireModulo(enabledModules, "frequencia"); if (blocked) return blocked;
    const { aluno_email, serie_id, ano } = body as any;
    if (!aluno_email) return err("aluno_email obrigatório.");
    const anoFiltro = ano || new Date().getFullYear();
    const dataInicio = `${anoFiltro}-01-01`;
    const dataFim = `${anoFiltro}-12-31`;

    // Total de chamadas da série
    let qChamadas = sb.from("frequencia_chamadas").select("id", { count: "exact", head: false }).gte("data", dataInicio).lte("data", dataFim);
    if (serie_id) qChamadas = qChamadas.eq("serie_id", serie_id);
    const { data: chamadas } = await qChamadas;
    const totalAulas = chamadas?.length || 0;

    // Registros do aluno
    const chamadaIds = (chamadas || []).map((c: any) => c.id);
    let totalFaltas = 0;
    if (chamadaIds.length > 0) {
      const { count } = await sb.from("frequencia_registros")
        .select("*", { count: "exact", head: true })
        .eq("aluno_email", aluno_email)
        .in("chamada_id", chamadaIds)
        .in("status", ["A", "F"]);
      totalFaltas = count || 0;
    }

    const percentPresenca = totalAulas > 0 ? Math.round(((totalAulas - totalFaltas) / totalAulas) * 100 * 10) / 10 : 100;
    const percentFaltas = totalAulas > 0 ? Math.round((totalFaltas / totalAulas) * 100 * 10) / 10 : 0;

    return ok({ aluno_email, total_aulas: totalAulas, total_faltas: totalFaltas, percent_presenca: percentPresenca, percent_faltas: percentFaltas });
  }

  // ═══════════════════════════════════════════════════════════
  //  DIÁRIO DE CLASSE DIGITAL
  // ═══════════════════════════════════════════════════════════

  if (action === "diario_registros_list") {
    const blocked = requireModulo(enabledModules, "diario_classe"); if (blocked) return blocked;
    const { serie_id, disciplina_id, data_inicio, data_fim } = body as any;
    let q = sb.from("diario_registros").select("*, series(nome), notas_disciplinas(nome), professoras(nome)").order("data", { ascending: false });
    if (serie_id) q = q.eq("serie_id", serie_id);
    if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
    if (data_inicio) q = q.gte("data", data_inicio);
    if (data_fim) q = q.lte("data", data_fim);
    q = q.limit(100);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "diario_registros_create") {
    const blocked = requireModulo(enabledModules, "diario_classe"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { serie_id, disciplina_id, data: dataStr, conteudo_planejado, conteudo_executado, observacoes, habilidades_bncc } = body as any;
    if (!serie_id || !dataStr) return err("serie_id e data obrigatórios.");
    const { data, error } = await sb.from("diario_registros").insert({
      serie_id, disciplina_id: disciplina_id || null, data: dataStr,
      professora_id: prof?.id || null,
      conteudo_planejado: conteudo_planejado || null,
      conteudo_executado: conteudo_executado || null,
      observacoes: observacoes || null,
      habilidades_bncc: habilidades_bncc || []
    }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "diario_registros_update") {
    const blocked = requireModulo(enabledModules, "diario_classe"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token; delete fields._prof_token;
    fields.atualizado_em = new Date().toISOString();
    const { error } = await sb.from("diario_registros").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "diario_registros_delete") {
    const blocked = requireModulo(enabledModules, "diario_classe"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id } = body as { id: string };
    const { error } = await sb.from("diario_registros").delete().eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "diario_bncc_habilidades_list") {
    const blocked = requireModulo(enabledModules, "diario_classe"); if (blocked) return blocked;
    const { componente, ano_serie, busca } = body as any;
    let q = sb.from("diario_bncc_habilidades").select("*").order("codigo");
    if (componente) q = q.eq("componente", componente);
    if (ano_serie) q = q.eq("ano_serie", ano_serie);
    if (busca) q = q.or(`codigo.ilike.%${busca}%,descricao.ilike.%${busca}%`);
    const { data } = await q;
    return ok(data ?? []);
  }

  // ═══════════════════════════════════════════════════════════
  //  DOCUMENTOS DO ALUNO
  // ═══════════════════════════════════════════════════════════

  if (action === "documento_templates_list") {
    const blocked = requireModulo(enabledModules, "documentos"); if (blocked) return blocked;
    const { data } = await sb.from("documentos_templates").select("id, tipo, nome, variaveis, ativo").eq("ativo", true).order("tipo");
    return ok(data ?? []);
  }

  if (action === "documento_templates_update") {
    const blocked = requireModulo(enabledModules, "documentos"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, template_html, variaveis } = body as any;
    if (!id) return err("ID obrigatório.");
    const fields: any = {};
    if (template_html !== undefined) fields.template_html = template_html;
    if (variaveis !== undefined) fields.variaveis = variaveis;
    const { error } = await sb.from("documentos_templates").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "documento_gerar") {
    const blocked = requireModulo(enabledModules, "documentos"); if (blocked) return blocked;
    const gerente = await validarSessaoGerente(sb, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { tipo, aluno_email, aluno_nome, dados } = body as any;
    if (!tipo || !aluno_email || !aluno_nome) return err("tipo, aluno_email e aluno_nome obrigatórios.");

    // Buscar template
    const { data: tmpl } = await sb.from("documentos_templates").select("*").eq("tipo", tipo).single();
    if (!tmpl) return err("Template não encontrado para tipo: " + tipo);

    // Substituir variáveis
    let html = tmpl.template_html;
    const varsData = dados || {};
    varsData.aluno_nome = varsData.aluno_nome || aluno_nome;
    varsData.data_extenso = varsData.data_extenso || new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    varsData.ano = varsData.ano || new Date().getFullYear().toString();

    for (const [key, val] of Object.entries(varsData)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(val ?? ""));
    }

    // Salvar documento gerado
    const { data: doc, error } = await sb.from("documentos_gerados").insert({
      aluno_email, aluno_nome, tipo, dados_json: varsData,
      gerado_por: gerente.nome, gerado_em: new Date().toISOString()
    }).select().single();
    if (error) return err(error.message);

    return ok({ ...doc, html_renderizado: html });
  }

  if (action === "documentos_aluno_list") {
    const blocked = requireModulo(enabledModules, "documentos"); if (blocked) return blocked;
    // Aluno autenticado vê apenas seus próprios documentos; gerente pode ver de qualquer aluno.
    const aluno = await validarSessaoAluno(sb, alunoToken || token);
    const gerente = !aluno ? await validarSessaoGerente(sb, token) : null;
    if (!aluno && !gerente) return err("Sessão inválida.", 401);
    const emailFiltro = aluno ? aluno.email : (body as any).aluno_email;
    if (!emailFiltro) return err("aluno_email obrigatório.");
    const { data } = await sb.from("documentos_gerados").select("*").eq("aluno_email", emailFiltro).order("gerado_em", { ascending: false });
    return ok(data ?? []);
  }

  // ═══════════════════════════════════════════════════════════
  //  RELATÓRIOS PEDAGÓGICOS / BNCC
  // ═══════════════════════════════════════════════════════════

  if (action === "relatorio_pedagogico_list") {
    const blocked = requireModulo(enabledModules, "relatorios_bncc"); if (blocked) return blocked;
    const { aluno_email, professora_id, periodo_id, ano, status } = body as any;
    let q = sb.from("relatorios_pedagogicos").select("*, notas_periodos(nome), professoras(nome)").order("criado_em", { ascending: false });
    if (aluno_email) q = q.eq("aluno_email", aluno_email);
    if (professora_id) q = q.eq("professora_id", professora_id);
    if (periodo_id) q = q.eq("periodo_id", periodo_id);
    if (ano) q = q.eq("ano", ano);
    if (status) q = q.eq("status", status);
    q = q.limit(100);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "relatorio_pedagogico_create") {
    const blocked = requireModulo(enabledModules, "relatorios_bncc"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    if (!prof) return err("Sessão inválida.", 401);
    const { aluno_email, aluno_nome, periodo_id, ano, tipo, texto } = body as any;
    if (!aluno_email || !aluno_nome) return err("aluno_email e aluno_nome obrigatórios.");
    const { data, error } = await sb.from("relatorios_pedagogicos").insert({
      aluno_email, aluno_nome, professora_id: prof.id, periodo_id, ano: ano || new Date().getFullYear(),
      tipo: tipo || "descritivo", texto, status: "rascunho"
    }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "relatorio_pedagogico_update") {
    const blocked = requireModulo(enabledModules, "relatorios_bncc"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token; delete fields._prof_token;
    fields.atualizado_em = new Date().toISOString();
    if (fields.status === "aprovado" && gerente) { fields.aprovado_por = gerente.nome; fields.aprovado_em = new Date().toISOString(); }
    const { error } = await sb.from("relatorios_pedagogicos").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "relatorio_competencias_upsert") {
    const blocked = requireModulo(enabledModules, "relatorios_bncc"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    if (!prof) return err("Sessão inválida.", 401);
    const { relatorio_id, competencias } = body as { relatorio_id: string; competencias: Array<{ competencia_id: string; nivel: string; observacao?: string }> };
    if (!relatorio_id || !Array.isArray(competencias)) return err("relatorio_id e competencias[] obrigatórios.");
    const rows = competencias.map(c => ({ relatorio_id, competencia_id: c.competencia_id, nivel: c.nivel, observacao: c.observacao || null }));
    const { error } = await sb.from("relatorio_competencias").upsert(rows, { onConflict: "relatorio_id,competencia_id" });
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (action === "bncc_competencias_list") {
    const blocked = requireModulo(enabledModules, "relatorios_bncc"); if (blocked) return blocked;
    const { area, componente, ano_serie, tipo, busca } = body as any;
    let q = sb.from("bncc_competencias").select("*").order("codigo");
    if (area) q = q.eq("area", area);
    if (componente) q = q.eq("componente", componente);
    if (ano_serie) q = q.eq("ano_serie", ano_serie);
    if (tipo) q = q.eq("tipo", tipo);
    if (busca) q = q.or(`codigo.ilike.%${busca}%,descricao.ilike.%${busca}%`);
    const { data } = await q;
    return ok(data ?? []);
  }

  // ═══════════════════════════════════════════════════════════
  //  PORTAL DO ALUNO
  // ═══════════════════════════════════════════════════════════

  if (action === "aluno_login") {
    const blocked = requireModulo(enabledModules, "portal_aluno"); if (blocked) return blocked;
    const { email, senha } = body as { email: string; senha: string };
    if (!email || !senha) return err("Email e senha obrigatórios.");
    const { data: aluno } = await sb.from("alunos_login").select("id, aluno_nome, email, senha_hash, familia_email, serie, ativo").eq("email", email).single();
    if (!aluno || !aluno.ativo) return err("Credenciais inválidas.", 401);
    // Verificar senha (hex:hex format)
    try {
      const [saltHex, storedHash] = aluno.senha_hash.split(":");
      const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []).map((h: string) => parseInt(h, 16)));
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
      const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (hashHex !== storedHash) return err("Credenciais inválidas.", 401);
    } catch { return err("Erro na verificação.", 500); }
    // Criar sessão
    const tkn = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
    await sb.from("aluno_sessoes").insert({ aluno_id: aluno.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
    return ok({ token: tkn, nome: aluno.aluno_nome, email: aluno.email, serie: aluno.serie });
  }

  if (action === "aluno_logout") {
    const blocked = requireModulo(enabledModules, "portal_aluno"); if (blocked) return blocked;
    const alunoToken = (body._aluno_token as string) || token;
    if (alunoToken) await sb.from("aluno_sessoes").delete().eq("token", alunoToken);
    return ok({ success: true });
  }

  if (action === "aluno_notas_get") {
    const blocked = requireModulo(enabledModules, "portal_aluno"); if (blocked) return blocked;
    const aluno = await validarSessaoAluno(sb, alunoToken || token);
    if (!aluno) return err("Sessão inválida.", 401);
    const { ano } = body as any;
    const emailFiltro = aluno.email;
    const { data } = await sb.from("boletins").select("*, notas_periodos(nome, numero)").eq("aluno_email", emailFiltro).eq("ano", ano || new Date().getFullYear()).order("notas_periodos(numero)");
    return ok(data ?? []);
  }

  if (action === "aluno_frequencia_get") {
    const blocked = requireModulo(enabledModules, "portal_aluno"); if (blocked) return blocked;
    const aluno = await validarSessaoAluno(sb, alunoToken || token);
    if (!aluno) return err("Sessão inválida.", 401);
    const { ano } = body as any;
    const emailFiltro = aluno.email;
    // Reutilizar a lógica de relatório
    const anoFiltro = ano || new Date().getFullYear();
    const { data: chamadas } = await sb.from("frequencia_chamadas").select("id").gte("data", `${anoFiltro}-01-01`).lte("data", `${anoFiltro}-12-31`);
    const totalAulas = chamadas?.length || 0;
    let totalFaltas = 0;
    if (totalAulas > 0) {
      const ids = chamadas!.map((c: any) => c.id);
      const { count } = await sb.from("frequencia_registros").select("*", { count: "exact", head: true }).eq("aluno_email", emailFiltro).in("chamada_id", ids).in("status", ["A", "F"]);
      totalFaltas = count || 0;
    }
    const percent = totalAulas > 0 ? Math.round(((totalAulas - totalFaltas) / totalAulas) * 1000) / 10 : 100;
    return ok({ total_aulas: totalAulas, total_faltas: totalFaltas, percent_presenca: percent });
  }

  // ═══════════════════════════════════════════════════════════
  //  BANCO DE PROVAS / AVALIAÇÕES ONLINE
  // ═══════════════════════════════════════════════════════════

  // ── Questões ──
  if (action === "provas_questoes_list") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const { disciplina_id, dificuldade, busca } = body as any;
    let q = sb.from("provas_questoes").select("*, notas_disciplinas(nome)").eq("ativo", true).order("criado_em", { ascending: false });
    if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
    if (dificuldade) q = q.eq("dificuldade", dificuldade);
    if (busca) q = q.ilike("texto", `%${busca}%`);
    q = q.limit(200);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "provas_questoes_create") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { disciplina_id, texto, tipo, opcoes, resposta_correta, dificuldade, habilidade_bncc, explicacao } = body as any;
    if (!texto) return err("Texto da questão obrigatório.");
    const { data, error } = await sb.from("provas_questoes").insert({
      disciplina_id, texto, tipo: tipo || "multipla", opcoes: opcoes || [],
      resposta_correta, dificuldade: dificuldade || "media",
      habilidade_bncc, explicacao, criado_por: prof?.id || null
    }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "provas_questoes_update") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token; delete fields._prof_token;
    const { error } = await sb.from("provas_questoes").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ── Provas ──
  if (action === "provas_list") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const { serie_id, disciplina_id, status } = body as any;
    let q = sb.from("provas").select("*, notas_disciplinas(nome), series(nome), professoras(nome)").order("criado_em", { ascending: false });
    if (serie_id) q = q.eq("serie_id", serie_id);
    if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
    if (status) q = q.eq("status", status);
    q = q.limit(100);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "provas_create") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { titulo, disciplina_id, serie_id, periodo_id, questoes, data_inicio, data_fim, tempo_limite, pontuacao_total, embaralhar } = body as any;
    if (!titulo) return err("Título obrigatório.");
    const { data, error } = await sb.from("provas").insert({
      titulo, disciplina_id, serie_id, periodo_id, questoes: questoes || [],
      data_inicio, data_fim, tempo_limite, pontuacao_total: pontuacao_total || 10,
      embaralhar: embaralhar || false, criado_por: prof?.id || null, status: "rascunho"
    }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "provas_update") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const prof = await validarSessaoProf(sb, profToken);
    const gerente = !prof ? await validarSessaoGerente(sb, token) : null;
    if (!prof && !gerente) return err("Sessão inválida.", 401);
    const { id, ...fields } = body as any;
    if (!id) return err("ID obrigatório.");
    delete fields.action; delete fields._token; delete fields._prof_token;
    const { error } = await sb.from("provas").update(fields).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ── Respostas dos alunos ──
  if (action === "provas_responder") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const aluno = await validarSessaoAluno(sb, alunoToken || token);
    if (!aluno) return err("Sessão inválida.", 401);
    const { prova_id, respostas } = body as any;
    const aluno_email = aluno.email;
    const aluno_nome = aluno.nome;
    if (!prova_id) return err("prova_id obrigatório.");
    // Verificar se prova está publicada e no prazo
    const { data: prova } = await sb.from("provas").select("status, data_inicio, data_fim, questoes, pontuacao_total").eq("id", prova_id).single();
    if (!prova || prova.status !== "publicada") return err("Prova não disponível.");
    const agora = new Date();
    if (prova.data_inicio && agora < new Date(prova.data_inicio)) return err("Prova ainda não iniciada.");
    if (prova.data_fim && agora > new Date(prova.data_fim)) return err("Prazo encerrado.");

    // Auto-correção para múltipla escolha
    let pontuacao = 0;
    const detalhada: Record<string, any> = {};
    const questoesProva = prova.questoes || [];
    const totalQuestoes = questoesProva.length;
    const pontoPorQuestao = totalQuestoes > 0 ? prova.pontuacao_total / totalQuestoes : 0;

    for (const qRef of questoesProva) {
      const qId = qRef.questao_id;
      const respAluno = respostas?.[qId];
      const { data: questao } = await sb.from("provas_questoes").select("tipo, opcoes, resposta_correta").eq("id", qId).single();
      if (!questao) continue;
      let correta = false;
      if (questao.tipo === "multipla") {
        const opcCorreta = (questao.opcoes || []).findIndex((o: any) => o.correta);
        correta = respAluno !== undefined && parseInt(respAluno) === opcCorreta;
      } else if (questao.tipo === "verdadeiro_falso") {
        correta = respAluno === questao.resposta_correta;
      }
      // Dissertativa precisa correção manual
      const pts = correta ? pontoPorQuestao : 0;
      pontuacao += pts;
      detalhada[qId] = { pontos: pts, max: pontoPorQuestao, correta, tipo: questao.tipo };
    }

    pontuacao = Math.round(pontuacao * 100) / 100;
    const corrigido = !questoesProva.some((q: any) => {
      const d = detalhada[q.questao_id];
      return d?.tipo === "dissertativa";
    });

    const { data, error } = await sb.from("provas_respostas").upsert({
      prova_id, aluno_email, aluno_nome, respostas: respostas || {},
      pontuacao, pontuacao_detalhada: detalhada, fim: agora.toISOString(),
      corrigido, corrigido_em: corrigido ? agora.toISOString() : null
    }, { onConflict: "prova_id,aluno_email" }).select().single();
    if (error) return err(error.message);
    return ok(data);
  }

  if (action === "provas_respostas_list") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const { prova_id, aluno_email } = body as any;
    let q = sb.from("provas_respostas").select("*").order("aluno_nome");
    if (prova_id) q = q.eq("prova_id", prova_id);
    if (aluno_email) q = q.eq("aluno_email", aluno_email);
    const { data } = await q;
    return ok(data ?? []);
  }

  // Prova disponível para aluno
  if (action === "provas_disponiveis_aluno") {
    const blocked = requireModulo(enabledModules, "banco_provas"); if (blocked) return blocked;
    const aluno = await validarSessaoAluno(sb, alunoToken || token);
    if (!aluno) return err("Sessão inválida.", 401);
    const { serie_id } = body as any;
    const aluno_email = aluno.email;
    const agora = new Date().toISOString();
    let q = sb.from("provas").select("id, titulo, notas_disciplinas(nome), data_inicio, data_fim, tempo_limite, pontuacao_total").eq("status", "publicada");
    if (serie_id) q = q.eq("serie_id", serie_id);
    q = q.lte("data_inicio", agora).gte("data_fim", agora);
    const { data: provas } = await q;
    // Check which ones student already answered
    const result = [];
    for (const p of provas || []) {
      const { data: resp } = await sb.from("provas_respostas").select("id, pontuacao, fim").eq("prova_id", p.id).eq("aluno_email", aluno_email).single();
      result.push({ ...p, respondida: !!resp, pontuacao: resp?.pontuacao ?? null });
    }
    return ok(result);
  }

  return err("Ação desconhecida: " + action, 404);
  } catch (error) {
    console.error("[academico] Unhandled error:", error);
    captureException(error instanceof Error ? error : new Error(String(error)), { action: String(body?.action || 'unknown') }).catch(() => {});
    return err("Erro interno do servidor.", 500);
  }
});
