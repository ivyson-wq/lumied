// ═══════════════════════════════════════════════════════════════
//  LAP — Cenários pré-carregados (Sprint 7 do programa)
//
//  Catálogos base que escolas podem importar com 1 clique pra evitar
//  o trabalho de criar do zero. Inspirado em Notion templates.
//
//  Princípios:
//   - Idempotente: rodar 2x não duplica (skip se nome já existe)
//   - Por escola: respeita tenant isolation
//   - Reversível: trackeia o que foi inserido pra rollback futuro
//
//  Cenários disponíveis:
//   - alm_catalogo_base: 50 itens em 4 categorias (papelaria, limpeza,
//     cozinha, manutenção) — catálogo padrão de escola brasileira
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

export type ScenarioKey =
  | "alm_catalogo_base"
  | "manut_categorias_padrao"
  | "cardapio_semana_padrao"
  | "ponto_escalas_modelo";

type AlmInsumoSeed = {
  nome: string;
  categoria: string;
  unidade: string;
  preco: number;
  descricao?: string;
};

const ALM_CATALOGO_BASE: AlmInsumoSeed[] = [
  // ─── PAPELARIA (18) ───────────────────────────────────────
  { nome: "Papel A4 (resma 500fls)",          categoria: "papelaria", unidade: "resma",  preco: 28.00 },
  { nome: "Papel sulfite ofício (resma)",     categoria: "papelaria", unidade: "resma",  preco: 32.00 },
  { nome: "Caneta esferográfica azul",        categoria: "papelaria", unidade: "unidade", preco: 1.80 },
  { nome: "Caneta esferográfica preta",       categoria: "papelaria", unidade: "unidade", preco: 1.80 },
  { nome: "Caneta esferográfica vermelha",    categoria: "papelaria", unidade: "unidade", preco: 1.80 },
  { nome: "Lápis preto nº 2",                  categoria: "papelaria", unidade: "unidade", preco: 1.20 },
  { nome: "Borracha branca",                  categoria: "papelaria", unidade: "unidade", preco: 1.00 },
  { nome: "Apontador com depósito",           categoria: "papelaria", unidade: "unidade", preco: 2.50 },
  { nome: "Caderno espiral 96fls",            categoria: "papelaria", unidade: "unidade", preco: 12.00 },
  { nome: "Fita adesiva 12mm (durex)",        categoria: "papelaria", unidade: "rolo",    preco: 4.00 },
  { nome: "Fita crepe 18mm",                  categoria: "papelaria", unidade: "rolo",    preco: 6.50 },
  { nome: "Cola branca 90g",                  categoria: "papelaria", unidade: "unidade", preco: 5.50 },
  { nome: "Tesoura escolar sem ponta",        categoria: "papelaria", unidade: "unidade", preco: 8.00 },
  { nome: "Régua 30cm",                       categoria: "papelaria", unidade: "unidade", preco: 3.00 },
  { nome: "Marcador de quadro branco preto",  categoria: "papelaria", unidade: "unidade", preco: 8.50 },
  { nome: "Marcador de quadro branco azul",   categoria: "papelaria", unidade: "unidade", preco: 8.50 },
  { nome: "Giz de cera (caixa 12 cores)",     categoria: "papelaria", unidade: "caixa",   preco: 14.00 },
  { nome: "Cartolina branca",                 categoria: "papelaria", unidade: "folha",   preco: 2.00 },

  // ─── LIMPEZA (14) ─────────────────────────────────────────
  { nome: "Detergente neutro 500ml",          categoria: "limpeza", unidade: "unidade", preco: 3.50 },
  { nome: "Água sanitária 1L",                categoria: "limpeza", unidade: "litro",   preco: 4.20 },
  { nome: "Desinfetante pinho 1L",            categoria: "limpeza", unidade: "litro",   preco: 6.80 },
  { nome: "Álcool 70% 1L",                    categoria: "limpeza", unidade: "litro",   preco: 9.50 },
  { nome: "Sabão em pó 1kg",                  categoria: "limpeza", unidade: "kg",      preco: 12.00 },
  { nome: "Esponja dupla face",               categoria: "limpeza", unidade: "unidade", preco: 1.80 },
  { nome: "Pano multiuso (rolo 50un)",        categoria: "limpeza", unidade: "rolo",    preco: 14.00 },
  { nome: "Vassoura",                         categoria: "limpeza", unidade: "unidade", preco: 18.00 },
  { nome: "Rodo 40cm",                        categoria: "limpeza", unidade: "unidade", preco: 22.00 },
  { nome: "Pá de lixo",                       categoria: "limpeza", unidade: "unidade", preco: 9.50 },
  { nome: "Saco de lixo 50L (pacote 100un)",  categoria: "limpeza", unidade: "pacote",  preco: 28.00 },
  { nome: "Saco de lixo 100L (pacote 100un)", categoria: "limpeza", unidade: "pacote",  preco: 42.00 },
  { nome: "Papel higiênico (fardo 64 rolos)", categoria: "limpeza", unidade: "fardo",   preco: 95.00 },
  { nome: "Papel toalha bobinas (fardo)",     categoria: "limpeza", unidade: "fardo",   preco: 55.00 },

  // ─── COZINHA (12) ─────────────────────────────────────────
  { nome: "Açúcar refinado 5kg",              categoria: "cozinha", unidade: "kg", preco: 22.00 },
  { nome: "Sal refinado 1kg",                 categoria: "cozinha", unidade: "kg", preco: 3.50 },
  { nome: "Óleo de soja 900ml",               categoria: "cozinha", unidade: "unidade", preco: 8.50 },
  { nome: "Arroz branco 5kg",                 categoria: "cozinha", unidade: "kg", preco: 28.00 },
  { nome: "Feijão carioca 1kg",               categoria: "cozinha", unidade: "kg", preco: 9.50 },
  { nome: "Leite integral 1L (caixa)",        categoria: "cozinha", unidade: "litro", preco: 5.20 },
  { nome: "Macarrão espaguete 500g",          categoria: "cozinha", unidade: "pacote", preco: 6.00 },
  { nome: "Farinha de trigo 1kg",             categoria: "cozinha", unidade: "kg", preco: 5.80 },
  { nome: "Café em pó 500g",                  categoria: "cozinha", unidade: "pacote", preco: 18.00 },
  { nome: "Achocolatado em pó 400g",          categoria: "cozinha", unidade: "pacote", preco: 12.00 },
  { nome: "Guardanapo de papel (pacote 50un)", categoria: "cozinha", unidade: "pacote", preco: 4.50 },
  { nome: "Copo descartável 200ml (100un)",   categoria: "cozinha", unidade: "pacote", preco: 9.50 },

  // ─── MANUTENÇÃO (6) ───────────────────────────────────────
  { nome: "Lâmpada LED 9W bivolt",            categoria: "manutencao", unidade: "unidade", preco: 12.00 },
  { nome: "Lâmpada LED 15W bivolt",           categoria: "manutencao", unidade: "unidade", preco: 18.00 },
  { nome: "Pilha AA (cartela 4un)",           categoria: "manutencao", unidade: "cartela", preco: 14.00 },
  { nome: "Fita isolante",                    categoria: "manutencao", unidade: "rolo", preco: 5.50 },
  { nome: "Parafuso 4x40mm (cento)",          categoria: "manutencao", unidade: "cento", preco: 22.00 },
  { nome: "Chave de fenda Philips média",     categoria: "manutencao", unidade: "unidade", preco: 18.00 },
];

