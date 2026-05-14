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
import { refreshSignedUrls } from "../../_shared/signed-url-cache.ts";

const log = createLogger("api");

// Module-level McpServer for ia_consulta_rapida (subset of gerente tools)

export async function handle(ctx: GerenteCtx): Promise<Response | null> {
  const { req, admin, body, action, ip, ok, err, cors: CORS, gerente, sessionEscolaId, token } = ctx;
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  // ── Solicitações ──────────────────────────────────────────────
  if (action === "solicitacoes_list") {
    const limite = Number(body.limite) || 100;
    const offset = Number(body.offset) || 0;
    const { data } = await admin.from("solicitacoes").select("id, email, nome_resp, nome_crianca, turno, serie, dias_semana, mes_vigencia, criado_em").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false }).range(offset, offset + limite - 1);
    return ok(data ?? []);
  }
  if (action === "solicitacoes_update_turno") {
    const { id, turno } = body as { id: string; turno: string };
    const { error } = await admin.from("solicitacoes").update({ turno }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "solicitacoes_delete") {
    const { id } = body as { id: string };
    await admin.from("solicitacoes").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Séries (CRUD completo) ────────────────────────────────────
  if (action === "series_list_all") {
    const { data } = await admin.from("series").select("*").eq("escola_id", sessionEscolaId).order("ordem");
    return ok(data ?? []);
  }
  if (action === "series_create") {
    const { nome, ordem } = body as { nome: string; ordem: number };
    if (!nome) return err("Nome é obrigatório.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { error } = await admin.from("series").insert({ nome, ordem: ordem ?? 99, escola_id: gerente.escola_id });
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "Já existe uma série com este nome." : sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "series_update") {
    const { id, nome, ordem, ativo, aviso_requisicao_mensal } = body as { id: string; nome: string; ordem: number; ativo: boolean; aviso_requisicao_mensal?: boolean };
    const update: Record<string, unknown> = { nome, ordem, ativo };
    if (aviso_requisicao_mensal !== undefined) update.aviso_requisicao_mensal = aviso_requisicao_mensal;
    const { error } = await admin.from("series").update(update).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "series_delete") {
    const { id, force } = body as { id: string; force?: boolean };
    const { count } = await admin.from("alunos").select("id", { count: "exact", head: true })
      .eq("serie_id", id).eq("escola_id", sessionEscolaId).neq("ativo", false);
    if ((count ?? 0) > 0 && !force) {
      return err(`Esta turma tem ${count} aluno(s) vinculado(s). Confirme novamente para excluir mesmo assim.`, 409);
    }
    await admin.from("series").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Recursos compartilhados (tablets etc) ──────────────
  if (action === "recursos_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("recursos").select("*")
      .eq("escola_id", gerente.escola_id).order("tipo").order("identificacao");
    return ok({ data: data ?? [] });
  }
  if (action === "recursos_save") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id, tipo, identificacao, modelo, localizacao, fixo, ativo, observacao,
            buffer_pos_uso_min, tempo_carga_min, permite_sobreposicao } = body as Record<string, unknown>;
    if (!tipo || !identificacao) return err("Tipo e identificação obrigatórios.");
    const data: Record<string, unknown> = { tipo, identificacao, modelo: modelo || null, localizacao: localizacao || null, fixo: !!fixo, ativo: ativo !== false, observacao: observacao || null, permite_sobreposicao: !!permite_sobreposicao };
    if (buffer_pos_uso_min !== undefined && buffer_pos_uso_min !== null && buffer_pos_uso_min !== "") {
      const v = parseInt(String(buffer_pos_uso_min));
      if (!Number.isNaN(v) && v >= 0 && v <= 240) data.buffer_pos_uso_min = v;
    }
    if (tempo_carga_min !== undefined && tempo_carga_min !== null && tempo_carga_min !== "") {
      const v = parseInt(String(tempo_carga_min));
      if (!Number.isNaN(v) && v >= 0 && v <= 240) data.tempo_carga_min = v;
    }
    if (id) {
      const { error } = await admin.from("recursos").update(data).eq("id", id).eq("escola_id", gerente.escola_id);
      if (error) return err(sanitizePgError(error));
      return ok({ success: true, id });
    }
    const { data: novo, error } = await admin.from("recursos").insert({ ...data, escola_id: gerente.escola_id }).select("id").single();
    if (error) return err(sanitizePgError(error));
    return ok({ success: true, id: (novo as any).id });
  }
  if (action === "recursos_delete") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id } = body as { id: string };
    await admin.from("recursos").delete().eq("id", id).eq("escola_id", gerente.escola_id);
    return ok({ success: true });
  }
  if (action === "reservas_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { recurso_id, desde, ate } = body as Record<string, string>;
    let q = admin.from("reservas_recursos")
      .select("*, recursos(tipo, identificacao, localizacao, buffer_pos_uso_min, tempo_carga_min, permite_sobreposicao), series(nome), professoras(nome)")
      .eq("escola_id", gerente.escola_id).order("inicio", { ascending: true }).limit(500);
    if (recurso_id) q = q.eq("recurso_id", recurso_id);
    if (desde) q = q.gte("inicio", desde);
    if (ate) q = q.lte("fim", ate);
    const { data } = await q;
    return ok({ data: data ?? [] });
  }
  if (action === "reservas_criar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { recurso_id, turma_id, professora_id, inicio, fim, observacao,
            recorrencia, recorrencia_ate } = body as Record<string, string | null>;
    if (!recurso_id || !inicio || !fim) return err("Recurso, início e fim obrigatórios.");
    if (new Date(fim as string) <= new Date(inicio as string)) return err("O fim deve ser posterior ao início.");

    // Pontual: insere 1 row e fim
    if (!recorrencia || recorrencia === "unica") {
      const { data: nova, error } = await admin.from("reservas_recursos").insert({
        escola_id: gerente.escola_id, recurso_id,
        turma_id: turma_id || null, professora_id: professora_id || null,
        inicio, fim, observacao: observacao || null,
        recorrencia: "unica",
      }).select("id").single();
      if (error) {
        if (/Conflito de reserva/i.test(error.message)) return err(error.message, 409);
        return err(sanitizePgError(error));
      }
      return ok({ success: true, id: (nova as any).id, criadas: 1 });
    }

    if (!["semanal", "diaria"].includes(recorrencia)) return err("recorrencia inválida (use unica/semanal/diaria).");
    if (!recorrencia_ate) return err("recorrencia_ate obrigatório (data limite).");

    const ini = new Date(inicio as string);
    const fimD = new Date(fim as string);
    const limite = new Date((recorrencia_ate as string) + "T23:59:59");
    if (limite <= ini) return err("recorrencia_ate deve ser posterior ao início.");

    const stepDias = recorrencia === "semanal" ? 7 : 1;
    const maxIter = recorrencia === "semanal" ? 53 : 366;

    // Cria parent (a primeira ocorrência) — filhas apontam pra ela
    const { data: parent, error: errP } = await admin.from("reservas_recursos").insert({
      escola_id: gerente.escola_id, recurso_id,
      turma_id: turma_id || null, professora_id: professora_id || null,
      inicio, fim, observacao: observacao || null,
      recorrencia, recorrencia_ate,
    }).select("id").single();
    if (errP) {
      if (/Conflito de reserva/i.test(errP.message)) return err(errP.message, 409);
      return err(sanitizePgError(errP));
    }
    const parentId = (parent as any).id;

    // Gera as filhas; conflitos pulam (não bloqueiam toda a série)
    let criadas = 1;
    let puladas = 0;
    const rows: any[] = [];
    for (let i = 1; i < maxIter; i++) {
      const novoIni = new Date(ini); novoIni.setUTCDate(novoIni.getUTCDate() + stepDias * i);
      if (novoIni > limite) break;
      const novoFim = new Date(fimD); novoFim.setUTCDate(novoFim.getUTCDate() + stepDias * i);
      rows.push({
        escola_id: gerente.escola_id, recurso_id,
        turma_id: turma_id || null, professora_id: professora_id || null,
        inicio: novoIni.toISOString(), fim: novoFim.toISOString(),
        observacao: observacao || null,
        recorrencia: "unica", serie_id: parentId,
      });
    }
    // Insere uma a uma pra capturar conflitos individuais
    for (const r of rows) {
      const { error: e2 } = await admin.from("reservas_recursos").insert(r);
      if (e2) { puladas++; continue; }
      criadas++;
    }
    return ok({ success: true, id: parentId, criadas, puladas, total_planejadas: rows.length + 1 });
  }
  if (action === "reservas_editar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id, recurso_id, turma_id, inicio, fim, observacao } = body as Record<string, string | null>;
    if (!id) return err("ID obrigatório.");
    if (!recurso_id || !inicio || !fim) return err("Recurso, início e fim obrigatórios.");
    if (new Date(fim as string) <= new Date(inicio as string)) return err("O fim deve ser posterior ao início.");
    const upd: Record<string, unknown> = {
      recurso_id, turma_id: turma_id || null,
      inicio, fim, observacao: observacao || null,
    };
    const { error } = await admin.from("reservas_recursos").update(upd)
      .eq("id", id).eq("escola_id", gerente.escola_id);
    if (error) {
      if (/Conflito de reserva/i.test(error.message)) return err(error.message, 409);
      return err(sanitizePgError(error));
    }
    return ok({ success: true, id });
  }
  if (action === "reservas_cancelar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id, serie } = body as { id: string; serie?: boolean };
    if (!id) return err("ID obrigatório.");
    // Se serie=true, cancela todas filhas + parent
    if (serie) {
      const { error: e1 } = await admin.from("reservas_recursos").update({ status: "cancelada" })
        .eq("escola_id", gerente.escola_id).or(`id.eq.${id},serie_id.eq.${id}`);
      if (e1) return err(sanitizePgError(e1));
      return ok({ success: true, modo: "serie" });
    }
    const { error } = await admin.from("reservas_recursos").update({ status: "cancelada" })
      .eq("id", id).eq("escola_id", gerente.escola_id);
    if (error) return err(sanitizePgError(error));
    return ok({ success: true });
  }

  // ── Analytics: ocupação dos recursos + recomendação de capacidade ──
  // Considera buffer pós-uso e tempo de carga: ocupação efetiva é
  // (fim + buffer) - (inicio - tempo_carga) por reserva. Reflete o
  // tempo que o recurso de fato fica indisponível (não só o slot da aula).
  if (action === "recursos_analytics") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data: recursos } = await admin.from("recursos")
      .select("id, tipo, identificacao, ativo, buffer_pos_uso_min, tempo_carga_min")
      .eq("escola_id", gerente.escola_id).eq("ativo", true);
    const horasEscolaPorSemana = 11 * 5; // 7h-18h × seg-sex
    const desde = new Date(); desde.setHours(0, 0, 0, 0);
    const ate = new Date(desde); ate.setDate(ate.getDate() + 14);
    const { data: reservas } = await admin.from("reservas_recursos")
      .select("recurso_id, inicio, fim, status")
      .eq("escola_id", gerente.escola_id).eq("status", "ativa")
      .gte("inicio", desde.toISOString()).lt("inicio", ate.toISOString());

    type Acc = {
      recurso_id: string; tipo: string; identificacao: string;
      buffer_min: number; carga_min: number;
      horasReservadasPuras: number; horasOcupadasEfetivas: number;
    };
    const porRecurso: Record<string, Acc> = {};
    for (const r of (recursos ?? []) as any[]) {
      porRecurso[r.id] = {
        recurso_id: r.id, tipo: r.tipo, identificacao: r.identificacao,
        buffer_min: r.buffer_pos_uso_min ?? 0, carga_min: r.tempo_carga_min ?? 0,
        horasReservadasPuras: 0, horasOcupadasEfetivas: 0,
      };
    }
    for (const rv of (reservas ?? []) as any[]) {
      const acc = porRecurso[rv.recurso_id];
      if (!acc) continue;
      const horasPuras = (new Date(rv.fim).getTime() - new Date(rv.inicio).getTime()) / 3600000;
      const horasEfetivas = horasPuras + (acc.buffer_min + acc.carga_min) / 60;
      acc.horasReservadasPuras += horasPuras;
      acc.horasOcupadasEfetivas += horasEfetivas;
    }
    const capacidadeUnitaria = horasEscolaPorSemana * 2; // 14 dias
    const recursosAnalise = Object.values(porRecurso).map(r => ({
      ...r,
      horas_capacidade: capacidadeUnitaria,
      taxa_ocupacao_pct: capacidadeUnitaria ? Math.round((r.horasOcupadasEfetivas / capacidadeUnitaria) * 100) : 0,
    })).sort((a, b) => b.taxa_ocupacao_pct - a.taxa_ocupacao_pct);

    type AccTipo = { tipo: string; qtd: number; horasOcupadasEfetivas: number; horas_capacidade: number; buffer_medio: number; carga_media: number };
    const porTipo: Record<string, AccTipo> = {};
    for (const r of recursosAnalise) {
      if (!porTipo[r.tipo]) porTipo[r.tipo] = { tipo: r.tipo, qtd: 0, horasOcupadasEfetivas: 0, horas_capacidade: 0, buffer_medio: 0, carga_media: 0 };
      porTipo[r.tipo].qtd++;
      porTipo[r.tipo].horasOcupadasEfetivas += r.horasOcupadasEfetivas;
      porTipo[r.tipo].horas_capacidade += capacidadeUnitaria;
      porTipo[r.tipo].buffer_medio += r.buffer_min;
      porTipo[r.tipo].carga_media += r.carga_min;
    }
    const tiposAnalise = Object.values(porTipo).map(t => {
      const taxa = t.horas_capacidade ? t.horasOcupadasEfetivas / t.horas_capacidade : 0;
      const taxaPct = Math.round(taxa * 100);
      let sugestao = 0;
      if (taxa > 0.8) {
        const horasIdeais = t.horasOcupadasEfetivas / 0.7;
        const qtdIdeal = Math.ceil(horasIdeais / capacidadeUnitaria);
        sugestao = Math.max(0, qtdIdeal - t.qtd);
      }
      return {
        tipo: t.tipo, qtd: t.qtd,
        horas_ocupadas_efetivas: Math.round(t.horasOcupadasEfetivas * 10) / 10,
        horas_capacidade: t.horas_capacidade,
        taxa_pct: taxaPct, sugestao_extras: sugestao,
        buffer_medio_min: t.qtd ? Math.round(t.buffer_medio / t.qtd) : 0,
        carga_media_min: t.qtd ? Math.round(t.carga_media / t.qtd) : 0,
      };
    }).sort((a, b) => b.taxa_pct - a.taxa_pct);

    return ok({
      janela_dias: 14,
      horas_escola_semana: horasEscolaPorSemana,
      total_recursos: recursosAnalise.length,
      total_reservas_periodo: (reservas ?? []).length,
      por_recurso: recursosAnalise,
      por_tipo: tiposAnalise,
    });
  }

  // Audit log do cadastro — listar últimas mudanças
  if (action === "audit_log_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { entidade, limit } = body as { entidade?: string; limit?: number };
    let q = admin.from("audit_log_cadastro").select("*")
      .eq("escola_id", gerente.escola_id)
      .order("criado_em", { ascending: false })
      .limit(Math.min(limit || 100, 500));
    if (entidade) q = q.eq("entidade", entidade);
    const { data } = await q;
    return ok({ data: data ?? [] });
  }

  // ── Saúde do cadastro: detecta inconsistências de famílias/alunos/turmas
  if (action === "cadastro_saude") {
    const [seriesRes, alunosRes, profsRes] = await Promise.all([
      admin.from("series").select("id, nome").eq("escola_id", sessionEscolaId),
      admin.from("alunos").select("id, nome, serie_id, ativo, familia_email").eq("escola_id", sessionEscolaId),
      admin.from("professoras").select("id, nome, serie_id, series_monitoras").eq("escola_id", sessionEscolaId),
    ]);
    const series = (seriesRes.data ?? []) as Array<{ id: string; nome: string }>;
    const alunos = (alunosRes.data ?? []) as Array<{ id: string; nome: string; serie_id: string | null; ativo: boolean; familia_email: string }>;
    const profs = (profsRes.data ?? []) as Array<{ id: string; nome: string; serie_id: string | null; series_monitoras: string[] | null }>;

    const ativos = alunos.filter(a => a.ativo !== false);
    const semTurma = ativos.filter(a => !a.serie_id);

    const alunosPorSerie: Record<string, number> = {};
    for (const a of ativos) if (a.serie_id) alunosPorSerie[a.serie_id] = (alunosPorSerie[a.serie_id] || 0) + 1;

    const profsPorSerie: Record<string, string[]> = {};
    for (const p of profs) {
      const ids = new Set<string>();
      if (p.serie_id) ids.add(p.serie_id);
      for (const sid of (p.series_monitoras || [])) if (sid) ids.add(sid);
      for (const sid of ids) (profsPorSerie[sid] = profsPorSerie[sid] || []).push(p.nome);
    }

    const turmasSemAluno = series.filter(s => !alunosPorSerie[s.id]).map(s => ({ id: s.id, nome: s.nome }));
    const turmasSemProf = series.filter(s => !(profsPorSerie[s.id]?.length)).map(s => ({ id: s.id, nome: s.nome }));

    const nomeCount: Record<string, Array<{ id: string; nome: string }>> = {};
    for (const s of series) {
      const k = (s.nome || "").trim().toLowerCase();
      if (!k) continue;
      (nomeCount[k] = nomeCount[k] || []).push(s);
    }
    const nomesDuplicados = Object.values(nomeCount).filter(arr => arr.length > 1).map(arr => ({
      nome: arr[0].nome,
      ids: arr.map(s => s.id),
      count: arr.length,
    }));

    const semFamiliaEmail = ativos.filter(a => !a.familia_email).map(a => ({ id: a.id, nome: a.nome }));

    return ok({
      resumo: {
        total_series: series.length,
        total_alunos_ativos: ativos.length,
        total_professoras: profs.length,
        alunos_sem_turma: semTurma.length,
        turmas_sem_aluno: turmasSemAluno.length,
        turmas_sem_professor: turmasSemProf.length,
        nomes_duplicados: nomesDuplicados.length,
        alunos_sem_familia_email: semFamiliaEmail.length,
      },
      alunos_sem_turma: semTurma.slice(0, 50).map(a => ({ id: a.id, nome: a.nome })),
      turmas_sem_aluno: turmasSemAluno.slice(0, 50),
      turmas_sem_professor: turmasSemProf.slice(0, 50),
      nomes_duplicados: nomesDuplicados.slice(0, 20),
      alunos_sem_familia_email: semFamiliaEmail.slice(0, 50),
    });
  }

  // ── Gerentes ──────────────────────────────────────────────────
  if (action === "gerentes_list") {
    const { data } = await admin.from("gerentes").select("id, nome, email, criado_em").eq("escola_id", sessionEscolaId).order("criado_em");
    return ok(data ?? []);
  }
  if (action === "gerentes_create") {
    const { nome, email, senha } = body as { nome: string; email: string; senha: string };
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const senha_hash = await hashSenha(senha as string);
    const { error } = await admin.from("gerentes").insert({ nome, email, senha_hash, escola_id: gerente.escola_id });
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "gerentes_delete") {
    const { id } = body as { id: string };
    if (id === gerente.id) return err("Você não pode remover sua própria conta.");
    // Atomic safe delete via RPC (migration 217) — previne race condition
    const { data: okRpc, error: rpcErr } = await admin.rpc("gerentes_safe_delete", { p_id: id });
    if (rpcErr) {
      console.error("[gerentes_safe_delete]", rpcErr);
      return err(sanitizePgError(rpcErr));
    }
    if (!okRpc) return err("É necessário manter pelo menos um gerente.");
    return ok({ success: true });
  }
  if (action === "gerentes_change_password") {
    const { senhaAtual, novaSenha } = body as { senhaAtual: string; novaSenha: string };
    if (!senhaAtual || !novaSenha) return err("Preencha todos os campos.");
    if ((novaSenha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const { data: g } = await admin.from("gerentes").select("senha_hash").eq("id", gerente.id).single();
    if (!g || !(await verificarSenhaAuto(senhaAtual, g.senha_hash))) return err("Senha atual incorreta.");
    const hash = await hashSenha(novaSenha);
    await admin.from("gerentes").update({ senha_hash: hash }).eq("id", gerente.id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Usuários Unificados ──────────────────────────────────────
  if (action === "usuarios_list") {
    const { data } = await admin.from("usuarios").select("id, nome, email, papel, papeis, ativo, criado_em").eq("escola_id", sessionEscolaId).order("papel").order("nome").limit(2000);
    const users = (data ?? []).map((u: any) => ({ ...u, papeis: u.papeis?.length ? u.papeis : (u.papel ? [u.papel] : []) }));
    // Enriquece professoras com serie_id
    const profEmails = users.filter(u => u.papeis.includes('professora') || u.papeis.includes('professora_assistente')).map(u => u.email);
    if (profEmails.length) {
      const { data: profs } = await admin.from("professoras").select("email, serie_id, series(id, nome)").eq("escola_id", sessionEscolaId).in("email", profEmails);
      const profMap = new Map((profs ?? []).map((p: any) => [p.email, { serie_id: p.serie_id, serie_nome: p.series?.nome }]));
      for (const u of users) {
        const p = profMap.get(u.email);
        if (p) { (u as any).serie_id = p.serie_id; (u as any).serie_nome = p.serie_nome; }
      }
    }
    return ok(users);
  }
  if (action === "usuarios_create") {
    const { nome, email, senha, papel, papeis: rawPapeis, features } = body as any;
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    // Aceita papeis (array) ou papel (string legado)
    let papeis: string[] = Array.isArray(rawPapeis) && rawPapeis.length ? rawPapeis : (papel ? [papel] : []);
    if (!papeis.length) return err("Selecione pelo menos um papel.");
    const papeisValidos = ["gerente", "diretor", "financeiro", "professora", "professora_assistente", "secretaria", "comercial", "manutencao", "impressao", "nutricionista", "almoxarifado"];
    const invalidos = papeis.filter((p: string) => !papeisValidos.includes(p));
    if (invalidos.length) return err("Papel inválido: " + invalidos.join(", "));
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const escola_id = gerente.escola_id;
    const senha_hash = await hashSenhaProf(senha as string);
    const primaryPapel = papeis[0]; // para compatibilidade com coluna legada
    const { error } = await admin.from("usuarios").insert({ nome, email, senha_hash, papel: primaryPapel, papeis, escola_id });
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    // Sincroniza com tabelas legadas para cada papel
    if (papeis.includes("gerente") || papeis.includes("diretor") || papeis.includes("financeiro")) {
      await admin.from("gerentes").insert({ nome, email, senha_hash: await hashSenha(senha as string), escola_id }).catch(() => {});
    }
    if (papeis.some((p: string) => ["professora", "professora_assistente", "manutencao"].includes(p))) {
      const tipo = papeis.includes("professora_assistente") ? "professora_assistente" : papeis.includes("manutencao") ? "manutencao" : "professora";
      await admin.from("professoras").insert({ nome, email, senha_hash, tipo, escola_id }).catch(() => {});
    }
    const secRoles = ["secretaria","comercial","financeiro","diretor","manutencao","impressao","nutricionista","almoxarifado"];
    if (papeis.some((p: string) => secRoles.includes(p))) {
      let secFeatures = features || [];
      if (!secFeatures.length) {
        if (papeis.includes("secretaria")) secFeatures.push("atestados");
        if (papeis.includes("comercial")) secFeatures.push("crm", "templates", "metas");
        if (papeis.includes("financeiro") || papeis.includes("diretor")) secFeatures.push("financeiro");
        if (papeis.includes("diretor") || papeis.includes("gerente")) secFeatures.push("financeiro_gerencial");
        if (papeis.includes("manutencao")) secFeatures.push("manutencao");
        if (papeis.includes("impressao")) secFeatures.push("impressao");
        if (papeis.includes("nutricionista")) secFeatures.push("cozinha");
        if (papeis.includes("almoxarifado")) secFeatures.push("almoxarifado");
      }
      await admin.from("secretarias").upsert({ nome, email, senha_hash, features: secFeatures, ativo: true, escola_id }, { onConflict: "email" }).catch(() => {});
    }
    return ok({ success: true });
  }
  if (action === "usuarios_update") {
    const { id, nome, email, papel, papeis: rawPapeis, features } = body as any;
    if (!id) return err("ID obrigatório.");
    // Busca estado atual
    const { data: current } = await admin.from("usuarios").select("nome, email, senha_hash, papeis, papel").eq("id", id).eq("escola_id", sessionEscolaId).single();
    if (!current) return err("Usuário não encontrado.");
    const update: Record<string, unknown> = {};
    if (nome) update.nome = nome;
    if (email) update.email = email;
    const papeis = Array.isArray(rawPapeis) && rawPapeis.length ? rawPapeis : (papel ? [papel] : null);
    if (papeis) {
      update.papeis = papeis;
      update.papel = papeis[0];
    }
    const { error } = await admin.from("usuarios").update(update).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    // Sincroniza tabelas legadas se papéis mudaram
    if (papeis) {
      try {
        const oldRoles: string[] = current.papeis?.length ? current.papeis : (current.papel ? [current.papel] : []);
        const uEmail = (email || current.email) as string;
        const uNome = (nome || current.nome) as string;
        const uHash = current.senha_hash as string;
        // Gerente: diretor, gerente, financeiro → tabela gerentes
        const needsGerente = papeis.some((p: string) => ["gerente","diretor","financeiro"].includes(p));
        const hadGerente = oldRoles.some((p: string) => ["gerente","diretor","financeiro"].includes(p));
        if (needsGerente && !hadGerente) {
          await admin.from("gerentes").upsert({ nome: uNome, email: uEmail, senha_hash: uHash, escola_id: sessionEscolaId }, { onConflict: "email" }).catch(() => {});
        } else if (!needsGerente && hadGerente) {
          await admin.from("gerentes").delete().eq("email", uEmail).eq("escola_id", sessionEscolaId).catch(() => {});
        }
        // Professora
        const needsProf = papeis.some((p: string) => ["professora","professora_assistente","manutencao"].includes(p));
        const hadProf = oldRoles.some((p: string) => ["professora","professora_assistente","manutencao"].includes(p));
        if (needsProf && !hadProf) {
          const tipo = papeis.includes("professora_assistente") ? "professora_assistente" : papeis.includes("manutencao") ? "manutencao" : "professora";
          await admin.from("professoras").upsert({ nome: uNome, email: uEmail, senha_hash: uHash, tipo, escola_id: sessionEscolaId }, { onConflict: "email" }).catch(() => {});
        } else if (!needsProf && hadProf) {
          await admin.from("professoras").delete().eq("email", uEmail).eq("escola_id", sessionEscolaId).catch(() => {});
        }
        // Secretaria/Comercial
        const secRoles = ["secretaria","comercial","financeiro","diretor","manutencao","impressao","nutricionista","almoxarifado"];
        const needsSec = papeis.some((p: string) => secRoles.includes(p));
        const hadSec = oldRoles.some((p: string) => secRoles.includes(p));
        if (needsSec) {
          const secFeatures: string[] = Array.isArray(features) ? features : [];
          if (!secFeatures.length) {
            if (papeis.includes("secretaria")) secFeatures.push("atestados");
            if (papeis.includes("comercial")) secFeatures.push("crm", "templates", "metas");
            if (papeis.includes("financeiro") || papeis.includes("diretor")) secFeatures.push("financeiro");
            if (papeis.includes("diretor") || papeis.includes("gerente")) secFeatures.push("financeiro_gerencial");
            if (papeis.includes("manutencao")) secFeatures.push("manutencao");
            if (papeis.includes("impressao")) secFeatures.push("impressao");
            if (papeis.includes("nutricionista")) secFeatures.push("cozinha");
            if (papeis.includes("almoxarifado")) secFeatures.push("almoxarifado");
          }
          // Upsert: cria se não existe, atualiza features se existe
          await admin.from("secretarias").upsert({ nome: uNome, email: uEmail, senha_hash: uHash, features: secFeatures, ativo: true, escola_id: sessionEscolaId }, { onConflict: "email" }).catch(() => {});
        } else if (!needsSec && hadSec) {
          await admin.from("secretarias").update({ ativo: false }).eq("email", uEmail).eq("escola_id", sessionEscolaId).catch(() => {});
        }
      } catch (_syncErr) {
        // Sync com tabelas legadas é best-effort, não falha a operação principal
      }
    }
    return ok({ success: true });
  }
  if (action === "usuarios_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    const { data: u } = await admin.from("usuarios").select("email, papel, papeis").eq("id", id).eq("escola_id", sessionEscolaId).single();
    if (!u) return err("Usuário não encontrado.");
    if (u.email === gerente.email) return err("Você não pode remover sua própria conta.");
    const roles = u.papeis?.length ? u.papeis : [u.papel];
    if (roles.includes("gerente")) {
      // Conta gerentes em papeis (array) OR papel (singular legado)
      const { count } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true })
        .eq("escola_id", sessionEscolaId)
        .or("papeis.cs.{gerente},papel.eq.gerente")
        .eq("ativo", true);
      if ((count ?? 0) <= 1) return err("É necessário manter pelo menos um gerente.");
    }
    await admin.from("usuarios").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    // Remove de todas as tabelas legadas
    await admin.from("gerentes").delete().eq("email", u.email).eq("escola_id", sessionEscolaId).catch(() => {});
    await admin.from("professoras").delete().eq("email", u.email).eq("escola_id", sessionEscolaId).catch(() => {});
    await admin.from("secretarias").delete().eq("email", u.email).eq("escola_id", sessionEscolaId).catch(() => {});
    return ok({ success: true });
  }
  if (action === "usuarios_reset_senha") {
    const { id, nova_senha } = body as { id: string; nova_senha: string };
    if (!id || !nova_senha) return err("ID e nova senha são obrigatórios.");
    if ((nova_senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(nova_senha as string);
    const { error } = await admin.from("usuarios").update({ senha_hash }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "usuarios_reenviar_credenciais") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    const { data: u } = await admin.from("usuarios").select("nome, email, papeis, papel").eq("id", id).eq("escola_id", sessionEscolaId).single();
    if (!u) return err("Usuário não encontrado.");
    // Gera nova senha aleatória de 8 chars
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let novaSenha = "";
    for (let i = 0; i < 8; i++) novaSenha += chars[Math.floor(Math.random() * chars.length)];
    const senha_hash = await hashSenhaProf(novaSenha);
    await admin.from("usuarios").update({ senha_hash }).eq("id", id).eq("escola_id", sessionEscolaId);
    // Atualiza tabelas legadas
    await admin.from("gerentes").update({ senha_hash: await hashSenha(novaSenha) }).eq("email", u.email).eq("escola_id", sessionEscolaId).catch(() => {});
    await admin.from("professoras").update({ senha_hash }).eq("email", u.email).eq("escola_id", sessionEscolaId).catch(() => {});
    await admin.from("secretarias").update({ senha_hash }).eq("email", u.email).eq("escola_id", sessionEscolaId).catch(() => {});
    // Determina portal
    const roles: string[] = u.papeis?.length ? u.papeis : (u.papel ? [u.papel] : []);
    let portal = "area-restrita.html";
    if (roles.includes("gerente") || roles.includes("diretor")) portal = "gerente.html";
    else if (roles.includes("professora") || roles.includes("professora_assistente")) portal = "professora.html";
    else portal = "secretaria.html";
    // Busca branding da escola
    const { data: escola } = await admin.from("escolas").select("nome, slug").eq("id", sessionEscolaId).single();
    const escolaNome = escola?.nome || "Escola";
    const slug = escola?.slug || "";
    const { data: cfgRows } = await admin.from("escola_config").select("chave, valor").eq("escola_id", sessionEscolaId);
    const cfg: Record<string, string> = {};
    for (const r of cfgRows || []) cfg[r.chave] = r.valor;
    const cor = cfg.cor_primaria || "#C8102E";
    const logoUrl = cfg.escola_logo_url || "";
    const icone = cfg.escola_icone || "🎓";
    const portalUrl = slug ? `https://${slug}.lumied.com.br/${portal}` : portal;
    const escolaNomeSafe = escapeHtml(escolaNome);
    const corSafe = escapeHtml(cor);
    const logoHtml = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="${escolaNomeSafe}" style="max-height:60px;max-width:200px;object-fit:contain;margin-bottom:16px;">`
      : `<div style="font-size:32px;margin-bottom:16px;">${escapeHtml(icone)}</div>`;
    const html = `
      <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#fff;">
        <div style="text-align:center;margin-bottom:24px;">
          ${logoHtml}
          <h2 style="color:${corSafe};margin:0;font-size:20px;">${escolaNomeSafe}</h2>
          <p style="color:#888;font-size:12px;margin:4px 0 0;">by <strong>Lumied</strong></p>
        </div>
        <div style="background:#f8f5f0;border-radius:12px;padding:24px;">
          <p style="font-size:15px;color:#333;margin:0 0 12px;">Olá <strong>${escapeHtml(u.nome || '')}</strong>,</p>
          <p style="font-size:14px;color:#555;margin:0 0 16px;">Suas credenciais de acesso ao sistema:</p>
          <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin-bottom:16px;">
            <p style="margin:0 0 8px;font-size:13px;"><strong>Email:</strong> ${escapeHtml(u.email)}</p>
            <p style="margin:0;font-size:13px;"><strong>Senha:</strong> <code style="background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:14px;letter-spacing:1px;">${escapeHtml(novaSenha)}</code></p>
          </div>
          <div style="text-align:center;">
            <a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:12px 28px;background:${corSafe};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Acessar Portal</a>
          </div>
          <p style="font-size:12px;color:#999;margin:16px 0 0;text-align:center;">Recomendamos alterar sua senha após o primeiro acesso.</p>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="font-size:11px;color:#bbb;text-align:center;">Sistema ${escolaNomeSafe} by Lumied</p>
      </div>`;
    const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_KEY) return err("Serviço de e-mail não configurado.");
    const escolaNomeHeader = sanitizeHeaderValue(escolaNome) || "Lumied";
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: `${escolaNomeHeader} <noreply@lumied.com.br>`,
        to: [u.email],
        subject: `Suas credenciais de acesso — ${escolaNomeHeader}`,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[reenviar-credenciais] Resend error:", resp.status, errBody);
      return err("Erro ao enviar e-mail. Tente novamente.");
    }
    return ok({ success: true, email: u.email });
  }

  // ── Permissões RBAC ────────────────────────────────────────────
  if (action === "permissoes_get") {
    const { usuario_id } = body as { usuario_id: string };
    if (!usuario_id) return err("usuario_id obrigatório.");

    // Get user's papeis (array) com fallback ao singular
    const { data: user } = await admin.from("usuarios").select("papel, papeis").eq("id", usuario_id).eq("escola_id", sessionEscolaId).single();
    if (!user) return err("Usuário não encontrado.", 404);
    const userRoles: string[] = (user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : [])) as string[];

    // Get defaults de TODOS os papéis e faz UNIÃO (permissão mais permissiva vence)
    const { data: defaults } = userRoles.length
      ? await admin.from("permissoes_papel")
          .select("modulo, pode_ver, pode_editar")
          .in("papel", userRoles)
      : { data: [] as Array<{modulo:string;pode_ver:boolean;pode_editar:boolean}> };

    // Get user-specific overrides
    const { data: overrides } = await admin.from("permissoes_usuario")
      .select("modulo, pode_ver, pode_editar")
      .eq("usuario_id", usuario_id);

    // Merge: overrides take precedence
    const permsMap: Record<string, {pode_ver: boolean, pode_editar: boolean}> = {};
    for (const d of defaults || []) {
      const cur = permsMap[d.modulo];
      // União OR — se QUALQUER papel do usuário permite, permite
      permsMap[d.modulo] = {
        pode_ver: (cur?.pode_ver ?? false) || d.pode_ver,
        pode_editar: (cur?.pode_editar ?? false) || d.pode_editar,
      };
    }
    for (const o of overrides || []) permsMap[o.modulo] = { pode_ver: o.pode_ver, pode_editar: o.pode_editar };

    const result = Object.entries(permsMap).map(([modulo, p]) => ({ modulo, ...p }));
    return ok(result);
  }
  if (action === "permissoes_update") {
    const { usuario_id, permissoes } = body as { usuario_id: string; permissoes: Array<{modulo: string; pode_ver: boolean; pode_editar: boolean}> };
    if (!usuario_id || !Array.isArray(permissoes)) return err("usuario_id e permissoes obrigatórios.");

    for (const p of permissoes) {
      await admin.from("permissoes_usuario").upsert({
        escola_id: sessionEscolaId,
        usuario_id,
        modulo: p.modulo,
        pode_ver: p.pode_ver,
        pode_editar: p.pode_editar,
        atualizado_por: gerente.email,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "usuario_id,modulo" });
    }

    return ok({ success: true });
  }
  if (action === "permissoes_reset") {
    const { usuario_id } = body as { usuario_id: string };
    if (!usuario_id) return err("usuario_id obrigatório.");
    await admin.from("permissoes_usuario").delete().eq("usuario_id", usuario_id);
    return ok({ success: true });
  }

  // ── Alunos ─────────────────────────────────────────────────
  if (action === "alunos_list") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    if (!gerente.escola_id) return err("Sessão sem escola associada.", 403);
    // Filtros opcionais: { somente_ativos?: bool, limit?: number }
    // Mantém default todos (compatibilidade); caller opt-in passando
    // somente_ativos=true bate idx_alunos_escola_ativo_nome (mig 273).
    const { somente_ativos, limit } = body as { somente_ativos?: boolean; limit?: number };
    const lim = Math.min(Math.max(parseInt(String(limit || 2000)) || 2000, 1), 5000);
    let q = admin.from("alunos")
      .select("id, nome, email, serie, turma, data_nascimento, responsavel_nome, resp_nome, cpf, ativo, turno, dias_semana, atividades_ids, turmas_selecionadas, almoco_dias, criado_em")
      .eq("escola_id", gerente.escola_id)
      .order("nome").limit(lim);
    if (somente_ativos === true) q = q.neq("ativo", false);
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "aluno_documentos_list") {
    const { aluno_email } = body as { aluno_email: string };
    if (!aluno_email) return err("aluno_email obrigatório.");
    const { data } = await admin.from("matricula_documentos").select("*").eq("escola_id", sessionEscolaId).ilike("aluno_email", aluno_email).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }

  if (action === "aluno_historico_list") {
    const { aluno_nome, aluno_email } = body as { aluno_nome?: string; aluno_email?: string };
    let q = admin.from("aluno_historico").select("*").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false });
    if (aluno_email) q = q.ilike("aluno_email", aluno_email);
    else if (aluno_nome) q = q.ilike("aluno_nome", `%${aluno_nome}%`);
    else return err("aluno_nome ou aluno_email obrigatório.");
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "aluno_criar") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    if (!gerente.escola_id) return err("Sessão sem escola associada.", 403);
    const { nome, email, serie, data_nascimento, responsavel_nome } = body as any;
    if (!nome) return err("Nome obrigatório.");
    const { data, error } = await admin.from("alunos").insert({
      nome, email: email || null, serie: serie || null,
      data_nascimento: data_nascimento || null,
      responsavel_nome: responsavel_nome || null,
      ativo: true,
      escola_id: gerente.escola_id,
    }).select("id").single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    logAudit(admin, {
      ator_tipo: 'gerente', ator_id: gerente.id, ator_email: gerente.email,
      recurso: 'aluno', recurso_id: data?.id,
      acao: 'criar', ip, user_agent: req.headers.get('user-agent'),
      depois: { nome, email, serie, responsavel_nome },
    });
    return ok({ success: true, id: data?.id });
  }

  if (action === "aluno_update_turno") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, turno, dias_semana } = body as { id: string; turno: string; dias_semana?: string[] };
    if (!id || !turno) return err("id e turno obrigatórios.");
    const updateData: any = { turno };
    if (dias_semana !== undefined) updateData.dias_semana = dias_semana;
    const { error } = await admin.from("alunos").update(updateData).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  if (action === "alunos_import_turnos") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { registros } = body as { registros: { nome: string; turno: string; dias_semana?: string[] }[] };
    if (!Array.isArray(registros) || !registros.length) return err("registros obrigatório (array).");
    // Busca todos os alunos para matching flexível
    const { data: todosAlunos } = await admin.from("alunos").select("id, nome").eq("escola_id", sessionEscolaId);
    const alunosList = todosAlunos ?? [];
    function findAlunoTurno(nomeBusca: string) {
      const limpo = nomeBusca.replace(/\s*-\s*G\d+$/i, "").trim().toLowerCase();
      let f = alunosList.find(a => a.nome.toLowerCase() === limpo);
      if (f) return f;
      f = alunosList.find(a => a.nome.toLowerCase().startsWith(limpo) || limpo.startsWith(a.nome.toLowerCase()));
      if (f) return f;
      const palavras = limpo.split(/\s+/).filter(p => p.length > 2);
      return alunosList.find(a => palavras.every(p => a.nome.toLowerCase().includes(p))) || null;
    }
    let sucesso = 0, erros: string[] = [];
    for (const r of registros) {
      if (!r.nome || !r.turno) { erros.push((r.nome || "?") + ": nome e turno obrigatórios"); continue; }
      const updateData: any = { turno: r.turno };
      if (r.dias_semana) updateData.dias_semana = r.dias_semana;
      const found = findAlunoTurno(r.nome);
      if (!found) { erros.push(r.nome + ": aluno não encontrado"); continue; }
      const { error } = await admin.from("alunos").update(updateData).eq("id", found.id).eq("escola_id", sessionEscolaId);
      if (error) { erros.push(r.nome + ": " + error.message); continue; }
      sucesso++;
    }
    return ok({ sucesso, erros });
  }

  if (action === "alunos_import_atividades") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { registros } = body as { registros: { nome: string; atividade: string; turma?: string }[] };
    if (!Array.isArray(registros) || !registros.length) return err("registros obrigatório (array).");

    // Busca todas as atividades cadastradas para resolver nomes → IDs
    const { data: atividades } = await admin.from("atividades").select("id, nome, horarios").eq("escola_id", sessionEscolaId);
    const ativMap: Record<string, { id: string; horarios: any[] }> = {};
    for (const a of atividades ?? []) {
      ativMap[a.nome.toLowerCase()] = { id: a.id, horarios: a.horarios ?? [] };
    }

    // Busca todos os alunos para matching flexível
    const { data: todosAlunos } = await admin.from("alunos").select("id, nome").eq("escola_id", sessionEscolaId);
    const alunosList = todosAlunos ?? [];

    // Função de matching: limpa sufixos (- G1, - G2), normaliza acentos, busca parcial
    function findAluno(nomeBusca: string) {
      // Remove sufixos como "- G1", "- G2" etc
      const limpo = nomeBusca.replace(/\s*-\s*G\d+$/i, "").trim().toLowerCase();
      // Match exato (case-insensitive)
      let found = alunosList.find(a => a.nome.toLowerCase() === limpo);
      if (found) return found;
      // Match parcial: nome da planilha contido no nome do banco ou vice-versa
      found = alunosList.find(a => a.nome.toLowerCase().startsWith(limpo) || limpo.startsWith(a.nome.toLowerCase()));
      if (found) return found;
      // Match por palavras: todas as palavras do nome da planilha devem estar no nome do banco
      const palavras = limpo.split(/\s+/).filter(p => p.length > 2);
      found = alunosList.find(a => {
        const nomeDb = a.nome.toLowerCase();
        return palavras.every(p => nomeDb.includes(p));
      });
      return found || null;
    }

    // Agrupa linhas por aluno (mesmo aluno pode ter múltiplas atividades)
    const porAluno: Record<string, { alunoId: string; atividades_ids: string[]; turmas_selecionadas: any[] }> = {};
    const erros: string[] = [];
    for (const r of registros) {
      if (!r.nome || !r.atividade) { erros.push((r.nome || "?") + ": nome e atividade obrigatórios"); continue; }
      const ativ = ativMap[r.atividade.toLowerCase()];
      if (!ativ) { erros.push(r.nome + ": atividade '" + r.atividade + "' não encontrada"); continue; }
      const aluno = findAluno(r.nome);
      if (!aluno) { erros.push(r.nome + ": aluno não encontrado"); continue; }
      const key = aluno.id;
      if (!porAluno[key]) porAluno[key] = { alunoId: aluno.id, atividades_ids: [], turmas_selecionadas: [] };
      if (!porAluno[key].atividades_ids.includes(ativ.id)) porAluno[key].atividades_ids.push(ativ.id);
      // Resolve turma → slots a partir dos horários da atividade
      const turmaInfo = r.turma ? ativ.horarios.find((h: any) => h.turma === r.turma) : null;
      porAluno[key].turmas_selecionadas.push({
        atividade_id: ativ.id,
        turma: r.turma || (ativ.horarios[0]?.turma ?? ''),
        slots: turmaInfo?.slots ?? ativ.horarios[0]?.slots ?? [],
      });
    }

    let sucesso = 0;
    for (const [, dados] of Object.entries(porAluno)) {
      const { error } = await admin.from("alunos").update({
        atividades_ids: dados.atividades_ids,
        turmas_selecionadas: dados.turmas_selecionadas,
      }).eq("id", dados.alunoId).eq("escola_id", sessionEscolaId);
      if (error) { erros.push(dados.alunoId + ": " + error.message); continue; }
      sucesso++;
    }
    return ok({ sucesso, erros });
  }

  if (action === "aluno_historico_create") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { aluno_nome, aluno_email, turma, tipo, titulo, descricao } = body as any;
    if (!aluno_nome || !titulo || !tipo) return err("aluno_nome, titulo e tipo obrigatórios.");
    const { error } = await admin.from("aluno_historico").insert({
      escola_id: sessionEscolaId, aluno_nome, aluno_email: aluno_email || null,
      turma: turma || null, tipo, titulo, descricao: descricao || null,
      registrado_por: gerente.nome, registrado_por_papel: 'coordenacao',
    });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Configurações (tenant-scoped via escola_config) ──────────
  if (action === "config_set") {
    const { chave, valor } = body as { chave: string; valor: string };
    if (!chave) return err("chave obrigatória.");
    await admin.from("escola_config").upsert({ escola_id: sessionEscolaId, chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "chave,escola_id" });
    return ok({ success: true });
  }
  if (action === "config_delete") {
    const { chave } = body as { chave: string };
    if (!chave) return err("chave obrigatória.");
    await admin.from("escola_config").delete().eq("escola_id", sessionEscolaId).eq("chave", chave);
    return ok({ success: true });
  }

  // ── Logo upload (base64) ─────────────────────────────────────
  if (action === "logo_upload") {
    const { base64, mime } = body as { base64: string; mime: string };
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowed.includes(mime)) return err("Tipo de arquivo não permitido.");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > 5 * 1024 * 1024) return err("Arquivo muito grande (máx. 5MB).");
    const ext = mime.split("/")[1].replace("svg+xml", "svg");
    const path = `logo.${ext}`;
    const { error } = await admin.storage.from("logos").upload(path, bytes, { contentType: mime, upsert: true });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    const { data: { publicUrl } } = admin.storage.from("logos").getPublicUrl(path);
    const url = publicUrl + "?t=" + Date.now();
    await admin.from("configuracoes").upsert({ chave: "logo_url", valor: url });
    return ok({ url });
  }
  if (action === "logo_remove") {
    await admin.from("configuracoes").delete().eq("chave", "logo_url");
    return ok({ success: true });
  }

  // ── Upload de relatório PDF para compartilhar ─────────────────
  if (action === "relatorio_upload") {
    const { base64, nome } = body as { base64: string; nome: string };
    if (!base64 || !nome) return err("base64 e nome são obrigatórios.");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) return err("Arquivo muito grande (máx. 20MB).");
    // Salva com timestamp para evitar cache
    const path = `relatorios/${nome}-${Date.now()}.pdf`;
    // Garante que o bucket 'relatorios' existe
    await admin.storage.createBucket('relatorios', { public: true, fileSizeLimit: 20971520 }).catch(() => {});
    const { error } = await admin.storage.from("relatorios").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    const { data: { publicUrl } } = admin.storage.from("relatorios").getPublicUrl(path);
    return ok({ url: publicUrl });
  }

  // ── Atividades (autenticado — duplicata de linha 568) ─────────
  if (action === "atividades_list") {
    const { data } = await admin.from("atividades").select("*").eq("escola_id", sessionEscolaId).eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }

  // ── Atividades CRUD (autenticado) ─────────────────────────────
  if (action === "atividades_list_all") {
    const { data: atividades } = await admin.from("atividades").select("*").eq("escola_id", sessionEscolaId).order("ordem");
    if (!atividades?.length) return ok([]);

    const { data: alunosAtiv } = await admin.from("alunos").select("turmas_selecionadas").eq("escola_id", sessionEscolaId).not("turmas_selecionadas", "is", null);
    const ocupacao: Record<string, number> = {};
    for (const al of alunosAtiv ?? []) {
      for (const ts of (al.turmas_selecionadas ?? [])) {
        const key = `${ts.atividade_id}|${ts.turma}`;
        ocupacao[key] = (ocupacao[key] || 0) + 1;
      }
    }

    const resultado = atividades.map(a => ({
      ...a,
      horarios: (a.horarios ?? []).map((t: Record<string, unknown>) => {
        const inscritos = ocupacao[`${a.id}|${t.turma}`] || 0;
        const vagas = Number(t.vagas ?? 999);
        return { ...t, inscritos, vagas_disponiveis: Math.max(0, vagas - inscritos) };
      })
    }));

    return ok(resultado);
  }
  if (action === "atividades_create") {
    const { nome, preco, descricao, cor, horarios, ordem, valor_repasse_aluno, cobranca_pela_escola } = body as Record<string, unknown>;
    if (!nome) return err("Nome é obrigatório.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { error } = await admin.from("atividades").insert({ nome, preco: preco ?? 0, descricao: descricao ?? "", cor: cor ?? "#C8102E", horarios: horarios ?? [], ordem: ordem ?? 99, valor_repasse_aluno: valor_repasse_aluno ?? 0, cobranca_pela_escola: cobranca_pela_escola ?? true, escola_id: gerente.escola_id });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "atividades_update") {
    const { id, nome, preco, descricao, cor, horarios, ordem, ativo } = body as Record<string, unknown>;
    if (!id) return err("ID obrigatório.");
    const { error } = await admin.from("atividades").update({ nome, preco, descricao, cor, horarios, ordem, ativo }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // Atualização completa (edição pelo gerente)
  if (action === "atividades_update_full") {
    const { id, nome, preco, descricao, cor, horarios, ordem, valor_repasse_aluno, cobranca_pela_escola } = body as Record<string, unknown>;
    if (!id || !nome) return err("ID e nome são obrigatórios.");
    const updateData: Record<string, unknown> = { nome, preco, descricao, cor, horarios, ordem };
    if (valor_repasse_aluno != null) updateData.valor_repasse_aluno = valor_repasse_aluno;
    if (cobranca_pela_escola != null) updateData.cobranca_pela_escola = cobranca_pela_escola;
    const { error } = await admin.from("atividades").update(updateData).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "atividades_delete") {
    const { id } = body as { id: string };
    await admin.from("atividades").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Contas a Receber — Atividades Extras ─────────────────────
  if (action === "atividades_apurar_mes") {
    // Apura e gera contas a receber para cada atividade no mês informado
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: atividades } = await admin.from("atividades").select("id, nome, valor_repasse_aluno").eq("escola_id", sessionEscolaId).eq("ativo", true);
    const { data: alunos } = await admin.from("alunos").select("atividades_ids").eq("escola_id", sessionEscolaId).eq("ativo", true).not("atividades_ids", "is", null);
    if (!atividades?.length) return ok({ gerados: 0 });

    // Conta alunos por atividade
    const contagem: Record<string, number> = {};
    for (const a of alunos ?? []) {
      for (const aid of (a.atividades_ids || [])) {
        contagem[aid] = (contagem[aid] || 0) + 1;
      }
    }

    // Calcula vencimento: dia 05 do mês seguinte
    const [y, m] = mes.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    const vencimento = `${nextMonth}-05`;

    let gerados = 0;
    for (const ativ of atividades) {
      const qtd = contagem[ativ.id] || 0;
      if (qtd === 0 && !ativ.valor_repasse_aluno) continue;
      const total = qtd * (ativ.valor_repasse_aluno || 0);
      const { error } = await admin.from("atividades_contas_receber").upsert({
        atividade_id: ativ.id, atividade_nome: ativ.nome, mes_apuracao: mes,
        qtd_alunos: qtd, valor_por_aluno: ativ.valor_repasse_aluno || 0,
        valor_total: total, data_vencimento: vencimento,
      }, { onConflict: "atividade_id,mes_apuracao" });
      if (!error) gerados++;
    }
    return ok({ gerados, mes, vencimento });
  }
  if (action === "atividades_contas_list") {
    const mes = (body as any).mes;
    let q = admin.from("atividades_contas_receber").select("*").eq("escola_id", sessionEscolaId).order("atividade_nome");
    if (mes) q = q.eq("mes_apuracao", mes);
    const { data } = await q;
    return ok(data ?? []);
  }
  if (action === "atividades_conta_pagar") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("atividades_contas_receber").update({ status: "pago", data_pagamento: new Date().toISOString().slice(0, 10) }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "atividades_conta_cancelar") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("atividades_contas_receber").update({ status: "cancelado" }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Inscrições em atividades (autenticado) ────────────────────
  // Usa idx_alunos_atividades_partial (mig 273) para varredura O(matches).
  if (action === "inscricoes_atividades_list") {
    const { data } = await admin
      .from("alunos")
      .select("id, nome, email, serie, turma, responsavel_nome, resp_nome, atividades_ids, turmas_selecionadas, almoco_dias, criado_em")
      .eq("escola_id", sessionEscolaId)
      .not("atividades_ids", "is", null)
      .order("nome")
      .limit(2000);
    // Map to expected frontend fields
    const mapped = (data ?? []).map(a => ({
      id: a.id,
      nome_crianca: a.nome,
      email: a.email,
      nome_resp: a.responsavel_nome || a.resp_nome || '',
      serie: a.serie || a.turma || '',
      atividades_ids: a.atividades_ids,
      turmas_selecionadas: a.turmas_selecionadas,
      almoco_dias: a.almoco_dias,
      criado_em: a.criado_em,
    }));
    return ok(mapped);
  }
  if (action === "inscricoes_atividades_delete") {
    const { id } = body as { id: string };
    // Clear atividades from aluno instead of deleting
    const { error } = await admin.from("alunos").update({ atividades_ids: null, turmas_selecionadas: null, almoco_dias: null }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "aluno_update_atividades") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, atividades_ids, turmas_selecionadas, almoco_dias } = body as any;
    if (!id) return err("id obrigatório.");
    const updateData: any = {};
    if (atividades_ids !== undefined) updateData.atividades_ids = atividades_ids;
    if (turmas_selecionadas !== undefined) updateData.turmas_selecionadas = turmas_selecionadas;
    if (almoco_dias !== undefined) updateData.almoco_dias = almoco_dias;
    const { error } = await admin.from("alunos").update(updateData).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── IA: Resumo pedagógico do aluno (Lumi IA pervasiva) ────────
  if (action === "aluno_resumo_ia") {
    const { aluno_email } = body as { aluno_email: string };
    if (!aluno_email || typeof aluno_email !== 'string') return err("aluno_email obrigatório.");

    const iaAtiva = await isFlagOn(admin, 'ia_ativa', sessionEscolaId);
    if (!iaAtiva) return ok({ resumo: null });

    const email = (aluno_email as string).toLowerCase().trim();
    const cacheKey = `aluno_resumo_ia:${sessionEscolaId}:${email}`;
    const cached = cacheGet(cacheKey);
    if (cached) return ok(cached);

    // Get last 30 days chamada IDs (escola-scoped)
    const trinta_dias_atras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: chamadas } = await admin.from("frequencia_chamadas")
      .select("id")
      .eq("escola_id", sessionEscolaId)
      .gte("data", trinta_dias_atras);
    const chamadaIds = (chamadas || []).map((c: any) => c.id);

    // Gather data in parallel
    const [alunoRes, frequenciaRes, notasRes, engajRes] = await Promise.all([
      admin.from("alunos").select("nome, serie, turma").eq("escola_id", sessionEscolaId).ilike("email", email).maybeSingle(),
      chamadaIds.length > 0
        ? admin.from("frequencia_registros").select("status").eq("aluno_email", email).in("chamada_id", chamadaIds)
        : Promise.resolve({ data: [] as { status: string }[] }),
      admin.from("notas_lancamentos").select("valor").eq("aluno_email", email).eq("escola_id", sessionEscolaId).order("lancado_em", { ascending: false }).limit(5),
      admin.from("familia_engagement").select("score_app_usage, trend, detalhes").eq("escola_id", sessionEscolaId).eq("familia_email", email).maybeSingle(),
    ]);

    const aluno = alunoRes.data;
    const registros = frequenciaRes.data || [];
    const notas = notasRes.data || [];
    const engaj = engajRes.data;

    // Attendance counts
    const presencas = registros.filter((r: any) => r.status === 'P').length;
    const faltas = registros.filter((r: any) => ['A', 'F'].includes(r.status)).length;
    const justificados = registros.filter((r: any) => r.status === 'J').length;
    const pctPresenca = chamadaIds.length > 0 ? Math.round((presencas / chamadaIds.length) * 100) : null;

    // Average grade
    const notaVals = (notas as any[]).map(n => Number(n.valor)).filter(v => !isNaN(v));
    const mediaNotas = notaVals.length
      ? (notaVals.reduce((s: number, v: number) => s + v, 0) / notaVals.length).toFixed(1)
      : null;

    // Parent engagement
    const detalhes = ((engaj as any)?.detalhes) || {};
    const sessoesApp = detalhes.sessoes ?? null;

    const dados = {
      faltas,
      presencas,
      justificados,
      total_chamadas: chamadaIds.length,
      pct_presenca: pctPresenca,
      media_notas: mediaNotas,
      ultimo_acesso_pai: null,
      sessoes_pais_30d: sessoesApp,
      alertas: 0,
    };

    const nomeAluno = (aluno as any)?.nome || email;
    const serieInfo = [(aluno as any)?.serie, (aluno as any)?.turma].filter(Boolean).join(' / ') || '?';

    const prompt = `Aluno: ${nomeAluno}
Série/Turma: ${serieInfo}
Frequência (últimos 30 dias): ${presencas} presenças, ${faltas} faltas${justificados > 0 ? `, ${justificados} justificados` : ''} de ${chamadaIds.length} chamadas${pctPresenca !== null ? ` (${pctPresenca}% de presença)` : ''}
Notas recentes (últimas ${notaVals.length}): ${notaVals.length ? notaVals.join(', ') : 'sem registros'}
Média recente: ${mediaNotas ?? 'N/A'}
Engajamento dos pais no app: ${sessoesApp !== null ? `${sessoesApp} sessões nos últimos 30 dias` : 'sem dados'}
Tendência familiar: ${(engaj as any)?.trend ?? 'sem dados'}`;

    const aiRes = await askClaude(prompt, {
      system: `Você é a Lumi, assistente pedagógica da escola. Analise os dados deste aluno e gere um resumo conciso (máx 150 palavras) com: 1) Situação geral (emoji de status), 2) Pontos de atenção, 3) Sugestão de ação para o educador. Seja direto e útil.`,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
      budget: { sb: admin, escolaId: sessionEscolaId },
    });

    if (!aiRes || aiRes.blocked || !aiRes.text) return ok({ resumo: null });

    const result = { resumo: aiRes.text, dados, gerado_em: new Date().toISOString() };
    cacheSet(cacheKey, result, 30 * 60 * 1000);
    return ok(result);
  }

  // ── Professoras (autenticado) ─────────────────────────────────
  if (action === "professoras_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("professoras").select("*").eq("escola_id", gerente.escola_id).order("nome").limit(2000);
    return ok(data ?? []);
  }
  if (action === "professoras_create") {
    const { nome, email, senha, tipo } = body as { nome: string; email: string; senha: string; tipo?: string };
    if (!nome || !email) return err("Nome e e-mail são obrigatórios.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const tiposValidos = ["professora", "professora_assistente", "manutencao"];
    const insertData: Record<string, unknown> = { nome, email, tipo: tiposValidos.includes(tipo ?? "") ? tipo : "professora", escola_id: gerente.escola_id };
    if (senha) {
      if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
      insertData.senha_hash = await hashSenhaProf(senha as string);
    }
    const { error } = await admin.from("professoras").insert(insertData);
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "professoras_reset_senha") {
    const { id, nova_senha } = body as { id: string; nova_senha: string };
    if (!id || !nova_senha) return err("ID e nova senha são obrigatórios.");
    if ((nova_senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(nova_senha as string);
    const { error } = await admin.from("professoras").update({ senha_hash }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "professoras_delete") {
    const { id } = body as { id: string };
    await admin.from("professoras").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Manutenção CRUD (autenticado — gerente) ─────────────────
  // Filtros: { somente_abertas?: bool, limit?: number }
  // Default sem args: últimos 500 chamados (qualquer status). Com somente_abertas=true,
  // bate o índice parcial idx_manutencoes_abertas (mig 273) e responde instantâneo.
  if (action === "manutencao_list") {
    const { somente_abertas, limit } = body as { somente_abertas?: boolean; limit?: number };
    const lim = Math.min(Math.max(parseInt(String(limit || 500)) || 500, 1), 2000);
    let q = admin
      .from("manutencoes")
      .select("id, descricao, localizacao, urgencia, status, equipe_responsavel, foto_url, foto_path, observacao_gerente, data_conclusao, criado_em, atualizado_em, usuario_id, escola_id, pergunta_coordenacao, pergunta_em, pergunta_por, pergunta_resposta, pergunta_respondida_em, usuarios(nome, email)")
      .eq("escola_id", sessionEscolaId)
      .order("criado_em", { ascending: false })
      .limit(lim);
    if (somente_abertas) q = q.not("status", "in", "(concluida,rejeitada)");
    const { data, error } = await q;
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Bucket privado (mig 280): signed URL TTL 1h, com cache in-memory
    // pra evitar regenerar a cada listagem (cache helper, [[n-plus-one]] 2026-05-14)
    const refreshed = await refreshSignedUrls(admin.storage, "manutencoes", data ?? [], "foto_path", "foto_url");
    // Sort by urgencia priority: critica > alta > media > baixa, then by criado_em desc
    const prioridade: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };
    const sorted = refreshed.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const pa = prioridade[a.urgencia as string] ?? 9;
      const pb = prioridade[b.urgencia as string] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.criado_em as string).getTime() - new Date(a.criado_em as string).getTime();
    });
    return ok(sorted);
  }
  if (action === "manutencao_create") {
    const { descricao, localizacao, urgencia, foto_url: fotoUrlBody, usuario_id, base64, mime } = body as Record<string, unknown>;
    if (!descricao || !localizacao || !urgencia) return err("Descrição, localização e urgência são obrigatórios.");
    const urgencias = ["baixa", "media", "alta", "critica"];
    if (!urgencias.includes(urgencia as string)) return err("Urgência inválida. Use: baixa, media, alta, critica.");
    let foto_url: string | null = (fotoUrlBody as string) ?? null;
    let foto_path_value: string | null = null;
    if (base64 && mime) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(mime as string)) return err("Tipo de imagem não permitido.");
      const bytes = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return err("Imagem muito grande (máx. 10MB).");
      const ext = (mime as string).split("/")[1];
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await admin.storage.createBucket("manutencoes", { public: false }).catch(() => {});
      const { error: upErr } = await admin.storage.from("manutencoes").upload(path, bytes, { contentType: mime as string, upsert: false });
      if (upErr) return err("Erro ao enviar foto: " + upErr.message);
      const { data: signed } = await admin.storage.from("manutencoes").createSignedUrl(path, 60 * 60 * 24 * 7);
      foto_url = signed?.signedUrl || null;
      foto_path_value = path;
    }
    const insert: Record<string, unknown> = { descricao, localizacao, urgencia, foto_url, foto_path: foto_path_value, escola_id: sessionEscolaId };
    if (usuario_id) insert.usuario_id = usuario_id;
    else if (gerente?.id) insert.usuario_id = gerente.id;
    const { error } = await admin.from("manutencoes").insert(insert);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "manutencao_update_status") {
    const { id, status, equipe_responsavel, observacao_gerente } = body as Record<string, unknown>;
    if (!id || !status) return err("ID e status são obrigatórios.");
    const statusValidos = ["aprovada", "em_execucao", "concluida", "rejeitada"];
    if (!statusValidos.includes(status as string)) return err("Status inválido. Use: aprovada, em_execucao, concluida, rejeitada.");
    const update: Record<string, unknown> = { status, atualizado_em: new Date().toISOString() };
    if (equipe_responsavel !== undefined) update.equipe_responsavel = equipe_responsavel;
    if (observacao_gerente !== undefined) update.observacao_gerente = observacao_gerente;
    if (status === "concluida") update.data_conclusao = new Date().toISOString().split("T")[0];
    const { error } = await admin.from("manutencoes").update(update).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "manutencao_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("manutencoes").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "manutencao_tirar_duvida") {
    const { id, pergunta } = body as { id: string; pergunta: string };
    if (!id || !pergunta?.trim()) return err("ID e pergunta são obrigatórios.");
    const { data: chamado } = await admin
      .from("manutencoes")
      .select("id, descricao, usuario_id, escola_id")
      .eq("id", id)
      .eq("escola_id", sessionEscolaId)
      .maybeSingle();
    if (!chamado) return err("Chamado não encontrado.", 404);
    const { error } = await admin.from("manutencoes").update({
      pergunta_coordenacao: pergunta.trim(),
      pergunta_em: new Date().toISOString(),
      pergunta_por: gerente?.nome ?? null,
      pergunta_resposta: null,
      pergunta_respondida_em: null,
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    if (chamado.usuario_id) {
      await admin.from("notificacoes").insert({
        portal: "professora",
        destinatario: chamado.usuario_id,
        titulo: "Coordenação tem uma dúvida sobre seu chamado",
        mensagem: `${gerente?.nome || "Coordenação"} pediu esclarecimento: "${pergunta.trim().slice(0, 200)}"`,
        tipo: "info",
        escola_id: sessionEscolaId,
      });
    }
    return ok({ success: true });
  }
  if (action === "manutencao_responder_pergunta") {
    const { id, resposta } = body as { id: string; resposta: string };
    if (!id || !resposta?.trim()) return err("ID e resposta são obrigatórios.");
    const { error } = await admin.from("manutencoes").update({
      pergunta_resposta: resposta.trim(),
      pergunta_respondida_em: new Date().toISOString(),
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Famílias (CRUD) ─────────────────────────────────────
  if (action === "familias_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("familias").select("cpf, nome_responsavel, nome_aluno, email, serie, turno, escola_id, atualizado_em").eq("escola_id", gerente.escola_id).order("nome_aluno").limit(5000);
    return ok(data ?? []);
  }
  if (action === "familias_update") {
    const { cpf, nome_aluno, nome_responsavel, email, serie, turno } = body as {
      cpf: string; nome_aluno?: string; nome_responsavel?: string;
      email?: string; serie?: string | null; turno?: string | null;
    };
    if (!cpf) return err("CPF obrigatório.");
    const updates: Record<string, unknown> = {};
    if (nome_aluno !== undefined) updates.nome_aluno = nome_aluno;
    if (nome_responsavel !== undefined) updates.nome_responsavel = nome_responsavel;
    if (email !== undefined) updates.email = email;
    if (serie !== undefined) updates.serie = serie;
    if (turno !== undefined) updates.turno = turno;
    if (!Object.keys(updates).length) return err("Nenhum campo para atualizar.");
    const { error } = await admin.from("familias").update(updates).eq("cpf", cpf).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "familias_reset_senha") {
    const { email, nova_senha } = body as { email?: string; nova_senha?: string };
    if (!email) return err("E-mail obrigatório.");
    if (!nova_senha || nova_senha.length < 6) return err("Senha deve ter no mínimo 6 caracteres.");
    // Step 1: Try to create user (works if user doesn't exist yet)
    const { data: created } = await admin.auth.admin.createUser({
      email, password: nova_senha, email_confirm: true
    });
    if (created?.user) return ok({ success: true });
    // Step 2: User already exists — get their ID via generateLink
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink", email
    });
    if (linkErr || !linkData?.user?.id) return err("Não foi possível localizar o usuário: " + (linkErr?.message || "user não encontrado"));
    // Step 3: Update password
    const { error: updateErr } = await admin.auth.admin.updateUserById(linkData.user.id, { password: nova_senha });
    if (updateErr) return err("Erro ao alterar senha: " + updateErr.message);
    return ok({ success: true });
  }
  if (action === "familias_delete") {
    const { cpf, email } = body as { cpf?: string; email?: string };
    if (!cpf && !email) return err("CPF ou email obrigatório.");
    if (cpf) {
      await admin.from("familias").delete().eq("cpf", cpf).eq("escola_id", sessionEscolaId);
    } else {
      await admin.from("familias").delete().eq("email", email!).eq("escola_id", sessionEscolaId);
    }
    return ok({ success: true });
  }

  // ── Equipes de manutenção (CRUD) ────────────────────────
  if (action === "manut_equipes_list") {
    const { data } = await admin.from("manut_equipes").select("*").eq("escola_id", sessionEscolaId).eq("ativo", true).order("nome");
    return ok(data ?? []);
  }
  if (action === "manut_equipes_list_all") {
    const { data } = await admin.from("manut_equipes").select("*").eq("escola_id", sessionEscolaId).order("nome");
    return ok(data ?? []);
  }
  if (action === "manut_equipe_save") {
    const { id, nome } = body as { id?: string; nome: string };
    if (!nome) return err("Nome obrigatório.");
    if (id) {
      const { error } = await admin.from("manut_equipes").update({ nome }).eq("id", id).eq("escola_id", sessionEscolaId);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    } else {
      const { error } = await admin.from("manut_equipes").insert({ nome, escola_id: sessionEscolaId });
      if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "Já existe uma equipe com este nome." : sanitizePgError(error)); }
    }
    return ok({ success: true });
  }
  if (action === "manut_equipe_toggle") {
    const { id, ativo } = body as { id: string; ativo: boolean };
    if (!id) return err("ID obrigatório.");
    await admin.from("manut_equipes").update({ ativo }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Categorias de insumos ───────────────────────────────
  if (action === "alm_categorias_list") {
    const { data } = await admin.from("alm_categorias").select("*").eq("escola_id", sessionEscolaId).eq("ativo", true).order("nome");
    return ok(data ?? []);
  }
  if (action === "alm_categorias_list_all") {
    const { data } = await admin.from("alm_categorias").select("*").eq("escola_id", sessionEscolaId).order("nome");
    return ok(data ?? []);
  }
  if (action === "alm_categoria_save") {
    const { id, nome } = body as { id?: string; nome: string };
    if (!nome) return err("Nome obrigatório.");
    if (id) {
      const { error } = await admin.from("alm_categorias").update({ nome }).eq("id", id).eq("escola_id", sessionEscolaId);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    } else {
      const { error } = await admin.from("alm_categorias").insert({ nome, escola_id: sessionEscolaId });
      if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "Já existe uma categoria com este nome." : sanitizePgError(error)); }
    }
    return ok({ success: true });
  }
  if (action === "alm_categoria_toggle") {
    const { id, ativo } = body as { id: string; ativo: boolean };
    if (!id) return err("ID obrigatório.");
    await admin.from("alm_categorias").update({ ativo }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Calendario Escolar ─────────────────────────────────
  if (action === "calendario_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { mes, ano } = body as { mes?: string; ano?: string };
    let query = admin.from("calendario_eventos").select("*").eq("escola_id", gerente.escola_id).order("data_inicio");
    if (mes) {
      const [y, m] = mes.split("-");
      const inicio = `${y}-${m}-01`;
      const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const fim = `${y}-${m}-${lastDay}`;
      query = query.gte("data_inicio", inicio).lte("data_inicio", fim);
    } else if (ano) {
      query = query.gte("data_inicio", `${ano}-01-01`).lte("data_inicio", `${ano}-12-31`);
    }
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "calendario_list_public") {
    // Para pais e professoras (sem auth)
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const [y, m] = mes.split("-");
    const inicio = `${y}-${m}-01`;
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const fim = `${y}-${m}-${lastDay}`;
    const portal = (body as any).portal || "pais";
    let query = admin.from("calendario_eventos").select("*")
      .gte("data_inicio", inicio).lte("data_inicio", fim).order("data_inicio");
    if (portal === "pais") query = query.eq("visivel_pais", true);
    else query = query.eq("visivel_professoras", true);
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "calendario_save") {
    const { id, titulo, descricao, data_inicio, data_fim, tipo, cor, visivel_pais, visivel_professoras } = body as any;
    if (!titulo || !data_inicio) return err("Titulo e data obrigatorios.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const data = { titulo, descricao: descricao || null, data_inicio, data_fim: data_fim || data_inicio, tipo: tipo || "evento", cor: cor || "#C8102E", visivel_pais: visivel_pais ?? true, visivel_professoras: visivel_professoras ?? true, criado_por: gerente?.nome, escola_id: gerente.escola_id };
    if (id) {
      await admin.from("calendario_eventos").update(data).eq("id", id).eq("escola_id", gerente.escola_id);
    } else {
      await admin.from("calendario_eventos").insert(data);
    }
    return ok({ success: true });
  }
  if (action === "calendario_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("calendario_eventos").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Dashboard Resumo (KPIs + Action Items para a home do gerente) ───────
  if (action === "dashboard_resumo_gerente") {
    const hoje = new Date();
    const hojeISO = hoje.toISOString().split("T")[0];
    const mesAtual = hojeISO.slice(0, 7);
    const anoMes = (d: Date) => d.toISOString().slice(0, 7);
    const mesAnterior = (() => { const d = new Date(hoje); d.setMonth(d.getMonth() - 1); return anoMes(d); })();
    const proxima7 = (() => { const d = new Date(hoje); d.setDate(d.getDate() + 7); return d.toISOString().split("T")[0]; })();

    const primeiroDiaMes = mesAtual + "-01";
    const [
      alunosRes, freqRes, mensRes, mensAntRes, lancRes, lancAntRes,
      manutRes, almRes, leadsRes, evRes, alunosBdayRes,
      freqMesRes,
    ] = await Promise.all([
      admin.from("alunos").select("id", { count: "exact", head: true }).eq("escola_id", sessionEscolaId).eq("ativo", true),
      admin.from("frequencia").select("presente").eq("escola_id", sessionEscolaId).eq("data", hojeISO),
      admin.from("fin_mensalidades").select("status, valor_total, familia_nome, vencimento").eq("escola_id", sessionEscolaId).eq("mes", mesAtual),
      admin.from("fin_mensalidades").select("status, valor_total").eq("escola_id", sessionEscolaId).eq("mes", mesAnterior),
      admin.from("fin_lancamentos").select("tipo, valor, status, data_lancamento, data_vencimento, descricao, fornecedor").eq("escola_id", sessionEscolaId).gte("data_lancamento", mesAtual + "-01").lte("data_lancamento", mesAtual + "-31"),
      admin.from("fin_lancamentos").select("tipo, valor, status").eq("escola_id", sessionEscolaId).gte("data_lancamento", mesAnterior + "-01").lte("data_lancamento", mesAnterior + "-31"),
      admin.from("manutencoes").select("id, status, urgencia").eq("escola_id", sessionEscolaId).in("status", ["pendente", "aprovada", "em_execucao"]),
      admin.from("alm_requisicoes").select("id, status, total").eq("escola_id", sessionEscolaId).eq("status", "pendente"),
      admin.from("crm_leads").select("id, atualizado_em").eq("escola_id", sessionEscolaId),
      admin.from("calendario_eventos").select("titulo, data_inicio, tipo, cor").eq("escola_id", sessionEscolaId).gte("data_inicio", hojeISO).lte("data_inicio", proxima7).order("data_inicio").limit(6),
      admin.from("alunos").select("nome, data_nascimento, serie").eq("escola_id", sessionEscolaId).eq("ativo", true).not("data_nascimento", "is", null),
      // Monthly frequency for alunos with < 75% attendance
      admin.from("frequencia").select("aluno_id, aluno_nome, presente").eq("escola_id", sessionEscolaId).gte("data", primeiroDiaMes).lte("data", hojeISO).limit(5000),
    ]);

    const totalAlunos = alunosRes.count || 0;
    const freq = freqRes.data || [];
    const presentes = freq.filter((f: any) => f.presente).length;
    const ausentes = freq.filter((f: any) => !f.presente).length;
    const presencaPct = freq.length > 0 ? Math.round((presentes / freq.length) * 100) : null;

    const mens = mensRes.data || [];
    const mensAnt = mensAntRes.data || [];
    let mensPago = 0, mensPendente = 0, mensAtrasado = 0, mensTotal = 0;
    let qtdPago = 0, qtdPendente = 0, qtdAtrasado = 0;
    const devedores = new Map<string, { nome: string; total: number; qtd: number }>();
    for (const m of mens as any[]) {
      mensTotal += Number(m.valor_total || 0);
      if (m.status === "pago") { mensPago += Number(m.valor_total || 0); qtdPago++; }
      else if (m.status === "atrasado" || (m.status === "pendente" && m.vencimento && m.vencimento < hojeISO)) {
        mensAtrasado += Number(m.valor_total || 0); qtdAtrasado++;
        const key = m.familia_nome || "—";
        const cur = devedores.get(key) || { nome: key, total: 0, qtd: 0 };
        cur.total += Number(m.valor_total || 0); cur.qtd += 1; devedores.set(key, cur);
      }
      else if (m.status === "pendente") { mensPendente += Number(m.valor_total || 0); qtdPendente++; }
    }
    let mensPagoAnt = 0, mensTotalAnt = 0;
    for (const m of mensAnt as any[]) {
      mensTotalAnt += Number(m.valor_total || 0);
      if (m.status === "pago") mensPagoAnt += Number(m.valor_total || 0);
    }
    const topDevedores = Array.from(devedores.values()).sort((a, b) => b.total - a.total).slice(0, 5);

    const lancs = (lancRes.data || []) as any[];
    let receitaMes = 0, despesaMes = 0, contasReceber = 0, contasPagar = 0;
    const proxVenc: any[] = [];
    for (const l of lancs) {
      const v = Number(l.valor || 0);
      if (l.tipo === "receita") {
        if (l.status === "pago") receitaMes += v;
        else contasReceber += v;
      } else {
        if (l.status === "pago") despesaMes += v;
        else contasPagar += v;
      }
      if (l.status !== "pago" && l.data_vencimento && l.data_vencimento >= hojeISO && l.data_vencimento <= proxima7) {
        proxVenc.push({ descricao: l.descricao, fornecedor: l.fornecedor, valor: v, vencimento: l.data_vencimento, tipo: l.tipo });
      }
    }
    const lancsAnt = (lancAntRes.data || []) as any[];
    let receitaAnt = 0, despesaAnt = 0;
    for (const l of lancsAnt) {
      const v = Number(l.valor || 0);
      if (l.tipo === "receita" && l.status === "pago") receitaAnt += v;
      else if (l.tipo === "despesa" && l.status === "pago") despesaAnt += v;
    }
    proxVenc.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

    const manuts = (manutRes.data || []) as any[];
    const manutPendentes = manuts.filter((m) => m.status === "pendente").length;
    const manutEmExec = manuts.filter((m) => m.status === "em_execucao" || m.status === "aprovada").length;
    const manutUrgentes = manuts.filter((m) => (m.urgencia === "alta" || m.urgencia === "urgente") && m.status !== "concluida").length;

    const almReqs = (almRes.data || []) as any[];
    const almPendQtd = almReqs.length;
    const almPendValor = almReqs.reduce((s, r) => s + Number(r.total || 0), 0);

    const leads = (leadsRes.data || []) as any[];
    const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
    const leadsParados = leads.filter((l) => l.atualizado_em && new Date(l.atualizado_em) < seteDiasAtras).length;
    const leadsTotal = leads.length;

    // Aniversariantes próximos 7 dias
    const bdayList = (alunosBdayRes.data || []) as any[];
    const aniversariantes: any[] = [];
    for (const a of bdayList) {
      if (!a.data_nascimento) continue;
      const dn = new Date(a.data_nascimento + "T12:00:00");
      const proxAniv = new Date(hoje.getFullYear(), dn.getMonth(), dn.getDate());
      if (proxAniv < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) {
        proxAniv.setFullYear(hoje.getFullYear() + 1);
      }
      const diff = Math.round((proxAniv.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) / 86400000);
      if (diff >= 0 && diff <= 7) {
        const idade = proxAniv.getFullYear() - dn.getFullYear();
        aniversariantes.push({ nome: a.nome, serie: a.serie, dia: proxAniv.toISOString().split("T")[0], dias_falta: diff, idade });
      }
    }
    aniversariantes.sort((a, b) => a.dias_falta - b.dias_falta);

    // Alunos com frequência < 75% no mês
    const freqMesPorAluno = new Map<string, { nome: string; total: number; presentes: number }>();
    for (const r of (freqMesRes.data || []) as any[]) {
      const cur = freqMesPorAluno.get(r.aluno_id) || { nome: r.aluno_nome || "?", total: 0, presentes: 0 };
      cur.total += 1;
      if (r.presente) cur.presentes += 1;
      freqMesPorAluno.set(r.aluno_id, cur);
    }
    const freqCriticos = [...freqMesPorAluno.values()]
      .map(a => ({ nome: a.nome, pct: a.total > 0 ? Math.round((a.presentes / a.total) * 100) : 0, total: a.total, presentes: a.presentes }))
      .filter(a => a.pct < 75 && a.total >= 3)
      .sort((a, b) => a.pct - b.pct);

    // Inadimplência do mês (%)
    const totalMensalidades = qtdPago + qtdPendente + qtdAtrasado;
    const inadimplenciaPct = totalMensalidades > 0 ? Math.round((qtdAtrasado / totalMensalidades) * 100) : 0;

    const totalPendencias = manutPendentes + almPendQtd + qtdAtrasado + leadsParados;

    return ok({
      data: hojeISO,
      mes: mesAtual,
      alunos: { ativos: totalAlunos, presentes_hoje: presentes, ausentes_hoje: ausentes, presenca_pct: presencaPct, freq_registrada: freq.length },
      financeiro: {
        receita_mes: receitaMes,
        despesa_mes: despesaMes,
        receita_mes_anterior: receitaAnt,
        despesa_mes_anterior: despesaAnt,
        contas_receber: contasReceber,
        contas_pagar: contasPagar,
        mens_pago: mensPago,
        mens_pendente: mensPendente,
        mens_atrasado: mensAtrasado,
        mens_total: mensTotal,
        mens_pago_anterior: mensPagoAnt,
        mens_total_anterior: mensTotalAnt,
        qtd_atrasado: qtdAtrasado,
        qtd_pendente: qtdPendente,
        qtd_pago: qtdPago,
      },
      pendencias: {
        manutencao_pendente: manutPendentes,
        manutencao_em_execucao: manutEmExec,
        manutencao_urgentes: manutUrgentes,
        almox_pendente_qtd: almPendQtd,
        almox_pendente_valor: almPendValor,
        leads_parados: leadsParados,
        leads_total: leadsTotal,
        mensalidades_atrasadas: qtdAtrasado,
        total: totalPendencias,
      },
      top_devedores: topDevedores,
      proximos_vencimentos: proxVenc.slice(0, 6),
      aniversariantes: aniversariantes.slice(0, 8),
      eventos_proximos: evRes.data || [],
      // Morning Briefing extras
      inadimplencia_pct: inadimplenciaPct,
      freq_critica: { total: freqCriticos.length, alunos: freqCriticos.slice(0, 8) },
      proximos_vencimentos_count: proxVenc.length,
    });
  }


  return null
}
