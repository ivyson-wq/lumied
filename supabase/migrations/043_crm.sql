-- CRM - Pipeline de Leads
CREATE TABLE IF NOT EXISTS crm_estagios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  cor text DEFAULT '#1a6bb5',
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean DEFAULT true
);

INSERT INTO crm_estagios (nome, cor, ordem) VALUES
  ('Novo Lead', '#9b59b6', 0),
  ('Primeiro Contato', '#3498db', 1),
  ('Visita Agendada', '#f39c12', 2),
  ('Visita Realizada', '#e67e22', 3),
  ('Proposta Enviada', '#1abc9c', 4),
  ('Negociação', '#e74c3c', 5),
  ('Matrícula Fechada', '#2ecc71', 6),
  ('Perdido', '#95a5a6', 7)
ON CONFLICT DO NOTHING;

ALTER TABLE crm_estagios DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome_responsavel text NOT NULL,
  email text,
  telefone text,
  nome_crianca text,
  idade_crianca text,
  serie_interesse text,
  estagio_id uuid REFERENCES crm_estagios(id),
  origem text, -- indicacao, site, instagram, facebook, evento, outro
  valor_mensalidade numeric,
  observacoes text,
  responsavel_interno text, -- quem está cuidando deste lead
  data_proximo_contato date,
  data_visita date,
  motivo_perda text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_estagio ON crm_leads(estagio_id);
ALTER TABLE crm_leads DISABLE ROW LEVEL SECURITY;

-- Historico de interacoes com o lead
CREATE TABLE IF NOT EXISTS crm_interacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('ligacao','email','whatsapp','visita','reuniao','nota','outro')),
  descricao text NOT NULL,
  criado_por text,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_interacoes_lead ON crm_interacoes(lead_id);
ALTER TABLE crm_interacoes DISABLE ROW LEVEL SECURITY;

-- Templates de mensagem (para WhatsApp e email)
CREATE TABLE IF NOT EXISTS crm_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  categoria text DEFAULT 'geral', -- boas_vindas, follow_up, visita, proposta, etc
  conteudo text NOT NULL,
  variaveis text[], -- {{nome}}, {{crianca}}, {{serie}}, etc
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

INSERT INTO crm_templates (nome, categoria, conteudo, variaveis) VALUES
  ('Boas-vindas', 'boas_vindas', 'Olá {{nome}}! 😊 Obrigado pelo interesse na Maple Bear Caxias do Sul. Somos uma escola bilíngue com metodologia canadense. Gostaria de agendar uma visita para conhecer nossa escola?', '{nome}'),
  ('Follow-up', 'follow_up', 'Olá {{nome}}, tudo bem? Estou entrando em contato sobre o interesse na Maple Bear para {{crianca}}. Podemos conversar sobre as opções de turno e atividades? 📚', '{nome,crianca}'),
  ('Agendar Visita', 'visita', 'Olá {{nome}}! Que tal conhecer a Maple Bear pessoalmente? Temos horários disponíveis esta semana. Qual dia e horário seria melhor para você? 🏫', '{nome}'),
  ('Pós-Visita', 'pos_visita', 'Olá {{nome}}! Foi um prazer recebê-lo(a) na Maple Bear! 🍁 Espero que tenha gostado de conhecer nossa estrutura. Ficou alguma dúvida? Estou à disposição!', '{nome}'),
  ('Proposta', 'proposta', 'Olá {{nome}}! Segue a proposta para {{crianca}} na turma {{serie}}: Mensalidade: R$ {{valor}}. Posso esclarecer alguma dúvida? 📋', '{nome,crianca,serie,valor}'),
  ('Matrícula', 'matricula', 'Olá {{nome}}! 🎉 Que alegria ter {{crianca}} na família Maple Bear! A matrícula está confirmada para {{serie}}. Em breve enviaremos todas as informações de início das aulas.', '{nome,crianca,serie}')
ON CONFLICT DO NOTHING;

ALTER TABLE crm_templates DISABLE ROW LEVEL SECURITY;

-- Reunioes agendadas (para Google Calendar)
CREATE TABLE IF NOT EXISTS crm_reunioes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES crm_leads(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  data_hora timestamptz NOT NULL,
  duracao_min integer DEFAULT 30,
  local text,
  descricao text,
  google_event_id text,
  status text DEFAULT 'agendada' CHECK (status IN ('agendada','realizada','cancelada','reagendada')),
  criado_por text,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE crm_reunioes DISABLE ROW LEVEL SECURITY;
