-- =====================================================
-- 090: Sistema WhatsApp — Atendimento + Push Comercial
-- Meta Cloud API + Cloudflare Workers + Chatwoot
-- =====================================================

-- ── Departamentos de atendimento ────────────────────
CREATE TABLE IF NOT EXISTS wa_departments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,                        -- 'Matrículas','Financeiro','Secretaria','Pedagogia','Direção'
  shortcut text NOT NULL,                    -- '1','2','3','4','5','0'
  type text DEFAULT 'human',                 -- 'human','bot','group'
  destination text,                          -- número ou fila Chatwoot
  active_from time DEFAULT '08:00',
  active_until time DEFAULT '18:00',
  off_hours_msg text DEFAULT 'Nosso atendimento funciona de segunda a sexta das 8h às 18h. Sua mensagem foi registrada e responderemos assim que possível.',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wa_departments DISABLE ROW LEVEL SECURITY;

-- Departamentos padrão
INSERT INTO wa_departments (name, shortcut, type, destination) VALUES
('Matrículas e informações', '1', 'human', NULL),
('Financeiro', '2', 'human', NULL),
('Secretaria / Documentos', '3', 'human', NULL),
('Pedagogia / Professores', '4', 'human', NULL),
('Direção', '5', 'human', NULL),
('Outras dúvidas', '0', 'human', NULL)
ON CONFLICT DO NOTHING;

-- ── Estado de conversa por número ───────────────────
CREATE TABLE IF NOT EXISTS wa_conversation_state (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text UNIQUE NOT NULL,                -- número WhatsApp (ex: 5554999990000)
  contact_name text,
  student_id uuid,                           -- FK aluno no SaaS (nullable)
  familia_id uuid,                           -- FK família no SaaS (nullable)
  current_step text DEFAULT 'greeting',      -- 'greeting','menu','submenu_X','dept_X','autoservice','human','closed'
  last_dept text,                            -- último departamento acessado
  context jsonb DEFAULT '{}'::jsonb,         -- dados temporários do fluxo
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wa_conversation_state DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_conv_phone ON wa_conversation_state(phone);

-- ── Reuniões agendadas (Push Comercial) ─────────────
CREATE TABLE IF NOT EXISTS wa_scheduled_meetings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  meeting_at timestamptz NOT NULL,
  location text DEFAULT 'Maple Bear Bento Gonçalves',
  reminder_24h boolean DEFAULT false,
  reminder_2h boolean DEFAULT false,
  followup_sent boolean DEFAULT false,
  notes text,
  crm_lead_id uuid,                          -- vínculo com CRM (opcional)
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wa_scheduled_meetings DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_meetings_at ON wa_scheduled_meetings(meeting_at);

-- ── Palavras-chave de urgência (configurável) ───────
CREATE TABLE IF NOT EXISTS wa_urgency_keywords (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword text NOT NULL UNIQUE,
  category text DEFAULT 'geral',             -- 'saude','seguranca','emocional','geral'
  active boolean DEFAULT true
);
ALTER TABLE wa_urgency_keywords DISABLE ROW LEVEL SECURITY;

INSERT INTO wa_urgency_keywords (keyword, category) VALUES
('acidente', 'saude'),
('machucou', 'saude'),
('machucado', 'saude'),
('hospital', 'saude'),
('bateu', 'seguranca'),
('caiu', 'saude'),
('sumiu', 'seguranca'),
('buscar agora', 'seguranca'),
('emergência', 'geral'),
('emergencia', 'geral'),
('socorro', 'geral'),
('febre alta', 'saude'),
('desmaiou', 'saude'),
('chorando', 'emocional'),
('não quer entrar', 'emocional'),
('nao quer entrar', 'emocional'),
('urgente', 'geral'),
('URGENTE', 'geral'),
('não passou', 'seguranca'),
('nao passou', 'seguranca')
ON CONFLICT (keyword) DO NOTHING;

-- ── Palavras-chave de roteamento por departamento ───
CREATE TABLE IF NOT EXISTS wa_routing_keywords (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword text NOT NULL,
  department_shortcut text NOT NULL,          -- referência ao shortcut do departamento
  active boolean DEFAULT true
);
ALTER TABLE wa_routing_keywords DISABLE ROW LEVEL SECURITY;

INSERT INTO wa_routing_keywords (keyword, department_shortcut) VALUES
-- Financeiro
('mensalidade', '2'), ('boleto', '2'), ('pagamento', '2'), ('débito', '2'), ('debito', '2'), ('pagar', '2'), ('pix', '2'), ('segunda via', '2'),
-- Secretaria
('declaração', '3'), ('declaracao', '3'), ('histórico', '3'), ('historico', '3'), ('documento', '3'), ('certidão', '3'), ('certidao', '3'), ('transferência', '3'), ('transferencia', '3'),
-- Pedagogia
('professor', '4'), ('professora', '4'), ('atividade', '4'), ('lição', '4'), ('licao', '4'), ('nota', '4'), ('tarefa', '4'), ('prova', '4'),
-- Matrículas
('matrícula', '1'), ('matricula', '1'), ('vaga', '1'), ('valor', '1'), ('quanto custa', '1'), ('rematrícula', '1'), ('rematricula', '1'), ('visita', '1'),
-- Direção
('diretor', '5'), ('diretora', '5'), ('direção', '5'), ('direcao', '5'), ('responsável', '5'), ('dono', '5')
ON CONFLICT DO NOTHING;

-- ── Log de mensagens (auditoria) ────────────────────
CREATE TABLE IF NOT EXISTS wa_messages_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  direction text NOT NULL,                    -- 'inbound','outbound'
  message_type text DEFAULT 'text',           -- 'text','template','interactive','image','audio'
  content text,
  template_name text,                         -- se foi template Meta
  department text,
  urgency_detected boolean DEFAULT false,
  meta_message_id text,                       -- ID da mensagem na Meta API
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wa_messages_log DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_log_phone ON wa_messages_log(phone, created_at);

-- ── Configuração geral do WhatsApp ──────────────────
CREATE TABLE IF NOT EXISTS wa_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_nome text DEFAULT 'Maple Bear Bento Gonçalves',
  escola_endereco text,
  escola_telefone_emergencia text,
  greeting_message text DEFAULT 'Olá, {{nome}}! 👋 Bem-vindo ao {{escola}}.\n\nComo posso te ajudar?',
  session_timeout_minutes integer DEFAULT 10,
  urgency_auto_escalate_minutes integer DEFAULT 3,
  business_hours_start time DEFAULT '08:00',
  business_hours_end time DEFAULT '18:00',
  business_days integer[] DEFAULT '{1,2,3,4,5}', -- 1=seg, 5=sex
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wa_config DISABLE ROW LEVEL SECURITY;

INSERT INTO wa_config (escola_nome) VALUES ('Maple Bear Bento Gonçalves') ON CONFLICT DO NOTHING;
