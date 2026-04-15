-- ═══════════════════════════════════════════════════════════════
--  Migration 227 — Módulo Cozinha (Merenda Escolar Interna)
--
--  Escopo: cardápio nutricional, receitas/fichas técnicas,
--  estoque de alimentos com validade (FIFO), compras, controle
--  sanitário (RDC 216 ANVISA), amostras testemunha 72h,
--  desperdício, rastreabilidade de lote.
--
--  Alergias/restrições reutilizam cantina_restricoes (já existente).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. CONFIG COZINHA (por escola) ─────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_config (
  escola_id            uuid PRIMARY KEY REFERENCES escolas(id) ON DELETE CASCADE,
  nutricionista_nome   text,
  nutricionista_crn    text,
  nutricionista_email  text,
  custo_refeicao_meta  numeric(10,2),     -- R$ por porção (meta)
  tolerancia_temp_geladeira numeric(4,1) DEFAULT 7.0,   -- °C máx
  tolerancia_temp_freezer   numeric(4,1) DEFAULT -12.0, -- °C máx
  amostra_horas        smallint DEFAULT 72,              -- ANVISA RDC 216
  observacoes          text,
  atualizado_em        timestamptz DEFAULT now()
);

-- ── 2. ALIMENTOS (catálogo) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_alimentos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome              text NOT NULL,
  categoria         text,               -- cereais, proteinas, hortalicas, frutas, laticinios, tempero, bebidas
  unidade_compra    text DEFAULT 'kg',  -- kg, pct, un, L, caixa
  unidade_uso       text DEFAULT 'g',   -- g, ml, un
  fator_conversao   numeric(10,4) DEFAULT 1000, -- 1 kg = 1000 g
  estoque_minimo    numeric(10,3) DEFAULT 0,    -- na unidade_uso
  temperatura       text DEFAULT 'seco',        -- seco, refrigerado, congelado
  preco_medio       numeric(10,2),
  kcal_100g         numeric(6,1),
  proteina_g_100g   numeric(5,2),
  carbo_g_100g      numeric(5,2),
  gordura_g_100g    numeric(5,2),
  sodio_mg_100g     numeric(6,1),
  alergenos         text[],             -- ['gluten','lactose','ovo','soja','amendoim']
  ativo             boolean DEFAULT true,
  criado_em         timestamptz DEFAULT now(),
  UNIQUE(escola_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_cozinha_alimentos_escola ON cozinha_alimentos(escola_id, ativo);

-- ── 3. LOTES (FIFO + rastreabilidade) ──────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_alimento_lotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  alimento_id       uuid NOT NULL REFERENCES cozinha_alimentos(id) ON DELETE CASCADE,
  lote              text,
  quantidade        numeric(12,3) NOT NULL,   -- na unidade_uso
  quantidade_inicial numeric(12,3) NOT NULL,
  validade          date,
  nota_fiscal       text,
  fornecedor        text,
  preco_unitario    numeric(10,4),            -- por unidade_uso
  recebido_em       timestamptz DEFAULT now(),
  recebido_por      text,
  conferido         boolean DEFAULT false,
  observacao        text,
  criado_em         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cozinha_lotes_alimento ON cozinha_alimento_lotes(alimento_id, validade);
CREATE INDEX IF NOT EXISTS idx_cozinha_lotes_escola_val ON cozinha_alimento_lotes(escola_id, validade)
  WHERE quantidade > 0;

-- ── 4. RECEITAS / FICHAS TÉCNICAS ──────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_receitas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome              text NOT NULL,
  categoria         text,               -- prato_principal, acompanhamento, salada, sopa, lanche, bebida, sobremesa
  faixa_etaria      text[],             -- ['bercario','maternal','fundamental1','fundamental2']
  rendimento_porcoes integer DEFAULT 1,
  tempo_preparo_min integer,
  modo_preparo      text,
  observacoes       text,
  ativa             boolean DEFAULT true,
  criado_em         timestamptz DEFAULT now(),
  atualizado_em     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cozinha_receitas_escola ON cozinha_receitas(escola_id, ativa);

CREATE TABLE IF NOT EXISTS cozinha_receita_ingredientes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receita_id        uuid NOT NULL REFERENCES cozinha_receitas(id) ON DELETE CASCADE,
  alimento_id       uuid NOT NULL REFERENCES cozinha_alimentos(id) ON DELETE RESTRICT,
  quantidade        numeric(10,3) NOT NULL,   -- na unidade_uso do alimento, por PORÇÃO
  unidade           text,                      -- opcional, usa alimento.unidade_uso
  observacao        text
);
CREATE INDEX IF NOT EXISTS idx_cozinha_receita_ing ON cozinha_receita_ingredientes(receita_id);

