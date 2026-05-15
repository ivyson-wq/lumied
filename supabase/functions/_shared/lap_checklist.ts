// ═══════════════════════════════════════════════════════════════
//  LAP Activation Checklist — catálogo + cálculo de estado
//
//  Itens da checklist são definidos em código (CHECKLIST_ITEMS).
//  Estado é calculado on-demand cruzando product_events (mig 345)
//  com lap_activation_dismiss (mig 346).
//
//  Princípios:
//   - Cada item tem `check_events`: lista de event_names que satisfazem
//   - `min_count` define quantos eventos contam como "done" (default 1)
//   - `cta`: deeplink interno (modulo + opcional query string) pra
//     levar o usuário direto pra ação certa
//   - `personas`: filtro de quem deve ver esse item (default: todos
//     que veem o widget — gerente/diretor/financeiro/secretaria)
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

export type ChecklistItem = {
  key: string;
  label: string;
  icon: string;
  module: string;
  check_events: string[];
  min_count?: number;
  cta?: {
    href?: string;       // URL relativa (ex: "gerente.html#manutencao")
    description?: string; // tooltip do botão
  };
  priority: number;       // menor = aparece primeiro
  personas?: string[];    // null/undefined = visível pra todos
};

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  // === STAKEHOLDERS (cobertura do LHS) ===
  {
    key: "diretor_logou",
    label: "Diretor(a) acessou o sistema",
    icon: "👔",
    module: "auth",
    check_events: ["auth.user.logged_in"],
    priority: 10,
    personas: ["diretor","financeiro","secretaria"],
    cta: { href: "/area-restrita.html", description: "Convide o(a) diretor(a) a abrir o painel" },
  },
  {
    key: "financeiro_logou",
    label: "Time financeiro acessou",
    icon: "💰",
    module: "auth",
    check_events: ["auth.user.logged_in"],
    priority: 20,
    cta: { href: "/secretaria.html", description: "Adicione um usuário com papel 'financeiro'" },
  },
  {
    key: "secretaria_logou",
    label: "Secretaria acessou",
    icon: "📋",
    module: "auth",
    check_events: ["auth.user.logged_in"],
    priority: 30,
    cta: { href: "/secretaria.html" },
  },

  // === SETUP & CONVITES ===
  {
    key: "convite_2_usuario",
    label: "Convidar 2º usuário",
    icon: "👥",
    module: "onboarding",
    check_events: ["onboarding.convite.enviado","onboarding.convite.aceito","pais.convite.aceito"],
    priority: 40,
    cta: { href: "/gerente.html#usuarios", description: "Convide um colega — escolas com 1 usuário só churnam" },
  },
  {
    key: "configurar_banco",
    label: "Configurar conta bancária",
    icon: "🏦",
    module: "financeiro",
    check_events: ["financeiro.conta_bancaria.configurada","financeiro.cobranca.gerada"],
    priority: 50,
    cta: { href: "/gerente.html#bancos", description: "Cadastre o banco pra emitir boletos" },
  },

  // === FINANCEIRO (AHA principal) ===
  {
    key: "primeira_cobranca",
    label: "Gerar 1ª cobrança",
    icon: "🧾",
    module: "financeiro",
    check_events: ["financeiro.cobranca.gerada","financeiro.remessa.gerada"],
    priority: 60,
    cta: { href: "/gerente.html#financeiro", description: "Crie sua primeira cobrança ou remessa" },
  },
  {
    key: "primeira_baixa_auto",
    label: "Receber 1ª baixa automática",
    icon: "✅",
    module: "financeiro",
    check_events: ["financeiro.baixa.automatica"],
    priority: 70,
    cta: { description: "Acontece automaticamente quando 1º pagamento chega via webhook do banco" },
  },

  // === MANUTENÇÃO ===
  {
    key: "primeiro_chamado_manut",
    label: "Abrir 1º chamado de manutenção",
    icon: "🔧",
    module: "manutencao",
    check_events: ["manutencao.chamado.aberto"],
    priority: 80,
    cta: { href: "/gerente.html#manutencao", description: "Lâmpada queimada? Reporte aqui e teste o fluxo" },
  },
  {
    key: "primeiro_chamado_fechado_sla",
    label: "Fechar 1º chamado no SLA",
    icon: "⏱️",
    module: "manutencao",
    check_events: ["manutencao.chamado.fechado_no_sla"],
    priority: 90,
    cta: { href: "/gerente.html#manutencao", description: "Acompanhe o tempo e marque concluído quando resolver" },
  },

  // === ALMOXARIFADO ===
  {
    key: "primeiro_insumo_almox",
    label: "Cadastrar 1º item do almoxarifado",
    icon: "📦",
    module: "almoxarifado",
    check_events: ["almoxarifado.insumo.cadastrado","almoxarifado.inventario.criado","almoxarifado.compra.aprovada"],
    priority: 100,
    cta: { href: "/gerente.html#almoxarifado", description: "Comece com 5 itens mais usados (papel, caneta, fralda)" },
  },

  // === ACADEMICO / MATRICULAS ===
  {
    key: "primeiro_aluno",
    label: "Matricular 1º aluno (ou importar)",
    icon: "🎓",
    module: "academico",
    check_events: ["academico.aluno.matriculado","onboarding.migracao_erp.promovida"],
    priority: 110,
    cta: { href: "/gerente.html#alunos", description: "Cadastre manualmente ou importe do ERP anterior" },
  },

  // === PAIS ===
  {
    key: "primeiro_pai_aceitou",
    label: "1ª família acessou o portal",
    icon: "👨‍👩‍👧",
    module: "onboarding",
    check_events: ["pais.convite.aceito","auth.user.logged_in"],
    priority: 120,
    cta: { description: "Acontece quando uma família entra em familia.html pela primeira vez" },
  },
];

