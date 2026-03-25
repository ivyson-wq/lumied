-- Armazena tokens OAuth do Mercado Livre
CREATE TABLE IF NOT EXISTS ml_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  user_id text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

ALTER TABLE ml_tokens DISABLE ROW LEVEL SECURITY;
