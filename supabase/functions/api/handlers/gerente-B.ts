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
  // ── Analytics Dashboard ───────────────────────────────
  if (action === "analytics_dashboard") {
    const ano = (body as any).ano || new Date().getFullYear().toString();
    // Solicitacoes por mes
    const { data: sols } = await admin.from("solicitacoes").select("criado_em, turno").eq("escola_id", sessionEscolaId).gte("criado_em", `${ano}-01-01`).lte("criado_em", `${ano}-12-31T23:59:59`);
    const solsPorMes = Array(12).fill(0);
    for (const s of sols ?? []) { const m = new Date(s.criado_em).getMonth(); solsPorMes[m]++; }

    // Almoxarifado gastos por mes
    const { data: reqs } = await admin.from("alm_requisicoes").select("mes, total, status").eq("escola_id", sessionEscolaId).like("mes", `${ano}-%`);
    const gastosPorMes = Array(12).fill(0);
    for (const r of reqs ?? []) {
      if (r.status === "aprovado") {
        const m = parseInt(r.mes.split("-")[1]) - 1;
        gastosPorMes[m] += r.total || 0;
      }
    }

    // Manutencao por status
    const { data: manuts } = await admin.from("manutencoes").select("status, urgencia, criado_em").eq("escola_id", sessionEscolaId).gte("criado_em", `${ano}-01-01`);
    const manutStatus: Record<string, number> = {};
    const manutPorMes = Array(12).fill(0);
    for (const m of manuts ?? []) {
      manutStatus[m.status] = (manutStatus[m.status] || 0) + 1;
      const mo = new Date(m.criado_em).getMonth();
      manutPorMes[mo]++;
    }

    // Atividades inscritos
    const { data: ativs } = await admin.from("atividades").select("nome, horarios").eq("escola_id", sessionEscolaId).eq("ativo", true);
    const atividadesData = (ativs ?? []).map((a: any) => ({
      nome: a.nome,
      inscritos: (a.horarios || []).reduce((s: number, h: any) => s + (h.inscritos || 0), 0),
    }));

    return ok({
      solicitacoes_por_mes: solsPorMes,
      gastos_almox_por_mes: gastosPorMes,
      manutencao_status: manutStatus,
      manutencao_por_mes: manutPorMes,
      atividades: atividadesData,
      ano,
    });
  }

  // ── Permissoes ─────────────────────────────────────────
  if (action === "permissoes_usuario") {
    const papel = gerente?.papel || (body as any).papel || 'gerente';
    const { data } = await admin.from("permissoes_papel").select("modulo, pode_ver, pode_editar").eq("papel", papel);
    return ok(data ?? []);
  }

  // ── Financeiro ────────────────────────────────────────
  if (action === "fin_plano_contas_list") {
    const { data } = await admin.from("fin_plano_contas").select("*").eq("escola_id", sessionEscolaId).order("codigo");
    return ok(data ?? []);
  }
  if (action === "fin_plano_contas_save") {
    const { id, codigo, nome, tipo, grupo, nivel } = body as any;
    if (!nome || !tipo) return err("Nome e tipo obrigatorios.");
    if (id) {
      await admin.from("fin_plano_contas").update({ codigo, nome, tipo, grupo: grupo || null, nivel: nivel || 2 }).eq("id", id).eq("escola_id", sessionEscolaId);
    } else {
      await admin.from("fin_plano_contas").insert({ codigo, nome, tipo, grupo: grupo || null, nivel: nivel || 2, escola_id: sessionEscolaId });
    }
    return ok({ success: true });
  }
  if (action === "fin_lancamento_save") {
    const { id, tipo, conta_id, descricao, valor, data_lancamento, data_vencimento, status, fornecedor, familia_email, familia_nome, observacao, centro_custo_id, metodo_pagamento } = body as any;
    if (!descricao || !valor || !data_lancamento) return err("Descricao, valor e data obrigatorios.");
    const data = { tipo, conta_id, descricao, valor: parseFloat(valor), data_lancamento, data_vencimento: data_vencimento || null, status: status || 'pendente', fornecedor: fornecedor || null, familia_email: familia_email || null, familia_nome: familia_nome || null, observacao: observacao || null, centro_custo_id: centro_custo_id || null, metodo_pagamento: metodo_pagamento || null, criado_por: gerente?.nome };
    if (id) {
      await admin.from("fin_lancamentos").update(data).eq("id", id).eq("escola_id", sessionEscolaId);
    } else {
      await admin.from("fin_lancamentos").insert({ ...data, escola_id: sessionEscolaId });
    }
    return ok({ success: true });
  }
  if (action === "fin_lancamentos_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const tipo = (body as any).tipo;
    let query = admin.from("fin_lancamentos").select("*, fin_plano_contas(nome, codigo)")
      .eq("escola_id", gerente.escola_id)
      .gte("data_lancamento", mes + "-01").lte("data_lancamento", mes + "-31").order("data_lancamento", { ascending: false });
    if (tipo) query = query.eq("tipo", tipo);
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "fin_lancamento_pagar") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("fin_lancamentos").update({ status: "pago", data_pagamento: new Date().toISOString().split("T")[0] }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "fin_lancamento_delete") {
    const { id } = body as { id: string };
    await admin.from("fin_lancamentos").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "fin_dashboard") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const ano = (body as any).ano || new Date().getFullYear().toString();
    const { data: lancs } = await admin.from("fin_lancamentos").select("tipo, valor, status, data_lancamento")
      .eq("escola_id", gerente.escola_id)
      .neq("status", "cancelado")
      .gte("data_lancamento", ano + "-01-01").lte("data_lancamento", ano + "-12-31");
    const receitasMes = Array(12).fill(0), despesasMes = Array(12).fill(0);
    let totalReceitas = 0, totalDespesas = 0, pendente = 0;
    for (const l of lancs ?? []) {
      const m = parseInt(l.data_lancamento.split("-")[1]) - 1;
      if (l.tipo === "receita") { receitasMes[m] += l.valor; totalReceitas += l.valor; }
      else { despesasMes[m] += l.valor; totalDespesas += l.valor; }
      if (l.status === "pendente" || l.status === "atrasado") pendente += l.valor;
    }
    // Mensalidades
    const { data: mens } = await admin.from("fin_mensalidades").select("status, valor_total")
      .eq("escola_id", sessionEscolaId).like("mes", ano + "-%");
    let mensPago = 0, mensPendente = 0, mensTotal = 0;
    for (const m of mens ?? []) {
      mensTotal += m.valor_total;
      if (m.status === "pago") mensPago += m.valor_total;
      else mensPendente += m.valor_total;
    }
    return ok({ receitas_mes: receitasMes, despesas_mes: despesasMes, total_receitas: totalReceitas, total_despesas: totalDespesas, pendente, mensalidades: { total: mensTotal, pago: mensPago, pendente: mensPendente }, ano });
  }
  if (action === "fin_gerar_mensalidades") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const vencimento = (body as any).vencimento || 10;
    // Busca todas as solicitacoes ativas
    const { data: sols } = await admin.from("solicitacoes").select("email, nome_resp, nome_crianca, serie, turno").eq("escola_id", sessionEscolaId);
    // Preços de turno: busca da config da escola, fallback para defaults
    const TURNO_PRECOS_DEFAULT: Record<string, number> = {
      integral_5x: 4395, integral_4x: 4303.57, integral_3x: 4072.13, integral_2x: 3760.70, integral_1x: 3300,
      semi_5x: 4030, semi_4x: 3991.57, semi_3x: 3773.13, semi_2x: 3534.70, semi_1x: 3196.27, tarde: 0, diaria: 150,
    };
    const { data: cfgPrecos } = await admin.from("escola_config").select("valor").eq("escola_id", sessionEscolaId).eq("chave", "turno_precos").maybeSingle();
    let TURNO_PRECOS = TURNO_PRECOS_DEFAULT;
    if (cfgPrecos?.valor) {
      try { TURNO_PRECOS = { ...TURNO_PRECOS_DEFAULT, ...JSON.parse(cfgPrecos.valor) }; } catch { /* keep defaults */ }
    }
    let geradas = 0;
    for (const s of sols ?? []) {
      const valorTurno = TURNO_PRECOS[s.turno] || 0;
      if (valorTurno <= 0) continue;
      const [y, m] = mes.split("-");
      const dtVenc = `${y}-${m}-${String(vencimento).padStart(2, "0")}`;
      const { error } = await admin.from("fin_mensalidades").upsert({
        familia_email: s.email, familia_nome: s.nome_resp, crianca_nome: s.nome_crianca,
        serie: s.serie, turno: s.turno, valor_turno: valorTurno, valor_atividades: 0,
        valor_total: valorTurno, mes, data_vencimento: dtVenc,
        escola_id: sessionEscolaId,
      }, { onConflict: "familia_email,crianca_nome,mes" });
      if (!error) geradas++;
    }
    return ok({ success: true, geradas });
  }
  if (action === "fin_mensalidades_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data } = await admin.from("fin_mensalidades").select("*").eq("escola_id", gerente.escola_id).eq("mes", mes).order("familia_nome");
    return ok(data ?? []);
  }
  if (action === "fin_mensalidade_pagar") {
    const { id } = body as { id: string };
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    await admin.from("fin_mensalidades").update({ status: "pago", data_pagamento: new Date().toISOString().split("T")[0] }).eq("id", id).eq("escola_id", gerente.escola_id);
    return ok({ success: true });
  }

  // ── DRE Estruturado (NBC TG 1000) ───────────────────────
  if (action === "fin_dre") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const ano = (body as any).ano || new Date().getFullYear().toString();
    const eid = gerente.escola_id;
    // Fetch all receita/despesa accounts with grupo info
    const { data: contas } = await admin.from("fin_plano_contas")
      .select("id, codigo, nome, tipo, grupo, nivel")
      .eq("escola_id", eid).in("tipo", ["receita", "despesa"]).order("codigo");
    const { data: lancs } = await admin.from("fin_lancamentos")
      .select("conta_id, valor, tipo, status, data_lancamento")
      .eq("escola_id", eid).neq("status", "cancelado")
      .gte("data_lancamento", ano + "-01-01").lte("data_lancamento", ano + "-12-31");

    // Build conta map with grupo
    type ContaDRE = { nome: string; codigo: string; tipo: string; grupo: string; nivel: number; meses: number[]; total: number };
    const contaMap: Record<string, ContaDRE> = {};
    for (const c of contas ?? []) {
      contaMap[c.id] = { nome: c.nome, codigo: c.codigo, tipo: c.tipo, grupo: c.grupo || "", nivel: c.nivel || 2, meses: Array(12).fill(0), total: 0 };
    }
    for (const l of lancs ?? []) {
      if (l.conta_id && contaMap[l.conta_id]) {
        const m = parseInt(l.data_lancamento.split("-")[1]) - 1;
        contaMap[l.conta_id].meses[m] += l.valor;
        contaMap[l.conta_id].total += l.valor;
      }
    }
    const allContas = Object.values(contaMap).filter(c => c.nivel === 2); // only leaf accounts

    // Group by DRE sections
    const sumMeses = (items: ContaDRE[]) => {
      const m = Array(12).fill(0);
      items.forEach(c => c.meses.forEach((v, i) => m[i] += v));
      return m;
    };
    const recOp = allContas.filter(c => c.tipo === "receita" && c.grupo === "operacional");
    const recFin = allContas.filter(c => c.tipo === "receita" && c.grupo === "financeira");
    const recOut = allContas.filter(c => c.tipo === "receita" && c.grupo === "outras");
    const csp = allContas.filter(c => c.tipo === "despesa" && c.grupo === "csp");
    const despAdm = allContas.filter(c => c.tipo === "despesa" && c.grupo === "administrativa");
    const despCom = allContas.filter(c => c.tipo === "despesa" && c.grupo === "comercial");
    const despFin = allContas.filter(c => c.tipo === "despesa" && c.grupo === "financeira");
    const despFisc = allContas.filter(c => c.tipo === "despesa" && c.grupo === "fiscal");

    const recOpMes = sumMeses(recOp), recFinMes = sumMeses(recFin), recOutMes = sumMeses(recOut);
    const cspMes = sumMeses(csp), admMes = sumMeses(despAdm), comMes = sumMeses(despCom);
    const finMes = sumMeses(despFin), fiscMes = sumMeses(despFisc);
    const totalRecMes = recOpMes.map((v, i) => v + recFinMes[i] + recOutMes[i]);
    const totalDespMes = cspMes.map((v, i) => v + admMes[i] + comMes[i] + finMes[i] + fiscMes[i]);
    const lucroBrutoMes = recOpMes.map((v, i) => v - cspMes[i]);
    const resultadoOpMes = lucroBrutoMes.map((v, i) => v - admMes[i] - comMes[i]);
    const resultadoMes = totalRecMes.map((v, i) => v - totalDespMes[i]);

    return ok({
      // Structured DRE sections
      receita_operacional: recOp, receita_financeira: recFin, outras_receitas: recOut,
      csp, despesas_administrativas: despAdm, despesas_comerciais: despCom,
      despesas_financeiras: despFin, impostos: despFisc,
      // Aggregated monthly totals
      total_receita_operacional_mes: recOpMes,
      total_csp_mes: cspMes,
      lucro_bruto_mes: lucroBrutoMes,
      total_desp_adm_mes: admMes,
      total_desp_com_mes: comMes,
      resultado_operacional_mes: resultadoOpMes,
      total_rec_fin_mes: recFinMes,
      total_desp_fin_mes: finMes,
      total_impostos_mes: fiscMes,
      total_receitas_mes: totalRecMes,
      total_despesas_mes: totalDespMes,
      resultado_mes: resultadoMes,
      // Legacy compat
      receitas: [...recOp, ...recFin, ...recOut],
      despesas: [...csp, ...despAdm, ...despCom, ...despFin, ...despFisc],
      ano,
    });
  }

  // ── Balanço Patrimonial (NBC TG 1000) ──────────────────
  if (action === "fin_balanco") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const eid = gerente.escola_id;
    // All balance sheet accounts with grupo
    const { data: contas } = await admin.from("fin_plano_contas")
      .select("id, codigo, nome, tipo, grupo, nivel")
      .eq("escola_id", eid).in("tipo", ["ativo", "passivo", "patrimonio"]).order("codigo");
    // Manual saldos (imobilizado, capital social, etc.)
    const { data: saldos } = await admin.from("fin_saldos_patrimoniais").select("conta_id, saldo").eq("escola_id", eid).eq("mes", mes);
    const saldoMap: Record<string, number> = {};
    for (const s of saldos ?? []) saldoMap[s.conta_id] = s.saldo;

    // Auto-calculate from lancamentos
    const [y] = mes.split("-");
    // Mensalidades a Receber (1.1.04) = pending receita lancamentos
    const contaAR = (contas ?? []).find(c => c.codigo === "1.1.04");
    if (contaAR) {
      const { data: pend } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "receita").in("status", ["pendente", "atrasado"])
        .lte("data_lancamento", mes + "-31");
      saldoMap[contaAR.id] = (pend ?? []).reduce((s, l) => s + (l.valor || 0), 0);
    }
    // PDD (1.1.07) = negative, estimated as overdue > 28 days
    const contaPDD = (contas ?? []).find(c => c.codigo === "1.1.07");
    if (contaPDD) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 28);
      const { data: overdue } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "receita").eq("status", "atrasado")
        .lt("data_vencimento", cutoff.toISOString().slice(0, 10));
      saldoMap[contaPDD.id] = -1 * (overdue ?? []).reduce((s, l) => s + (l.valor || 0), 0);
    }
    // Fornecedores (2.1.01) = pending despesa lancamentos
    const contaForn = (contas ?? []).find(c => c.codigo === "2.1.01");
    if (contaForn) {
      const { data: despPend } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "despesa").eq("status", "pendente")
        .lte("data_lancamento", mes + "-31");
      saldoMap[contaForn.id] = (saldoMap[contaForn.id] || 0) + (despPend ?? []).reduce((s, l) => s + (l.valor || 0), 0);
    }

    // Lucro do período (receitas - despesas realizadas)
    const { data: lancs } = await admin.from("fin_lancamentos").select("tipo, valor, status")
      .eq("escola_id", eid).neq("status", "cancelado")
      .gte("data_lancamento", y + "-01-01").lte("data_lancamento", mes + "-31");
    let lucro = 0;
    for (const l of lancs ?? []) lucro += l.tipo === "receita" ? l.valor : -l.valor;

    // Build structured response
    const buildGroup = (tipo: string, grupo: string) =>
      (contas ?? []).filter(c => c.tipo === tipo && c.grupo === grupo && c.nivel === 2)
        .map(c => ({ ...c, saldo: saldoMap[c.id] || 0 }));

    const ativoCirculante = buildGroup("ativo", "circulante");
    const ativoNaoCirculante = buildGroup("ativo", "nao_circulante");
    const passivoCirculante = buildGroup("passivo", "circulante");
    const passivoNaoCirculante = buildGroup("passivo", "nao_circulante");
    const pl = (contas ?? []).filter(c => c.tipo === "patrimonio" && c.nivel === 2)
      .map(c => ({ ...c, saldo: saldoMap[c.id] || 0 }));

    const sumSaldo = (items: any[]) => items.reduce((s, c) => s + c.saldo, 0);
    const totalAtivoCirc = sumSaldo(ativoCirculante);
    const totalAtivoNaoCirc = sumSaldo(ativoNaoCirculante);
    const totalAtivo = totalAtivoCirc + totalAtivoNaoCirc;
    const totalPassivoCirc = sumSaldo(passivoCirculante);
    const totalPassivoNaoCirc = sumSaldo(passivoNaoCirculante);
    const totalPassivo = totalPassivoCirc + totalPassivoNaoCirc;
    const totalPL = sumSaldo(pl) + lucro;

    return ok({
      ativo_circulante: ativoCirculante, ativo_nao_circulante: ativoNaoCirculante,
      passivo_circulante: passivoCirculante, passivo_nao_circulante: passivoNaoCirculante,
      patrimonio: pl,
      total_ativo_circulante: totalAtivoCirc, total_ativo_nao_circulante: totalAtivoNaoCirc,
      total_ativo: totalAtivo,
      total_passivo_circulante: totalPassivoCirc, total_passivo_nao_circulante: totalPassivoNaoCirc,
      total_passivo: totalPassivo, total_pl: totalPL, lucro_periodo: lucro,
      // Legacy compat
      ativos: [...ativoCirculante, ...ativoNaoCirculante],
      passivos: [...passivoCirculante, ...passivoNaoCirculante],
      mes,
    });
  }
  if (action === "fin_saldo_patrimonial_set") {
    const { conta_id, mes, saldo } = body as any;
    if (!conta_id || !mes) return err("conta_id e mes obrigatorios.");
    await admin.from("fin_saldos_patrimoniais").upsert({ conta_id, mes, saldo: parseFloat(saldo) || 0, escola_id: sessionEscolaId }, { onConflict: "conta_id,mes" });
    return ok({ success: true });
  }

  // ── Dashboard Estendido ─────────────────────────────────
  if (action === "fin_dashboard_extended") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const eid = gerente.escola_id;
    const hoje = new Date().toISOString().slice(0, 10);
    const mesAtual = hoje.slice(0, 7);
    const ano = (body as any).ano || hoje.slice(0, 4);

    // Aging buckets (receivables)
    const { data: pendentes } = await admin.from("fin_lancamentos")
      .select("valor, data_vencimento, familia_email, familia_nome, descricao")
      .eq("escola_id", eid).eq("tipo", "receita").in("status", ["pendente", "atrasado"])
      .not("data_vencimento", "is", null);
    const aging = { current: 0, d7: 0, d15: 0, d28: 0, d28_items: [] as any[] };
    for (const l of pendentes ?? []) {
      const dias = Math.floor((Date.now() - new Date(l.data_vencimento + "T12:00:00").getTime()) / 86400000);
      if (dias < 0) aging.current += l.valor;
      else if (dias < 7) aging.current += l.valor;
      else if (dias < 15) aging.d7 += l.valor;
      else if (dias < 28) aging.d15 += l.valor;
      else { aging.d28 += l.valor; aging.d28_items.push({ familia: l.familia_nome, valor: l.valor, dias, descricao: l.descricao }); }
    }

    // Receita prevista vs realizada (by month)
    const { data: allLancsAno } = await admin.from("fin_lancamentos")
      .select("valor, status, data_lancamento, tipo")
      .eq("escola_id", eid).eq("tipo", "receita").neq("status", "cancelado")
      .gte("data_lancamento", ano + "-01-01").lte("data_lancamento", ano + "-12-31");
    const previsto = Array(12).fill(0), realizado = Array(12).fill(0);
    for (const l of allLancsAno ?? []) {
      const m = parseInt(l.data_lancamento.split("-")[1]) - 1;
      previsto[m] += l.valor;
      if (l.status === "pago") realizado[m] += l.valor;
    }

    // Inadimplencia rate
    const { data: mensMes } = await admin.from("fin_mensalidades")
      .select("status").eq("escola_id", eid).eq("mes", mesAtual);
    const totalMens = (mensMes ?? []).length;
    const atrasados = (mensMes ?? []).filter(m => m.status === "atrasado").length;
    const inadimplencia_pct = totalMens > 0 ? Math.round((atrasados / totalMens) * 100) : 0;

    // Payment by turma/serie
    const { data: mensPorSerie } = await admin.from("fin_mensalidades")
      .select("serie, status, valor_total").eq("escola_id", eid).like("mes", ano + "-%");
    const serieMap: Record<string, { total: number; pago: number; valor_total: number; valor_pago: number }> = {};
    for (const m of mensPorSerie ?? []) {
      const s = m.serie || "Sem série";
      if (!serieMap[s]) serieMap[s] = { total: 0, pago: 0, valor_total: 0, valor_pago: 0 };
      serieMap[s].total++;
      serieMap[s].valor_total += m.valor_total;
      if (m.status === "pago") { serieMap[s].pago++; serieMap[s].valor_pago += m.valor_total; }
    }
    const por_serie = Object.entries(serieMap).map(([serie, d]) => ({
      serie, ...d, taxa_pgto: d.total > 0 ? Math.round((d.pago / d.total) * 100) : 0,
    })).sort((a, b) => a.taxa_pgto - b.taxa_pgto);

    // Top devedores
    const topDev = (aging.d28_items || []).sort((a: any, b: any) => b.valor - a.valor).slice(0, 10);

    return ok({
      aging, previsto, realizado, inadimplencia_pct,
      por_serie, top_devedores: topDev, ano,
    });
  }

  // ── Reajuste Anual ─────────────────────────────────────
  if (action === "fin_reajuste_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("fin_reajustes").select("*, fin_reajuste_historico(turno, preco_anterior, preco_novo)")
      .eq("escola_id", gerente.escola_id).order("ano_letivo", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "fin_reajuste_create") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { ano_letivo, taxa_percentual, indice, data_vigencia, motivo } = body as any;
    if (!ano_letivo || taxa_percentual == null || !data_vigencia) return err("ano_letivo, taxa_percentual e data_vigencia obrigatórios.");
    const { data, error: e2 } = await admin.from("fin_reajustes").insert({
      ano_letivo, taxa_percentual: parseFloat(taxa_percentual), indice: indice || "manual",
      data_vigencia, motivo, criado_por: gerente.nome, escola_id: gerente.escola_id,
    }).select().single();
    if (e2) return err(e2.message);
    return ok(data);
  }
  if (action === "fin_reajuste_aplicar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id } = body as any;
    if (!id) return err("id obrigatório.");
    const { data: rea } = await admin.from("fin_reajustes").select("*").eq("id", id).eq("escola_id", gerente.escola_id).single();
    if (!rea) return err("Reajuste não encontrado.");
    if (rea.aplicado) return err("Reajuste já aplicado.");
    const taxa = 1 + (rea.taxa_percentual / 100);
    // Read current turno prices
    const { data: cfgPrecos } = await admin.from("escola_config").select("valor").eq("escola_id", gerente.escola_id).eq("chave", "turno_precos").maybeSingle();
    const precos: Record<string, number> = cfgPrecos?.valor ? JSON.parse(cfgPrecos.valor) : {};
    const historico: any[] = [];
    for (const [turno, precoAtual] of Object.entries(precos)) {
      const novo = Math.round(precoAtual * taxa * 100) / 100;
      historico.push({ reajuste_id: id, turno, preco_anterior: precoAtual, preco_novo: novo, escola_id: gerente.escola_id });
      precos[turno] = novo;
    }
    // Save new prices
    await admin.from("escola_config").upsert({ escola_id: gerente.escola_id, chave: "turno_precos", valor: JSON.stringify(precos) }, { onConflict: "escola_id,chave" });
    // Save history
    if (historico.length) await admin.from("fin_reajuste_historico").insert(historico);
    // Mark as applied
    await admin.from("fin_reajustes").update({ aplicado: true, aplicado_em: new Date().toISOString() }).eq("id", id);
    return ok({ success: true, historico });
  }

  // ── Recibos ────────────────────────────────────────────
  if (action === "fin_recibos_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { familia_email, mes } = body as any;
    let q = admin.from("fin_recibos").select("*").eq("escola_id", gerente.escola_id).order("data_pagamento", { ascending: false });
    if (familia_email) q = q.eq("familia_email", familia_email);
    if (mes) q = q.gte("data_pagamento", mes + "-01").lte("data_pagamento", mes + "-31");
    const { data } = await q.limit(200);
    return ok(data ?? []);
  }

  // ── NF Batch ───────────────────────────────────────────
  if (action === "fin_nf_emitir") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { cpf_cnpj_tomador, familia_nome, valor, descricao_servico, mensalidade_id, boleto_id, lancamento_id } = body as any;
    if (!valor || !descricao_servico) return err("Valor e descrição obrigatórios.");
    const { data, error: e3 } = await admin.from("fin_notas_fiscais").insert({
      cpf_cnpj_tomador, familia_nome, valor: parseFloat(valor), descricao_servico,
      mensalidade_id, boleto_id, lancamento_id, escola_id: gerente.escola_id,
    }).select().single();
    if (e3) return err(e3.message);
    return ok(data);
  }
  if (action === "fin_nf_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("fin_notas_fiscais").select("*").eq("escola_id", gerente.escola_id).order("criado_em", { ascending: false }).limit(200);
    return ok(data ?? []);
  }
  if (action === "fin_nf_marcar_emitida") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id, numero_nf } = body as any;
    if (!id) return err("id obrigatório.");
    await admin.from("fin_notas_fiscais").update({ status: "emitida", numero_nf }).eq("id", id).eq("escola_id", gerente.escola_id);
    return ok({ success: true });
  }
  if (action === "fin_nf_batch") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { batch_id, mes } = body as any;
    // Get all paid mensalidades for the month that don't have NFs yet
    let q = admin.from("fin_mensalidades").select("id, familia_email, familia_nome, crianca_nome, valor_total")
      .eq("escola_id", gerente.escola_id).eq("status", "pago");
    if (mes) q = q.eq("mes", mes);
    const { data: mens } = await q;
    let geradas = 0;
    for (const m of mens ?? []) {
      const exists = await admin.from("fin_notas_fiscais").select("id").eq("mensalidade_id", m.id).eq("escola_id", gerente.escola_id).maybeSingle();
      if (exists.data) continue;
      await admin.from("fin_notas_fiscais").insert({
        mensalidade_id: m.id, familia_email: m.familia_email, familia_nome: m.familia_nome,
        valor: m.valor_total, descricao_servico: "Serviços educacionais - " + (m.crianca_nome || "Aluno"),
        escola_id: gerente.escola_id,
      });
      geradas++;
    }
    return ok({ geradas });
  }

  // ── Export CSV/JSON ────────────────────────────────────
  if (action === "fin_export") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { tipo: exportTipo, periodo_inicio, periodo_fim, formato } = body as any;
    const inicio = periodo_inicio || new Date().getFullYear() + "-01-01";
    const fim = periodo_fim || new Date().toISOString().slice(0, 10);
    let data: any[] = [];

    if (exportTipo === "lancamentos" || !exportTipo) {
      const { data: lancs } = await admin.from("fin_lancamentos")
        .select("data_lancamento, descricao, tipo, valor, status, data_pagamento, metodo_pagamento, familia_nome, familia_email")
        .eq("escola_id", gerente.escola_id).neq("status", "cancelado")
        .gte("data_lancamento", inicio).lte("data_lancamento", fim)
        .order("data_lancamento");
      data = lancs ?? [];
    } else if (exportTipo === "mensalidades") {
      const { data: mens } = await admin.from("fin_mensalidades")
        .select("mes, crianca_nome, familia_nome, familia_email, serie, turno, valor_total, status, data_vencimento, data_pagamento")
        .eq("escola_id", gerente.escola_id)
        .gte("mes", inicio.slice(0, 7)).lte("mes", fim.slice(0, 7))
        .order("mes");
      data = mens ?? [];
    } else if (exportTipo === "recibos") {
      const { data: recs } = await admin.from("fin_recibos")
        .select("numero_recibo, familia_nome, familia_email, crianca_nome, valor, data_pagamento, metodo_pagamento, descricao")
        .eq("escola_id", gerente.escola_id)
        .gte("data_pagamento", inicio).lte("data_pagamento", fim)
        .order("data_pagamento");
      data = recs ?? [];
    }

    if (formato === "csv" && data.length > 0) {
      const headers = Object.keys(data[0]);
      const csv = [headers.join(";"), ...data.map(row => headers.map(h => String(row[h] ?? "").replace(/;/g, ",")).join(";"))].join("\n");
      return ok({ csv, total: data.length });
    }
    return ok({ data, total: data.length });
  }

  // ── Notificação Config ─────────────────────────────────
  if (action === "fin_notificacao_config_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("fin_notificacao_config").select("*").eq("escola_id", gerente.escola_id).order("tipo");
    return ok(data ?? []);
  }
  if (action === "fin_notificacao_config_save") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { tipo, canal, habilitado, dias_offset, template_assunto, template_corpo } = body as any;
    if (!tipo) return err("tipo obrigatório.");
    const { data, error: e4 } = await admin.from("fin_notificacao_config").upsert({
      tipo, canal: canal || "email", habilitado: habilitado !== false,
      dias_offset: dias_offset ?? 0, template_assunto, template_corpo,
      escola_id: gerente.escola_id,
    }, { onConflict: "escola_id,tipo,canal" }).select().single();
    if (e4) return err(e4.message);
    return ok(data);
  }
  if (action === "fin_notificacao_log_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("fin_notificacao_log").select("*").eq("escola_id", gerente.escola_id).order("criado_em", { ascending: false }).limit(100);
    return ok(data ?? []);
  }

  // ── Portal Pais: Financeiro ────────────────────────────
  if (action === "pais_pagamentos_historico") {
    const email = (body as any).email || gerente?.email;
    if (!email) return err("Email obrigatório.");
    const eid = sessionEscolaId;
    const { data: recibos } = await admin.from("fin_recibos")
      .select("numero_recibo, valor, data_pagamento, metodo_pagamento, descricao, crianca_nome, criado_em")
      .eq("escola_id", eid).eq("familia_email", email)
      .order("data_pagamento", { ascending: false }).limit(50);
    const { data: mens } = await admin.from("fin_mensalidades")
      .select("id, mes, crianca_nome, valor_total, status, data_vencimento, data_pagamento")
      .eq("escola_id", eid).eq("familia_email", email)
      .order("mes", { ascending: false }).limit(24);
    return ok({ recibos: recibos ?? [], mensalidades: mens ?? [] });
  }

  // ── Desconto Approval ──────────────────────────────────
  if (action === "fin_ajuste_aprovar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id, aprovado } = body as any;
    if (!id) return err("id obrigatório.");
    await admin.from("fin_ajustes_aluno").update({
      status_aprovacao: aprovado ? "aprovado" : "rejeitado",
      aprovado_por: gerente.nome,
      aprovado_em: new Date().toISOString(),
    }).eq("id", id).eq("escola_id", gerente.escola_id);
    return ok({ success: true });
  }

  // ── Centro de Custos ─────────────────────────────────
  if (action === "fin_centros_custo_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("fin_centros_custo").select("*").eq("escola_id", gerente.escola_id).eq("ativo", true).order("codigo");
    return ok(data ?? []);
  }
  if (action === "fin_centro_custo_save") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { codigo, nome } = body as any;
    if (!codigo || !nome) return err("codigo e nome obrigatórios.");
    const { data, error: e5 } = await admin.from("fin_centros_custo").upsert({ codigo, nome, escola_id: gerente.escola_id }, { onConflict: "escola_id,codigo" }).select().single();
    if (e5) return err(e5.message);
    return ok(data);
  }

  // ── Fechamento Mensal ──────────────────────────────────
  if (action === "fin_fechamento_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("fin_fechamento_mensal").select("*").eq("escola_id", gerente.escola_id).order("mes", { ascending: false }).limit(24);
    return ok(data ?? []);
  }
  if (action === "fin_fechamento_fechar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { mes } = body as any;
    if (!mes) return err("mes obrigatório (YYYY-MM).");
    await admin.from("fin_fechamento_mensal").upsert({
      mes, fechado: true, fechado_por: gerente.nome, fechado_em: new Date().toISOString(),
      escola_id: gerente.escola_id,
    }, { onConflict: "escola_id,mes" });
    return ok({ success: true });
  }
  if (action === "fin_fechamento_reabrir") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { mes } = body as any;
    if (!mes) return err("mes obrigatório.");
    await admin.from("fin_fechamento_mensal").update({
      fechado: false, reaberto_por: gerente.nome, reaberto_em: new Date().toISOString(),
    }).eq("escola_id", gerente.escola_id).eq("mes", mes);
    return ok({ success: true });
  }

  // ── Fluxo de Caixa Projetado ───────────────────────────
  if (action === "fin_fluxo_caixa") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const eid = gerente.escola_id;
    const meses_projecao = (body as any).meses || 3;
    const resultado: any[] = [];

    for (let i = 0; i < meses_projecao; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() + i);
      const mes = d.toISOString().slice(0, 7);
      const inicio = mes + "-01";
      const fim = mes + "-31";

      // Receitas previstas (lançamentos pendentes + mensalidades a vencer)
      const { data: recPend } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "receita").in("status", ["pendente", "atrasado"])
        .gte("data_vencimento", inicio).lte("data_vencimento", fim);
      const receitaPrevista = (recPend ?? []).reduce((s, l) => s + (l.valor || 0), 0);

      // Despesas previstas (lançamentos pendentes)
      const { data: despPend } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "despesa").in("status", ["pendente"])
        .gte("data_vencimento", inicio).lte("data_vencimento", fim);
      const despesaPrevista = (despPend ?? []).reduce((s, l) => s + (l.valor || 0), 0);

      // Já realizado no mês
      const { data: recReal } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "receita").eq("status", "pago")
        .gte("data_pagamento", inicio).lte("data_pagamento", fim);
      const receitaRealizada = (recReal ?? []).reduce((s, l) => s + (l.valor || 0), 0);

      const { data: despReal } = await admin.from("fin_lancamentos").select("valor")
        .eq("escola_id", eid).eq("tipo", "despesa").eq("status", "pago")
        .gte("data_pagamento", inicio).lte("data_pagamento", fim);
      const despesaRealizada = (despReal ?? []).reduce((s, l) => s + (l.valor || 0), 0);

      resultado.push({
        mes,
        receita_prevista: receitaPrevista + receitaRealizada,
        despesa_prevista: despesaPrevista + despesaRealizada,
        receita_realizada: receitaRealizada,
        despesa_realizada: despesaRealizada,
        saldo_projetado: (receitaPrevista + receitaRealizada) - (despesaPrevista + despesaRealizada),
      });
    }
    return ok(resultado);
  }

  // ── DRE Competência vs Caixa ───────────────────────────
  if (action === "fin_dre_caixa") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const ano = (body as any).ano || new Date().getFullYear().toString();
    // Regime caixa: only counts pago lancamentos, by data_pagamento
    const { data: contasEscola } = await admin.from("fin_plano_contas").select("id, codigo, nome, tipo").eq("escola_id", gerente.escola_id).in("tipo", ["receita", "despesa"]).order("codigo");
    const { data: contasGlobal } = await admin.from("fin_plano_contas").select("id, codigo, nome, tipo").is("escola_id", null).in("tipo", ["receita", "despesa"]).order("codigo");
    const codigosEscola = new Set((contasEscola ?? []).map(c => c.codigo));
    const contas = [...(contasEscola ?? []), ...(contasGlobal ?? []).filter(c => !codigosEscola.has(c.codigo))];
    const { data: lancs } = await admin.from("fin_lancamentos").select("conta_id, valor, tipo, data_pagamento")
      .eq("escola_id", gerente.escola_id).eq("status", "pago")
      .gte("data_pagamento", ano + "-01-01").lte("data_pagamento", ano + "-12-31");
    const contaMap: Record<string, { nome: string; codigo: string; tipo: string; meses: number[]; total: number }> = {};
    for (const c of contas) contaMap[c.id] = { nome: c.nome, codigo: c.codigo, tipo: c.tipo, meses: Array(12).fill(0), total: 0 };
    for (const l of lancs ?? []) {
      if (l.conta_id && contaMap[l.conta_id] && l.data_pagamento) {
        const m = parseInt(l.data_pagamento.split("-")[1]) - 1;
        contaMap[l.conta_id].meses[m] += l.valor;
        contaMap[l.conta_id].total += l.valor;
      }
    }
    const receitas = Object.values(contaMap).filter(c => c.tipo === "receita");
    const despesas = Object.values(contaMap).filter(c => c.tipo === "despesa");
    const totalReceitasMes = Array(12).fill(0), totalDespesasMes = Array(12).fill(0);
    for (const r of receitas) r.meses.forEach((v, i) => totalReceitasMes[i] += v);
    for (const d of despesas) d.meses.forEach((v, i) => totalDespesasMes[i] += v);
    const resultadoMes = totalReceitasMes.map((r, i) => r - totalDespesasMes[i]);
    return ok({ receitas, despesas, total_receitas_mes: totalReceitasMes, total_despesas_mes: totalDespesasMes, resultado_mes: resultadoMes, ano, regime: "caixa" });
  }

  // ── Conciliacao Bancaria ──────────────────────────────
  if (action === "fin_extrato_importar") {
    const itens = (body as any).itens || [];
    if (!itens.length) return err("Nenhum item para importar.");
    let ok2 = 0;
    for (const it of itens) {
      const { error } = await admin.from("fin_extrato_bancario").insert({
        data_transacao: it.data, descricao: it.descricao, valor: Math.abs(parseFloat(it.valor)),
        tipo: parseFloat(it.valor) >= 0 ? "credito" : "debito", saldo: it.saldo || null, banco: it.banco || null,
        escola_id: sessionEscolaId,
      });
      if (!error) ok2++;
    }
    return ok({ importados: ok2 });
  }
  if (action === "fin_extrato_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data } = await admin.from("fin_extrato_bancario").select("*, fin_lancamentos(descricao, valor)")
      .eq("escola_id", gerente.escola_id)
      .gte("data_transacao", mes + "-01").lte("data_transacao", mes + "-31").order("data_transacao");
    return ok(data ?? []);
  }
  if (action === "fin_extrato_conciliar") {
    const { extrato_id, lancamento_id } = body as any;
    if (!extrato_id) return err("extrato_id obrigatorio.");
    await admin.from("fin_extrato_bancario").update({ lancamento_id: lancamento_id || null, conciliado: !!lancamento_id }).eq("id", extrato_id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "fin_extrato_auto_conciliar") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: extratos } = await admin.from("fin_extrato_bancario").select("*").eq("escola_id", sessionEscolaId).eq("conciliado", false)
      .gte("data_transacao", mes + "-01").lte("data_transacao", mes + "-31");
    const { data: lancs } = await admin.from("fin_lancamentos").select("id, descricao, valor, data_lancamento")
      .eq("escola_id", sessionEscolaId).gte("data_lancamento", mes + "-01").lte("data_lancamento", mes + "-31");
    let conciliados = 0;
    for (const ext of extratos ?? []) {
      const match = (lancs ?? []).find(l => Math.abs(l.valor - ext.valor) < 0.01 && l.data_lancamento === ext.data_transacao);
      if (match) {
        await admin.from("fin_extrato_bancario").update({ lancamento_id: match.id, conciliado: true }).eq("id", ext.id).eq("escola_id", sessionEscolaId);
        conciliados++;
      }
    }
    return ok({ conciliados });
  }

  // ── Emissao de Boletos (Inter) ──────────────────────────
  if (action === "fin_emitir_boleto") {
    const { mensalidade_id, cpf_pagador, valor, vencimento, descricao, nome_pagador, aluno_id } = body as any;
    const { endereco, cep, cidade, uf } = body as any;
    if (!cpf_pagador || !valor || !vencimento) return err("CPF, valor e vencimento obrigatorios.");
    const RELAY_URL = Deno.env.get("INTER_RELAY_URL") || "";
    const RELAY_SECRET = Deno.env.get("RELAY_SECRET") || "";
    if (!RELAY_URL || !RELAY_SECRET) return err("Inter API não configurada (INTER_RELAY_URL).");
    try {
      // 1. Obter OAuth token
      const clientId = Deno.env.get("INTER_CLIENT_ID") || "";
      const clientSecret = Deno.env.get("INTER_CLIENT_SECRET") || "";
      if (!clientId || !clientSecret) return err("Inter API não configurada (CLIENT_ID/SECRET).");
      const scopes = ["boleto-cobranca.write", "boleto-cobranca.read boleto-cobranca.write", "cobv.write", "cobranca.write"];
      let interToken = "";
      for (const scope of scopes) {
        try {
          const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: "client_credentials" });
          const tokenRes = await fetch(`${RELAY_URL}/inter-proxy`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` },
            body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }),
            signal: AbortSignal.timeout(15000),
          });
          const tokenResp = await tokenRes.json() as any;
          if (tokenResp.status >= 200 && tokenResp.status < 300) {
            const parsed = JSON.parse(tokenResp.body);
            if (parsed?.access_token) { interToken = parsed.access_token; break; }
          }
        } catch { /* try next scope */ }
      }
      if (!interToken) return err("Não foi possível autenticar com o Banco Inter. Verifique as credenciais.");
      // 2. Criar cobranca via API Inter v3
      const cobrancaBody = {
        seuNumero: `LUM-${Date.now().toString(36).toUpperCase()}`,
        valorNominal: parseFloat(valor),
        dataVencimento: vencimento,
        numDiasAgenda: 30,
        pagador: {
          cpfCnpj: cpf_pagador.replace(/\D/g, ""),
          tipoPessoa: cpf_pagador.replace(/\D/g, "").length > 11 ? "JURIDICA" : "FISICA",
          nome: nome_pagador || "Responsavel",
          endereco: endereco || "Rua não informada",
          cidade: cidade || "Caxias do Sul",
          uf: uf || "RS",
          cep: (cep || "95000000").replace(/\D/g, ""),
        },
        mensagem: { linha1: (descricao || "Mensalidade Escolar").substring(0, 100) },
      };
      const res = await fetch(`${RELAY_URL}/inter-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` },
        body: JSON.stringify({ path: "/cobranca/v3/cobrancas", method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${interToken}` }, body: JSON.stringify(cobrancaBody) }),
        signal: AbortSignal.timeout(15000),
      });
      const relayResp = await res.json() as any;
      if (relayResp.status && (relayResp.status < 200 || relayResp.status >= 300)) {
        return err("Erro Inter API: " + (relayResp.body || relayResp.status));
      }
      const interData = typeof relayResp.body === "string" ? JSON.parse(relayResp.body) : relayResp.body;
      const codigoSolicitacao = interData?.codigoSolicitacao || "";

      // 3. Inter v3 é assíncrono — buscar detalhes do boleto (nosso_numero, linha digitável, PIX)
      //    Obtém novo token com scope de leitura e faz polling
      let boletoDetails: any = {};
      if (codigoSolicitacao) {
        let readToken = "";
        try {
          const readScopes = ["boleto-cobranca.read", "boleto-cobranca.read boleto-cobranca.write"];
          for (const scope of readScopes) {
            const tp = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: "client_credentials" });
            const tr = await fetch(`${RELAY_URL}/inter-proxy`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` },
              body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tp.toString() }),
              signal: AbortSignal.timeout(10000),
            });
            const tResp = await tr.json() as any;
            if (tResp.status >= 200 && tResp.status < 300) {
              const parsed = JSON.parse(tResp.body);
              if (parsed?.access_token) { readToken = parsed.access_token; break; }
            }
          }
        } catch { /* use write token as fallback */ }
        const pollToken = readToken || interToken;

        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const detRes = await fetch(`${RELAY_URL}/inter-proxy`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` },
              body: JSON.stringify({ path: `/cobranca/v3/cobrancas/${codigoSolicitacao}`, method: "GET", headers: { Authorization: `Bearer ${pollToken}` }, body: "" }),
              signal: AbortSignal.timeout(10000),
            });
            const detRelay = await detRes.json() as any;
            if (detRelay.status >= 200 && detRelay.status < 300) {
              const parsed = typeof detRelay.body === "string" ? JSON.parse(detRelay.body) : detRelay.body;
              boletoDetails = parsed;
              if (parsed?.boleto?.nossoNumero || parsed?.boleto?.linhaDigitavel) break;
            }
          } catch { /* retry */ }
        }
      }

      const nossoNumero = boletoDetails?.boleto?.nossoNumero || boletoDetails?.cobranca?.nossoNumero || null;
      const codigoBarras = boletoDetails?.boleto?.codigoBarras || null;
      const linhaDigitavel = boletoDetails?.boleto?.linhaDigitavel || null;
      const pixCopiaECola = boletoDetails?.pix?.pixCopiaECola || null;

      // 4. Salvar boleto emitido
      const { error: insErr } = await admin.from("fin_boletos_emitidos").insert({
        mensalidade_id: mensalidade_id || null,
        aluno_id: aluno_id || null,
        familia_email: (body as any).familia_email || null,
        familia_nome: nome_pagador || null,
        crianca_nome: (body as any).crianca_nome || null,
        cpf_pagador, valor: parseFloat(valor), vencimento, descricao,
        escola_id: sessionEscolaId,
        nosso_numero: nossoNumero,
        codigo_barras: codigoBarras,
        linha_digitavel: linhaDigitavel,
        pix_copia_cola: pixCopiaECola,
        inter_response: { ...interData, detalhes: boletoDetails },
      });
      if (insErr) return err("Boleto criado no Inter mas erro ao salvar: " + insErr.message);
      // 5. Upsert mensalidade se vinculada
      if (mensalidade_id) {
        await admin.from("fin_mensalidades").update({ status: "pendente" }).eq("id", mensalidade_id).eq("escola_id", sessionEscolaId);
      }
      return ok({ success: true, nosso_numero: nossoNumero, linha_digitavel: linhaDigitavel, pix: pixCopiaECola, codigo_solicitacao: codigoSolicitacao });
    } catch (e) { return err("Erro ao emitir boleto: " + (e as Error).message); }
  }
  if (action === "fin_boletos_emitidos_list") {
    const { mes, emissao_inicio, emissao_fim, vencimento_inicio, vencimento_fim, pessoa } = body as any;
    let query = admin.from("fin_boletos_emitidos").select("*").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false });
    if (vencimento_inicio && vencimento_fim) {
      query = query.gte("vencimento", vencimento_inicio).lte("vencimento", vencimento_fim);
    } else if (mes) {
      query = query.gte("vencimento", mes + "-01").lte("vencimento", mes + "-31");
    }
    if (emissao_inicio) query = query.gte("criado_em", emissao_inicio + "T00:00:00");
    if (emissao_fim) query = query.lte("criado_em", emissao_fim + "T23:59:59");
    if (pessoa) query = query.or(`familia_nome.ilike.%${pessoa}%,crianca_nome.ilike.%${pessoa}%,cpf_pagador.ilike.%${pessoa}%`);
    const { data } = await query.limit(500);
    return ok(data ?? []);
  }
  if (action === "fin_boleto_cancelar") {
    const { id } = body as { id: string };
    if (!id) return err("id obrigatório.");
    // Busca dados do boleto
    const { data: bol } = await admin.from("fin_boletos_emitidos").select("*").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!bol) return err("Boleto não encontrado.");
    if (bol.status === "pago") return err("Boleto já pago, não pode ser cancelado.");
    if (bol.status === "cancelado") return err("Boleto já está cancelado.");
    // Tenta cancelar no Inter se tiver codigoSolicitacao
    const RELAY_URL = Deno.env.get("INTER_RELAY_URL") || "";
    const RELAY_SECRET = Deno.env.get("RELAY_SECRET") || "";
    const codSol = bol.inter_response?.codigoSolicitacao || bol.inter_response?.detalhes?.cobranca?.codigoSolicitacao || "";
    if (codSol && RELAY_URL) {
      try {
        const clientId = Deno.env.get("INTER_CLIENT_ID") || "";
        const clientSecret = Deno.env.get("INTER_CLIENT_SECRET") || "";
        const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "boleto-cobranca.write", grant_type: "client_credentials" });
        const tRes = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` }, body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }), signal: AbortSignal.timeout(10000) });
        const tData = await tRes.json() as any;
        if (tData.status >= 200 && tData.status < 300) {
          const token = JSON.parse(tData.body).access_token;
          await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` }, body: JSON.stringify({ path: `/cobranca/v3/cobrancas/${codSol}/cancelar`, method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ motivoCancelamento: "ACERTOS" }) }), signal: AbortSignal.timeout(10000) });
        }
      } catch (e) { console.warn("[fin_boleto_cancelar] Erro ao cancelar no Inter:", e); }
    }
    await admin.from("fin_boletos_emitidos").update({ status: "cancelado" }).eq("id", id).eq("escola_id", sessionEscolaId);
    // Atualiza batch item se houver
    if (bol.batch_item_id) {
      await admin.from("fin_boleto_batch_items").update({ status: "cancelado" }).eq("id", bol.batch_item_id).eq("escola_id", sessionEscolaId);
    }
    return ok({ success: true });
  }
  // ── Baixar PDF do boleto via Inter API ──
  if (action === "fin_boleto_pdf") {
    const { id } = body as any;
    if (!id) return err("id obrigatório.");
    const { data: bol } = await admin.from("fin_boletos_emitidos").select("*").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!bol) return err("Boleto não encontrado.");
    const codSol = bol.inter_response?.codigoSolicitacao || bol.inter_response?.detalhes?.cobranca?.codigoSolicitacao || "";
    if (!codSol) return err("Código de solicitação não encontrado. Boleto pode não ter sido emitido no Inter.");
    const RELAY_URL = Deno.env.get("INTER_RELAY_URL") || "";
    const RELAY_SECRET = Deno.env.get("RELAY_SECRET") || "";
    try {
      const clientId = Deno.env.get("INTER_CLIENT_ID") || "";
      const clientSecret = Deno.env.get("INTER_CLIENT_SECRET") || "";
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "boleto-cobranca.read", grant_type: "client_credentials" });
      const tRes = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` }, body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }), signal: AbortSignal.timeout(10000) });
      const tData = await tRes.json() as any;
      const token = JSON.parse(tData.body).access_token;
      const pdfRes = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` }, body: JSON.stringify({ path: `/cobranca/v3/cobrancas/${codSol}/pdf`, method: "GET", headers: { Authorization: `Bearer ${token}` }, body: "" }), signal: AbortSignal.timeout(15000) });
      const pdfRelay = await pdfRes.json() as any;
      if (pdfRelay.status < 200 || pdfRelay.status >= 300) return err("Erro ao baixar PDF: " + pdfRelay.status);
      const pdfData = JSON.parse(pdfRelay.body);
      return ok({ pdf_base64: pdfData.pdf, nosso_numero: bol.nosso_numero, crianca_nome: bol.crianca_nome });
    } catch (e) { return err("Erro ao baixar PDF: " + (e as Error).message); }
  }
  // ── Gerar link público do PDF do boleto (para WhatsApp / compartilhamento) ──
  if (action === "fin_boleto_pdf_link") {
    const { id } = body as any;
    if (!id) return err("id obrigatório.");
    const { data: bol } = await admin.from("fin_boletos_emitidos").select("*").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!bol) return err("Boleto não encontrado.");
    const codSol = bol.inter_response?.codigoSolicitacao || bol.inter_response?.detalhes?.cobranca?.codigoSolicitacao || "";
    if (!codSol) return err("Código de solicitação não encontrado.");
    const RELAY_URL = Deno.env.get("INTER_RELAY_URL") || "";
    const RELAY_SECRET = Deno.env.get("RELAY_SECRET") || "";
    try {
      const clientId = Deno.env.get("INTER_CLIENT_ID") || "";
      const clientSecret = Deno.env.get("INTER_CLIENT_SECRET") || "";
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "boleto-cobranca.read", grant_type: "client_credentials" });
      const tRes = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` }, body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }), signal: AbortSignal.timeout(10000) });
      const token = JSON.parse((await tRes.json() as any).body).access_token;
      const pdfRes = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` }, body: JSON.stringify({ path: `/cobranca/v3/cobrancas/${codSol}/pdf`, method: "GET", headers: { Authorization: `Bearer ${token}` }, body: "" }), signal: AbortSignal.timeout(15000) });
      const pdfRelay = await pdfRes.json() as any;
      if (pdfRelay.status < 200 || pdfRelay.status >= 300) return err("Erro ao baixar PDF.");
      const pdfB64 = JSON.parse(pdfRelay.body).pdf;
      // Converte base64 para Uint8Array
      const bin = atob(pdfB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      // Upload para Supabase Storage
      const fileName = `boletos-compartilhados/${bol.nosso_numero || id}.pdf`;
      await admin.storage.from("boletos").upload(fileName, bytes, { contentType: "application/pdf", upsert: true });
      // Signed URL válida por 30 dias
      const { data: signed } = await admin.storage.from("boletos").createSignedUrl(fileName, 60 * 60 * 24 * 30);
      const fullUrl = signed?.signedUrl || null;
      // Gerar short link lumied.com.br/b/XXXX
      let shortUrl = fullUrl;
      if (fullUrl) {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join("").toUpperCase().substring(0, 6);
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
        await admin.from("short_links").upsert({ code, url: fullUrl, tipo: "boleto_pdf", expira_em: expiresAt }, { onConflict: "code" });
        shortUrl = `https://lumied.com.br/b/${code}`;
      }
      return ok({ pdf_url: shortUrl, pdf_url_full: fullUrl, nosso_numero: bol.nosso_numero });
    } catch (e) { return err("Erro ao gerar link PDF: " + (e as Error).message); }
  }
  // ── Enviar boleto por email ──
  if (action === "fin_boleto_enviar_email") {
    const { id, email_destino } = body as any;
    if (!id) return err("id obrigatório.");
    const { data: bol } = await admin.from("fin_boletos_emitidos").select("*").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!bol) return err("Boleto não encontrado.");
    const destino = email_destino || bol.familia_email;
    if (!destino) return err("Email de destino não encontrado.");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return err("RESEND_API_KEY não configurada.");

    // Se faltar dados (linha_digitavel, pix), busca do Inter
    let linhaDigitavel = bol.linha_digitavel || "";
    let pixCopiaECola = bol.pix_copia_cola || "";
    let nossoNumero = bol.nosso_numero || "";
    const codSol = bol.inter_response?.codigoSolicitacao || bol.inter_response?.detalhes?.cobranca?.codigoSolicitacao || "";
    const RELAY_URL = Deno.env.get("INTER_RELAY_URL") || "";
    const RELAY_SECRET_VAL = Deno.env.get("RELAY_SECRET") || "";

    if (codSol && RELAY_URL && (!linhaDigitavel || !pixCopiaECola)) {
      try {
        const cId = Deno.env.get("INTER_CLIENT_ID") || "";
        const cSec = Deno.env.get("INTER_CLIENT_SECRET") || "";
        const p = new URLSearchParams({ client_id: cId, client_secret: cSec, scope: "boleto-cobranca.read", grant_type: "client_credentials" });
        const tR = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET_VAL}` }, body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString() }), signal: AbortSignal.timeout(10000) });
        const tk = JSON.parse((await tR.json() as any).body).access_token;
        const dR = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET_VAL}` }, body: JSON.stringify({ path: `/cobranca/v3/cobrancas/${codSol}`, method: "GET", headers: { Authorization: `Bearer ${tk}` }, body: "" }), signal: AbortSignal.timeout(10000) });
        const det = JSON.parse((await dR.json() as any).body);
        linhaDigitavel = linhaDigitavel || det?.boleto?.linhaDigitavel || "";
        pixCopiaECola = pixCopiaECola || det?.pix?.pixCopiaECola || "";
        nossoNumero = nossoNumero || det?.boleto?.nossoNumero || "";
        // Atualiza no banco para próximas vezes
        if (det?.boleto?.linhaDigitavel) {
          await admin.from("fin_boletos_emitidos").update({
            linha_digitavel: det.boleto.linhaDigitavel,
            nosso_numero: det.boleto.nossoNumero,
            codigo_barras: det.boleto.codigoBarras,
            pix_copia_cola: det.pix?.pixCopiaECola,
          }).eq("id", id);
        }
      } catch { /* continua sem dados extras */ }
    }

    // Baixar PDF do Inter para anexar ao email
    let pdfBase64 = "";
    if (codSol && RELAY_URL) {
      try {
        const cId = Deno.env.get("INTER_CLIENT_ID") || "";
        const cSec = Deno.env.get("INTER_CLIENT_SECRET") || "";
        const p = new URLSearchParams({ client_id: cId, client_secret: cSec, scope: "boleto-cobranca.read", grant_type: "client_credentials" });
        const tR = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET_VAL}` }, body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString() }), signal: AbortSignal.timeout(10000) });
        const tk = JSON.parse((await tR.json() as any).body).access_token;
        const pR = await fetch(`${RELAY_URL}/inter-proxy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET_VAL}` }, body: JSON.stringify({ path: `/cobranca/v3/cobrancas/${codSol}/pdf`, method: "GET", headers: { Authorization: `Bearer ${tk}` }, body: "" }), signal: AbortSignal.timeout(15000) });
        const pRelay = await pR.json() as any;
        if (pRelay.status >= 200 && pRelay.status < 300) {
          pdfBase64 = JSON.parse(pRelay.body).pdf || "";
        }
      } catch { /* continua sem PDF */ }
    }

    const { data: escola } = await admin.from("escolas").select("nome").eq("id", sessionEscolaId).maybeSingle();
    const escolaNome = (escola as any)?.nome || "Escola";
    const venc = bol.vencimento ? new Date(bol.vencimento + "T12:00:00").toLocaleDateString("pt-BR") : "—";
    const valor = `R$ ${parseFloat(bol.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a6bb5;">${escolaNome} — Boleto</h2>
      <p>Olá, <strong>${bol.familia_nome || "Responsável"}</strong>!</p>
      <p>Segue o boleto referente a <strong>${bol.crianca_nome || "aluno"}</strong>.</p>
      ${pdfBase64 ? '<p style="color:#2d7a3a;font-weight:600;">O boleto em PDF está anexado a este email.</p>' : ""}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr style="background:#f8f8f8;"><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Descrição</td><td style="padding:10px;border:1px solid #ddd;">${bol.descricao || "Mensalidade"}</td></tr>
        <tr><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Valor</td><td style="padding:10px;border:1px solid #ddd;font-size:20px;font-weight:700;color:#1a6bb5;">${valor}</td></tr>
        <tr style="background:#f8f8f8;"><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Vencimento</td><td style="padding:10px;border:1px solid #ddd;">${venc}</td></tr>
        ${nossoNumero ? `<tr><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Nosso Número</td><td style="padding:10px;border:1px solid #ddd;">${nossoNumero}</td></tr>` : ""}
        ${linhaDigitavel ? `<tr style="background:#f8f8f8;"><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Linha Digitável</td><td style="padding:10px;border:1px solid #ddd;font-family:monospace;font-size:13px;word-break:break-all;letter-spacing:0.5px;">${linhaDigitavel}</td></tr>` : ""}
      </table>
      ${pixCopiaECola ? `<div style="background:#f0f7ff;border:1px solid #c5d9f0;border-radius:8px;padding:16px;margin:16px 0;">
        <div style="font-weight:700;margin-bottom:8px;color:#1a6bb5;">PIX Copia e Cola</div>
        <div style="font-size:12px;color:#666;margin-bottom:6px;">Copie o código abaixo e cole no app do seu banco:</div>
        <code style="font-size:11px;word-break:break-all;display:block;background:#fff;padding:10px;border-radius:4px;border:1px solid #e0e0e0;">${pixCopiaECola}</code>
      </div>` : ""}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#999;font-size:11px;">Este email foi enviado automaticamente por ${escolaNome} via Lumied. Em caso de dúvidas, entre em contato com a secretaria da escola.</p>
    </div>`;

    const emailBody: Record<string, unknown> = {
      from: `${escolaNome} <financeiro@lumied.com.br>`,
      to: [destino],
      subject: `Boleto — ${bol.crianca_nome || "Mensalidade"} — ${valor} — Venc: ${venc}`,
      html,
    };
    if (pdfBase64) {
      emailBody.attachments = [{
        filename: `boleto_${nossoNumero || "lumied"}.pdf`,
        content: pdfBase64,
        content_type: "application/pdf",
      }];
    }
    try {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify(emailBody),
        signal: AbortSignal.timeout(15000),
      });
      const emailResult = await emailRes.json();
      if (emailResult?.statusCode >= 400) return err("Erro Resend: " + (emailResult.message || emailResult.name));
    } catch (e) { return err("Erro ao enviar email: " + (e as Error).message); }
    return ok({ success: true, enviado_para: destino, com_pdf: !!pdfBase64, com_linha_digitavel: !!linhaDigitavel, com_pix: !!pixCopiaECola });
  }
  if (action === "fin_boletos_enviar_email_batch") {
    const { ids } = body as { ids: string[] };
    if (!ids || !ids.length) return err("ids obrigatório (array de IDs de boletos).");
    if (ids.length > 50) return err("Máximo de 50 boletos por vez.");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return err("RESEND_API_KEY não configurada.");
    const { data: escola } = await admin.from("escolas").select("nome").eq("id", sessionEscolaId).maybeSingle();
    const escolaNome = (escola as any)?.nome || "Escola";
    const { data: boletos } = await admin.from("fin_boletos_emitidos").select("*").eq("escola_id", sessionEscolaId).in("id", ids);
    let enviados = 0, erros = 0;
    for (const bol of boletos ?? []) {
      if (!bol.familia_email) { erros++; continue; }
      try {
        const venc = bol.vencimento ? new Date(bol.vencimento + "T12:00:00").toLocaleDateString("pt-BR") : "—";
        const valor = `R$ ${parseFloat(bol.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1a6bb5;">${escapeHtml(escolaNome)} — Boleto</h2>
          <p>Olá, <strong>${escapeHtml(bol.familia_nome || "Responsável")}</strong>!</p>
          <p>Segue o boleto referente a <strong>${escapeHtml(bol.crianca_nome || "aluno")}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr style="background:#f8f8f8;"><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Valor</td><td style="padding:10px;border:1px solid #ddd;font-size:20px;font-weight:700;color:#1a6bb5;">${valor}</td></tr>
            <tr><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Vencimento</td><td style="padding:10px;border:1px solid #ddd;">${venc}</td></tr>
            ${bol.linha_digitavel ? `<tr style="background:#f8f8f8;"><td style="padding:10px;border:1px solid #ddd;font-weight:600;">Linha Digitável</td><td style="padding:10px;border:1px solid #ddd;font-family:monospace;font-size:13px;">${escapeHtml(bol.linha_digitavel)}</td></tr>` : ""}
          </table>
          ${bol.pix_copia_cola ? `<div style="background:#f0f7ff;border:1px solid #c5d9f0;border-radius:8px;padding:16px;margin:16px 0;"><div style="font-weight:700;margin-bottom:8px;color:#1a6bb5;">PIX Copia e Cola</div><code style="font-size:11px;word-break:break-all;display:block;background:#fff;padding:10px;border-radius:4px;border:1px solid #e0e0e0;">${escapeHtml(bol.pix_copia_cola)}</code></div>` : ""}
          <p style="color:#999;font-size:11px;">Enviado por ${escapeHtml(escolaNome)} via Lumied.</p>
        </div>`;
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: `${sanitizeHeaderValue(escolaNome)} <financeiro@lumied.com.br>`, to: [bol.familia_email], subject: `Boleto — ${bol.crianca_nome || "Mensalidade"} — ${valor}`, html }),
          signal: AbortSignal.timeout(10000),
        });
        if (emailRes.ok) enviados++;
        else erros++;
      } catch { erros++; }
    }
    return ok({ enviados, erros, total: ids.length });
  }
  if (action === "fin_boleto_baixa_manual") {
    const { id, observacao } = body as any;
    if (!id) return err("id obrigatório.");
    const agora = new Date().toISOString();
    const userName = gerente?.nome || "Usuário";
    // Atomic: só marca pago se ainda não está pago
    const { data: updated, error: updErr } = await admin.from("fin_boletos_emitidos").update({
      status: "pago",
      pago_em: agora.slice(0, 10),
      baixa_manual: true,
      baixa_manual_por: userName,
      baixa_manual_em: agora,
      baixa_manual_obs: observacao || null,
    }).eq("id", id).eq("escola_id", sessionEscolaId).neq("status", "pago").select("id, mensalidade_id, batch_item_id");
    if (updErr) return err(updErr.message);
    if (!updated?.length) return err("Boleto já está marcado como pago.");
    const boleto = updated[0];
    // Atualiza mensalidade e batch item vinculados
    if (boleto.mensalidade_id) {
      await admin.from("fin_mensalidades").update({ status: "pago", data_pagamento: agora.slice(0, 10) }).eq("id", boleto.mensalidade_id).eq("escola_id", sessionEscolaId);
    }
    if (boleto.batch_item_id) {
      await admin.from("fin_boleto_batch_items").update({ status: "pago" }).eq("id", boleto.batch_item_id).eq("escola_id", sessionEscolaId);
    }
    return ok({ success: true, baixa_manual_por: userName, baixa_manual_em: agora });
  }

  // ── Notas Fiscais ─────────────────────────────────────
  if (action === "fin_nf_emitir") {
    const { mensalidade_id, boleto_id, familia_email, familia_nome, cpf_cnpj_tomador, valor, descricao_servico } = body as any;
    if (!valor || !descricao_servico) return err("Valor e descricao obrigatorios.");
    // Salvar NF como pendente (emissao real sera integrada com sistema da prefeitura)
    const { data: nf, error: insErr } = await admin.from("fin_notas_fiscais").insert({
      boleto_id: boleto_id || null, mensalidade_id: mensalidade_id || null,
      familia_email, familia_nome, cpf_cnpj_tomador: cpf_cnpj_tomador || null,
      valor: parseFloat(valor), descricao_servico,
      status: "pendente",
      escola_id: sessionEscolaId,
    }).select("id").single();
    if (insErr) return err(insErr.message);
    return ok({ success: true, nf_id: nf.id });
  }
  if (action === "fin_nf_list") {
    const mes = (body as any).mes;
    let query = admin.from("fin_notas_fiscais").select("*").eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false });
    if (mes) query = query.gte("criado_em", mes + "-01").lte("criado_em", mes + "-31T23:59:59");
    const { data } = await query.limit(100);
    return ok(data ?? []);
  }
  if (action === "fin_nf_marcar_emitida") {
    const { id, numero_nf, codigo_verificacao } = body as any;
    await admin.from("fin_notas_fiscais").update({ status: "emitida", numero_nf, codigo_verificacao }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── CRM ────────────────────────────────────────────────
  if (action === "crm_estagios_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("crm_estagios").select("*").eq("escola_id", gerente.escola_id).eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }
  if (action === "crm_leads_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("crm_leads").select("*, crm_estagios(nome, cor, ordem)").eq("escola_id", gerente.escola_id).order("atualizado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "crm_lead_save") {
    const b = body as any;
    if (!b.id && !b.nome_responsavel) return err("Nome obrigatorio.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);

    if (b.id) {
      // UPDATE: só envia campos que foram explicitamente fornecidos (não sobrescreve com undefined)
      const updates: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      if (b.nome_responsavel !== undefined) updates.nome_responsavel = b.nome_responsavel;
      if (b.email !== undefined) updates.email = b.email;
      if (b.telefone !== undefined) updates.telefone = b.telefone;
      if (b.nome_crianca !== undefined) updates.nome_crianca = b.nome_crianca;
      if (b.data_nascimento !== undefined) updates.data_nascimento = b.data_nascimento || null;
      if (b.serie_interesse !== undefined) updates.serie_interesse = b.serie_interesse;
      if (b.estagio_id !== undefined) updates.estagio_id = b.estagio_id;
      if (b.origem !== undefined) updates.origem = b.origem;
      if (b.valor_mensalidade !== undefined) updates.valor_mensalidade = b.valor_mensalidade ? parseFloat(b.valor_mensalidade) : null;
      if (b.observacoes !== undefined) updates.observacoes = b.observacoes;
      if (b.responsavel_interno !== undefined) updates.responsavel_interno = b.responsavel_interno;
      if (b.data_proximo_contato !== undefined) updates.data_proximo_contato = b.data_proximo_contato || null;
      if (b.data_visita !== undefined) updates.data_visita = b.data_visita || null;
      const { data: updated, error: updErr } = await admin.from("crm_leads").update(updates).eq("id", b.id).eq("escola_id", gerente.escola_id).select("id").maybeSingle();
      if (updErr) return err(updErr.message);
      if (!updated) return err("Lead não encontrado.", 404);
      return ok({ success: true, id: b.id });
    } else {
      // INSERT: monta objeto completo
      let estagioFinal = b.estagio_id;
      if (!estagioFinal) {
        const { data: primeiro } = await admin.from("crm_estagios").select("id").eq("escola_id", gerente.escola_id).order("ordem").limit(1).maybeSingle();
        if (primeiro) estagioFinal = primeiro.id;
      }
      const data = {
        nome_responsavel: b.nome_responsavel, email: b.email, telefone: b.telefone,
        nome_crianca: b.nome_crianca, data_nascimento: b.data_nascimento || null,
        serie_interesse: b.serie_interesse, estagio_id: estagioFinal, origem: b.origem,
        valor_mensalidade: b.valor_mensalidade ? parseFloat(b.valor_mensalidade) : null,
        observacoes: b.observacoes, responsavel_interno: b.responsavel_interno,
        data_proximo_contato: b.data_proximo_contato || null,
        data_visita: b.data_visita || null,
        atualizado_em: new Date().toISOString(), escola_id: gerente.escola_id,
      };
      const { data: created, error: insErr } = await admin.from("crm_leads").insert(data).select("id").single();
      if (insErr) return err(insErr.message);
      return ok({ success: true, id: created.id });
    }
  }
  if (action === "crm_lead_mover") {
    const { id, estagio_id } = body as any;
    if (!id || !estagio_id) return err("id e estagio_id obrigatorios.");
    await admin.from("crm_leads").update({ estagio_id, atualizado_em: new Date().toISOString() }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_lead_delete") {
    const { id } = body as { id: string };
    await admin.from("crm_leads").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_interacoes_list") {
    const { lead_id } = body as any;
    if (!lead_id) return err("lead_id obrigatorio.");
    // Validar que o lead pertence à escola do gerente (evita enumerar leads cross-tenant)
    const { data: lead } = await admin.from("crm_leads").select("id").eq("id", lead_id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!lead) return err("Lead não encontrado.", 404);
    const { data } = await admin.from("crm_interacoes").select("*").eq("lead_id", lead_id).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "crm_interacao_save") {
    const { lead_id, tipo, descricao } = body as any;
    if (!lead_id || !descricao) return err("lead_id e descricao obrigatorios.");
    await admin.from("crm_interacoes").insert({ lead_id, tipo: tipo || "nota", descricao, criado_por: gerente?.nome, escola_id: sessionEscolaId });
    await admin.from("crm_leads").update({ atualizado_em: new Date().toISOString() }).eq("id", lead_id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_templates_list") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { data } = await admin.from("crm_templates").select("*").eq("escola_id", gerente.escola_id).eq("ativo", true).order("categoria");
    return ok(data ?? []);
  }
  if (action === "crm_template_save") {
    const { id, nome, categoria, conteudo, variaveis } = body as any;
    if (!nome || !conteudo) return err("Nome e conteudo obrigatorios.");
    if (id) { await admin.from("crm_templates").update({ nome, categoria, conteudo, variaveis }).eq("id", id).eq("escola_id", sessionEscolaId); }
    else { await admin.from("crm_templates").insert({ nome, categoria: categoria || "geral", conteudo, variaveis: variaveis || [], escola_id: sessionEscolaId }); }
    return ok({ success: true });
  }
  if (action === "crm_reuniao_save") {
    const { lead_id, titulo, data_hora, duracao_min, local, descricao, google_calendar_id } = body as any;
    if (!titulo || !data_hora) return err("Titulo e data obrigatorios.");
    const duration = duracao_min || 30;
    const { data: r, error: e } = await admin.from("crm_reunioes").insert({ lead_id, titulo, data_hora, duracao_min: duration, local, descricao, criado_por: gerente?.nome, escola_id: sessionEscolaId }).select("id").single();
    if (e) return err(e.message);
    // Sync with Google Calendar
    let gcalResult: { eventId?: string; htmlLink?: string } = {};
    const calId = google_calendar_id || Deno.env.get("GOOGLE_CALENDAR_ID");
    if (calId) {
      const gcal = await createCalendarEvent({
        calendarId: calId,
        summary: titulo,
        description: descricao || `Reunião CRM${lead_id ? ' — Lead vinculado' : ''}`,
        location: local,
        startDateTime: data_hora,
        durationMin: duration,
        timeZone: "America/Sao_Paulo",
      });
      if (gcal.success && gcal.eventId) {
        await admin.from("crm_reunioes").update({ google_event_id: gcal.eventId }).eq("id", r.id);
        gcalResult = { eventId: gcal.eventId, htmlLink: gcal.htmlLink };
      } else {
        log.warn("Google Calendar sync failed:", gcal.error);
      }
    }
    // Registra interacao
    if (lead_id) {
      await admin.from("crm_interacoes").insert({ lead_id, tipo: "reuniao", descricao: `Reunião agendada: ${titulo} em ${new Date(data_hora).toLocaleString("pt-BR")}${gcalResult.htmlLink ? ' | Google Calendar: ' + gcalResult.htmlLink : ''}`, criado_por: gerente?.nome, escola_id: sessionEscolaId });
    }
    return ok({ success: true, id: r.id, google_event_id: gcalResult.eventId, google_calendar_link: gcalResult.htmlLink });
  }
  if (action === "config_series_idade_list") {
    const ano = (body as any).ano || new Date().getFullYear();
    const { data } = await admin.from("config_series_idade").select("*").eq("ano_ref", ano).eq("ativo", true).eq("escola_id", sessionEscolaId).order("ordem");
    return ok(data ?? []);
  }
  if (action === "config_series_idade_save") {
    const { id, serie, idade_min_meses, idade_max_meses, data_corte_ref, ano_ref } = body as any;
    if (!serie) return err("Serie obrigatoria.");
    const data = { serie, idade_min_meses: parseInt(idade_min_meses), idade_max_meses: parseInt(idade_max_meses), data_corte_ref: data_corte_ref || "03-31", ano_ref: parseInt(ano_ref) || new Date().getFullYear() };
    if (id) { await admin.from("config_series_idade").update(data).eq("id", id).eq("escola_id", sessionEscolaId); }
    else { await admin.from("config_series_idade").insert({ ...data, ordem: 99, escola_id: sessionEscolaId }); }
    return ok({ success: true });
  }
  if (action === "config_series_idade_delete") {
    const { id } = body as { id: string };
    await admin.from("config_series_idade").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "config_series_idade_atualizar_ano") {
    const { ano_origem, ano_destino } = body as any;
    if (!ano_origem || !ano_destino) return err("Ano de origem e destino obrigatorios.");
    const { data: existentes } = await admin.from("config_series_idade").select("*").eq("ano_ref", parseInt(ano_origem)).eq("ativo", true).eq("escola_id", sessionEscolaId);
    if (!existentes?.length) return err("Nenhuma serie encontrada para o ano " + ano_origem);
    for (const s of existentes) {
      await admin.from("config_series_idade").upsert({
        serie: s.serie, idade_min_meses: s.idade_min_meses, idade_max_meses: s.idade_max_meses,
        data_corte_ref: s.data_corte_ref, ano_ref: parseInt(ano_destino), ordem: s.ordem, ativo: true, escola_id: sessionEscolaId
      }, { onConflict: "serie,ano_ref" });
    }
    return ok({ success: true, total: existentes.length });
  }
  if (action === "crm_calcular_serie") {
    const { data_nascimento } = body as any;
    if (!data_nascimento) return err("data_nascimento obrigatoria.");
    const ano = new Date().getFullYear();
    const { data: config } = await admin.from("config_series_idade").select("*").eq("ano_ref", ano).eq("ativo", true).order("ordem");
    if (!config?.length) return ok({ serie: null });
    const dataCorte = new Date(ano + "-" + (config[0].data_corte_ref || "03-31"));
    const nasc = new Date(data_nascimento);
    const diffMs = dataCorte.getTime() - nasc.getTime();
    const meses = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
    const match = config.find(c => meses >= c.idade_min_meses && meses <= c.idade_max_meses);
    return ok({ serie: match?.serie || null, idade_meses: meses });
  }
  // Vagas
  if (action === "crm_vagas_list") {
    const ano = parseInt((body as any).ano) || new Date().getFullYear();
    const { data: turmas } = await admin.from("crm_turmas_vagas").select("*").eq("escola_id", sessionEscolaId).eq("ano", ano).order("ordem");
    // Contar matriculas/reservas por serie
    const { data: matrs } = await admin.from("crm_matriculas").select("serie, status").eq("escola_id", sessionEscolaId).eq("ano", ano).in("status", ["reserva", "matriculado"]);
    const ocupMap: Record<string, { reservas: number; matriculados: number }> = {};
    for (const m of matrs ?? []) {
      if (!ocupMap[m.serie]) ocupMap[m.serie] = { reservas: 0, matriculados: 0 };
      if (m.status === "reserva") ocupMap[m.serie].reservas++;
      else ocupMap[m.serie].matriculados++;
    }
    const result = (turmas ?? []).map((t: any) => {
      const o = ocupMap[t.serie] || { reservas: 0, matriculados: 0 };
      return { ...t, reservas: o.reservas, matriculados: o.matriculados, ocupados: o.reservas + o.matriculados, disponiveis: t.vagas_total - o.reservas - o.matriculados };
    });
    return ok(result);
  }
  if (action === "crm_vagas_save") {
    const { id, serie, ano, qtd_turmas, vagas_por_turma, ordem } = body as any;
    if (!serie || !ano) return err("Serie e ano obrigatorios.");
    const data = { serie, ano: parseInt(ano), qtd_turmas: parseInt(qtd_turmas) || 1, vagas_por_turma: parseInt(vagas_por_turma) || 18, ordem: parseInt(ordem) || 0 };
    if (id) { await admin.from("crm_turmas_vagas").update(data).eq("id", id).eq("escola_id", sessionEscolaId); }
    else { await admin.from("crm_turmas_vagas").upsert({ ...data, escola_id: sessionEscolaId }, { onConflict: "serie,ano" }); }
    return ok({ success: true });
  }
  // Matriculas
  if (action === "crm_matricula_criar") {
    const { lead_id, nome_responsavel, nome_crianca, serie, ano, status, email, telefone, data_nascimento, turma } = body as any;
    if (!nome_crianca || !serie || !ano) return err("Crianca, serie e ano obrigatorios.");
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const st = status || "reserva";
    const { error } = await admin.from("crm_matriculas").insert({
      lead_id, nome_responsavel, nome_crianca, serie, ano: parseInt(ano), status: st,
      email: email || null, telefone: telefone || null, data_nascimento: data_nascimento || null,
      turma: turma || "A",
      data_reserva: st === "reserva" ? new Date().toISOString().split("T")[0] : null,
      data_matricula: st === "matriculado" ? new Date().toISOString().split("T")[0] : null,
      escola_id: gerente.escola_id,
    });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Mover lead para estagio correto
    if (lead_id) {
      const estagioNome = st === "matriculado" ? "Matrícula Fechada" : "Negociação";
      const { data: est } = await admin.from("crm_estagios").select("id").ilike("nome", `%${estagioNome}%`).maybeSingle();
      if (est) await admin.from("crm_leads").update({ estagio_id: est.id, ano_matricula: parseInt(ano), atualizado_em: new Date().toISOString() }).eq("id", lead_id).eq("escola_id", sessionEscolaId);
      await admin.from("crm_interacoes").insert({ lead_id, tipo: "nota", descricao: `${st === "matriculado" ? "Matrícula" : "Reserva"} registrada para ${serie} ${ano}`, criado_por: gerente?.nome, escola_id: sessionEscolaId });
    }
    return ok({ success: true });
  }
  if (action === "crm_matricula_atualizar_status") {
    const { id, status } = body as any;
    if (!id || !status) return err("id e status obrigatorios.");
    const update: Record<string, any> = { status };
    if (status === "matriculado") update.data_matricula = new Date().toISOString().split("T")[0];
    if (status === "cancelado") update.data_cancelamento = new Date().toISOString().split("T")[0];
    await admin.from("crm_matriculas").update(update).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_matricula_atualizar_turma") {
    const { id, turma } = body as any;
    if (!id || !turma) return err("id e turma obrigatorios.");
    await admin.from("crm_matriculas").update({ turma }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "crm_matriculas_list") {
    const ano = parseInt((body as any).ano) || new Date().getFullYear();
    const { data } = await admin.from("crm_matriculas").select("*").eq("escola_id", sessionEscolaId).eq("ano", ano).order("serie").order("turma").order("criado_em");
    return ok(data ?? []);
  }
  // ── Exclusão de matrícula (remover aluno da turma) ──
  if (action === "crm_matricula_remover") {
    // Gerente remove direto (deleta o registro)
    const { id, motivo } = body as any;
    if (!id) return err("id obrigatorio.");
    const { data: mat } = await admin.from("crm_matriculas").select("nome_crianca, serie, turma").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!mat) return err("Matricula nao encontrada.");
    await admin.from("crm_matriculas").delete().eq("id", id).eq("escola_id", sessionEscolaId);
    // Log a exclusão aprovada automaticamente
    await admin.from("crm_matricula_exclusoes").insert({
      matricula_id: id, solicitado_por: gerente?.email || "gerente", solicitado_papel: "gerente",
      motivo: motivo || "Removido pelo gerente", status: "aprovado", aprovado_por: gerente?.email || "gerente",
      respondido_em: new Date().toISOString(), escola_id: sessionEscolaId,
    });
    return ok({ success: true, message: `${mat.nome_crianca} removido(a) de ${mat.serie} ${mat.turma || ""}`.trim() });
  }
  if (action === "crm_matricula_solicitar_exclusao") {
    // Secretaria solicita exclusão — fica pendente para gerente aprovar
    const { id, motivo, solicitante_email, solicitante_nome } = body as any;
    if (!id) return err("id obrigatorio.");
    const { data: mat } = await admin.from("crm_matriculas").select("nome_crianca, serie, turma").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    if (!mat) return err("Matricula nao encontrada.");
    // Checar se já há pendência para esta matrícula
    const { data: existing } = await admin.from("crm_matricula_exclusoes").select("id").eq("matricula_id", id).eq("status", "pendente").eq("escola_id", sessionEscolaId).maybeSingle();
    if (existing) return err("Ja existe uma solicitacao pendente para esta matricula.");
    await admin.from("crm_matricula_exclusoes").insert({
      matricula_id: id, solicitado_por: solicitante_email || "secretaria", solicitado_papel: "secretaria",
      motivo: motivo || "", status: "pendente", escola_id: sessionEscolaId,
    });
    // Notificar gerentes
    const { data: gerentes } = await admin.from("gerentes").select("email").eq("escola_id", sessionEscolaId);
    for (const g of gerentes ?? []) {
      await admin.from("notificacoes").insert({
        portal: "gerente", destinatario: g.email,
        titulo: "Solicitação de exclusão",
        mensagem: `${solicitante_nome || "Secretaria"} solicitou a exclusão de ${mat.nome_crianca} (${mat.serie} ${mat.turma || ""}).${motivo ? " Motivo: " + motivo : ""}`,
        tipo: "warning", escola_id: sessionEscolaId,
      });
    }
    return ok({ success: true, message: "Solicitação enviada para aprovação do gerente." });
  }
  if (action === "crm_exclusoes_pendentes_list") {
    const { data } = await admin.from("crm_matricula_exclusoes").select("*, crm_matriculas(nome_crianca, nome_responsavel, serie, turma, status, telefone, email)")
      .eq("escola_id", sessionEscolaId).eq("status", "pendente").order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "crm_exclusao_aprovar") {
    const { id, observacao } = body as any;
    if (!id) return err("id obrigatorio.");
    const { data: excl } = await admin.from("crm_matricula_exclusoes").select("matricula_id").eq("id", id).eq("escola_id", sessionEscolaId).eq("status", "pendente").maybeSingle();
    if (!excl) return err("Solicitacao nao encontrada ou ja respondida.");
    // Deletar a matrícula
    await admin.from("crm_matriculas").delete().eq("id", excl.matricula_id).eq("escola_id", sessionEscolaId);
    // Atualizar exclusão
    await admin.from("crm_matricula_exclusoes").update({
      status: "aprovado", aprovado_por: gerente?.email || "gerente",
      observacao_resposta: observacao || null, respondido_em: new Date().toISOString(),
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    // Notificar quem solicitou
    const { data: exclFull } = await admin.from("crm_matricula_exclusoes").select("solicitado_por").eq("id", id).maybeSingle();
    if (exclFull?.solicitado_por) {
      await admin.from("notificacoes").insert({
        portal: "secretaria", destinatario: exclFull.solicitado_por,
        titulo: "Exclusão aprovada ✅", mensagem: `A solicitação de exclusão foi aprovada pelo gerente.${observacao ? " Obs: " + observacao : ""}`,
        tipo: "success", escola_id: sessionEscolaId,
      });
    }
    return ok({ success: true });
  }
  if (action === "crm_exclusao_rejeitar") {
    const { id, observacao } = body as any;
    if (!id) return err("id obrigatorio.");
    const { data: excl } = await admin.from("crm_matricula_exclusoes").select("matricula_id, solicitado_por").eq("id", id).eq("escola_id", sessionEscolaId).eq("status", "pendente").maybeSingle();
    if (!excl) return err("Solicitacao nao encontrada ou ja respondida.");
    await admin.from("crm_matricula_exclusoes").update({
      status: "rejeitado", aprovado_por: gerente?.email || "gerente",
      observacao_resposta: observacao || null, respondido_em: new Date().toISOString(),
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    if (excl.solicitado_por) {
      await admin.from("notificacoes").insert({
        portal: "secretaria", destinatario: excl.solicitado_por,
        titulo: "Exclusão rejeitada ❌", mensagem: `A solicitação de exclusão foi rejeitada pelo gerente.${observacao ? " Motivo: " + observacao : ""}`,
        tipo: "error", escola_id: sessionEscolaId,
      });
    }
    return ok({ success: true });
  }
  if (action === "crm_metas_list") {
    const ano = parseInt((body as any).ano) || new Date().getFullYear();
    const { data } = await admin.from("comercial_metas").select("*").eq("escola_id", sessionEscolaId).eq("ano", ano).order("mes");
    return ok(data ?? []);
  }
  if (action === "crm_metas_save") {
    const { mes, ano, meta_leads, meta_matriculas, meta_valor } = body as any;
    if (!mes || !ano) return err("mes e ano obrigatorios.");
    const { data: existing } = await admin.from("comercial_metas").select("id").eq("escola_id", sessionEscolaId).eq("ano", parseInt(ano)).eq("mes", parseInt(mes)).maybeSingle();
    if (existing) {
      await admin.from("comercial_metas").update({ meta_leads: parseInt(meta_leads)||0, meta_matriculas: parseInt(meta_matriculas)||0, meta_valor: parseFloat(meta_valor)||0 }).eq("id", existing.id);
    } else {
      await admin.from("comercial_metas").insert({ escola_id: sessionEscolaId, mes: parseInt(mes), ano: parseInt(ano), meta_leads: parseInt(meta_leads)||0, meta_matriculas: parseInt(meta_matriculas)||0, meta_valor: parseFloat(meta_valor)||0 });
    }
    return ok({ success: true });
  }
  if (action === "crm_dashboard") {
    const { data: leads } = await admin.from("crm_leads").select("estagio_id, origem, valor_mensalidade, criado_em, crm_estagios(nome)").eq("escola_id", sessionEscolaId);
    const { data: estagios } = await admin.from("crm_estagios").select("id, nome, cor, ordem").eq("ativo", true).eq("escola_id", sessionEscolaId).order("ordem");
    const porEstagio: Record<string, number> = {};
    const porOrigem: Record<string, number> = {};
    let valorPipeline = 0;
    for (const l of leads ?? []) {
      const est = (l as any).crm_estagios?.nome || "?";
      porEstagio[est] = (porEstagio[est] || 0) + 1;
      if (l.origem) porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1;
      if (l.valor_mensalidade) valorPipeline += l.valor_mensalidade;
    }
    return ok({ total: (leads ?? []).length, por_estagio: porEstagio, por_origem: porOrigem, valor_pipeline: valorPipeline, estagios: estagios ?? [] });
  }

  // ── Impressoes (gerente) ────────────────────────────────
  // Helper: signed URL TTL 1h pra arquivos do bucket privado 'impressoes'
  // (mig 281). Usa cache in-memory ([[signed-url-cache]]) pra evitar regenerar
  // a cada listagem.
  const refreshImpressoesUrls = async (rows: any[]) =>
    refreshSignedUrls(admin.storage, "impressoes", rows, "arquivo_path", "arquivo_url");

  if (action === "impressoes_pendentes") {
    const { data } = await admin.from("impressoes").select("*")
      .eq("escola_id", sessionEscolaId).in("status", ["pendente", "aprovado", "impresso"]).order("criado_em", { ascending: true });
    return ok(await refreshImpressoesUrls(data ?? []));
  }
  if (action === "impressoes_todas") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data } = await admin.from("impressoes").select("*")
      .eq("escola_id", sessionEscolaId).gte("criado_em", mes + "-01").order("criado_em", { ascending: false });
    return ok(await refreshImpressoesUrls(data ?? []));
  }
  if (action === "impressao_aprovar") {
    const { id, nota } = body as { id: string; nota?: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({
      status: "aprovado", aprovado_por: gerente?.nome, aprovado_em: new Date().toISOString(),
      nota_gerente: nota || null,
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    const { data: imp } = await admin.from("impressoes").select("professora_id, professoras(email)").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    const profEmail = (imp as any)?.professoras?.email;
    if (profEmail) {
      await admin.from("notificacoes").insert({ portal: "professora", destinatario: profEmail, titulo: "Impressao aprovada", mensagem: "Sua solicitacao de impressao foi aprovada.", tipo: "success", escola_id: sessionEscolaId });
    }
    return ok({ success: true });
  }
  if (action === "impressao_rejeitar") {
    const { id, nota } = body as { id: string; nota?: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({
      status: "rejeitado", aprovado_por: gerente?.nome, aprovado_em: new Date().toISOString(),
      nota_gerente: nota || null,
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    const { data: imp } = await admin.from("impressoes").select("professora_id, professoras(email)").eq("id", id).eq("escola_id", sessionEscolaId).maybeSingle();
    const profEmail = (imp as any)?.professoras?.email;
    if (profEmail) {
      await admin.from("notificacoes").insert({ portal: "professora", destinatario: profEmail, titulo: "Impressao rejeitada", mensagem: nota ? "Motivo: " + nota : "Sua solicitacao foi rejeitada.", tipo: "error", escola_id: sessionEscolaId });
    }
    return ok({ success: true });
  }
  if (action === "impressao_marcar_impresso") {
    const { id, turma_destino } = body as { id: string; turma_destino?: string };
    if (!id) return err("ID obrigatorio.");
    const updateFields: Record<string, unknown> = { status: "impresso", impresso_em: new Date().toISOString() };
    if (turma_destino) updateFields.turma_destino = turma_destino;
    await admin.from("impressoes").update(updateFields).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "impressao_marcar_entregue") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({ status: "entregue", entregue_em: new Date().toISOString(), entregue_por: gerente?.nome }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "impressoes_orcamento_list") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: turmas } = await admin.from("series").select("id, nome").eq("escola_id", sessionEscolaId).eq("ativo", true).order("nome");
    const { data: orcs } = await admin.from("impressoes_orcamento").select("turma_id, limite").eq("escola_id", sessionEscolaId).eq("mes", mes);
    const { data: usadas } = await admin.from("impressoes").select("turma_id, copias, num_paginas").eq("escola_id", sessionEscolaId).gte("criado_em", mes + "-01").in("status", ["pendente", "aprovado", "impresso", "entregue"]);
    const orcMap: Record<string, number> = {};
    for (const o of orcs ?? []) orcMap[o.turma_id] = o.limite;
    const usadoMap: Record<string, number> = {};
    for (const u of usadas ?? []) usadoMap[u.turma_id] = (usadoMap[u.turma_id] || 0) + ((u.copias || 0) * (u.num_paginas || 1));
    const result = (turmas ?? []).map((t: any) => ({ ...t, limite: orcMap[t.id] ?? 50, usado: usadoMap[t.id] ?? 0 }));
    return ok(result);
  }
  if (action === "impressoes_orcamento_set") {
    const { turma_id, mes, limite } = body as any;
    if (!turma_id || !mes) return err("turma_id e mes obrigatorios.");
    await admin.from("impressoes_orcamento").upsert({ escola_id: sessionEscolaId, turma_id, mes, limite: parseInt(limite) || 50 }, { onConflict: "turma_id,mes" });
    return ok({ success: true });
  }

  // ── Horário de Acesso Professoras ────────────────────────
  if (action === "prof_horario_acesso_list") {
    const { data } = await admin.from("professora_horario_acesso").select("*").eq("escola_id", sessionEscolaId).order("professora_id").order("dia_semana");
    const { data: profs } = await admin.from("professoras").select("id, nome, email").eq("escola_id", sessionEscolaId).eq("ativo", true).order("nome");
    return ok({ data: data ?? [], professoras: profs ?? [] });
  }
  if (action === "prof_horario_acesso_salvar") {
    const { professora_id, horarios } = body as any;
    if (!professora_id || !Array.isArray(horarios)) return err("professora_id e horarios[] obrigatórios.");
    // Remove existentes e insere novos
    await admin.from("professora_horario_acesso").delete().eq("professora_id", professora_id).eq("escola_id", sessionEscolaId);
    if (horarios.length > 0) {
      const rows = horarios.map((h: any) => ({
        professora_id,
        dia_semana: h.dia_semana,
        hora_inicio: h.hora_inicio || "07:00",
        hora_fim: h.hora_fim || "18:00",
        ativo: h.ativo !== false,
        escola_id: sessionEscolaId,
      }));
      const { error } = await admin.from("professora_horario_acesso").insert(rows);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    }
    return ok({ success: true });
  }
  if (action === "prof_horario_acesso_remover") {
    const { professora_id } = body as any;
    if (!professora_id) return err("professora_id obrigatório.");
    await admin.from("professora_horario_acesso").delete().eq("professora_id", professora_id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── Alertas de Emergencia ───────────────────────────────
  if (action === "emergencia_acionar") {
    const { tipo, mensagem } = body as { tipo: string; mensagem?: string };
    if (!tipo) return err("Tipo obrigatorio.");
    const { error } = await admin.from("alertas_emergencia").insert({
      tipo, mensagem: mensagem || null,
      acionado_por: gerente?.nome || "Gerente",
      acionado_por_id: gerente?.id || null,
      escola_id: sessionEscolaId,
    });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Notifica todos os portais
    const { data: users } = await admin.from("usuarios").select("email, papel, papeis").eq("escola_id", sessionEscolaId);
    const tipos: Record<string, string> = { incendio: "INCENDIO", intruso: "INTRUSO", emergencia_medica: "EMERGENCIA MEDICA", evacuacao: "EVACUACAO", outro: "ALERTA" };
    const tipoLabel = tipos[tipo] || tipo.toUpperCase();
    for (const u of users ?? []) {
      const uRoles: string[] = (u.papeis?.length ? u.papeis : (u.papel ? [u.papel] : [])) as string[];
      // Emergência: enviar para o portal mais privilegiado do usuário
      const portal = uRoles.includes("gerente") ? "gerente"
        : uRoles.includes("secretaria") || uRoles.includes("comercial") || uRoles.includes("financeiro") ? "secretaria"
        : "professora";
      await admin.from("notificacoes").insert({
        portal, destinatario: u.email,
        titulo: "EMERGENCIA: " + tipoLabel,
        mensagem: mensagem || "Alerta de emergencia acionado. Siga o protocolo de seguranca.",
        tipo: "error",
        escola_id: sessionEscolaId,
      });
    }
    return ok({ success: true });
  }
  if (action === "emergencia_resolver") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("alertas_emergencia").update({
      ativo: false, resolvido_em: new Date().toISOString(),
      resolvido_por: gerente?.nome || "Gerente",
    }).eq("id", id).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "emergencia_ativos") {
    const { data } = await admin.from("alertas_emergencia").select("*")
      .eq("escola_id", sessionEscolaId).eq("ativo", true).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "emergencia_historico") {
    const { data } = await admin.from("alertas_emergencia").select("*")
      .eq("escola_id", sessionEscolaId).order("criado_em", { ascending: false }).limit(50);
    return ok(data ?? []);
  }

  // ── Atribuir turma/série a professora ───────────────────
  if (action === "usuarios_set_serie") {
    const { email, serie_id, serie_nome } = body as { email: string; serie_id?: string | null; serie_nome?: string };
    if (!email) return err("E-mail obrigatório.");
    let resolvedId = serie_id || null;
    if (!resolvedId && serie_nome) {
      const { data: s } = await admin.from("series").select("id").ilike("nome", serie_nome).limit(1).maybeSingle();
      resolvedId = s?.id || null;
    }
    const { error } = await admin.from("professoras").update({ serie_id: resolvedId }).eq("email", email).eq("escola_id", sessionEscolaId);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Notificações ────────────────────────────────────────
  if (action === "notif_list") {
    const { portal, email } = body as { portal: string; email: string };
    if (!portal || !email) return err("portal e email obrigatórios.");
    const { data } = await admin.from("notificacoes").select("*")
      .eq("escola_id", sessionEscolaId)
      .eq("portal", portal).eq("destinatario", email)
      .order("criado_em", { ascending: false }).limit(50);
    return ok(data ?? []);
  }
  if (action === "notif_marcar_lida") {
    const { ids } = body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) return err("ids obrigatório (array).");
    await admin.from("notificacoes").update({ lida: true }).in("id", ids).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }
  if (action === "notif_marcar_todas") {
    const { portal, email } = body as { portal: string; email: string };
    if (!portal || !email) return err("portal e email obrigatórios.");
    await admin.from("notificacoes").update({ lida: true }).eq("portal", portal).eq("destinatario", email).eq("lida", false).eq("escola_id", sessionEscolaId);
    return ok({ success: true });
  }

  // ── WebAuthn / Biometria (gerente) ──────────────────────
  if (action === "webauthn_register_challenge") {
    const rp_id = body.rp_id as string;
    if (!rp_id || !gerente) return err("Sessão inválida.", 401);
    const challenge = generateChallenge();
    await admin.from("webauthn_challenges").insert({ challenge, usuario_tipo: "gerente", usuario_id: gerente.id, tipo: "register", rp_id });
    await admin.from("webauthn_challenges").delete().lt("expira_em", new Date().toISOString());
    return ok({ challenge, rp_id, user_id: b64urlEncode(new TextEncoder().encode(gerente.id)), user_name: gerente.email, user_display_name: gerente.nome });
  }
  if (action === "webauthn_register_verify") {
    const { credential, rp_id } = body as { credential: any; rp_id: string };
    if (!credential || !rp_id || !gerente) return err("Dados incompletos.", 400);
    const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("tipo", "register").eq("usuario_id", gerente.id).gt("expira_em", new Date().toISOString()).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ch) return err("Challenge expirado.", 400);
    await admin.from("webauthn_challenges").delete().eq("id", ch.id);
    try {
      const result = await verifyRegistration(credential.response.clientDataJSON, credential.response.attestationObject, ch.challenge, rp_id);
      await admin.from("webauthn_credentials").insert({ usuario_tipo: "gerente", usuario_id: gerente.id, credential_id: result.credentialId, public_key: result.publicKey, sign_count: result.signCount, transports: credential.transports || ["internal"], rp_id });
      return ok({ success: true });
    } catch (e) { return err("Verificação falhou: " + (e as Error).message, 400); }
  }

  return null
}
