-- ═══════════════════════════════════════════════════════════════
--  Migration 113: Controle de Acesso (Face Control ID + RFID)
--  Dispositivos iDFace, reconhecimento facial, cartão RFID,
--  presença automática, alertas em tempo real
-- ═══════════════════════════════════════════════════════════════

-- Dispositivos de controle de acesso (Face Control ID)
CREATE TABLE IF NOT EXISTS acesso_dispositivos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  ip text NOT NULL,
  porta integer DEFAULT 443,
  tipo text NOT NULL CHECK (tipo IN ('catraca_entrada','catraca_saida','terminal_entrada','terminal_saida','terminal_bidirecional')),
  localizacao text, -- ex: "Portaria principal", "Hall infantil"
  modelo text DEFAULT 'iDFace', -- Control iD iDFace
  api_session text, -- session token for Control iD API
  ultimo_heartbeat timestamptz,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_dispositivos DISABLE ROW LEVEL SECURITY;

-- Faces cadastradas (sync com dispositivos)
CREATE TABLE IF NOT EXISTS acesso_faces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pessoa_tipo text NOT NULL CHECK (pessoa_tipo IN ('aluno','responsavel','funcionario')),
  pessoa_id uuid NOT NULL, -- ID do aluno, familia, ou usuario
  pessoa_nome text NOT NULL,
  foto_url text, -- foto armazenada no storage
  device_user_id bigint, -- ID no dispositivo Control iD
  sync_status text DEFAULT 'pendente' CHECK (sync_status IN ('pendente','sincronizado','erro')),
  sync_erro text,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_faces DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_faces_pessoa ON acesso_faces(pessoa_tipo, pessoa_id);

-- Cartões RFID
CREATE TABLE IF NOT EXISTS acesso_rfid (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  card_uid text NOT NULL UNIQUE,
  pessoa_tipo text NOT NULL CHECK (pessoa_tipo IN ('aluno','responsavel','funcionario')),
  pessoa_id uuid NOT NULL,
  pessoa_nome text NOT NULL,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_rfid DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_rfid_card ON acesso_rfid(card_uid);

-- Eventos de acesso (log imutável)
CREATE TABLE IF NOT EXISTS acesso_eventos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  dispositivo_id uuid REFERENCES acesso_dispositivos(id),
  pessoa_tipo text NOT NULL,
  pessoa_id uuid NOT NULL,
  pessoa_nome text NOT NULL,
  metodo text NOT NULL CHECK (metodo IN ('face','rfid','manual')),
  direcao text NOT NULL CHECK (direcao IN ('entrada','saida')),
  foto_captura_url text, -- foto capturada no momento do reconhecimento
  confianca numeric(5,2), -- score de confiança do reconhecimento facial
  card_uid text, -- se RFID
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_eventos DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_eventos_pessoa ON acesso_eventos(pessoa_tipo, pessoa_id, criado_em DESC);
CREATE INDEX idx_acesso_eventos_data ON acesso_eventos(criado_em DESC);

-- Presença diária de alunos (derivada dos eventos)
CREATE TABLE IF NOT EXISTS acesso_presenca (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_id uuid NOT NULL,
  aluno_nome text NOT NULL,
  data date NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada time,
  hora_saida time,
  entrada_metodo text, -- face/rfid/manual
  saida_metodo text,
  entrada_evento_id uuid REFERENCES acesso_eventos(id),
  saida_evento_id uuid REFERENCES acesso_eventos(id),
  status text DEFAULT 'presente' CHECK (status IN ('presente','ausente','saiu','parcial')),
  criado_em timestamptz DEFAULT now(),
  UNIQUE(aluno_id, data)
);
ALTER TABLE acesso_presenca DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_presenca_data ON acesso_presenca(data, status);

-- Permissões de retirada (quem pode buscar a criança)
CREATE TABLE IF NOT EXISTS acesso_permissoes_retirada (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_id uuid NOT NULL,
  aluno_nome text NOT NULL,
  responsavel_id uuid, -- ID da familia
  responsavel_nome text NOT NULL,
  responsavel_email text,
  responsavel_foto_url text,
  parentesco text, -- pai, mae, avo, tio, motorista, etc
  autorizado boolean DEFAULT true,
  autorizado_por text, -- quem autorizou (nome do gerente)
  validade date, -- null = permanente
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_permissoes_retirada DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_perm_aluno ON acesso_permissoes_retirada(aluno_id);

-- Alertas em tempo real (para recepção e professora)
CREATE TABLE IF NOT EXISTS acesso_alertas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id uuid REFERENCES acesso_eventos(id),
  tipo text NOT NULL CHECK (tipo IN ('chegada_responsavel','saida_aluno','entrada_aluno','nao_autorizado','desconhecido')),
  pessoa_nome text NOT NULL,
  aluno_nome text,
  turma text,
  mensagem text NOT NULL,
  destinatario_tipo text CHECK (destinatario_tipo IN ('recepcao','professora','gerente','todos')),
  destinatario_id uuid, -- professora_id se for para professora específica
  lido boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_alertas DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_alertas_dest ON acesso_alertas(destinatario_tipo, lido, criado_em DESC);

-- Config de dispositivos
CREATE TABLE IF NOT EXISTS acesso_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chave text UNIQUE NOT NULL,
  valor text NOT NULL,
  descricao text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_config DISABLE ROW LEVEL SECURITY;

INSERT INTO acesso_config (chave, valor, descricao) VALUES
  ('heartbeat_interval_s', '30', 'Intervalo de heartbeat dos dispositivos em segundos'),
  ('confianca_minima', '0.75', 'Score mínimo de confiança para reconhecimento facial'),
  ('alerta_desconhecido', 'true', 'Gerar alerta quando pessoa não reconhecida'),
  ('alerta_nao_autorizado', 'true', 'Gerar alerta quando responsável não autorizado tenta retirada'),
  ('foto_captura_salvar', 'true', 'Salvar foto da captura no momento do reconhecimento'),
  ('horario_entrada_inicio', '06:30', 'Início do período de entrada'),
  ('horario_entrada_fim', '08:30', 'Fim do período de entrada'),
  ('horario_saida_inicio', '11:00', 'Início do período de saída'),
  ('horario_saida_fim', '18:30', 'Fim do período de saída')
ON CONFLICT (chave) DO NOTHING;