// ─── Estado calculado on-demand ────────────────────────────────

export type ChecklistItemState = ChecklistItem & {
  done: boolean;
  done_count: number;
  dismissed_until: string | null;
  marked_done: boolean;
};

export type ChecklistState = {
  items: ChecklistItemState[];
  total: number;
  done: number;
  percent: number;
  hidden_count: number;
  completed_all: boolean;
};

export async function getChecklistState(
  sb: SupabaseClient,
  escola_id: string,
  user_id?: string | null,
): Promise<ChecklistState> {
  // 1. Carrega TODOS os product_events relevantes desta escola
  //    (só eventos cujos nomes constam em algum check_events de algum item)
  const allEventNames = new Set<string>();
  for (const item of CHECKLIST_ITEMS) {
    for (const e of item.check_events) allEventNames.add(e);
  }

  const { data: events } = await sb
    .from("product_events")
    .select("event_name, persona")
    .eq("escola_id", escola_id)
    .in("event_name", Array.from(allEventNames));

  // Contagem por event_name (e também por event_name × persona quando relevante)
  const countByName = new Map<string, number>();
  const countByNameAndPersona = new Map<string, number>();
  for (const e of (events ?? []) as Array<{ event_name: string; persona: string | null }>) {
    countByName.set(e.event_name, (countByName.get(e.event_name) ?? 0) + 1);
    if (e.persona) {
      const k = `${e.event_name}::${e.persona}`;
      countByNameAndPersona.set(k, (countByNameAndPersona.get(k) ?? 0) + 1);
    }
  }

  // 2. Carrega dismissals da escola (e do user se informado)
  const { data: dismissals } = await sb
    .from("lap_activation_dismiss")
    .select("user_id, item_key, dismissed_until, marked_done")
    .eq("escola_id", escola_id);

  const now = new Date();
  const dismissByKey = new Map<string, { dismissed_until: string | null; marked_done: boolean }>();
  for (const d of (dismissals ?? []) as Array<{ user_id: string | null; item_key: string; dismissed_until: string | null; marked_done: boolean }>) {
    // Filtra: aceita dismissals da escola toda (user_id null) OU do user atual
    if (d.user_id === null || d.user_id === user_id) {
      const prev = dismissByKey.get(d.item_key);
      // Se já tinha um, mantém o mais "forte" (marked_done ganha; ou data mais distante)
      if (!prev) {
        dismissByKey.set(d.item_key, { dismissed_until: d.dismissed_until, marked_done: d.marked_done });
      } else {
        const newDate = d.dismissed_until ? new Date(d.dismissed_until) : null;
        const prevDate = prev.dismissed_until ? new Date(prev.dismissed_until) : null;
        dismissByKey.set(d.item_key, {
          marked_done: prev.marked_done || d.marked_done,
          dismissed_until: prevDate && newDate
            ? (newDate > prevDate ? d.dismissed_until : prev.dismissed_until)
            : (d.dismissed_until ?? prev.dismissed_until),
        });
      }
    }
  }

  // 3. Computa estado item por item
  const items: ChecklistItemState[] = [];
  let hidden = 0;
  for (const item of CHECKLIST_ITEMS) {
    let count = 0;
    for (const ename of item.check_events) {
      count += countByName.get(ename) ?? 0;
    }
    const minCount = item.min_count ?? 1;
    const dismiss = dismissByKey.get(item.key);
    const dismissActive = dismiss?.dismissed_until ? new Date(dismiss.dismissed_until) > now : false;

    // Para itens de stakeholders, conferir persona-específica
    let done = count >= minCount;
    if (item.key === "diretor_logou") {
      done = (countByNameAndPersona.get("auth.user.logged_in::diretor") ?? 0) >= 1;
    } else if (item.key === "financeiro_logou") {
      done = (countByNameAndPersona.get("auth.user.logged_in::financeiro") ?? 0) >= 1;
    } else if (item.key === "secretaria_logou") {
      done = (countByNameAndPersona.get("auth.user.logged_in::secretaria") ?? 0) >= 1;
    } else if (item.key === "primeiro_pai_aceitou") {
      done = (countByNameAndPersona.get("auth.user.logged_in::pais") ?? 0) >= 1
          || (countByName.get("pais.convite.aceito") ?? 0) >= 1;
    }

    const markedDone = dismiss?.marked_done ?? false;

    if (dismissActive && !done && !markedDone) {
      hidden++;
      continue;
    }

    items.push({
      ...item,
      done: done || markedDone,
      done_count: count,
      dismissed_until: dismiss?.dismissed_until ?? null,
      marked_done: markedDone,
    });
  }

  // Ordena: incompletos primeiro (por priority), depois completos
  items.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.priority - b.priority;
  });

  const total = items.length;
  const doneCount = items.filter((i) => i.done).length;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return {
    items,
    total,
    done: doneCount,
    percent,
    hidden_count: hidden,
    completed_all: doneCount === total && total > 0,
  };
}
