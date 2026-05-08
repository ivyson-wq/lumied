// ═══════════════════════════════════════════════════════════════
//  Edge Function: ponto (v2 — Router Pattern)
//  Parser AFD (Portaria 671), cálculo de horas, espelho de ponto
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature, successResponse, AppError } from "../_shared/mod.ts";

const router = new Router("ponto");
router.useGlobal(rateLimit());
const feat = requireFeature("rh");

// ═══════════════════════════════════════════════════════
//  AFD PARSER (Portaria MTP 671/2021)
// ═══════════════════════════════════════════════════════

interface AfdHeader { nsr: number; periodStart: string; periodEnd: string; employerType: string; cnpj: string; companyName: string; }
interface AfdEvent { nsr: number; date: string; time: string; pis: string; }
interface AfdEmployee { nsr: number; date: string; pis: string; name: string; role: string; }
interface AfdTrailer { lastNsr: number; totalEvents: number; totalEmployees: number; }
interface ParsedAfd { header: AfdHeader | null; events: AfdEvent[]; employees: AfdEmployee[]; trailer: AfdTrailer | null; isValid: boolean; errors: string[]; }

function parseAfdDate(ddmmaaaa: string): string {
  const d = ddmmaaaa.substring(0, 2), m = ddmmaaaa.substring(2, 4), y = ddmmaaaa.substring(4, 8);
  return `${y}-${m}-${d}`;
}

function parseAfd(content: string): ParsedAfd {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  let header: AfdHeader | null = null;
  const events: AfdEvent[] = [];
  const employees: AfdEmployee[] = [];
  let trailer: AfdTrailer | null = null;
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const type = line[0];
    try {
      if (type === "1") {
        header = {
          nsr: parseInt(line.substring(1, 10)),
          periodStart: parseAfdDate(line.substring(10, 18)),
          periodEnd: parseAfdDate(line.substring(18, 26)),
          employerType: line[26],
          cnpj: line.substring(27, 41).trim(),
          companyName: line.substring(41, 191).trim(),
        };
      } else if (type === "3") {
        const pis = line.substring(24, 36).trim().padStart(12, "0");
        const timeStr = line.substring(18, 24);
        events.push({
          nsr: parseInt(line.substring(1, 10)),
          date: parseAfdDate(line.substring(10, 18)),
          time: `${timeStr.substring(0, 2)}:${timeStr.substring(2, 4)}:${timeStr.substring(4, 6)}`,
          pis,
        });
      } else if (type === "5") {
        employees.push({
          nsr: parseInt(line.substring(1, 10)),
          date: parseAfdDate(line.substring(10, 18)),
          pis: line.substring(18, 30).trim().padStart(12, "0"),
          name: line.substring(30, 82).trim(),
          role: line.substring(82, 86).trim(),
        });
      } else if (type === "9") {
        trailer = {
          lastNsr: parseInt(line.substring(1, 10)),
          totalEvents: parseInt(line.substring(10, 19)),
          totalEmployees: parseInt(line.substring(19, 28)),
        };
      }
    } catch (e) {
      errors.push(`Linha ${i + 1}: ${(e as Error).message}`);
    }
  }

  if (!header) errors.push("Header (tipo 1) não encontrado");
  if (!trailer) errors.push("Trailer (tipo 9) não encontrado");
  if (trailer && trailer.totalEvents !== events.length) {
    errors.push(`Trailer indica ${trailer.totalEvents} eventos, encontrados ${events.length}`);
  }

  return { header, events, employees, trailer, isValid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════
//  CALCULATOR — Horas trabalhadas por dia
// ═══════════════════════════════════════════════════════

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

interface DaySummary {
  pis: string; date: string; events: string[];
  firstEvent: string | null; lastEvent: string | null;
  workedMinutes: number | null; hasOddEvents: boolean;
}

function calculateDay(events: AfdEvent[]): DaySummary {
  const sorted = [...events].sort((a, b) => a.time.localeCompare(b.time));
  const hasOdd = sorted.length % 2 !== 0;
  let worked = 0;
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    worked += timeToMinutes(sorted[i + 1].time) - timeToMinutes(sorted[i].time);
  }
  return {
    pis: sorted[0]?.pis ?? "",
    date: sorted[0]?.date ?? "",
    events: sorted.map(e => e.time),
    firstEvent: sorted[0]?.time ?? null,
    lastEvent: sorted[sorted.length - 1]?.time ?? null,
    workedMinutes: sorted.length >= 2 ? worked : null,
    hasOddEvents: hasOdd,
  };
}