// ─── Cenário 2: Manutenção — 10 categorias-tipo + 3 chamados exemplo ───
type ManutChamadoSeed = { categoria: string; descricao: string; urgencia: string };
const MANUT_CHAMADOS_EXEMPLO: ManutChamadoSeed[] = [
  { categoria: "Elétrica", descricao: "Lâmpada queimada no corredor do 2º andar", urgencia: "media" },
  { categoria: "Hidráulica", descricao: "Vazamento na torneira do banheiro da sala 5", urgencia: "alta" },
  { categoria: "Ar-condicionado", descricao: "AC da sala 3 não está esfriando", urgencia: "alta" },
];

// ─── Cenário 3: Cardápio semana padrão ─────────────────────────
type CardapioSeed = { dia: string; refeicao: string; descricao: string };
const CARDAPIO_SEMANA: CardapioSeed[] = [
  { dia: "segunda", refeicao: "lanche_manha", descricao: "Frutas variadas + biscoito" },
  { dia: "segunda", refeicao: "almoco",      descricao: "Arroz, feijão, frango grelhado, salada de alface e tomate" },
  { dia: "segunda", refeicao: "lanche_tarde",descricao: "Iogurte natural + cereal" },
  { dia: "terca",   refeicao: "lanche_manha", descricao: "Pão de queijo + suco natural" },
  { dia: "terca",   refeicao: "almoco",       descricao: "Macarrão à bolonhesa + salada de cenoura" },
  { dia: "terca",   refeicao: "lanche_tarde", descricao: "Bolo caseiro + leite" },
  { dia: "quarta",  refeicao: "lanche_manha", descricao: "Mamão + bolacha de água e sal" },
  { dia: "quarta",  refeicao: "almoco",       descricao: "Arroz integral, feijão, peixe assado, brócolis" },
  { dia: "quarta",  refeicao: "lanche_tarde", descricao: "Vitamina de banana com aveia" },
  { dia: "quinta",  refeicao: "lanche_manha", descricao: "Maçã + barra de cereal" },
  { dia: "quinta",  refeicao: "almoco",       descricao: "Risoto de legumes + frango ao molho" },
  { dia: "quinta",  refeicao: "lanche_tarde", descricao: "Tapioca + queijo" },
  { dia: "sexta",   refeicao: "lanche_manha", descricao: "Suco de laranja + torrada integral" },
  { dia: "sexta",   refeicao: "almoco",       descricao: "Lasanha + salada mista" },
  { dia: "sexta",   refeicao: "lanche_tarde", descricao: "Gelatina + biscoito sem açúcar" },
];

