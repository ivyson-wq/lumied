-- =====================================================
-- 095: Quiz de Compliance — Geração automática por IA
-- Perguntas geradas a partir das políticas/protocolos
-- salvos no app, aplicadas periodicamente por cargo
-- =====================================================

-- ── Quizzes (cada quiz = 1 aplicação sobre 1 tema) ──
CREATE TABLE IF NOT EXISTS compliance_quizzes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,                      -- "Protocolo de Evacuação — Abril 2026"
  descricao text,
  politica_id uuid REFERENCES compliance_politicas(id), -- política/protocolo base
  tema text NOT NULL,                        -- 'evacuacao','primeiros_socorros','incendio','bullying','lgpd','higiene','outro'
  -- Configuração
  total_perguntas integer DEFAULT 5,
  nota_minima numeric(5,2) DEFAULT 70,       -- % mínima para aprovação
  tempo_limite_minutos integer DEFAULT 15,
  tentativas_max integer DEFAULT 3,
  -- Periodicidade
  recorrencia text DEFAULT 'trimestral',     -- 'mensal','trimestral','semestral','anual','unica'
  proxima_aplicacao date,
  -- Público-alvo
  aplica_a text DEFAULT 'todos',             -- 'todos','professoras','administrativo','gestao'
  cargos_especificos text[],                 -- cargos específicos se aplica_a = 'especifico'
  -- Geração IA
  perguntas_geradas boolean DEFAULT false,
  prompt_contexto text,                      -- contexto extra para a IA
  -- Metadata
  criado_por text,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_quizzes DISABLE ROW LEVEL SECURITY;

-- ── Perguntas geradas por IA ────────────────────────
CREATE TABLE IF NOT EXISTS compliance_quiz_perguntas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id uuid NOT NULL REFERENCES compliance_quizzes(id) ON DELETE CASCADE,
  ordem integer NOT NULL,
  pergunta text NOT NULL,
  tipo text DEFAULT 'multipla_escolha',      -- 'multipla_escolha','verdadeiro_falso','dissertativa'
  opcoes jsonb,                              -- ["opção A","opção B","opção C","opção D"]
  resposta_correta integer,                  -- índice da opção correta (0-based) — null para dissertativa
  explicacao text,                           -- explicação da resposta correta (mostrada após responder)
  dificuldade text DEFAULT 'media',          -- 'facil','media','dificil'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_quiz_perguntas DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_quiz_perguntas_quiz ON compliance_quiz_perguntas(quiz_id, ordem);

-- ── Atribuições (quem deve responder) ───────────────
CREATE TABLE IF NOT EXISTS compliance_quiz_atribuicoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id uuid NOT NULL REFERENCES compliance_quizzes(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES rh_funcionarios(id),
  professora_id uuid REFERENCES professoras(id),
  nome text NOT NULL,
  email text,
  cargo text,
  -- Status
  status text DEFAULT 'pendente',            -- 'pendente','em_andamento','aprovado','reprovado','expirado'
  tentativas integer DEFAULT 0,
  melhor_nota numeric(5,2),
  ultima_tentativa_em timestamptz,
  aprovado_em timestamptz,
  prazo date,                                -- data limite para responder
  -- Notificação
  notificado boolean DEFAULT false,
  notificado_em timestamptz,
  lembrete_enviado boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_quiz_atribuicoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_quiz_atrib_prof ON compliance_quiz_atribuicoes(professora_id, status);
CREATE INDEX idx_quiz_atrib_pendente ON compliance_quiz_atribuicoes(professora_id) WHERE status IN ('pendente','em_andamento');

-- ── Respostas individuais ───────────────────────────
CREATE TABLE IF NOT EXISTS compliance_quiz_respostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  atribuicao_id uuid NOT NULL REFERENCES compliance_quiz_atribuicoes(id) ON DELETE CASCADE,
  pergunta_id uuid NOT NULL REFERENCES compliance_quiz_perguntas(id),
  tentativa integer DEFAULT 1,
  resposta_selecionada integer,              -- índice da opção escolhida
  resposta_texto text,                       -- para dissertativa
  correta boolean,
  tempo_segundos integer,                    -- tempo gasto na pergunta
  respondido_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_quiz_respostas DISABLE ROW LEVEL SECURITY;

-- ── Triggers ────────────────────────────────────────
CREATE TRIGGER compliance_quizzes_atualizado
  BEFORE UPDATE ON compliance_quizzes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ── Cron: verificar quizzes vencidos (diário 8h) ───
SELECT cron.schedule(
  'compliance-quiz-vencidos',
  '0 8 * * 1-5',
  $$UPDATE compliance_quiz_atribuicoes SET status = 'expirado'
    WHERE prazo < CURRENT_DATE AND status IN ('pendente','em_andamento')$$
);
