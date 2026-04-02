-- =====================================================
-- 099: IA como Camada Nativa — Inteligência Operacional
-- Insights automáticos, assistente por portal,
-- sugestões inline, previsões, análises
-- =====================================================

-- ── Insights gerados pela IA ────────────────────────
CREATE TABLE IF NOT EXISTS ia_insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Contexto
  portal text NOT NULL,                      -- 'gerente','professora','pais','aluno','secretaria','admin'
  categoria text NOT NULL,                   -- 'alerta','sugestao','previsao','resumo','anomalia','oportunidade'
  modulo text,                               -- módulo relacionado: 'financeiro','frequencia','crm','compliance'...
  -- Conteúdo
  titulo text NOT NULL,                      -- "3 alunos com risco de evasão"
  descricao text NOT NULL,                   -- texto completo da insight
  dados_base jsonb,                          -- dados usados para gerar (rastreabilidade)
  confianca numeric(3,2),                    -- 0.00-1.00 (confiança da IA)
  impacto text DEFAULT 'medio',              -- 'baixo','medio','alto','critico'
  -- Ação sugerida
  acao_sugerida text,                        -- "Enviar mensagem de acolhimento para as famílias"
  acao_tipo text,                            -- 'enviar_mensagem','agendar_reuniao','revisar_dados','nenhuma'
  acao_url text,                             -- deep link para a tela relevante
  -- Destinatário
  destinatario_tipo text,                    -- 'todos','gerente','professora:id','pai:email'
  destinatario_id text,                      -- ID específico (se individual)
  -- Status
  status text DEFAULT 'ativa',               -- 'ativa','lida','descartada','executada'
  lida_em timestamptz,
  executada_em timestamptz,
  -- Metadata
  gerado_por text DEFAULT 'claude-haiku',    -- modelo usado
  tokens_usados integer,
  custo_estimado numeric(10,4),
  criado_em timestamptz DEFAULT now(),
  expira_em timestamptz                      -- insights expiram (ex: previsão semanal)
);
ALTER TABLE ia_insights DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ia_insights_portal ON ia_insights(portal, status, criado_em DESC);
CREATE INDEX idx_ia_insights_dest ON ia_insights(destinatario_tipo, destinatario_id) WHERE status = 'ativa';

-- ── Conversas com o assistente IA ───────────────────
CREATE TABLE IF NOT EXISTS ia_conversas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  portal text NOT NULL,
  usuario_id text,                           -- ID do usuário
  usuario_nome text,
  -- Mensagens (array de {role, content, timestamp})
  mensagens jsonb DEFAULT '[]'::jsonb,
  total_mensagens integer DEFAULT 0,
  -- Contexto injetado
  contexto_dados jsonb,                      -- dados do banco enviados como contexto
  -- Custo
  tokens_total integer DEFAULT 0,
  custo_total numeric(10,4) DEFAULT 0,
  -- Metadata
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE ia_conversas DISABLE ROW LEVEL SECURITY;

-- ── Configuração da IA por escola ───────────────────
CREATE TABLE IF NOT EXISTS ia_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id),
  -- Toggles
  insights_automaticos boolean DEFAULT true,
  assistente_ativo boolean DEFAULT true,
  sugestoes_inline boolean DEFAULT true,
  -- Limites (para controle de custo)
  max_insights_dia integer DEFAULT 50,
  max_conversas_dia integer DEFAULT 100,
  max_tokens_mes integer DEFAULT 500000,
  -- Personalidade
  tom text DEFAULT 'profissional_amigavel',  -- 'formal','profissional_amigavel','casual'
  idioma text DEFAULT 'pt-BR',
  nome_assistente text DEFAULT 'Lumi',       -- nome do assistente IA
  -- Uso
  tokens_usados_mes integer DEFAULT 0,
  insights_gerados_hoje integer DEFAULT 0,
  ultimo_reset_diario date,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE ia_config DISABLE ROW LEVEL SECURITY;

INSERT INTO ia_config (escola_id) SELECT id FROM escolas WHERE ativo = true ON CONFLICT DO NOTHING;

-- ── Cron: gerar insights diários (7h BRT = 10h UTC) ─
SELECT cron.schedule(
  'ia-insights-diarios',
  '0 10 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/lumied-ai',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"action":"gerar_insights_diarios"}'::jsonb
  )$$
);

-- ── Cron: resetar contadores diários (meia-noite) ───
SELECT cron.schedule(
  'ia-reset-diario',
  '0 3 * * *',
  $$UPDATE ia_config SET insights_gerados_hoje = 0, ultimo_reset_diario = CURRENT_DATE
    WHERE ultimo_reset_diario IS NULL OR ultimo_reset_diario < CURRENT_DATE$$
);

-- ── Cron: resetar tokens mensais (dia 1) ────────────
SELECT cron.schedule(
  'ia-reset-mensal',
  '0 3 1 * *',
  $$UPDATE ia_config SET tokens_usados_mes = 0$$
);
