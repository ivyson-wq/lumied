// ═══════════════════════════════════════════════════════════════
//  LAP — QBR Template (Sprint 16)
//
//  Quarterly Business Review automático. Pega todos os indicadores
//  importantes da escola e gera HTML executivo + JSON.
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

export type QbrReport = {
  escola: { id: string; nome: string; slug: string; criado_em: string };
  periodo: { de: string; ate: string; dias: number };
  health: {
    score_atual: number | null;
    score_anterior: number | null;
    delta: number;
    color: string | null;
    amps_atual: number;
    amps_d60: number | null;
    breakdown: any;
  };
  adocao: {
    modulos_ativos: string[];
    dau_mau: number;
    eventos_total: number;
    eventos_por_modulo: Record<string, number>;
  };
  financeiro: {
    boletos_emitidos: number;
    baixas_automaticas: number;
    baixas_manuais: number;
    taxa_baixa_auto_pct: number;
  };
  manutencao: {
    chamados_total: number;
    fechados_no_sla: number;
    fechados_fora_sla: number;
    sla_pct: number;
  };
  stakeholders: {
    personas_logaram: string[];
    cobertura_pct: number;
    logins_total: number;
  };
  proximas_acoes: string[];
  gerado_em: string;
};

export async function buildQbr(
  sb: SupabaseClient,
  escola_id: string,
  periodoDias = 90,
): Promise<QbrReport | null> {
  const { data: escola } = await sb.from("escolas")
    .select("id, nome, slug, subdominio, criado_em").eq("id", escola_id).maybeSingle();
  if (!escola) return null;

  const ate = new Date();
  const de = new Date(Date.now() - periodoDias * 86400000);

  const { data: cache } = await sb.from("escola_health_score_cache")
    .select("*").eq("escola_id", escola_id).maybeSingle();

  const { data: events } = await sb.from("product_events")
    .select("event_name, module, persona, created_at")
    .eq("escola_id", escola_id)
    .gte("created_at", de.toISOString())
    .limit(50000);

  const evList = (events ?? []) as Array<{ event_name: string; module: string | null; persona: string | null; created_at: string }>;

  const byEvent = new Map<string, number>();
  const byModule = new Map<string, number>();
  const personaSet = new Set<string>();
  let logins = 0;
  for (const e of evList) {
    byEvent.set(e.event_name, (byEvent.get(e.event_name) ?? 0) + 1);
    if (e.module) byModule.set(e.module, (byModule.get(e.module) ?? 0) + 1);
    if (e.persona) personaSet.add(e.persona);
    if (e.event_name === "auth.user.logged_in") logins++;
  }

  const baixaAuto = byEvent.get("financeiro.baixa.automatica") ?? 0;
  const baixaManual = byEvent.get("financeiro.baixa.manual") ?? 0;
  const totalBaixa = baixaAuto + baixaManual;
  const boletosEmitidos = byEvent.get("financeiro.cobranca.gerada") ?? 0;

  const slaOk = byEvent.get("manutencao.chamado.fechado_no_sla") ?? 0;
  const slaFora = byEvent.get("manutencao.chamado.fechado_fora_sla") ?? 0;
  const chamadosAbertos = byEvent.get("manutencao.chamado.aberto") ?? 0;
  const totalSla = slaOk + slaFora;

  const targetPersonas = ["diretor","financeiro","secretaria","manutencao"];
  const personasLogaram = targetPersonas.filter((p) => personaSet.has(p));

  const proximas: string[] = [];
  if (totalBaixa > 0 && (baixaAuto / totalBaixa) < 0.7) {
    proximas.push("Aumentar taxa de baixa automática — investigar webhooks de banco");
  }
  if (totalSla > 0 && (slaOk / totalSla) < 0.8) {
    proximas.push("Revisar SLA de manutenção — % fora do prazo acima do aceitável");
  }
  if (personasLogaram.length < 3) {
    proximas.push("Convidar personas críticas faltantes — cobertura de stakeholders abaixo do ideal");
  }
  if ((cache?.amps_atual ?? 0) < 3) {
    proximas.push("Empurrar ativação de módulos secundários — AMPS atual baixo");
  }
  if ((cache?.delta_30d ?? 0) < -10) {
    proximas.push("Reunião de revisão urgente — health score caiu mais de 10 pontos em 30d");
  }
  if (proximas.length === 0) proximas.push("Manter cadência atual — escola em bom estado");

  return {
    escola: { id: escola.id, nome: escola.nome, slug: (escola as any).subdominio || escola.slug, criado_em: escola.criado_em },
    periodo: { de: de.toISOString(), ate: ate.toISOString(), dias: periodoDias },
    health: {
      score_atual: cache?.score ?? null,
      score_anterior: cache ? (cache.score - (cache.delta_30d ?? 0)) : null,
      delta: cache?.delta_30d ?? 0,
      color: cache?.color ?? null,
      amps_atual: cache?.amps_atual ?? 0,
      amps_d60: cache?.amps_d60 ?? null,
      breakdown: cache?.breakdown ?? null,
    },
    adocao: {
      modulos_ativos: Array.from(byModule.keys()),
      dau_mau: 0, // calculado separadamente se quiser
      eventos_total: evList.length,
      eventos_por_modulo: Object.fromEntries(byModule),
    },
    financeiro: {
      boletos_emitidos: boletosEmitidos,
      baixas_automaticas: baixaAuto,
      baixas_manuais: baixaManual,
      taxa_baixa_auto_pct: totalBaixa > 0 ? Math.round((baixaAuto / totalBaixa) * 100) : 0,
    },
    manutencao: {
      chamados_total: chamadosAbertos,
      fechados_no_sla: slaOk,
      fechados_fora_sla: slaFora,
      sla_pct: totalSla > 0 ? Math.round((slaOk / totalSla) * 100) : 0,
    },
    stakeholders: {
      personas_logaram: Array.from(personaSet),
      cobertura_pct: Math.round((personasLogaram.length / targetPersonas.length) * 100),
      logins_total: logins,
    },
    proximas_acoes: proximas,
    gerado_em: new Date().toISOString(),
  };
}

