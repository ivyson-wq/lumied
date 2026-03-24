-- Migration 010: Atestados médicos das professoras + classe Secretaria
-- Run this SQL in Supabase Dashboard > SQL Editor

-- 1. Secretaria user accounts
CREATE TABLE IF NOT EXISTS secretarias (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome       text        NOT NULL,
  email      text        UNIQUE NOT NULL,
  senha_hash text        NOT NULL,
  criado_em  timestamptz DEFAULT now()
);

-- 2. Secretaria sessions
CREATE TABLE IF NOT EXISTS secretaria_sessoes (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  secretaria_id  uuid        REFERENCES secretarias(id) ON DELETE CASCADE,
  token          text        UNIQUE NOT NULL,
  expira_em      timestamptz NOT NULL,
  criado_em      timestamptz DEFAULT now()
);

-- 3. Medical certificate uploads
CREATE TABLE IF NOT EXISTS atestados_professoras (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id  uuid        REFERENCES professoras(id) ON DELETE CASCADE,
  data_inicio    date        NOT NULL,
  data_fim       date        NOT NULL,
  motivo         text,
  arquivo_url    text,
  status         text        DEFAULT 'pendente'
                               CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  observacao     text,
  validado_por   text,
  data_validacao timestamptz,
  criado_em      timestamptz DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_secretaria_sessoes_token
  ON secretaria_sessoes(token);
CREATE INDEX IF NOT EXISTS idx_secretaria_sessoes_sec
  ON secretaria_sessoes(secretaria_id);
CREATE INDEX IF NOT EXISTS idx_atestados_professora
  ON atestados_professoras(professora_id);
CREATE INDEX IF NOT EXISTS idx_atestados_status
  ON atestados_professoras(status);

-- 5. Storage bucket for atestados (run in Supabase Dashboard > Storage)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('atestados', 'atestados', true)
-- ON CONFLICT (id) DO NOTHING;
