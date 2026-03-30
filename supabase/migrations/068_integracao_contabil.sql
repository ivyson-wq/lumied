-- =====================================================
-- 068: Integração Contábil
-- =====================================================

CREATE TABLE IF NOT EXISTS contabil_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sistema text NOT NULL,                   -- 'dominio','fortes','questor','contmatic','sped'
  formato_exportacao text DEFAULT 'csv',   -- 'csv','txt','xml','sped'
  config jsonb DEFAULT '{}'::jsonb,        -- configurações específicas do sistema
  ultimo_export timestamptz,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE contabil_config DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contabil_exportacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sistema text NOT NULL,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  tipo text DEFAULT 'lancamentos',         -- 'lancamentos','receitas','despesas','folha'
  registros integer DEFAULT 0,
  arquivo_url text,
  gerado_por text,
  gerado_em timestamptz DEFAULT now()
);
ALTER TABLE contabil_exportacoes DISABLE ROW LEVEL SECURITY;
