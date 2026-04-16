-- ═══════════════════════════════════════════════════════════════
--  Migration 247: Financeiro Interno Lumied
-- ═══════════════════════════════════════════════════════════════
--  Contas a pagar / receber da PRÓPRIA Lumied (não da escola).
--  CP tem divisão por centro de custo + categoria hierárquica.
--  CR cobre recebimentos SaaS + consultoria + outros.
--  Isolado do módulo financeiro das escolas (fin_boletos_batch etc).
-- ═══════════════════════════════════════════════════════════════

-- ── Centros de Custo ──
CREATE TABLE IF NOT EXISTS lumied_centros_custo (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT UNIQUE NOT NULL,
  codigo     TEXT UNIQUE,                -- ex: "TI", "COM", "CS"
  descricao  TEXT,
  ativo      BOOLEAN DEFAULT TRUE,
  criado_em  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO lumied_centros_custo (nome, codigo, descricao) VALUES
  ('TI / Infraestrutura', 'TI',    'Servidores, Supabase, Vercel, Cloudflare, domínios.'),
  ('Comercial',            'COM',  'Aquisição de clientes, mídia paga, eventos.'),
  ('Customer Success',     'CS',   'Onboarding, suporte proativo, retenção.'),
  ('Produto & Engenharia', 'ENG',  'Claude API, ferramentas de dev, SaaS de produto.'),
  ('Marketing',            'MKT',  'Conteúdo, SEO, branding.'),
  ('Administrativo',       'ADM',  'Contabilidade, jurídico, bancos, impostos.'),
  ('RH',                   'RH',   'Folha, benefícios, treinamentos.')
ON CONFLICT (nome) DO NOTHING;

-- ── Categorias de Despesa (hierárquica pai/filho) ──
CREATE TABLE IF NOT EXISTS lumied_categorias_despesa (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  parent_id  UUID REFERENCES lumied_categorias_despesa(id) ON DELETE RESTRICT,
  tipo       TEXT NOT NULL DEFAULT 'despesa' CHECK (tipo IN ('despesa','receita')),
  ativo      BOOLEAN DEFAULT TRUE,
  criado_em  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nome, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_cat_parent ON lumied_categorias_despesa(parent_id);

-- Seed: categorias raiz
INSERT INTO lumied_categorias_despesa (nome, tipo) VALUES
  ('Infraestrutura Cloud', 'despesa'),
  ('Software / SaaS',       'despesa'),
  ('Pessoal (CLT + PJ)',    'despesa'),
  ('Marketing & Vendas',    'despesa'),
  ('Operacional',           'despesa'),
  ('Impostos & Taxas',      'despesa'),
  ('Outros',                'despesa'),
  ('Receita SaaS',          'receita'),
  ('Consultoria',           'receita'),
  ('Implantação',           'receita')
ON CONFLICT (nome, parent_id) DO NOTHING;

-- Seed: subcategorias de Infraestrutura
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Supabase', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Infraestrutura Cloud' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Vercel', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Infraestrutura Cloud' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Cloudflare', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Infraestrutura Cloud' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Domínio & DNS', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Infraestrutura Cloud' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;

-- Seed: subcategorias de Software
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Claude API (Anthropic)', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Software / SaaS' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Resend (email)', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Software / SaaS' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Sentry', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Software / SaaS' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'GitHub', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Software / SaaS' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;

-- Seed: subcategorias de Pessoal
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Salário CLT', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Pessoal (CLT + PJ)' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'PJ / Freelancers', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Pessoal (CLT + PJ)' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;
INSERT INTO lumied_categorias_despesa (nome, parent_id, tipo)
SELECT 'Benefícios', id, 'despesa' FROM lumied_categorias_despesa WHERE nome='Pessoal (CLT + PJ)' AND parent_id IS NULL
ON CONFLICT (nome, parent_id) DO NOTHING;

-- ── Contas a Pagar ──
CREATE TABLE IF NOT EXISTS lumied_contas_pagar (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor        TEXT NOT NULL,
  documento         TEXT,                            -- nº NF, fatura, contrato
  descricao         TEXT,
  valor             NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  valor_pago        NUMERIC(12,2),
  data_emissao      DATE,
  data_vencimento   DATE NOT NULL,
  data_pagamento    DATE,
  centro_custo_id   UUID REFERENCES lumied_centros_custo(id) ON DELETE SET NULL,
  categoria_id      UUID REFERENCES lumied_categorias_despesa(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'aberto'
                    CHECK (status IN ('aberto','pago','cancelado','vencido')),
  forma_pagamento   TEXT,                            -- boleto, pix, ted, cartao, dinheiro
  anexo_url         TEXT,                            -- NF ou comprovante em storage
  observacao        TEXT,
  criado_por_staff_id UUID REFERENCES lumied_staff(id),
  pago_por_staff_id   UUID REFERENCES lumied_staff(id),
  criado_em         TIMESTAMPTZ DEFAULT now(),
  atualizado_em     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cp_status     ON lumied_contas_pagar(status);
CREATE INDEX IF NOT EXISTS idx_cp_venc       ON lumied_contas_pagar(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cp_centro     ON lumied_contas_pagar(centro_custo_id);
CREATE INDEX IF NOT EXISTS idx_cp_categoria  ON lumied_contas_pagar(categoria_id);

-- ── Contas a Receber ──
CREATE TABLE IF NOT EXISTS lumied_contas_receber (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origem            TEXT NOT NULL CHECK (origem IN ('saas','consultoria','implantacao','outros')),
  escola_id         UUID REFERENCES escolas(id) ON DELETE SET NULL,
  descricao         TEXT,
  valor             NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  valor_recebido    NUMERIC(12,2),
  data_emissao      DATE,
  data_vencimento   DATE NOT NULL,
  data_recebimento  DATE,
  status            TEXT NOT NULL DEFAULT 'aberto'
                    CHECK (status IN ('aberto','recebido','cancelado','vencido')),
  forma_pagamento   TEXT,
  observacao        TEXT,
  -- Quando origem='saas', pode referenciar a fatura correspondente para evitar duplicidade
  saas_fatura_id    UUID REFERENCES saas_faturas(id) ON DELETE SET NULL,
  criado_por_staff_id UUID REFERENCES lumied_staff(id),
  criado_em         TIMESTAMPTZ DEFAULT now(),
  atualizado_em     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cr_status ON lumied_contas_receber(status);
CREATE INDEX IF NOT EXISTS idx_cr_venc   ON lumied_contas_receber(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_escola ON lumied_contas_receber(escola_id);

-- ── Trigger: atualizar status='vencido' automaticamente (opcional via função/cron) ──
CREATE OR REPLACE FUNCTION marcar_vencidos_lumied() RETURNS void AS $$
BEGIN
  UPDATE lumied_contas_pagar SET status='vencido'
   WHERE status='aberto' AND data_vencimento < CURRENT_DATE;
  UPDATE lumied_contas_receber SET status='vencido'
   WHERE status='aberto' AND data_vencimento < CURRENT_DATE;
END $$ LANGUAGE plpgsql;
COMMENT ON FUNCTION marcar_vencidos_lumied IS 'Roda 1x/dia via pg_cron para marcar CP/CR vencidos.';

-- ── Views analíticas ──

-- CP no mês corrente agregado por centro de custo
CREATE OR REPLACE VIEW v_cp_por_centro_mes AS
SELECT
  cc.id AS centro_id, cc.nome AS centro_nome, cc.codigo,
  COUNT(cp.id) FILTER (WHERE cp.status='aberto') AS qtd_aberto,
  COALESCE(SUM(cp.valor) FILTER (WHERE cp.status='aberto'), 0) AS total_aberto,
  COALESCE(SUM(cp.valor_pago) FILTER (WHERE cp.status='pago' AND cp.data_pagamento >= date_trunc('month', CURRENT_DATE)::date), 0) AS total_pago_mes
FROM lumied_centros_custo cc
LEFT JOIN lumied_contas_pagar cp ON cp.centro_custo_id = cc.id
WHERE cc.ativo = TRUE
GROUP BY cc.id, cc.nome, cc.codigo
ORDER BY total_aberto DESC;

-- CP agregado por categoria raiz
CREATE OR REPLACE VIEW v_cp_por_categoria AS
SELECT
  COALESCE(raiz.id, cat.id) AS categoria_id,
  COALESCE(raiz.nome, cat.nome) AS categoria_nome,
  COUNT(cp.id) FILTER (WHERE cp.status='aberto') AS qtd_aberto,
  COALESCE(SUM(cp.valor) FILTER (WHERE cp.status='aberto'), 0) AS total_aberto,
  COALESCE(SUM(cp.valor_pago) FILTER (WHERE cp.status='pago' AND cp.data_pagamento >= date_trunc('month', CURRENT_DATE)::date), 0) AS total_pago_mes
FROM lumied_categorias_despesa cat
LEFT JOIN lumied_categorias_despesa raiz ON raiz.id = cat.parent_id
LEFT JOIN lumied_contas_pagar cp ON cp.categoria_id = cat.id
GROUP BY COALESCE(raiz.id, cat.id), COALESCE(raiz.nome, cat.nome)
ORDER BY total_aberto DESC;

-- RLS (tabelas de uso interno do staff; DISABLE — controle via app)
ALTER TABLE lumied_centros_custo        DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumied_categorias_despesa   DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumied_contas_pagar         DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumied_contas_receber       DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE lumied_contas_pagar IS 'Contas a pagar da Lumied (fornecedores, salários, impostos).';
COMMENT ON TABLE lumied_contas_receber IS 'Contas a receber da Lumied (SaaS, consultoria, implantação).';
