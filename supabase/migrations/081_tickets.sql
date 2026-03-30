-- 081: Sistema de tickets de suporte
CREATE TABLE IF NOT EXISTS tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id),
  email text NOT NULL,
  nome text,
  portal text NOT NULL,
  tipo text NOT NULL DEFAULT 'bug',
  descricao text NOT NULL,
  url_pagina text,
  user_agent text,
  resolucao_tela text,
  screenshot_url text,
  status text DEFAULT 'aberto',
  resposta text,
  respondido_por text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_escola ON tickets(escola_id);
CREATE INDEX IF NOT EXISTS idx_tickets_criado ON tickets(criado_em DESC);

-- Trigger para atualizar atualizado_em
CREATE OR REPLACE FUNCTION ticket_updated() RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ticket_updated
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION ticket_updated();