export function qbrToHtml(r: QbrReport): string {
  const colorMap: Record<string, string> = { green: "#16a34a", yellow: "#d19000", red: "#c81e1e" };
  const c = colorMap[r.health.color || ""] || "#64748b";
  const deltaSign = r.health.delta > 0 ? "+" : "";
  const deltaColor = r.health.delta > 0 ? "#16a34a" : r.health.delta < 0 ? "#c81e1e" : "#64748b";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QBR — ${esc(r.escola.nome)}</title>
<style>
body { font-family:-apple-system,Roboto,sans-serif; background:#f5f5f5; margin:0; padding:30px 20px; color:#1a1a1a; }
.report { max-width:880px; margin:0 auto; background:#fff; border-radius:16px; padding:40px 44px; box-shadow:0 8px 24px rgba(0,0,0,0.08); }
h1 { font-size:26px; margin:0 0 6px; letter-spacing:-0.02em; }
.sub { color:#64748b; font-size:13px; margin:0 0 30px; }
.kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:28px; }
.kpi { background:#fafafa; border:1px solid #e5e7eb; border-radius:10px; padding:14px; text-align:center; }
.kpi-val { font-size:24px; font-weight:800; }
.kpi-lbl { font-size:10.5px; font-weight:600; color:#64748b; text-transform:uppercase; margin-top:4px; }
.section { margin:24px 0; padding-top:18px; border-top:1px solid #f1f5f9; }
.section h2 { font-size:14px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.06em; margin:0 0 10px; }
.row { display:flex; justify-content:space-between; padding:7px 0; font-size:13.5px; border-bottom:1px dashed #f1f5f9; }
.row b { color:#1a1a1a; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { background:#f3f0ff; color:#6C63FF; padding:3px 9px; border-radius:6px; font-size:11px; font-weight:600; }
.proximas { background:linear-gradient(180deg,#fff,#fafafa); border:1px solid #e5e7eb; border-radius:12px; padding:18px 22px; }
.proximas ol { margin:6px 0 0; padding-left:22px; }
.proximas li { font-size:13.5px; line-height:1.7; }
footer { text-align:center; color:#94a3b8; font-size:11px; margin-top:30px; }
</style></head>
<body><div class="report">
  <h1>Quarterly Business Review</h1>
  <p class="sub"><b>${esc(r.escola.nome)}</b> · Período: últimos <b>${r.periodo.dias}</b> dias · Gerado em ${new Date(r.gerado_em).toLocaleDateString('pt-BR')}</p>

  <div class="kpis">
    <div class="kpi"><div class="kpi-val" style="color:${c}">${r.health.score_atual ?? '—'}</div><div class="kpi-lbl">Health Score</div></div>
    <div class="kpi"><div class="kpi-val" style="color:${deltaColor}">${deltaSign}${r.health.delta}</div><div class="kpi-lbl">Δ 30 dias</div></div>
    <div class="kpi"><div class="kpi-val">${r.health.amps_atual}</div><div class="kpi-lbl">AMPS atual</div></div>
    <div class="kpi"><div class="kpi-val">${r.health.amps_d60 ?? '—'}</div><div class="kpi-lbl">AMPS @ D60</div></div>
  </div>

  <div class="section">
    <h2>📊 Adoção</h2>
    <div class="row"><span>Total de eventos no período</span><b>${r.adocao.eventos_total.toLocaleString('pt-BR')}</b></div>
    <div class="row"><span>Módulos com atividade</span><b>${r.adocao.modulos_ativos.length}</b></div>
    <div class="chips" style="margin-top:8px">
      ${r.adocao.modulos_ativos.map(m => `<span class="chip">${esc(m)}</span>`).join('')}
    </div>
  </div>

  <div class="section">
    <h2>💰 Financeiro</h2>
    <div class="row"><span>Boletos emitidos</span><b>${r.financeiro.boletos_emitidos}</b></div>
    <div class="row"><span>Baixas automáticas</span><b>${r.financeiro.baixas_automaticas}</b></div>
    <div class="row"><span>Baixas manuais</span><b>${r.financeiro.baixas_manuais}</b></div>
    <div class="row"><span><b>Taxa de baixa automática</b></span><b style="color:${r.financeiro.taxa_baixa_auto_pct >= 70 ? '#16a34a' : '#c81e1e'}">${r.financeiro.taxa_baixa_auto_pct}%</b></div>
  </div>

  <div class="section">
    <h2>🔧 Manutenção</h2>
    <div class="row"><span>Chamados abertos no período</span><b>${r.manutencao.chamados_total}</b></div>
    <div class="row"><span>Fechados no SLA</span><b style="color:#16a34a">${r.manutencao.fechados_no_sla}</b></div>
    <div class="row"><span>Fechados fora do SLA</span><b style="color:#c81e1e">${r.manutencao.fechados_fora_sla}</b></div>
    <div class="row"><span><b>% no SLA</b></span><b style="color:${r.manutencao.sla_pct >= 80 ? '#16a34a' : '#c81e1e'}">${r.manutencao.sla_pct}%</b></div>
  </div>

  <div class="section">
    <h2>👥 Cobertura de Stakeholders</h2>
    <div class="row"><span>Personas que logaram</span><b>${r.stakeholders.personas_logaram.length}</b></div>
    <div class="row"><span>Total de logins</span><b>${r.stakeholders.logins_total}</b></div>
    <div class="row"><span><b>Cobertura</b></span><b>${r.stakeholders.cobertura_pct}%</b></div>
    <div class="chips" style="margin-top:8px">
      ${r.stakeholders.personas_logaram.map(p => `<span class="chip">${esc(p)}</span>`).join('')}
    </div>
  </div>

  <div class="section">
    <h2>🎯 Próximas Ações Recomendadas</h2>
    <div class="proximas">
      <ol>
        ${r.proximas_acoes.map(a => `<li>${esc(a)}</li>`).join('')}
      </ol>
    </div>
  </div>

  <footer>Lumied Activation Program · Relatório gerado automaticamente</footer>
</div></body></html>`;
}

function esc(s: string | null | undefined): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
