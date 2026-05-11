-- ═══════════════════════════════════════════════════════════════
--  Migration 323: Plano de Contas padrão escola (NBC TG 1000)
--
--  Reestrutura o plano de contas seguindo as melhores práticas
--  contábeis brasileiras para instituições de ensino.
--
--  Numeração: 1=Ativo, 2=Passivo, 3=PL, 4=Receita, 5=Despesa
--  Grupos: circulante/nao_circulante, operacional/financeiro/fiscal
-- ═══════════════════════════════════════════════════════════════

-- 1. Add grupo/subgrupo columns for structured categorization
ALTER TABLE fin_plano_contas
  ADD COLUMN IF NOT EXISTS grupo text,        -- e.g. 'circulante', 'nao_circulante', 'csp', 'administrativa', 'comercial', 'financeira', 'fiscal', 'operacional'
  ADD COLUMN IF NOT EXISTS nivel int DEFAULT 2; -- 1=grupo, 2=conta, 3=subconta

-- 2. Delete old global (escola_id IS NULL) accounts — they cause duplicates
DELETE FROM fin_plano_contas WHERE escola_id IS NULL;

-- 3. Delete old accounts and re-seed per escola with proper NBC structure
-- First, preserve any lancamentos referencing old contas by setting to NULL
UPDATE fin_lancamentos SET conta_id = NULL WHERE conta_id IS NOT NULL;

-- Clear old seed data
DELETE FROM fin_plano_contas;

-- 4. Seed proper chart of accounts per escola
-- Uses a DO block to iterate over all escolas
DO $$
DECLARE
  eid uuid;
