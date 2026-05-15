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

  // Detecta layout: Portaria 1510 antiga tem tipo em [0]; Portaria 671 MR/REP-P
  // (usado pelo Control iD iDFace) tem NSR de 9 dígitos em [0..8] e tipo em [9].
  const isMR = lines.some(l => /^\d{9}[0-9T]/.test(l) && l.length >= 10);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Trailer do iDFace tem NSR=999999999 (9 noves) e tipo='0' — tratamos como '9'.
    const isMRTrailer = isMR && line.startsWith("999999999");
    const type = isMRTrailer ? "9" : (isMR ? line[9] : line[0]);
    const nsrFrom = isMR ? 0 : 1;
    try {
      if (type === "1") {
        if (isMR) {
          // No layout MR o registro tipo 1 traz 3 datas DDMMAAAA seguidas
          // (periodStart, periodEnd, dataGeração) perto do fim, antes de
          // hora/CRC. Encontra a ÚLTIMA tripla onde as 3 são datas válidas.
          const isDate = (s: string) => {
            const d = parseInt(s.substring(0,2), 10);
            const mo = parseInt(s.substring(2,4), 10);
            const y = parseInt(s.substring(4,8), 10);
            return d>=1 && d<=31 && mo>=1 && mo<=12 && y>=2000 && y<=2099;
          };
          let periodStart = "", periodEnd = "";
          for (let off = line.length - 24; off >= 0; off--) {
            const a = line.substring(off, off+8);
            const b = line.substring(off+8, off+16);
            const c = line.substring(off+16, off+24);
            if (/^\d{8}$/.test(a) && /^\d{8}$/.test(b) && /^\d{8}$/.test(c) && isDate(a) && isDate(b) && isDate(c)) {
              periodStart = parseAfdDate(a);
              periodEnd = parseAfdDate(b);
              break;
            }
          }
          header = {
            nsr: parseInt(line.substring(0, 9)) || 0,
            periodStart, periodEnd,
            employerType: line[10] || "",
            cnpj: line.substring(11, 25).trim(),
            companyName: line.substring(25, 175).trim(),
          };
        } else {
          header = {
            nsr: parseInt(line.substring(1, 10)),
            periodStart: parseAfdDate(line.substring(10, 18)),
            periodEnd: parseAfdDate(line.substring(18, 26)),
            employerType: line[26],
            cnpj: line.substring(27, 41).trim(),
            companyName: line.substring(41, 191).trim(),
          };
        }
      } else if (type === "3") {
        let date: string, timeStr: string, pis: string;
        if (isMR) {
          // NSR(9)+tipo(1)+data(8)+horaHHMM(4)+PIS(12)+CRC(4)
          date = parseAfdDate(line.substring(10, 18));
          timeStr = line.substring(18, 22);
          pis = line.substring(22, 34).trim().padStart(12, "0");
        } else {
          date = parseAfdDate(line.substring(10, 18));
          timeStr = line.substring(18, 24);
          pis = line.substring(24, 36).trim().padStart(12, "0");
        }
        const hh = timeStr.substring(0, 2);
        const mm = timeStr.substring(2, 4);
        const ss = timeStr.length >= 6 ? timeStr.substring(4, 6) : "00";
        events.push({
          nsr: parseInt(line.substring(nsrFrom, nsrFrom + 9)),
          date,
          time: `${hh}:${mm}:${ss}`,
          pis,
        });
      } else if (type === "5") {
        if (isMR) {
          // NSR(9)+tipo(1)+data(8)+horaHHMM(4)+opType(1)+PIS(12)+nome(restante)
          employees.push({
            nsr: parseInt(line.substring(0, 9)),
            date: parseAfdDate(line.substring(10, 18)),
            pis: line.substring(23, 35).trim().padStart(12, "0"),
            name: line.substring(35, 87).trim(),
            role: line.substring(87, 91).trim(),
          });
        } else {
          employees.push({
            nsr: parseInt(line.substring(1, 10)),
            date: parseAfdDate(line.substring(10, 18)),
            pis: line.substring(18, 30).trim().padStart(12, "0"),
            name: line.substring(30, 82).trim(),
            role: line.substring(82, 86).trim(),
          });
        }
      } else if (type === "9" || type === "T") {
        if (isMR) {
          // Trailer iDFace tem layout proprietário — contamos a partir dos arrays.
          trailer = {
            lastNsr: events.length ? events[events.length - 1].nsr : 0,
            totalEvents: events.length,
            totalEmployees: employees.length,
          };
        } else {
          trailer = {
            lastNsr: parseInt(line.substring(1, 10)),
            totalEvents: parseInt(line.substring(10, 19)),
            totalEmployees: parseInt(line.substring(19, 28)),
          };
        }
      }
    } catch (e) {
      errors.push(`Linha ${i + 1}: ${(e as Error).message}`);
    }
  }

  if (!header) errors.push("Header (tipo 1) não encontrado");
  if (!trailer) errors.push("Trailer (tipo 9/T) não encontrado");
  if (trailer && !isMR && trailer.totalEvents !== events.length) {
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

function normalizePis(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").padStart(12, "0").slice(-12);
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
//  REPROCESS — Re-vincula afd_events órfãos e regera daily_summary
//  Source of truth do de-para: afd_funcionarios.employee_id
//  (NOT ponto_employees.pis — porque o "PIS" no AFD costuma ser o ID interno
//  do dispositivo iDFace, não o PIS oficial do INSS).
//  Idempotente: WHERE employee_id IS NULL nunca toca já-vinculados;
//  upsert em daily_summary re-escreve o mesmo valor.
//  pisFilter: limita a um conjunto de pis_afd (link pontual);
//             null = varre todos os órfãos da escola.
// ═══════════════════════════════════════════════════════
async function reprocessOrphans(
  sb: any,
  escola_id: string,
  pisFilter: string[] | null,
): Promise<{ eventos_vinculados: number; resumos_gerados: number }> {
  const mapQ = sb.from("afd_funcionarios").select("pis_afd, employee_id")
    .eq("escola_id", escola_id).not("employee_id", "is", null);
  if (pisFilter && pisFilter.length > 0) mapQ.in("pis_afd", pisFilter);
  const { data: mapped } = await mapQ;
  if (!mapped || mapped.length === 0) return { eventos_vinculados: 0, resumos_gerados: 0 };
  const pisMap = new Map<string, string>(mapped.map((m: any) => [m.pis_afd, m.employee_id as string]));

  let evQ = sb.from("afd_events").select("id, pis, employee_id, data_evento, hora_evento")
    .eq("escola_id", escola_id).is("employee_id", null);
  if (pisFilter && pisFilter.length > 0) evQ = evQ.in("pis", pisFilter);
  const { data: orphans } = await evQ.limit(50000);
  if (!orphans || orphans.length === 0) return { eventos_vinculados: 0, resumos_gerados: 0 };

  let bound = 0;
  const affected = new Map<string, { empId: string; pis: string; date: string; events: AfdEvent[] }>();

  const chunkSize = 500;
  for (let i = 0; i < orphans.length; i += chunkSize) {
    const slice = orphans.slice(i, i + chunkSize);
    const updates: { id: string; employee_id: string }[] = [];
    for (const ev of slice) {
      const empId = pisMap.get(ev.pis);
      if (!empId) continue;
      updates.push({ id: ev.id, employee_id: empId });
      const key = `${empId}_${ev.data_evento}`;
      if (!affected.has(key)) affected.set(key, { empId, pis: ev.pis, date: ev.data_evento, events: [] });
      affected.get(key)!.events.push({ nsr: 0, date: ev.data_evento, time: ev.hora_evento, pis: ev.pis });
    }
    for (const u of updates) {
      const { error } = await sb.from("afd_events").update({ employee_id: u.employee_id })
        .eq("id", u.id).eq("escola_id", escola_id).is("employee_id", null);
      if (!error) bound++;
    }
  }

  if (affected.size === 0) return { eventos_vinculados: bound, resumos_gerados: 0 };

  // Para cada (employee_id, data) afetado, busca TODOS os eventos do dia (não só os recém-vinculados)
  // para recalcular o summary com o conjunto completo.
  const summaryRows: any[] = [];
  for (const { empId, date } of affected.values()) {
    const { data: allEv } = await sb.from("afd_events")
      .select("hora_evento, data_evento, pis, nsr")
      .eq("escola_id", escola_id).eq("employee_id", empId).eq("data_evento", date);
    if (!allEv || allEv.length === 0) continue;
    const dayEvents: AfdEvent[] = allEv.map((e: any) => ({
      nsr: e.nsr ?? 0, date: e.data_evento, time: e.hora_evento, pis: e.pis,
    }));
    const summary = calculateDay(dayEvents);
    const expectedMinutes = 480;
    const worked = summary.workedMinutes ?? 0;
    summaryRows.push({
      escola_id, employee_id: empId, data_resumo: date,
      total_marcacoes: dayEvents.length,
      primeira_marcacao: summary.firstEvent,
      ultima_marcacao: summary.lastEvent,
      minutos_trabalhados: summary.workedMinutes,
      minutos_esperados: expectedMinutes,
      saldo_minutos: worked - expectedMinutes,
      status: dayEvents.length === 0 ? "ausente" : summary.hasOddEvents ? "impar" : "presente",
      marcacao_impar: summary.hasOddEvents,
    });
  }

  for (let i = 0; i < summaryRows.length; i += chunkSize) {
    await sb.from("ponto_daily_summary").upsert(summaryRows.slice(i, i + chunkSize), { onConflict: "employee_id,data_resumo" });
  }

  // Atualiza pis_nao_encontrados nas importações afetadas (opcional, best-effort)
  const { data: imps } = await sb.from("afd_imports").select("id")
    .eq("escola_id", escola_id).gt("pis_nao_encontrados", 0);
  for (const imp of (imps ?? [])) {
    const { count } = await sb.from("afd_events").select("*", { count: "exact", head: true })
      .eq("import_id", imp.id).is("employee_id", null);
    await sb.from("afd_imports").update({ pis_nao_encontrados: count ?? 0 })
      .eq("id", imp.id).eq("escola_id", escola_id);
  }

  return { eventos_vinculados: bound, resumos_gerados: summaryRows.length };
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
  const pisLimpo = normalizePis(pis);
  if (pisLimpo.replace(/0/g, "").length === 0) throw new AppError("VALIDATION_FAILED", "PIS inválido.");
  const { data, error } = await ctx.sb.from("ponto_employees").insert({
    escola_id: ctx.escola_id, nome, pis: pisLimpo, cargo, departamento, rh_funcionario_id, work_schedule, daily_hours,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("ponto_employee_update", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  if (typeof fields.pis === "string" && fields.pis.length > 0) fields.pis = normalizePis(fields.pis);
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

  const result = await processAfdContent(ctx, conteudo_afd, nome_arquivo || "afd_upload.txt", "manual", null);
  return successResponse({
    import_id: result.import_id,
    total_eventos: result.total_eventos,
    pis_nao_encontrados: result.pis_nao_encontrados,
    resumos_gerados: result.resumos_gerados,
    status: result.status,
    errors: result.errors,
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

router.on("ponto_afd_reprocess", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const result = await reprocessOrphans(ctx.sb, ctx.escola_id, null);
  return successResponse(result);
});

// ═══════════════════════════════════════════════════════
//  ROUTES — De-para AFD ↔ ponto_employees
// ═══════════════════════════════════════════════════════

router.on("ponto_afd_funcs_list", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("afd_funcionarios")
    .select("id, pis_afd, nome_afd, cargo_afd, employee_id, primeiro_visto, ultimo_visto, total_eventos, ponto_employees:employee_id(nome, pis)")
    .eq("escola_id", ctx.escola_id)
    .order("nome_afd", { ascending: true, nullsFirst: false })
    .order("pis_afd");
  return successResponse(data ?? []);
});

router.on("ponto_afd_func_link", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { afd_id, employee_id } = ctx.body as any;
  if (!afd_id) throw new AppError("VALIDATION_FAILED", "afd_id obrigatório.");
  // employee_id pode ser null (desvincular)
  const { data: afd, error: afdErr } = await ctx.sb.from("afd_funcionarios")
    .update({ employee_id: employee_id || null, atualizado_em: new Date().toISOString() })
    .eq("id", afd_id).eq("escola_id", ctx.escola_id).select("pis_afd").single();
  if (afdErr) throw new AppError("BAD_REQUEST", afdErr.message);

  let reproc: { eventos_vinculados: number; resumos_gerados: number } | null = null;
  if (employee_id) {
    reproc = await reprocessOrphans(ctx.sb, ctx.escola_id, [afd.pis_afd]);
  }
  return successResponse({ success: true, _reprocess: reproc });
});

router.on("ponto_afd_func_create_employee", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { afd_id, daily_hours, work_schedule } = ctx.body as any;
  if (!afd_id) throw new AppError("VALIDATION_FAILED", "afd_id obrigatório.");

  const { data: afd, error: afdErr } = await ctx.sb.from("afd_funcionarios")
    .select("id, pis_afd, nome_afd, cargo_afd, employee_id")
    .eq("id", afd_id).eq("escola_id", ctx.escola_id).single();
  if (afdErr || !afd) throw new AppError("NOT_FOUND", "Registro AFD não encontrado.");
  if (afd.employee_id) throw new AppError("CONFLICT", "Já está vinculado a um funcionário.");

  const nome = afd.nome_afd?.trim() || `Funcionário ${afd.pis_afd}`;

  // Cria ponto_employees usando o pis_afd como pis (preserva compat com queries que ainda usam pis).
  // Isso pode parecer estranho — o pis_afd geralmente NÃO é o PIS oficial — mas como hoje
  // ponto_employees.pis é UNIQUE NOT NULL e a folha não está integrada aqui, é seguro
  // usar o pis_afd como placeholder. O usuário pode editar depois com o PIS oficial.
  const { data: emp, error: empErr } = await ctx.sb.from("ponto_employees").insert({
    escola_id: ctx.escola_id, nome, pis: afd.pis_afd, cargo: afd.cargo_afd || null,
    daily_hours: daily_hours || 8, work_schedule: work_schedule || null,
  }).select().single();
  if (empErr) throw new AppError("BAD_REQUEST", empErr.message);

  const { error: linkErr } = await ctx.sb.from("afd_funcionarios")
    .update({ employee_id: emp.id, atualizado_em: new Date().toISOString() })
    .eq("id", afd_id).eq("escola_id", ctx.escola_id);
  if (linkErr) throw new AppError("BAD_REQUEST", linkErr.message);

  const reproc = await reprocessOrphans(ctx.sb, ctx.escola_id, [afd.pis_afd]);
  return successResponse({ employee: emp, _reprocess: reproc });
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
  // DOs do Cloudflare hibernam quando ociosos: 1ª chamada após hibernação pega o WS server-side
  // fechado e o bridge ainda em backoff de reconnect. Tentamos uma segunda vez após 3s.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
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
    if (res.status === 503 && tentativa === 1) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (res.status === 503) return { ok: false, status: 503, error: "Lumied Bridge offline. Verifique se o daemon está rodando na escola." };
    if (data?.timeout) return { ok: false, status: 504, error: "Timeout aguardando resposta do Bridge." };
    return { ok: !!data?.ok, status: data?.ok ? 200 : 502, error: data?.error, body: data?.payload ?? data };
  }
  return { ok: false, status: 503, error: "Lumied Bridge offline. Verifique se o daemon está rodando na escola." };
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

/** Processa o conteúdo AFD vindo do daemon Bridge OU do upload manual.
 *  Gera afd_imports + afd_funcionarios (de-para com tipo 5) + afd_events
 *  + ponto_daily_summary (só pros eventos vinculados via afd_funcionarios.employee_id).
 *  Source of truth do de-para: afd_funcionarios.employee_id (não ponto_employees.pis,
 *  porque o "PIS" no AFD costuma ser o ID interno do REP, não o PIS oficial). */
async function processAfdContent(
  ctx: any,
  conteudo: string,
  nomeArquivo: string,
  origem: "manual" | "bridge_auto",
  repDeviceId?: string | null,
): Promise<{ import_id: string; total_eventos: number; resumos_gerados: number; pis_nao_encontrados: number; status: string; errors?: string[] }> {
  const parsed = parseAfd(conteudo);

  // Fallback de período: se header faltar, infere min/max das batidas.
  let periodoInicio = parsed.header?.periodStart ?? null;
  let periodoFim    = parsed.header?.periodEnd ?? null;
  if ((!periodoInicio || !periodoFim) && parsed.events.length > 0) {
    const dates = parsed.events.map(e => e.date).sort();
    periodoInicio = periodoInicio || dates[0];
    periodoFim    = periodoFim    || dates[dates.length - 1];
  }
  if (!periodoInicio || !periodoFim) {
    throw new AppError("VALIDATION_FAILED",
      "AFD inválido: cabeçalho (tipo 1) ausente e arquivo sem batidas para inferir o período. " +
      (parsed.errors.length > 0 ? "Detalhes: " + parsed.errors.join("; ") : ""));
  }

  const { data: importRec, error: impErr } = await ctx.sb.from("afd_imports").insert({
    escola_id: ctx.escola_id,
    importado_por: origem === "bridge_auto" ? "lumied_bridge" : (ctx.user?.nome ?? "sistema"),
    nome_arquivo: nomeArquivo,
    periodo_inicio: periodoInicio,
    periodo_fim: periodoFim,
    cnpj_empregador: parsed.header?.cnpj ?? null,
    razao_social: parsed.header?.companyName ?? null,
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

  const chunkSize = 500;

  // Upsert afd_funcionarios com tipo 5 do AFD (catálogo do REP).
  // Quando o AFD não traz tipo 5 (alguns REPs Bridge entregam só batidas),
  // a tabela ainda é alimentada pelos PIS distintos das batidas no fallback.
  const eventStatsByPis = new Map<string, { first: string; last: string; count: number }>();
  for (const ev of parsed.events) {
    const cur = eventStatsByPis.get(ev.pis);
    if (!cur) eventStatsByPis.set(ev.pis, { first: ev.date, last: ev.date, count: 1 });
    else {
      if (ev.date < cur.first) cur.first = ev.date;
      if (ev.date > cur.last) cur.last = ev.date;
      cur.count++;
    }
  }

  const funcRows: any[] = [];
  const seenPis = new Set<string>();
  for (const f of parsed.employees) {
    seenPis.add(f.pis);
    const stats = eventStatsByPis.get(f.pis);
    funcRows.push({
      escola_id: ctx.escola_id, pis_afd: f.pis, nome_afd: f.name || null, cargo_afd: f.role || null,
      primeiro_visto: stats?.first ?? null, ultimo_visto: stats?.last ?? null, total_eventos: stats?.count ?? 0,
    });
  }
  // Garante registros para PIS que aparecem em batidas mas não vieram no tipo 5
  for (const [pis, stats] of eventStatsByPis) {
    if (seenPis.has(pis)) continue;
    funcRows.push({
      escola_id: ctx.escola_id, pis_afd: pis, nome_afd: null, cargo_afd: null,
      primeiro_visto: stats.first, ultimo_visto: stats.last, total_eventos: stats.count,
    });
  }
  for (let i = 0; i < funcRows.length; i += chunkSize) {
    await ctx.sb.from("afd_funcionarios").upsert(funcRows.slice(i, i + chunkSize), { onConflict: "escola_id,pis_afd" });
  }

  // De-para via afd_funcionarios.employee_id (source of truth)
  const { data: mapped } = await ctx.sb.from("afd_funcionarios")
    .select("pis_afd, employee_id").eq("escola_id", ctx.escola_id).not("employee_id", "is", null);
  const pisMap = new Map<string, string>((mapped ?? []).map((m: any) => [m.pis_afd, m.employee_id]));

  let unmatchedPis = 0;
  const eventRows = parsed.events.map(ev => {
    const empId = pisMap.get(ev.pis) ?? null;
    if (!empId) unmatchedPis++;
    return { escola_id: ctx.escola_id, import_id: importRec.id, employee_id: empId, pis: ev.pis, data_evento: ev.date, hora_evento: ev.time, nsr: ev.nsr };
  });

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

/** Puxa lista de funcionários cadastrados no iDFace via Bridge e popula
 *  afd_funcionarios.nome_afd (de-para com pis_afd = registration do REP).
 *  body opcional: { rep_id } — se omitido, usa o primeiro REP ativo da escola. */
router.on("ponto_idface_users_pull", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { rep_id } = (ctx.body ?? {}) as any;

  let repQ = ctx.sb.from("ponto_rep_devices").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
  if (rep_id) repQ = repQ.eq("id", rep_id);
  const { data: reps } = await repQ.limit(1);
  const rep = reps?.[0];
  if (!rep) throw new AppError("NOT_FOUND", "Nenhum REP cadastrado/ativo na escola para puxar a lista de funcionários.");

  const dispatchResult = await bridgeDispatchEphemeral(ctx.escola_id, "idface_users_pull", {
    ip: rep.ip,
    porta: rep.porta,
    protocolo: rep.protocolo,
    auth_modo: rep.auth_modo,
    usuario: rep.usuario,
    senha: rep.senha,
    url_login: rep.url_login,
  }, 30000);

  if (!dispatchResult.ok) {
    return successResponse({ ok: false, error: dispatchResult.error || "Falha ao falar com o Bridge.", status: dispatchResult.status });
  }
  const body = dispatchResult.body || {};
  if (!body.ok && body.error) {
    return successResponse({ ok: false, error: body.error });
  }
  const users: Array<{ id: string; name: string; registration: string }> = body.users || body.payload?.users || [];
  if (!Array.isArray(users) || users.length === 0) {
    return successResponse({ ok: true, total: 0, atualizados: 0, criados: 0, message: "iDFace não retornou usuários." });
  }

  // Normaliza pis_afd igual ao parser (12 dígitos, padStart) e faz upsert por (escola_id, pis_afd).
  // ON CONFLICT atualiza nome_afd. Pra registros já vinculados a employee_id, mantém o vínculo.
  const norm = (s: string) => String(s || "").replace(/\D/g, "").padStart(12, "0").slice(-12);
  const rows = users
    .filter(u => u.registration && norm(u.registration).replace(/0/g, "").length > 0)
    .map(u => ({
      escola_id: ctx.escola_id,
      pis_afd: norm(u.registration),
      nome_afd: u.name || null,
    }));

  // Conta quantos já existiam vs serão criados (best-effort)
  const allPis = rows.map(r => r.pis_afd);
  const { data: existentes } = await ctx.sb.from("afd_funcionarios").select("pis_afd")
    .eq("escola_id", ctx.escola_id).in("pis_afd", allPis);
  const existSet = new Set((existentes ?? []).map((e: any) => e.pis_afd));
  const criados = rows.filter(r => !existSet.has(r.pis_afd)).length;
  const atualizados = rows.length - criados;

  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await ctx.sb.from("afd_funcionarios").upsert(rows.slice(i, i + chunkSize), { onConflict: "escola_id,pis_afd" });
  }

  return successResponse({ ok: true, total: rows.length, atualizados, criados, ignorados: users.length - rows.length });
});

// ── Setup Checklist — usado pela página "Setup do Relógio" ──
router.on("ponto_setup_checklist", authGerente, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const escolaId = ctx.escola_id;

  const now = new Date();
  const mesIni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const mesFim = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${lastDay}`;

  const [emps, escolas, reps, importsAll, importsMes, summariesMes] = await Promise.all([
    ctx.sb.from("ponto_employees").select("id", { count: "exact", head: true }).eq("escola_id", escolaId).eq("ativo", true),
    ctx.sb.from("escolas").select("bridge_ultimo_heartbeat, bridge_token").eq("id", escolaId).maybeSingle(),
    ctx.sb.from("ponto_rep_devices").select("id, nome, ultimo_pull_status, ultimo_pull_em, ultimo_pull_erro").eq("escola_id", escolaId).eq("ativo", true),
    ctx.sb.from("afd_imports").select("id, status, pis_nao_encontrados, criado_em").eq("escola_id", escolaId).order("criado_em", { ascending: false }).limit(1),
    ctx.sb.from("afd_imports").select("id", { count: "exact", head: true }).eq("escola_id", escolaId).gte("criado_em", mesIni).lte("criado_em", `${mesFim}T23:59:59`),
    ctx.sb.from("ponto_daily_summary").select("id", { count: "exact", head: true }).eq("escola_id", escolaId).gte("data_resumo", mesIni).lte("data_resumo", mesFim),
  ]);

  const empsCount = emps.count ?? 0;
  const repsList = (reps.data ?? []) as any[];
  const lastImport = importsAll.data?.[0] as any;
  const escola = (escolas.data ?? null) as any;

  const bridgeHb = escola?.bridge_ultimo_heartbeat ? new Date(escola.bridge_ultimo_heartbeat).getTime() : 0;
  const bridgeMinAgo = bridgeHb ? Math.floor((Date.now() - bridgeHb) / 60000) : -1;
  const bridgeOnline = bridgeHb && bridgeMinAgo >= 0 && bridgeMinAgo < 5;

  const repOk = repsList.some((r) => r.ultimo_pull_status === "ok");
  const repAny = repsList.length > 0;
  const repWithError = repsList.find((r) => r.ultimo_pull_status && r.ultimo_pull_status !== "ok");

  const items = [
    {
      key: "funcionarios",
      label: "Cadastrar funcionários com PIS",
      detail: empsCount > 0
        ? `${empsCount} funcionário(s) cadastrado(s).`
        : "Nenhum funcionário cadastrado. O PIS de cada um precisa ser exatamente o que está no AFD do REP — sem PIS cadastrado, as batidas chegam mas não casam com ninguém.",
      ok: empsCount > 0,
      severity: empsCount > 0 ? "ok" : "error",
      blocking: true,
      action: { panel: "pontoEmployees", label: "Cadastrar" },
    },
    {
      key: "bridge_instalado",
      label: "Instalar o Lumied Bridge na escola",
      detail: bridgeOnline
        ? `Bridge online — último sinal há ${bridgeMinAgo} min.`
        : (bridgeHb
          ? `Bridge ficou offline há ${bridgeMinAgo} min. Reinicie o daemon no mini-PC da escola.`
          : "Daemon nunca conectou. Instale o Lumied Bridge num mini-PC/Pi da rede da escola — sem ele a coleta automática do AFD não funciona (mas você ainda pode importar manual)."),
      ok: !!bridgeOnline,
      severity: bridgeOnline ? "ok" : "warn",
      blocking: false,
      action: { panel: "acessoBridge", label: "Instalar Bridge" },
    },
    {
      key: "rep_cadastrado",
      label: "Cadastrar o REP físico (ponto eletrônico)",
      detail: repAny
        ? `${repsList.length} REP(s) cadastrado(s).`
        : "Cadastre IP, usuário e senha do seu REP (Control iD, Henry, etc) pra coleta automática do AFD às 03:30 BRT todo dia.",
      ok: repAny,
      severity: repAny ? "ok" : "warn",
      blocking: false,
      action: { panel: "pontoImport", label: "Cadastrar REP" },
    },
    {
      key: "rep_testado",
      label: "Testar a coleta do AFD",
      detail: !repAny
        ? "Cadastre um REP antes de testar."
        : (repOk
          ? "Coleta automática funcionando. Próximas batidas chegam sozinhas todo dia às 03:30 BRT."
          : (repWithError
            ? `Última coleta falhou: ${repWithError.ultimo_pull_status} — ${repWithError.ultimo_pull_erro || "verifique IP/senha"}.`
            : "REP cadastrado mas nunca foi testado. Use o botão '🧪 Testar agora' no cadastro.")),
      ok: repOk,
      severity: repOk ? "ok" : (repWithError ? "error" : "warn"),
      blocking: false,
      action: { panel: "pontoImport", label: "Testar coleta" },
    },
    {
      key: "primeira_importacao",
      label: "Importar o primeiro AFD",
      detail: lastImport
        ? `Última importação em ${new Date(lastImport.criado_em).toLocaleString("pt-BR")} — status "${lastImport.status}"${lastImport.pis_nao_encontrados ? `, ${lastImport.pis_nao_encontrados} PIS sem funcionário` : ""}.`
        : "Nenhuma importação ainda. Faça upload manual do AFD ou aguarde a coleta automática (se REP estiver cadastrado).",
      ok: !!lastImport && lastImport.status === "concluido",
      severity: lastImport && lastImport.status === "concluido" ? "ok" : "error",
      blocking: true,
      action: { panel: "pontoImport", label: "Importar agora" },
    },
    {
      key: "espelho_gerado",
      label: "Conferir o espelho de ponto",
      detail: (summariesMes.count ?? 0) > 0
        ? `${summariesMes.count} dia(s) com batidas processadas no mês atual.`
        : "Sem batidas processadas no mês atual. Importe o AFD primeiro.",
      ok: (summariesMes.count ?? 0) > 0,
      severity: (summariesMes.count ?? 0) > 0 ? "ok" : "warn",
      blocking: false,
      action: { panel: "pontoMirror", label: "Ver espelho" },
    },
    {
      key: "cobertura_pis",
      label: "Cobertura de funcionários no AFD",
      detail: lastImport && lastImport.pis_nao_encontrados > 0
        ? `Última importação tem ${lastImport.pis_nao_encontrados} PIS sem funcionário cadastrado — essas batidas ficam órfãs.`
        : (lastImport ? "Todos os PIS da última importação casaram com funcionários." : "Sem importações para avaliar."),
      ok: !lastImport || (lastImport.pis_nao_encontrados ?? 0) === 0,
      severity: !lastImport ? "muted" : (lastImport.pis_nao_encontrados > 0 ? "warn" : "ok"),
      blocking: false,
      action: { panel: "pontoEmployees", label: "Cadastrar PIS" },
    },
  ];

  const okCount = items.filter((i) => i.ok).length;
  const total = items.length;
  const score = total > 0 ? Math.round((okCount / total) * 100) : 0;
  const blockers = items.filter((i) => i.blocking && !i.ok).length;
  const podeOperar = blockers === 0;

  return successResponse({
    score,
    blockers,
    pode_operar: podeOperar,
    items,
    bridge: { online: !!bridgeOnline, ultimo_heartbeat: escola?.bridge_ultimo_heartbeat ?? null, min_atras: bridgeMinAgo },
    funcionarios_count: empsCount,
    reps_count: repsList.length,
    cron_horario: "03:30 BRT (todo dia)",
  });
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