// ═══════════════════════════════════════════════════════
//  ROUTES — Employees
// ═══════════════════════════════════════════════════════

router.on("ponto_employees_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("ponto_employees").select("*, rh_funcionarios(nome, cargo)").eq("escola_id", ctx.escola_id).eq("ativo", true).order("nome");
  return successResponse(data ?? []);
});

router.on("ponto_employee_create", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { nome, pis, cargo, departamento, rh_funcionario_id, work_schedule, daily_hours } = ctx.body as any;
  if (!nome || !pis) throw new AppError("VALIDATION_FAILED", "nome e pis obrigatórios.");
  const { data, error } = await ctx.sb.from("ponto_employees").insert({
    escola_id: ctx.escola_id, nome, pis: pis.padStart(12, "0"), cargo, departamento, rh_funcionario_id, work_schedule, daily_hours,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("ponto_employee_update", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("ponto_employees").update(fields).eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════
//  ROUTES — Upload e Parse AFD
// ═══════════════════════════════════════════════════════

router.on("ponto_afd_upload", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { conteudo_afd, nome_arquivo } = ctx.body as any;
  if (!conteudo_afd) throw new AppError("VALIDATION_FAILED", "conteudo_afd obrigatório (texto do arquivo AFD).");

  const parsed = parseAfd(conteudo_afd);

  // 1. Criar registro de importação
  const { data: importRec, error: impErr } = await ctx.sb.from("afd_imports").insert({
    escola_id: ctx.escola_id,
    importado_por: ctx.user?.nome ?? "sistema",
    nome_arquivo: nome_arquivo || "afd_upload.txt",
    periodo_inicio: parsed.header?.periodStart,
    periodo_fim: parsed.header?.periodEnd,
    cnpj_empregador: parsed.header?.cnpj,
    razao_social: parsed.header?.companyName,
    total_eventos: parsed.events.length,
    total_funcionarios: parsed.employees.length,
    status: parsed.isValid ? "processando" : "erro",
    erro_detalhes: parsed.errors.length > 0 ? parsed.errors.join("; ") : null,
  }).select().single();
  if (impErr) throw new AppError("BAD_REQUEST", impErr.message);

  if (!parsed.isValid) {
    return successResponse({ import_id: importRec.id, status: "erro", errors: parsed.errors });
  }

  // 2. Buscar employees para de-para PIS → employee_id
  const { data: emps } = await ctx.sb.from("ponto_employees").select("id, pis").eq("escola_id", ctx.escola_id).eq("ativo", true);
  const pisMap = new Map((emps ?? []).map((e: any) => [e.pis, e.id]));

  // 3. Inserir eventos em chunks
  let unmatchedPis = 0;
  const eventRows = parsed.events.map(ev => {
    const empId = pisMap.get(ev.pis) ?? null;
    if (!empId) unmatchedPis++;
    return { escola_id: ctx.escola_id, import_id: importRec.id, employee_id: empId, pis: ev.pis, data_evento: ev.date, hora_evento: ev.time, nsr: ev.nsr };
  });

  const chunkSize = 500;
  for (let i = 0; i < eventRows.length; i += chunkSize) {
    await ctx.sb.from("afd_events").insert(eventRows.slice(i, i + chunkSize));
  }

  // 4. Calcular daily_summaries
  const grouped = new Map<string, AfdEvent[]>();
  for (const ev of parsed.events) {
    const key = `${ev.pis}_${ev.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ev);
  }

  const summaryRows: any[] = [];
  for (const [key, dayEvents] of grouped) {
    const [pis] = key.split("_");
    const empId = pisMap.get(pis);
    if (!empId) continue;
    const summary = calculateDay(dayEvents);
    const expectedMinutes = 480; // 8h default
    const worked = summary.workedMinutes ?? 0;
    summaryRows.push({
      escola_id: ctx.escola_id,
      employee_id: empId,
      data_resumo: summary.date,
      total_marcacoes: dayEvents.length,
      primeira_marcacao: summary.firstEvent,
      ultima_marcacao: summary.lastEvent,
      minutos_trabalhados: summary.workedMinutes,
      minutos_esperados: expectedMinutes,
      saldo_minutos: worked - expectedMinutes,
      status: dayEvents.length === 0 ? "ausente" : summary.hasOddEvents ? "impar" : "presente",
      marcacao_impar: summary.hasOddEvents,
      import_id: importRec.id,
    });
  }

  if (summaryRows.length > 0) {
    for (let i = 0; i < summaryRows.length; i += chunkSize) {
      await ctx.sb.from("ponto_daily_summary").upsert(summaryRows.slice(i, i + chunkSize), { onConflict: "employee_id,data_resumo" });
    }
  }

  // 5. Atualizar importação
  await ctx.sb.from("afd_imports").update({
    status: "concluido",
    pis_nao_encontrados: unmatchedPis,
  }).eq("id", importRec.id).eq("escola_id", ctx.escola_id);

  return successResponse({
    import_id: importRec.id,
    total_eventos: parsed.events.length,
    total_funcionarios_afd: parsed.employees.length,
    pis_nao_encontrados: unmatchedPis,
    resumos_gerados: summaryRows.length,
    status: "concluido",
  });
});

// ═══════════════════════════════════════════════════════
//  ROUTES — Importações e Eventos
// ═══════════════════════════════════════════════════════

router.on("ponto_imports_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("afd_imports").select("*").eq("escola_id", ctx.escola_id).order("criado_em", { ascending: false }).limit(50);
  return successResponse(data ?? []);
});

router.on("ponto_events_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { employee_id, data_inicio, data_fim, import_id } = ctx.body as any;
  let q = ctx.sb.from("afd_events").select("*, ponto_employees(nome)").eq("escola_id", ctx.escola_id).order("data_evento").order("hora_evento");
  if (employee_id) q = q.eq("employee_id", employee_id);
  if (data_inicio) q = q.gte("data_evento", data_inicio);
  if (data_fim) q = q.lte("data_evento", data_fim);
  if (import_id) q = q.eq("import_id", import_id);
  const { data } = await q.limit(2000);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════
//  ROUTES — Resumo Diário e Espelho de Ponto
// ═══════════════════════════════════════════════════════

router.on("ponto_summary_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { employee_id, data_inicio, data_fim, status } = ctx.body as any;
  let q = ctx.sb.from("ponto_daily_summary").select("*, ponto_employees(nome, pis, cargo)").eq("escola_id", ctx.escola_id).order("data_resumo", { ascending: false });
  if (employee_id) q = q.eq("employee_id", employee_id);
  if (data_inicio) q = q.gte("data_resumo", data_inicio);
  if (data_fim) q = q.lte("data_resumo", data_fim);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(500);
  return successResponse(data ?? []);
});

router.on("ponto_mirror", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { employee_id, mes, ano } = ctx.body as any;
  if (!employee_id || !mes || !ano) throw new AppError("VALIDATION_FAILED", "employee_id, mes e ano obrigatórios.");

  const dataInicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const dataFim = `${ano}-${String(mes).padStart(2, "0")}-${lastDay}`;

  // Dados do funcionário
  const { data: emp } = await ctx.sb.from("ponto_employees").select("*").eq("id", employee_id).eq("escola_id", ctx.escola_id).single();
  if (!emp) throw new AppError("NOT_FOUND", "Funcionário não encontrado.");

  // Resumos do mês
  const { data: summaries } = await ctx.sb.from("ponto_daily_summary")
    .select("*")
    .eq("employee_id", employee_id)
    .gte("data_resumo", dataInicio)
    .lte("data_resumo", dataFim)
    .order("data_resumo");

  // Eventos detalhados do mês
  const { data: events } = await ctx.sb.from("afd_events")
    .select("data_evento, hora_evento")
    .eq("employee_id", employee_id)
    .gte("data_evento", dataInicio)
    .lte("data_evento", dataFim)
    .order("data_evento")
    .order("hora_evento");

  // Agrupar eventos por dia
  const eventsByDay = new Map<string, string[]>();
  for (const ev of (events ?? [])) {
    const d = ev.data_evento;
    if (!eventsByDay.has(d)) eventsByDay.set(d, []);
    eventsByDay.get(d)!.push(ev.hora_evento);
  }

  // Montar espelho
  const dias: any[] = [];
  let totalTrabalhado = 0;
  let totalExtra = 0;
  let totalFaltas = 0;

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(dateStr + "T12:00:00").getDay();
    const dowNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const isWeekend = dow === 0 || dow === 6;

    const summary = (summaries ?? []).find((s: any) => s.data_resumo === dateStr);
    const dayEvents = eventsByDay.get(dateStr) ?? [];

    const worked = summary?.minutos_trabalhados ?? 0;
    const saldo = summary?.saldo_minutos ?? 0;
    totalTrabalhado += worked;
    if (saldo > 0) totalExtra += saldo;
    if (!isWeekend && !summary && dayEvents.length === 0) totalFaltas++;

    dias.push({
      data: dateStr,
      dia_semana: dowNames[dow],
      fim_de_semana: isWeekend,
      marcacoes: dayEvents,
      minutos_trabalhados: worked,
      minutos_trabalhados_fmt: worked ? formatMinutes(worked) : "—",
      saldo_minutos: saldo,
      saldo_fmt: summary ? formatMinutes(saldo) : "—",
      status: summary?.status ?? (isWeekend ? "fim_de_semana" : "ausente"),
      marcacao_impar: summary?.marcacao_impar ?? false,
    });
  }

  return successResponse({
    funcionario: { nome: emp.nome, pis: emp.pis, cargo: emp.cargo, carga_horaria: emp.daily_hours },
    mes, ano,
    dias,
    totais: {
      total_trabalhado_minutos: totalTrabalhado,
      total_trabalhado_fmt: formatMinutes(totalTrabalhado),
      total_extra_minutos: totalExtra,
      total_extra_fmt: formatMinutes(totalExtra),
      total_faltas: totalFaltas,
      saldo_banco_horas: totalTrabalhado - (totalFaltas === 0 ? (summaries ?? []).reduce((acc: number, s: any) => acc + (s.minutos_esperados ?? 0), 0) : 0),
    },
  });
});

// ═══════════════════════════════════════════════════════
//  ROUTES — Justificativas
// ═══════════════════════════════════════════════════════

router.on("ponto_justificativa_criar", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { employee_id, summary_id, data_justificativa, motivo, descricao } = ctx.body as any;
  if (!employee_id || !data_justificativa || !motivo) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("ponto_justificativas").insert({
    escola_id: ctx.escola_id, employee_id, summary_id, data_justificativa, motivo, descricao,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("ponto_justificativa_aprovar", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, status } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const novoStatus = status === "rejeitado" ? "rejeitado" : "aprovado";
  const { error } = await ctx.sb.from("ponto_justificativas").update({
    status: novoStatus, aprovado_por: ctx.user?.nome, aprovado_em: new Date().toISOString(),
  }).eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  // Se aprovado, atualizar summary para justificado
  if (novoStatus === "aprovado") {
    const { data: just } = await ctx.sb.from("ponto_justificativas").select("employee_id, data_justificativa").eq("id", id).eq("escola_id", ctx.escola_id).single();
    if (just) {
      await ctx.sb.from("ponto_daily_summary").update({ status: "justificado" }).eq("employee_id", just.employee_id).eq("data_resumo", just.data_justificativa).eq("escola_id", ctx.escola_id);
    }
  }
  return successResponse({ success: true });
});

router.on("ponto_justificativas_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { employee_id, status } = ctx.body as any;
  let q = ctx.sb.from("ponto_justificativas").select("*, ponto_employees(nome)").eq("escola_id", ctx.escola_id).order("criado_em", { ascending: false });
  if (employee_id) q = q.eq("employee_id", employee_id);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════
//  ROUTES — Dashboard
// ═══════════════════════════════════════════════════════

router.on("ponto_dashboard", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { mes, ano } = ctx.body as any;
  const m = mes || new Date().getMonth() + 1;
  const a = ano || new Date().getFullYear();
  const dataInicio = `${a}-${String(m).padStart(2, "0")}-01`;
  const dataFim = `${a}-${String(m).padStart(2, "0")}-31`;

  const [totalEmps, totalImports, summaries] = await Promise.all([
    ctx.sb.from("ponto_employees").select("*", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true),
    ctx.sb.from("afd_imports").select("*", { count: "exact", head: true }).eq("escola_id", ctx.escola_id),
    ctx.sb.from("ponto_daily_summary").select("status, marcacao_impar, saldo_minutos").eq("escola_id", ctx.escola_id).gte("data_resumo", dataInicio).lte("data_resumo", dataFim),
  ]);

  const stats = { presentes: 0, ausentes: 0, impares: 0, extras: 0, debitos: 0 };
  for (const s of (summaries.data ?? []) as any[]) {
    if (s.status === "presente") stats.presentes++;
    if (s.status === "ausente") stats.ausentes++;
    if (s.marcacao_impar) stats.impares++;
    if (s.saldo_minutos > 0) stats.extras++;
    if (s.saldo_minutos < 0) stats.debitos++;
  }

  return successResponse({
    total_funcionarios: totalEmps.count ?? 0,
    total_importacoes: totalImports.count ?? 0,
    mes: m, ano: a, ...stats,
  });
});

// ═══════════════════════════════════════════════════════
//  REP DEVICES — coleta automática via Lumied Bridge
//  Cadastra REP físico (Control iD/Henry/etc), enfileira
//  comando afd_pull no daemon e processa o AFD retornado.
// ═══════════════════════════════════════════════════════

interface BridgeResult { ok: boolean; status: number; error?: string; body?: any; }

async function bridgeDispatchEphemeral(
  escolaId: string,
  tipo: string,
  payload: any,
  waitMs = 25000,
): Promise<BridgeResult> {
  const gatewayUrl = Deno.env.get("BRIDGE_GATEWAY_URL");
  const gatewaySecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
  if (!gatewayUrl || !gatewaySecret) {
    return { ok: false, status: 500, error: "Bridge gateway não configurado (BRIDGE_GATEWAY_URL/SECRET)." };
  }
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/dispatch/${escolaId}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${gatewaySecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ req_id: crypto.randomUUID(), wait_ms: waitMs, tipo, payload }),
      signal: AbortSignal.timeout(waitMs + 5000),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Gateway inalcançável: ${String(e)}` };
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 503) return { ok: false, status: 503, error: "Lumied Bridge offline. Verifique se o daemon está rodando na escola." };
  if (data?.timeout) return { ok: false, status: 504, error: "Timeout aguardando resposta do Bridge." };
  return { ok: !!data?.ok, status: data?.ok ? 200 : 502, error: data?.error, body: data?.payload ?? data };
}

function ddmmaaaa(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${dd}${mm}${yy}`;
}

interface RepConfig {
  ip: string;
  porta: number;
  protocolo: "http" | "https";
  auth_modo: "controlid_session" | "form_login" | "basic" | "none";
  usuario?: string;
  senha?: string;
  url_login?: string;
  url_afd_template: string;
}

/** Processa o conteúdo AFD vindo do daemon — gera afd_imports + afd_events + ponto_daily_summary. */
async function processAfdContent(
  ctx: any,
  conteudo: string,
  nomeArquivo: string,
  origem: "manual" | "bridge_auto",
  repDeviceId?: string | null,
): Promise<{ import_id: string; total_eventos: number; resumos_gerados: number; pis_nao_encontrados: number; status: string; errors?: string[] }> {
  const parsed = parseAfd(conteudo);
  const { data: importRec, error: impErr } = await ctx.sb.from("afd_imports").insert({
    escola_id: ctx.escola_id,
    importado_por: origem === "bridge_auto" ? "lumied_bridge" : (ctx.user?.nome ?? "sistema"),
    nome_arquivo: nomeArquivo,
    periodo_inicio: parsed.header?.periodStart,
    periodo_fim: parsed.header?.periodEnd,
    cnpj_empregador: parsed.header?.cnpj,
    razao_social: parsed.header?.companyName,
    total_eventos: parsed.events.length,
    total_funcionarios: parsed.employees.length,
    status: parsed.isValid ? "processando" : "erro",
    erro_detalhes: parsed.errors.length > 0 ? parsed.errors.join("; ") : null,
    origem,
    rep_device_id: repDeviceId ?? null,
  }).select().single();
  if (impErr) throw new AppError("BAD_REQUEST", impErr.message);
  if (!parsed.isValid) {
    return { import_id: importRec.id, total_eventos: 0, resumos_gerados: 0, pis_nao_encontrados: 0, status: "erro", errors: parsed.errors };
  }

  const { data: emps } = await ctx.sb.from("ponto_employees").select("id, pis").eq("escola_id", ctx.escola_id).eq("ativo", true);
  const pisMap = new Map((emps ?? []).map((e: any) => [e.pis, e.id]));

  let unmatchedPis = 0;
  const eventRows = parsed.events.map(ev => {
    const empId = pisMap.get(ev.pis) ?? null;
    if (!empId) unmatchedPis++;
    return { escola_id: ctx.escola_id, import_id: importRec.id, employee_id: empId, pis: ev.pis, data_evento: ev.date, hora_evento: ev.time, nsr: ev.nsr };
  });

  const chunkSize = 500;
  for (let i = 0; i < eventRows.length; i += chunkSize) {
    await ctx.sb.from("afd_events").insert(eventRows.slice(i, i + chunkSize));
  }

  const grouped = new Map<string, AfdEvent[]>();
  for (const ev of parsed.events) {
    const key = `${ev.pis}_${ev.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ev);
  }
  const summaryRows: any[] = [];
  for (const [key, dayEvents] of grouped) {
    const [pis] = key.split("_");
    const empId = pisMap.get(pis);
    if (!empId) continue;
    const summary = calculateDay(dayEvents);
    const expectedMinutes = 480;
    const worked = summary.workedMinutes ?? 0;
    summaryRows.push({
      escola_id: ctx.escola_id,
      employee_id: empId,
      data_resumo: summary.date,
      total_marcacoes: dayEvents.length,
      primeira_marcacao: summary.firstEvent,
      ultima_marcacao: summary.lastEvent,
      minutos_trabalhados: summary.workedMinutes,
      minutos_esperados: expectedMinutes,
      saldo_minutos: worked - expectedMinutes,
      status: dayEvents.length === 0 ? "ausente" : summary.hasOddEvents ? "impar" : "presente",
      marcacao_impar: summary.hasOddEvents,
      import_id: importRec.id,
    });
  }
  if (summaryRows.length > 0) {
    for (let i = 0; i < summaryRows.length; i += chunkSize) {
      await ctx.sb.from("ponto_daily_summary").upsert(summaryRows.slice(i, i + chunkSize), { onConflict: "employee_id,data_resumo" });
    }
  }
  await ctx.sb.from("afd_imports").update({ status: "concluido", pis_nao_encontrados: unmatchedPis }).eq("id", importRec.id).eq("escola_id", ctx.escola_id);

  return { import_id: importRec.id, total_eventos: parsed.events.length, resumos_gerados: summaryRows.length, pis_nao_encontrados: unmatchedPis, status: "concluido" };
}

/** Faz dispatch afd_pull pro daemon e processa retorno. NÃO grava log de status (caller decide). */
async function pullAfdViaBridge(
  ctx: any,
  rep: RepConfig & { id?: string; nome?: string },
  dataIni: Date,
  dataFim: Date,
  persistImport = true,
): Promise<{ status: string; eventos?: number; erro?: string; import_id?: string; pis_nao_encontrados?: number }> {
  const dispatchResult = await bridgeDispatchEphemeral(ctx.escola_id, "afd_pull", {
    ip: rep.ip,
    porta: rep.porta,
    protocolo: rep.protocolo,
    auth_modo: rep.auth_modo,
    usuario: rep.usuario,
    senha: rep.senha,
    url_login: rep.url_login,
    url_afd_template: rep.url_afd_template,
    dataini: ddmmaaaa(dataIni),
    datafim: ddmmaaaa(dataFim),
  }, 30000);

  if (!dispatchResult.ok) {
    const msg = dispatchResult.error || "Falha ao falar com o Bridge.";
    if (msg.includes("offline")) return { status: "bridge_offline", erro: msg };
    return { status: "erro_bridge", erro: msg };
  }
  const body = dispatchResult.body || {};
  if (!body.ok && body.error) {
    if (String(body.error).match(/login|401|403|sess/i)) return { status: "erro_login", erro: body.error };
    return { status: "erro_download", erro: body.error };
  }
  const conteudo = body.afd_content || body.payload?.afd_content;
  if (!conteudo || typeof conteudo !== "string") return { status: "erro_download", erro: "Bridge retornou sem conteúdo AFD." };
  const lines = conteudo.split(/\r?\n/).filter((l: string) => l.trim());
  if (lines.length < 3) return { status: "sem_dados", eventos: 0 };
  if (!persistImport) {
    // Modo teste: só valida o parse
    const parsed = parseAfd(conteudo);
    return { status: parsed.isValid ? "ok" : "erro_parse", eventos: parsed.events.length, erro: parsed.errors[0] };
  }
  try {
    const result = await processAfdContent(
      ctx,
      conteudo,
      `bridge_${rep.id ?? "test"}_${ddmmaaaa(dataIni)}_${ddmmaaaa(dataFim)}.txt`,
      "bridge_auto",
      rep.id ?? null,
    );
    return {
      status: result.status === "concluido" ? "ok" : "erro_parse",
      eventos: result.total_eventos,
      pis_nao_encontrados: result.pis_nao_encontrados,
      import_id: result.import_id,
    };
  } catch (e: any) {
    return { status: "erro_parse", erro: e?.message || String(e) };
  }
}

router.on("ponto_rep_devices_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("ponto_rep_devices")
    .select("id, nome, marca, modelo, ip, porta, protocolo, auth_modo, usuario, url_login, url_afd_template, ativo, ultimo_pull_em, ultimo_pull_status, ultimo_pull_erro, ultimo_pull_eventos, criado_em")
    .eq("escola_id", ctx.escola_id).order("criado_em", { ascending: false });
  return successResponse(data ?? []);
});

router.on("ponto_rep_devices_create", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const b = ctx.body as any;
  if (!b.nome || !b.ip || !b.url_afd_template) throw new AppError("VALIDATION_FAILED", "nome, ip e url_afd_template obrigatórios.");
  const { data, error } = await ctx.sb.from("ponto_rep_devices").insert({
    escola_id: ctx.escola_id,
    nome: b.nome, marca: b.marca || "controlid", modelo: b.modelo,
    ip: b.ip, porta: b.porta || 80, protocolo: b.protocolo || "http",
    auth_modo: b.auth_modo || "controlid_session",
    usuario: b.usuario, senha: b.senha,
    url_login: b.url_login, url_afd_template: b.url_afd_template,
    ativo: true,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("ponto_rep_devices_update", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  // Se senha vazio = mantém atual
  if (fields.senha === "" || fields.senha == null) delete fields.senha;
  const { error } = await ctx.sb.from("ponto_rep_devices").update(fields).eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("ponto_rep_devices_delete", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("ponto_rep_devices").delete().eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("ponto_rep_devices_test", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const b = ctx.body as any;
  if (!b.ip || !b.url_afd_template) throw new AppError("VALIDATION_FAILED", "ip e url_afd_template obrigatórios.");
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const result = await pullAfdViaBridge(ctx, {
    ip: b.ip, porta: b.porta || 80, protocolo: b.protocolo || "http",
    auth_modo: b.auth_modo || "controlid_session",
    usuario: b.usuario, senha: b.senha,
    url_login: b.url_login, url_afd_template: b.url_afd_template,
  }, ontem, ontem, false);
  return successResponse(result);
});

router.on("ponto_rep_devices_pull_now", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { data: rep } = await ctx.sb.from("ponto_rep_devices").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
  if (!rep) throw new AppError("NOT_FOUND", "REP não encontrado.");
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const result = await pullAfdViaBridge(ctx, rep as any, ontem, ontem, true);
  await ctx.sb.from("ponto_rep_devices").update({
    ultimo_pull_em: new Date().toISOString(),
    ultimo_pull_status: result.status,
    ultimo_pull_erro: result.erro || null,
    ultimo_pull_eventos: result.eventos ?? null,
  }).eq("id", id).eq("escola_id", ctx.escola_id);
  return successResponse(result);
});

// ── Cron diário às 03:30 BRT (06:30 UTC) — chama com Bearer cron_internal_key ──
router.on("ponto_pull_afd_diario_cron", async (ctx) => {
  const expected = Deno.env.get("CRON_INTERNAL_KEY");
  const auth = ctx.req?.headers.get("authorization") || "";
  if (!expected || auth !== `Bearer ${expected}`) {
    throw new AppError("AUTH_INVALID", "Cron sem autenticação interna válida.");
  }
  // Lista todos REPs ativos (cross-tenant — service-role)
  const { data: reps } = await ctx.sb.from("ponto_rep_devices").select("*").eq("ativo", true);
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const results: any[] = [];
  for (const rep of (reps ?? []) as any[]) {
    const localCtx = { ...ctx, escola_id: rep.escola_id, user: { nome: "lumied_bridge_cron" } };
    const r = await pullAfdViaBridge(localCtx, rep as any, ontem, ontem, true);
    await ctx.sb.from("ponto_rep_devices").update({
      ultimo_pull_em: new Date().toISOString(),
      ultimo_pull_status: r.status,
      ultimo_pull_erro: r.erro || null,
      ultimo_pull_eventos: r.eventos ?? null,
    }).eq("id", rep.id);
    results.push({ rep_id: rep.id, escola_id: rep.escola_id, ...r });
  }
  return successResponse({ ok: true, total: results.length, results });
});

// ═══════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