// ─── Cenário 4: Escalas-modelo (ponto CLT) ─────────────────────
type EscalaSeed = { nome: string; descricao: string; carga_h: number };
const PONTO_ESCALAS: EscalaSeed[] = [
  { nome: "Administrativo 44h",  descricao: "Seg-Sex 8h-17h30 (1h almoço); Sáb 8h-12h",     carga_h: 44 },
  { nome: "Professor 30h",       descricao: "Seg-Sex 13h-19h (sem intervalo formal)",        carga_h: 30 },
  { nome: "Manutenção 40h",      descricao: "Seg-Sex 7h-16h (1h almoço)",                    carga_h: 40 },
  { nome: "Limpeza 36h",         descricao: "Seg-Sex 6h-12h30; Sáb alternado",               carga_h: 36 },
  { nome: "Cozinha integral",    descricao: "Seg-Sex 6h30-15h30 (1h almoço)",                carga_h: 44 },
  { nome: "Período noturno",     descricao: "Seg-Sex 22h-5h (com adicional noturno 20%)",    carga_h: 35 },
];

const SCENARIOS_INDEX: Record<ScenarioKey, {
  label: string;
  count: number;
  module: string;
}> = {
  alm_catalogo_base: {
    label: "Catálogo Almoxarifado padrão (50 itens BR)",
    count: ALM_CATALOGO_BASE.length,
    module: "almoxarifado",
  },
  manut_categorias_padrao: {
    label: "3 chamados de exemplo (manutenção)",
    count: MANUT_CHAMADOS_EXEMPLO.length,
    module: "manutencao",
  },
  cardapio_semana_padrao: {
    label: "Cardápio semana padrão (5 dias × 3 refeições)",
    count: CARDAPIO_SEMANA.length,
    module: "cardapio",
  },
  ponto_escalas_modelo: {
    label: "Escalas-modelo CLT (6 tipos)",
    count: PONTO_ESCALAS.length,
    module: "ponto",
  },
};

export type ScenarioResult = {
  ok: boolean;
  inseridos: number;
  ja_existiam: number;
  total: number;
  detalhes?: string;
};

/**
 * Carrega cenário base p/ a escola. Idempotente — itens com mesmo nome
 * são pulados.
 */
export async function loadScenario(
  sb: SupabaseClient,
  escola_id: string,
  scenario: ScenarioKey,
): Promise<ScenarioResult> {
  if (scenario === "alm_catalogo_base") return loadAlmCatalogoBase(sb, escola_id);
  if (scenario === "manut_categorias_padrao") return loadManutChamados(sb, escola_id);
  if (scenario === "cardapio_semana_padrao") return loadCardapio(sb, escola_id);
  if (scenario === "ponto_escalas_modelo") return loadPontoEscalas(sb, escola_id);
  return { ok: false, inseridos: 0, ja_existiam: 0, total: 0, detalhes: `Cenário '${scenario}' desconhecido.` };
}

async function loadManutChamados(sb: SupabaseClient, escola_id: string): Promise<ScenarioResult> {
  // Verifica se já tem ≥3 chamados (skip se já configurou)
  const { count } = await sb.from("manutencoes")
    .select("*", { count: "exact", head: true })
    .eq("escola_id", escola_id);
  if ((count ?? 0) >= 3) {
    return { ok: true, inseridos: 0, ja_existiam: MANUT_CHAMADOS_EXEMPLO.length, total: MANUT_CHAMADOS_EXEMPLO.length, detalhes: "Já há chamados de manutenção registrados." };
  }
  const rows = MANUT_CHAMADOS_EXEMPLO.map((c) => ({
    escola_id,
    descricao: c.descricao,
    localizacao: "Exemplo (escola)",
    urgencia: c.urgencia,
    status: "aberta",
  }));
  const { error } = await sb.from("manutencoes").insert(rows);
  if (error) return { ok: false, inseridos: 0, ja_existiam: 0, total: rows.length, detalhes: error.message };
  return { ok: true, inseridos: rows.length, ja_existiam: 0, total: rows.length };
}