-- ── 5. CARDÁPIOS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_cardapios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  data              date NOT NULL,
  refeicao          text NOT NULL,      -- cafe, lanche_manha, almoco, lanche_tarde, jantar
  faixa_etaria      text,               -- bercario, maternal, fundamental1, fundamental2, todos
  receita_id        uuid REFERENCES cozinha_receitas(id) ON DELETE SET NULL,
  descricao_livre   text,               -- se não usar receita
  observacoes       text,
  aprovado_por      text,               -- nome nutricionista
  aprovado_crn      text,
  aprovado_em       timestamptz,
  publicado         boolean DEFAULT false,
  publicado_em      timestamptz,
  criado_em         timestamptz DEFAULT now(),
  UNIQUE(escola_id, data, refeicao, faixa_etaria)
);
CREATE INDEX IF NOT EXISTS idx_cozinha_cardapios_data ON cozinha_cardapios(escola_id, data);

-- ── 6. COMPRAS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_compras (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  numero            serial,
  status            text DEFAULT 'rascunho',  -- rascunho, cotacao, aprovada, enviada, recebida, cancelada
  fornecedor        text,
  fornecedor_cnpj   text,
  fornecedor_contato text,
  total             numeric(12,2) DEFAULT 0,
  data_pedido       date,
  data_entrega_prev date,
  data_recebimento  timestamptz,
  nota_fiscal       text,
  aprovado_por      text,
  aprovado_em       timestamptz,
  observacoes       text,
  criado_por        text,
  criado_em         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cozinha_compras_escola ON cozinha_compras(escola_id, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS cozinha_compra_itens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id         uuid NOT NULL REFERENCES cozinha_compras(id) ON DELETE CASCADE,
  alimento_id       uuid NOT NULL REFERENCES cozinha_alimentos(id) ON DELETE RESTRICT,
  quantidade        numeric(12,3) NOT NULL,
  unidade           text,
  preco_unitario    numeric(10,4),
  subtotal          numeric(12,2),
  recebido_qtd      numeric(12,3),
  lote_gerado_id    uuid REFERENCES cozinha_alimento_lotes(id) ON DELETE SET NULL,
  observacao        text
);
CREATE INDEX IF NOT EXISTS idx_cozinha_compra_itens ON cozinha_compra_itens(compra_id);

-- ── 7. SANITÁRIO — TEMPERATURA ─────────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_temperatura_registros (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  equipamento       text NOT NULL,      -- geladeira_1, freezer_1, etc
  tipo              text,               -- refrigerado, congelado, ambiente
  temperatura       numeric(5,1) NOT NULL,
  periodo           text,               -- manha, tarde
  conforme          boolean,
  acao_corretiva    text,
  registrado_por    text,
  registrado_em     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cozinha_temp_escola ON cozinha_temperatura_registros(escola_id, registrado_em DESC);

-- ── 8. SANITÁRIO — HIGIENIZAÇÃO ────────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_higienizacao_tarefas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome              text NOT NULL,
  area              text,               -- bancada, piso, geladeira, freezer, estoque, utensílios
  periodicidade     text NOT NULL,      -- diaria, semanal, quinzenal, mensal
  ativa             boolean DEFAULT true,
  criado_em         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cozinha_higienizacao_execucoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tarefa_id         uuid NOT NULL REFERENCES cozinha_higienizacao_tarefas(id) ON DELETE CASCADE,
  executado_por     text,
  executado_em      timestamptz DEFAULT now(),
  observacao        text,
  conforme          boolean DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_cozinha_hig_exec ON cozinha_higienizacao_execucoes(tarefa_id, executado_em DESC);

-- ── 9. AMOSTRAS TESTEMUNHA (ANVISA RDC 216 — 72h) ──────────────
CREATE TABLE IF NOT EXISTS cozinha_amostras (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  data              date NOT NULL,
  refeicao          text NOT NULL,
  receita_id        uuid REFERENCES cozinha_receitas(id) ON DELETE SET NULL,
  descricao         text,
  coletado_por      text,
  coletado_em       timestamptz DEFAULT now(),
  armazenado_ate    timestamptz,        -- coletado_em + amostra_horas
  descartado_em     timestamptz,
  descartado_por    text,
  lotes_utilizados  uuid[],             -- rastreabilidade
  observacao        text
);
CREATE INDEX IF NOT EXISTS idx_cozinha_amostras ON cozinha_amostras(escola_id, coletado_em DESC);

-- ── 10. DESPERDÍCIO ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cozinha_desperdicio (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  data              date NOT NULL,
  refeicao          text NOT NULL,
  receita_id        uuid REFERENCES cozinha_receitas(id) ON DELETE SET NULL,
  porcoes_preparadas integer,
  porcoes_servidas  integer,
  sobra_limpa_kg    numeric(8,3),       -- não servida (volta p/ estoque / descarte)
  sobra_suja_kg     numeric(8,3),       -- prato do aluno (desperdício real)
  per_capita_g      numeric(8,2),       -- calculado
  observacao        text,
  registrado_por    text,
  registrado_em     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cozinha_desp ON cozinha_desperdicio(escola_id, data DESC);

-- ── 11. CONSUMO (baixa de estoque por refeição) ────────────────
CREATE TABLE IF NOT EXISTS cozinha_consumo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  cardapio_id       uuid REFERENCES cozinha_cardapios(id) ON DELETE SET NULL,
  alimento_id       uuid NOT NULL REFERENCES cozinha_alimentos(id) ON DELETE RESTRICT,
  lote_id           uuid REFERENCES cozinha_alimento_lotes(id) ON DELETE SET NULL,
  quantidade        numeric(12,3) NOT NULL,
  custo_total       numeric(10,2),
  data              date NOT NULL,
  refeicao          text,
  registrado_em     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cozinha_consumo ON cozinha_consumo(escola_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_cozinha_consumo_alim ON cozinha_consumo(alimento_id);

-- ── 12. RLS (policy escola_id) ─────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'cozinha_config','cozinha_alimentos','cozinha_alimento_lotes',
    'cozinha_receitas','cozinha_receita_ingredientes','cozinha_cardapios',
    'cozinha_compras','cozinha_compra_itens','cozinha_temperatura_registros',
    'cozinha_higienizacao_tarefas','cozinha_higienizacao_execucoes',
    'cozinha_amostras','cozinha_desperdicio','cozinha_consumo'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY %I_service ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- ── 13. HELPERS SQL ────────────────────────────────────────────

-- Estoque atual por alimento (soma de lotes com qty > 0, ignorando vencidos)
CREATE OR REPLACE VIEW v_cozinha_estoque AS
SELECT
  a.id AS alimento_id,
  a.escola_id,
  a.nome,
  a.categoria,
  a.unidade_uso,
  a.estoque_minimo,
  a.temperatura,
  COALESCE(SUM(CASE WHEN l.validade IS NULL OR l.validade >= CURRENT_DATE THEN l.quantidade ELSE 0 END), 0) AS estoque_valido,
  COALESCE(SUM(CASE WHEN l.validade < CURRENT_DATE THEN l.quantidade ELSE 0 END), 0) AS estoque_vencido,
  MIN(CASE WHEN l.validade IS NOT NULL AND l.quantidade > 0 THEN l.validade END) AS proxima_validade
FROM cozinha_alimentos a
LEFT JOIN cozinha_alimento_lotes l ON l.alimento_id = a.id AND l.quantidade > 0
WHERE a.ativo = true
GROUP BY a.id;

-- Baixa FIFO de estoque (consome lotes mais próximos do vencimento primeiro)
CREATE OR REPLACE FUNCTION cozinha_baixar_estoque(
  p_escola uuid,
  p_alimento uuid,
  p_qtd numeric,
  p_cardapio uuid DEFAULT NULL,
  p_data date DEFAULT CURRENT_DATE,
  p_refeicao text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_restante numeric := p_qtd;
  v_lote record;
  v_baixa numeric;
  v_custo_total numeric := 0;
  v_lotes_usados uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_qtd <= 0 THEN RETURN jsonb_build_object('ok', true, 'lotes', '[]'::jsonb); END IF;

  FOR v_lote IN
    SELECT id, quantidade, preco_unitario
    FROM cozinha_alimento_lotes
    WHERE alimento_id = p_alimento AND escola_id = p_escola AND quantidade > 0
      AND (validade IS NULL OR validade >= CURRENT_DATE)
    ORDER BY validade NULLS LAST, recebido_em
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_baixa := LEAST(v_restante, v_lote.quantidade);
    UPDATE cozinha_alimento_lotes SET quantidade = quantidade - v_baixa WHERE id = v_lote.id;
    INSERT INTO cozinha_consumo(escola_id, cardapio_id, alimento_id, lote_id, quantidade, custo_total, data, refeicao)
      VALUES (p_escola, p_cardapio, p_alimento, v_lote.id, v_baixa, COALESCE(v_lote.preco_unitario,0)*v_baixa, p_data, p_refeicao);
    v_custo_total := v_custo_total + COALESCE(v_lote.preco_unitario,0)*v_baixa;
    v_lotes_usados := array_append(v_lotes_usados, v_lote.id);
    v_restante := v_restante - v_baixa;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_restante <= 0,
    'baixado', p_qtd - v_restante,
    'faltante', v_restante,
    'custo_total', v_custo_total,
    'lotes', to_jsonb(v_lotes_usados)
  );
END $$ LANGUAGE plpgsql;

-- Projeção de compras: cardápio futuro × porções previstas − estoque
CREATE OR REPLACE FUNCTION cozinha_projetar_compras(
  p_escola uuid,
  p_dias integer DEFAULT 7,
  p_porcoes_padrao integer DEFAULT 100
) RETURNS TABLE (
  alimento_id uuid,
  nome text,
  unidade text,
  necessario numeric,
  estoque_atual numeric,
  a_comprar numeric,
  preco_estimado numeric
) AS $$
  SELECT
    a.id,
    a.nome,
    a.unidade_uso,
    SUM(ri.quantidade * p_porcoes_padrao)::numeric AS necessario,
    COALESCE(v.estoque_valido, 0) AS estoque_atual,
    GREATEST(0, SUM(ri.quantidade * p_porcoes_padrao) - COALESCE(v.estoque_valido, 0))::numeric AS a_comprar,
    (GREATEST(0, SUM(ri.quantidade * p_porcoes_padrao) - COALESCE(v.estoque_valido, 0)) * COALESCE(a.preco_medio,0))::numeric AS preco_estimado
  FROM cozinha_cardapios c
  JOIN cozinha_receitas r ON r.id = c.receita_id
  JOIN cozinha_receita_ingredientes ri ON ri.receita_id = r.id
  JOIN cozinha_alimentos a ON a.id = ri.alimento_id
  LEFT JOIN v_cozinha_estoque v ON v.alimento_id = a.id
  WHERE c.escola_id = p_escola
    AND c.data BETWEEN CURRENT_DATE AND CURRENT_DATE + (p_dias||' days')::interval
  GROUP BY a.id, a.nome, a.unidade_uso, v.estoque_valido, a.preco_medio
  HAVING SUM(ri.quantidade * p_porcoes_padrao) > COALESCE(v.estoque_valido, 0)
  ORDER BY a_comprar DESC;
$$ LANGUAGE sql STABLE;

-- ── 14. SEED DE HIGIENIZAÇÃO BASE ──────────────────────────────
-- Tarefas criadas no onboarding da escola via trigger ou manualmente.
-- Não fazemos seed global aqui — cada escola gerencia as suas.

-- ── 15. MÓDULO NO CATÁLOGO ─────────────────────────────────────
INSERT INTO modulos (slug, nome, descricao, icone, grupo, portais, ordem, ativo)
VALUES (
  'cozinha',
  'Cozinha',
  'Merenda escolar interna: cardápio nutricional, estoque FIFO com validade, compras, controle sanitário (ANVISA RDC 216), amostras testemunha 72h, desperdício.',
  '🍳',
  'operacional',
  ARRAY['gerente','professora'],
  90,
  true
) ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  icone = EXCLUDED.icone,
  grupo = EXCLUDED.grupo,
  portais = EXCLUDED.portais;

-- Habilitar nos planos Automação, Avançado e Rede
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id
FROM planos p, modulos m
WHERE p.slug IN ('automacao','avancado','rede')
  AND m.slug = 'cozinha'
ON CONFLICT DO NOTHING;
