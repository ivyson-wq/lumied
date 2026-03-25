-- ── Tabelas para o módulo de reuniões/agenda ──

-- Gestoras (diretora e coordenadora pedagógica)
CREATE TABLE IF NOT EXISTS gestoras (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome         text NOT NULL,
  email        text NOT NULL,
  cargo        text NOT NULL CHECK (cargo IN ('diretora','coordenadora')),
  calendar_id  text,  -- Google Calendar ID (geralmente o próprio e-mail)
  criado_em    timestamptz DEFAULT now()
);

-- Horários disponíveis semanais (recorrentes)
CREATE TABLE IF NOT EXISTS horarios_disponiveis (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gestora_id   uuid NOT NULL REFERENCES gestoras(id) ON DELETE CASCADE,
  dia_semana   integer NOT NULL CHECK (dia_semana BETWEEN 1 AND 5),  -- 1=seg..5=sex
  hora_inicio  time NOT NULL,
  hora_fim     time NOT NULL,
  criado_em    timestamptz DEFAULT now()
);

-- Reuniões agendadas
CREATE TABLE IF NOT EXISTS reunioes (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gestora_id   uuid NOT NULL REFERENCES gestoras(id) ON DELETE CASCADE,
  email_resp   text NOT NULL,
  nome_resp    text NOT NULL,
  data_reuniao date NOT NULL,
  hora_inicio  time NOT NULL,
  hora_fim     time NOT NULL,
  assunto      text,
  status       text DEFAULT 'agendada' CHECK (status IN ('agendada','cancelada')),
  criado_em    timestamptz DEFAULT now()
);

-- Seed: gestoras padrão
INSERT INTO gestoras (nome, email, cargo) VALUES
  ('Diretora', '', 'diretora'),
  ('Coordenadora', '', 'coordenadora')
ON CONFLICT DO NOTHING;
