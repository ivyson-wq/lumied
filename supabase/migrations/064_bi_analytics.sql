-- =====================================================
-- 064: BI / Analytics Avançado
-- =====================================================

CREATE TABLE IF NOT EXISTS bi_indicadores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  slug text UNIQUE NOT NULL,
  descricao text,
  query_sql text,                          -- SQL para calcular o indicador
  tipo_visualizacao text DEFAULT 'numero', -- 'numero','grafico_linha','grafico_barra','gauge','tabela'
  config jsonb DEFAULT '{}'::jsonb,        -- cores, thresholds, labels
  categoria text DEFAULT 'geral',          -- 'academico','financeiro','operacional','evasao'
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE bi_indicadores DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bi_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  indicador_id uuid NOT NULL REFERENCES bi_indicadores(id) ON DELETE CASCADE,
  data date NOT NULL DEFAULT CURRENT_DATE,
  valor jsonb NOT NULL,                    -- valor do indicador naquela data
  UNIQUE(indicador_id, data)
);
ALTER TABLE bi_snapshots DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bi_dashboards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  descricao text,
  indicadores jsonb DEFAULT '[]'::jsonb,   -- [{indicador_id, posicao, tamanho}]
  layout jsonb DEFAULT '{}'::jsonb,        -- grid layout config
  publico boolean DEFAULT false,
  criado_por text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE bi_dashboards DISABLE ROW LEVEL SECURITY;

-- Seed: indicadores padrão
INSERT INTO bi_indicadores (nome, slug, descricao, tipo_visualizacao, categoria) VALUES
  ('Total de Alunos', 'total_alunos', 'Número total de alunos matriculados', 'numero', 'geral'),
  ('Taxa de Inadimplência', 'taxa_inadimplencia', 'Percentual de mensalidades em atraso', 'gauge', 'financeiro'),
  ('Taxa de Evasão', 'taxa_evasao', 'Percentual de cancelamentos no período', 'gauge', 'evasao'),
  ('Receita Mensal', 'receita_mensal', 'Receita total do mês', 'grafico_linha', 'financeiro'),
  ('Média Geral por Série', 'media_serie', 'Média de notas por série', 'grafico_barra', 'academico'),
  ('Frequência Média', 'frequencia_media', 'Percentual médio de frequência', 'gauge', 'academico'),
  ('Leads por Mês', 'leads_mes', 'Novos leads no CRM por mês', 'grafico_linha', 'operacional'),
  ('Conversão de Leads', 'conversao_leads', 'Taxa de conversão lead→matrícula', 'gauge', 'operacional'),
  ('Ocupação por Série', 'ocupacao_serie', 'Vagas preenchidas vs disponíveis', 'grafico_barra', 'geral'),
  ('Satisfação dos Pais', 'satisfacao_pais', 'Média das pesquisas de satisfação', 'gauge', 'geral')
ON CONFLICT (slug) DO NOTHING;