BEGIN
  FOR eid IN SELECT id FROM escolas LOOP

    -- ═══ ATIVO (1.x) ═══
    INSERT INTO fin_plano_contas (codigo, nome, tipo, grupo, nivel, escola_id) VALUES
      -- Ativo Circulante
      ('1.1',    'Ativo Circulante',              'ativo', 'circulante', 1, eid),
      ('1.1.01', 'Caixa',                         'ativo', 'circulante', 2, eid),
      ('1.1.02', 'Bancos Conta Movimento',         'ativo', 'circulante', 2, eid),
      ('1.1.03', 'Aplicações Financeiras CP',      'ativo', 'circulante', 2, eid),
      ('1.1.04', 'Mensalidades a Receber',         'ativo', 'circulante', 2, eid),
      ('1.1.05', 'Outros Créditos a Receber',      'ativo', 'circulante', 2, eid),
      ('1.1.06', 'Adiantamentos',                  'ativo', 'circulante', 2, eid),
      ('1.1.07', '(-) PDD - Provisão p/ Devedores Duvidosos', 'ativo', 'circulante', 2, eid),
      -- Ativo Não Circulante
      ('1.2',    'Ativo Não Circulante',           'ativo', 'nao_circulante', 1, eid),
      ('1.2.01', 'Terrenos',                       'ativo', 'nao_circulante', 2, eid),
      ('1.2.02', 'Edificações',                    'ativo', 'nao_circulante', 2, eid),
      ('1.2.03', 'Móveis e Utensílios',            'ativo', 'nao_circulante', 2, eid),
      ('1.2.04', 'Equipamentos e Informática',     'ativo', 'nao_circulante', 2, eid),
      ('1.2.05', 'Veículos',                       'ativo', 'nao_circulante', 2, eid),
      ('1.2.06', '(-) Depreciação Acumulada',      'ativo', 'nao_circulante', 2, eid),
      ('1.2.07', 'Intangível (Software/Licenças)', 'ativo', 'nao_circulante', 2, eid)
    ON CONFLICT DO NOTHING;

    -- ═══ PASSIVO (2.x) ═══
    INSERT INTO fin_plano_contas (codigo, nome, tipo, grupo, nivel, escola_id) VALUES
      -- Passivo Circulante
      ('2.1',    'Passivo Circulante',             'passivo', 'circulante', 1, eid),
      ('2.1.01', 'Fornecedores',                   'passivo', 'circulante', 2, eid),
      ('2.1.02', 'Salários a Pagar',               'passivo', 'circulante', 2, eid),
      ('2.1.03', 'FGTS a Recolher',                'passivo', 'circulante', 2, eid),
      ('2.1.04', 'INSS a Recolher',                'passivo', 'circulante', 2, eid),
      ('2.1.05', 'IRRF a Recolher',                'passivo', 'circulante', 2, eid),
      ('2.1.06', 'ISS a Recolher',                 'passivo', 'circulante', 2, eid),
      ('2.1.07', 'PIS/COFINS/CSLL a Recolher',     'passivo', 'circulante', 2, eid),
      ('2.1.08', 'Mensalidades Recebidas Antecipadamente', 'passivo', 'circulante', 2, eid),
      ('2.1.09', 'Provisão 13º Salário',           'passivo', 'circulante', 2, eid),
      ('2.1.10', 'Provisão de Férias',             'passivo', 'circulante', 2, eid),
      -- Passivo Não Circulante
      ('2.2',    'Passivo Não Circulante',         'passivo', 'nao_circulante', 1, eid),
      ('2.2.01', 'Empréstimos e Financiamentos LP','passivo', 'nao_circulante', 2, eid)
    ON CONFLICT DO NOTHING;

    -- ═══ PATRIMÔNIO LÍQUIDO (3.x) ═══
    INSERT INTO fin_plano_contas (codigo, nome, tipo, grupo, nivel, escola_id) VALUES
      ('3.1', 'Capital Social',                    'patrimonio', NULL, 2, eid),
      ('3.2', 'Reservas de Capital',               'patrimonio', NULL, 2, eid),
      ('3.3', 'Lucros/Prejuízos Acumulados',       'patrimonio', NULL, 2, eid)
    ON CONFLICT DO NOTHING;

    -- ═══ RECEITAS (4.x) ═══
    INSERT INTO fin_plano_contas (codigo, nome, tipo, grupo, nivel, escola_id) VALUES
      -- Receita Operacional
      ('4.1',    'Receita Operacional',            'receita', 'operacional', 1, eid),
      ('4.1.01', 'Mensalidades Escolares',         'receita', 'operacional', 2, eid),
      ('4.1.02', 'Taxa de Matrícula',              'receita', 'operacional', 2, eid),
      ('4.1.03', 'Atividades Extracurriculares',   'receita', 'operacional', 2, eid),
      ('4.1.04', 'Alimentação (Cantina)',           'receita', 'operacional', 2, eid),
      ('4.1.05', 'Transporte Escolar',             'receita', 'operacional', 2, eid),
      ('4.1.06', 'Material Didático',              'receita', 'operacional', 2, eid),
      ('4.1.07', 'Uniformes',                      'receita', 'operacional', 2, eid),
      ('4.1.08', 'Eventos e Festas',               'receita', 'operacional', 2, eid),
      -- Receita Financeira
      ('4.2',    'Receita Financeira',             'receita', 'financeira', 1, eid),
      ('4.2.01', 'Juros Recebidos (Atraso)',       'receita', 'financeira', 2, eid),
      ('4.2.02', 'Multa por Atraso',               'receita', 'financeira', 2, eid),
      ('4.2.03', 'Rendimentos de Aplicações',      'receita', 'financeira', 2, eid),
      -- Outras Receitas
      ('4.3',    'Outras Receitas',                'receita', 'outras', 1, eid),
      ('4.3.01', 'Doações Recebidas',              'receita', 'outras', 2, eid),
      ('4.3.02', 'Receitas Diversas',              'receita', 'outras', 2, eid)
    ON CONFLICT DO NOTHING;

    -- ═══ DESPESAS (5.x) ═══
    INSERT INTO fin_plano_contas (codigo, nome, tipo, grupo, nivel, escola_id) VALUES
      -- Custo dos Serviços Prestados (CSP)
      ('5.1',    'Custo dos Serviços Prestados',   'despesa', 'csp', 1, eid),
      ('5.1.01', 'Salários - Corpo Docente',       'despesa', 'csp', 2, eid),
      ('5.1.02', 'Encargos - Corpo Docente',       'despesa', 'csp', 2, eid),
      ('5.1.03', 'Material Pedagógico',            'despesa', 'csp', 2, eid),
      ('5.1.04', 'Alimentação Escolar',            'despesa', 'csp', 2, eid),
      ('5.1.05', 'Transporte Escolar',             'despesa', 'csp', 2, eid),
      -- Despesas Administrativas
      ('5.2',    'Despesas Administrativas',       'despesa', 'administrativa', 1, eid),
      ('5.2.01', 'Salários Administrativos',       'despesa', 'administrativa', 2, eid),
      ('5.2.02', 'Encargos Administrativos',       'despesa', 'administrativa', 2, eid),
      ('5.2.03', 'Aluguel',                        'despesa', 'administrativa', 2, eid),
      ('5.2.04', 'Condomínio',                     'despesa', 'administrativa', 2, eid),
      ('5.2.05', 'Energia Elétrica',               'despesa', 'administrativa', 2, eid),
      ('5.2.06', 'Água e Esgoto',                  'despesa', 'administrativa', 2, eid),
      ('5.2.07', 'Internet e Telefone',            'despesa', 'administrativa', 2, eid),
      ('5.2.08', 'Material de Escritório/Limpeza', 'despesa', 'administrativa', 2, eid),
      ('5.2.09', 'Manutenção Predial',             'despesa', 'administrativa', 2, eid),
      ('5.2.10', 'Seguros',                        'despesa', 'administrativa', 2, eid),
      ('5.2.11', 'Depreciação',                    'despesa', 'administrativa', 2, eid),
      ('5.2.12', 'Software e Licenças',            'despesa', 'administrativa', 2, eid),
      ('5.2.13', 'Serviços de Terceiros',          'despesa', 'administrativa', 2, eid),
      -- Despesas Comerciais
      ('5.3',    'Despesas Comerciais',            'despesa', 'comercial', 1, eid),
      ('5.3.01', 'Marketing e Publicidade',        'despesa', 'comercial', 2, eid),
      ('5.3.02', 'Comissões Captação',             'despesa', 'comercial', 2, eid),
      ('5.3.03', 'Eventos Promocionais',           'despesa', 'comercial', 2, eid),
      -- Despesas Financeiras
      ('5.4',    'Despesas Financeiras',           'despesa', 'financeira', 1, eid),
      ('5.4.01', 'Juros Pagos',                    'despesa', 'financeira', 2, eid),
      ('5.4.02', 'Tarifas Bancárias',              'despesa', 'financeira', 2, eid),
      ('5.4.03', 'IOF',                            'despesa', 'financeira', 2, eid),
      ('5.4.04', 'Descontos Concedidos',           'despesa', 'financeira', 2, eid),
      -- Impostos sobre Receita
      ('5.5',    'Impostos sobre Receita',         'despesa', 'fiscal', 1, eid),
      ('5.5.01', 'ISS',                            'despesa', 'fiscal', 2, eid),
      ('5.5.02', 'PIS',                            'despesa', 'fiscal', 2, eid),
      ('5.5.03', 'COFINS',                         'despesa', 'fiscal', 2, eid),
      ('5.5.04', 'CSLL',                           'despesa', 'fiscal', 2, eid),
      ('5.5.05', 'IRPJ',                           'despesa', 'fiscal', 2, eid)
    ON CONFLICT DO NOTHING;

  END LOOP;
END $$;

-- 5. Update the trigger function to use new code 4.1.01 (Mensalidades Escolares)
CREATE OR REPLACE FUNCTION _fin_conta_mensalidades(p_escola_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM fin_plano_contas
  WHERE escola_id = p_escola_id
    AND codigo = '4.1.01'
  LIMIT 1;
$$;

-- 6. Re-link existing lancamentos to the correct new accounts
UPDATE fin_lancamentos l
SET conta_id = (SELECT id FROM fin_plano_contas WHERE escola_id = l.escola_id AND codigo = '4.1.01' LIMIT 1)
WHERE l.mensalidade_id IS NOT NULL AND l.tipo = 'receita';

-- 7. Add unique constraint to prevent duplicate accounts
ALTER TABLE fin_plano_contas DROP CONSTRAINT IF EXISTS uq_plano_contas_escola_codigo;
ALTER TABLE fin_plano_contas ADD CONSTRAINT uq_plano_contas_escola_codigo UNIQUE (escola_id, codigo);
