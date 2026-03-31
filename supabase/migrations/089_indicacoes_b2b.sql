-- =====================================================
-- 089: Indicações B2B — Escolas indicam outras escolas
-- Programa Lumied Partners
-- =====================================================

CREATE TABLE IF NOT EXISTS indicacoes_b2b (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Escola que indica (cliente Lumied)
  escola_indicadora_id uuid REFERENCES escolas(id),
  indicador_nome text NOT NULL,
  indicador_cargo text,
  indicador_email text NOT NULL,
  indicador_telefone text,
  -- Escola indicada
  escola_nome text NOT NULL,
  escola_cidade text,
  escola_estado text DEFAULT 'RS',
  escola_tipo text,                          -- 'bilingue','internacional','particular','rede'
  contato_nome text NOT NULL,
  contato_email text,
  contato_telefone text NOT NULL,
  contato_cargo text,
  mensagem text,
  -- Tracking
  codigo text UNIQUE NOT NULL,               -- 'LPT-XXXXXX'
  status text DEFAULT 'indicada',            -- 'indicada','contatada','demonstracao','negociacao','contratada','recusada','expirada'
  -- Bonificação
  bonificacao_tipo text,                     -- 'desconto_mensalidade','cashback','meses_gratis','comissao'
  bonificacao_valor numeric,                 -- valor em R$ ou %
  bonificacao_descricao text,
  bonificacao_status text DEFAULT 'aguardando', -- 'aguardando','elegivel','aplicada','expirada'
  bonificacao_aplicada_em timestamptz,
  -- Metadata
  notas_internas text,                       -- anotações do time comercial
  responsavel_comercial text,
  data_contato timestamptz,
  data_demonstracao timestamptz,
  data_contratacao timestamptz,
  plano_contratado text,
  valor_contrato_mensal numeric,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE indicacoes_b2b DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ind_b2b_codigo ON indicacoes_b2b(codigo);
CREATE INDEX idx_ind_b2b_status ON indicacoes_b2b(status);
CREATE INDEX idx_ind_b2b_escola ON indicacoes_b2b(escola_indicadora_id);

-- Configuração do programa B2B por escola
CREATE TABLE IF NOT EXISTS indicacoes_b2b_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  programa_ativo boolean DEFAULT true,
  titulo text DEFAULT 'Lumied Partners',
  subtitulo text DEFAULT 'Indique escolas e ganhe benefícios exclusivos no seu plano.',
  -- Bonificação padrão por etapa
  bonificacao_demonstracao jsonb DEFAULT '{"tipo":"desconto_mensalidade","valor":5,"descricao":"5% de desconto por 3 meses"}'::jsonb,
  bonificacao_contratacao jsonb DEFAULT '{"tipo":"meses_gratis","valor":1,"descricao":"1 mês grátis no seu plano"}'::jsonb,
  bonificacao_especial jsonb DEFAULT '{"tipo":"comissao","valor":500,"descricao":"R$500 de bônus para a escola top indicadora do trimestre"}'::jsonb,
  -- Limites
  max_indicacoes_mes integer DEFAULT 10,
  validade_dias integer DEFAULT 120,
  -- Termos
  termos_html text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE indicacoes_b2b_config DISABLE ROW LEVEL SECURITY;

INSERT INTO indicacoes_b2b_config (programa_ativo) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TRIGGER indicacoes_b2b_atualizado
  BEFORE UPDATE ON indicacoes_b2b
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

CREATE TRIGGER indicacoes_b2b_config_atualizado
  BEFORE UPDATE ON indicacoes_b2b_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();
