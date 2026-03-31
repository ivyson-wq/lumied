-- =====================================================
-- 086: Programa de Indicações / Referral
-- =====================================================

-- ── Indicações feitas por clientes ──────────────────
CREATE TABLE IF NOT EXISTS indicacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Quem indicou (cliente existente)
  indicador_nome text NOT NULL,
  indicador_email text NOT NULL,
  indicador_telefone text,
  familia_id uuid,                          -- ref à família se existir
  -- Lead indicado
  lead_nome text NOT NULL,
  lead_email text,
  lead_telefone text NOT NULL,
  lead_serie_interesse text,                -- série de interesse
  lead_mensagem text,                       -- observação do indicador
  -- Tracking
  codigo_indicacao text UNIQUE NOT NULL,     -- código único de rastreio
  status text DEFAULT 'pendente',           -- 'pendente','contatado','matriculado','expirado','cancelado'
  crm_lead_id uuid,                         -- vinculo com crm_leads quando criado
  -- Recompensa
  recompensa_status text DEFAULT 'aguardando', -- 'aguardando','elegivel','entregue','expirada'
  recompensa_tipo text,                     -- 'desconto','cashback','brinde','isencao_taxa'
  recompensa_valor numeric,
  recompensa_descricao text,
  recompensa_entregue_em timestamptz,
  -- Metadata
  ip_origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE indicacoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_indicacoes_email ON indicacoes(indicador_email);
CREATE INDEX idx_indicacoes_codigo ON indicacoes(codigo_indicacao);
CREATE INDEX idx_indicacoes_status ON indicacoes(status);

-- ── Configuração do programa de recompensas ─────────
CREATE TABLE IF NOT EXISTS indicacoes_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid,
  programa_ativo boolean DEFAULT true,
  titulo text DEFAULT 'Indique e Ganhe',
  descricao text DEFAULT 'Indique famílias para a Maple Bear e ganhe recompensas exclusivas!',
  regras_html text,                         -- regras do programa em HTML
  -- Recompensas por etapa
  recompensa_indicacao jsonb DEFAULT '{"tipo":"desconto","valor":100,"descricao":"R$100 de desconto na mensalidade"}'::jsonb,
  recompensa_matricula jsonb DEFAULT '{"tipo":"desconto","valor":300,"descricao":"R$300 de desconto na mensalidade"}'::jsonb,
  -- Limites
  max_indicacoes_mes integer DEFAULT 5,
  validade_dias integer DEFAULT 90,         -- dias para o lead se matricular
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE indicacoes_config DISABLE ROW LEVEL SECURITY;

-- Config padrão
INSERT INTO indicacoes_config (programa_ativo) VALUES (true) ON CONFLICT DO NOTHING;

-- Trigger atualizado_em
CREATE TRIGGER indicacoes_atualizado
  BEFORE UPDATE ON indicacoes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

CREATE TRIGGER indicacoes_config_atualizado
  BEFORE UPDATE ON indicacoes_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();
