-- Migration 009: Diploma upload & teacher ranking system
-- Run this SQL in Supabase Dashboard > SQL Editor

-- 1. Add password hash to professoras table (for teacher login)
ALTER TABLE professoras
  ADD COLUMN IF NOT EXISTS senha_hash text;

-- 2. Teacher sessions table
CREATE TABLE IF NOT EXISTS professora_sessoes (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid       REFERENCES professoras(id) ON DELETE CASCADE,
  token        text        UNIQUE NOT NULL,
  expira_em    timestamptz NOT NULL,
  criado_em    timestamptz DEFAULT now()
);

-- 3. Diploma submissions table
CREATE TABLE IF NOT EXISTS diplomas_professoras (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid        REFERENCES professoras(id) ON DELETE CASCADE,
  nome_curso    text        NOT NULL,
  carga_horaria integer     NOT NULL CHECK (carga_horaria > 0),
  arquivo_url   text,
  status        text        DEFAULT 'pendente'
                              CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  pontuacao     integer     DEFAULT 0,
  observacao    text,
  validado_por  text,
  data_validacao timestamptz,
  criado_em     timestamptz DEFAULT now()
);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_professora_sessoes_token
  ON professora_sessoes(token);
CREATE INDEX IF NOT EXISTS idx_professora_sessoes_professora
  ON professora_sessoes(professora_id);
CREATE INDEX IF NOT EXISTS idx_diplomas_professora
  ON diplomas_professoras(professora_id);
CREATE INDEX IF NOT EXISTS idx_diplomas_status
  ON diplomas_professoras(status);

-- 5. Create storage bucket for diplomas (run via Supabase Dashboard > Storage)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('diplomas', 'diplomas', true)
-- ON CONFLICT (id) DO NOTHING;