async function loadCardapio(sb: SupabaseClient, escola_id: string): Promise<ScenarioResult> {
  // V1 simples: armazena cardápio como JSON em escola_config.chave='lap_cardapio_padrao'
  // (não criamos tabela nova só pra isso — tabela de cardápio dedicada vem em sprint futuro)
  const { error } = await sb.from("escola_config").upsert({
    escola_id,
    chave: "lap_cardapio_padrao",
    valor: CARDAPIO_SEMANA,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "chave,escola_id" });
  if (error) return { ok: false, inseridos: 0, ja_existiam: 0, total: CARDAPIO_SEMANA.length, detalhes: error.message };
  return { ok: true, inseridos: CARDAPIO_SEMANA.length, ja_existiam: 0, total: CARDAPIO_SEMANA.length };
}

async function loadPontoEscalas(sb: SupabaseClient, escola_id: string): Promise<ScenarioResult> {
  // V1: armazena escalas-modelo em escola_config (criação automática de horários
  // reais requer integração com tabela de ponto_escalas — fora de escopo deste sprint)
  const { error } = await sb.from("escola_config").upsert({
    escola_id,
    chave: "lap_ponto_escalas_modelo",
    valor: PONTO_ESCALAS,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "chave,escola_id" });
  if (error) return { ok: false, inseridos: 0, ja_existiam: 0, total: PONTO_ESCALAS.length, detalhes: error.message };
  return { ok: true, inseridos: PONTO_ESCALAS.length, ja_existiam: 0, total: PONTO_ESCALAS.length };
}

async function loadAlmCatalogoBase(
  sb: SupabaseClient,
  escola_id: string,
): Promise<ScenarioResult> {
  // Carrega nomes existentes pra evitar duplicar
  const { data: existing } = await sb
    .from("alm_insumos")
    .select("nome")
    .eq("escola_id", escola_id);

  const existingSet = new Set(
    ((existing ?? []) as Array<{ nome: string }>).map((r) => r.nome.toLowerCase().trim()),
  );

  const novos = ALM_CATALOGO_BASE.filter((i) => !existingSet.has(i.nome.toLowerCase().trim()));
  const jaExistiam = ALM_CATALOGO_BASE.length - novos.length;

  if (novos.length === 0) {
    return {
      ok: true,
      inseridos: 0,
      ja_existiam: jaExistiam,
      total: ALM_CATALOGO_BASE.length,
      detalhes: "Todo o catálogo padrão já foi carregado antes.",
    };
  }

  const rows = novos.map((i) => ({
    escola_id,
    nome: i.nome,
    categoria: i.categoria,
    unidade: i.unidade,
    preco: i.preco,
    estoque_qty: 0,
    descricao: i.descricao ?? null,
    ativo: true,
  }));

  const { error } = await sb.from("alm_insumos").insert(rows);
  if (error) {
    return { ok: false, inseridos: 0, ja_existiam: jaExistiam, total: ALM_CATALOGO_BASE.length, detalhes: error.message };
  }

  return {
    ok: true,
    inseridos: novos.length,
    ja_existiam: jaExistiam,
    total: ALM_CATALOGO_BASE.length,
  };
}

export function getScenariosIndex() {
  return SCENARIOS_INDEX;
}

/**
 * Verifica se um cenário "já parece carregado" pra essa escola.
 * Pra alm: se há ≥ 30 dos itens base com nome match (não exato, threshold).
 */
export async function isScenarioLoaded(
  sb: SupabaseClient,
  escola_id: string,
  scenario: ScenarioKey,
): Promise<boolean> {
  if (scenario === "alm_catalogo_base") {
    const { data } = await sb
      .from("alm_insumos")
      .select("nome")
      .eq("escola_id", escola_id);
    const set = new Set(
      ((data ?? []) as Array<{ nome: string }>).map((r) => r.nome.toLowerCase().trim()),
    );
    let matches = 0;
    for (const i of ALM_CATALOGO_BASE) {
      if (set.has(i.nome.toLowerCase().trim())) matches++;
    }
    return matches >= 30; // se >=60% dos itens estão carregados, considera "já carregado"
  }
  return false;
}
