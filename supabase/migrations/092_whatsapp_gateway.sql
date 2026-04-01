-- =====================================================
-- 092: Módulo WhatsApp Gateway — Comunicação escola→família
-- Feature opcional por escola, janela 24h, confirmações,
-- relatório semanal IA, FAQ bot, opt-in
-- =====================================================

-- ── Toggle do módulo por escola ─────────────────────
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS modulo_whatsapp boolean DEFAULT false;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS whatsapp_phone_id text;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS whatsapp_token text;

-- ── Turmas (se não existir) ─────────────────────────
CREATE TABLE IF NOT EXISTS wa_turmas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  professora_id uuid,
  escola_id uuid REFERENCES escolas(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_turmas DISABLE ROW LEVEL SECURITY;

-- ── Famílias com opt-in WhatsApp ────────────────────
CREATE TABLE IF NOT EXISTS wa_familias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  whatsapp text NOT NULL UNIQUE,              -- formato: 5554999991234
  opt_in boolean DEFAULT false,
  opt_in_at timestamptz,
  aluno_nome text,
  turma_id uuid REFERENCES wa_turmas(id),
  familia_id_saas uuid,                       -- vínculo com familias do SaaS
  escola_id uuid REFERENCES escolas(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_familias DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_fam_whatsapp ON wa_familias(whatsapp);
CREATE INDEX idx_wa_fam_escola ON wa_familias(escola_id);

-- ── Mensagens criadas por professoras ───────────────
CREATE TABLE IF NOT EXISTS wa_mensagens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conteudo text NOT NULL,
  professora_id uuid,
  turma_id uuid REFERENCES wa_turmas(id),
  familia_id uuid REFERENCES wa_familias(id),  -- NULL = turma toda
  status text DEFAULT 'rascunho',              -- 'rascunho','aguardando_aprovacao','aprovada','enviada','rejeitada'
  aprovada_por uuid,
  aprovada_at timestamptz,
  enviada_at timestamptz,
  whatsapp_msg_id text,
  escola_id uuid REFERENCES escolas(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_mensagens DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_msg_status ON wa_mensagens(status, escola_id);

-- ── Janelas de atendimento (24h gratuita) ───────────
CREATE TABLE IF NOT EXISTS wa_janelas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  familia_id uuid REFERENCES wa_familias(id) UNIQUE,
  professora_id uuid,
  mensagem_id uuid REFERENCES wa_mensagens(id),
  aberta_em timestamptz NOT NULL,
  expira_em timestamptz NOT NULL,
  renovada_em timestamptz,
  status text DEFAULT 'ativa',                 -- 'ativa','expirada'
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_janelas DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_janelas_fam ON wa_janelas(familia_id) WHERE status = 'ativa';

-- ── Respostas recebidas das famílias ────────────────
CREATE TABLE IF NOT EXISTS wa_respostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  familia_id uuid REFERENCES wa_familias(id),
  professora_id uuid,
  mensagem_id uuid REFERENCES wa_mensagens(id),
  tipo text NOT NULL,
    -- 'confirmacao_leitura','resposta_texto','opt_in','estou_a_caminho',
    -- 'confirmacao_evento','duvida_respondida_bot','duvida_roteada'
  conteudo text,
  whatsapp_msg_id text,
  lida_pela_prof boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_respostas DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_resp_nao_lidas ON wa_respostas(professora_id) WHERE lida_pela_prof = false;

-- ── Eventos escolares com confirmação ───────────────
CREATE TABLE IF NOT EXISTS wa_eventos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,
  descricao text,
  data_evento timestamptz NOT NULL,
  prazo_confirmacao timestamptz,
  turma_id uuid REFERENCES wa_turmas(id),
  escola_id uuid REFERENCES escolas(id),
  criado_por uuid,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_eventos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wa_confirmacoes_evento (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id uuid REFERENCES wa_eventos(id),
  familia_id uuid REFERENCES wa_familias(id),
  resposta text DEFAULT 'pendente',            -- 'confirmado','recusado','pendente'
  canal text DEFAULT 'whatsapp',               -- 'whatsapp','app'
  respondido_em timestamptz,
  UNIQUE(evento_id, familia_id)
);
ALTER TABLE wa_confirmacoes_evento DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_conf_evento ON wa_confirmacoes_evento(evento_id, resposta);

-- ── FAQs editáveis pela coordenação ─────────────────
CREATE TABLE IF NOT EXISTS wa_faqs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pergunta text NOT NULL,
  resposta text NOT NULL,
  categoria text,                              -- 'financeiro','pedagogico','horarios','uniforme','outro'
  ativa boolean DEFAULT true,
  escola_id uuid REFERENCES escolas(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_faqs DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_faqs_escola ON wa_faqs(escola_id) WHERE ativa = true;

-- ── Relatórios semanais gerados por IA ──────────────
CREATE TABLE IF NOT EXISTS wa_relatorios_semanais (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  familia_id uuid REFERENCES wa_familias(id),
  aluno_nome text,
  semana_inicio date NOT NULL,
  conteudo_gerado text NOT NULL,
  enviado_em timestamptz,
  whatsapp_msg_id text,
  escola_id uuid REFERENCES escolas(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_relatorios_semanais DISABLE ROW LEVEL SECURITY;

-- ── Função de expiração de janelas (pg_cron) ────────
CREATE OR REPLACE FUNCTION wa_expirar_janelas_vencidas()
RETURNS void AS $$
BEGIN
  UPDATE wa_janelas SET status = 'expirada'
  WHERE expira_em < NOW() AND status = 'ativa';
END;
$$ LANGUAGE plpgsql;

-- Cron: expirar janelas a cada hora
SELECT cron.schedule(
  'wa-expirar-janelas',
  '0 * * * *',
  $$SELECT wa_expirar_janelas_vencidas()$$
);

-- Cron: relatório semanal — sábados 9h UTC (6h BRT)
SELECT cron.schedule(
  'wa-relatorio-semanal',
  '0 9 * * 6',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/whatsapp-gateway',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"action":"cron_relatorio_semanal"}'::jsonb
  )$$
);
