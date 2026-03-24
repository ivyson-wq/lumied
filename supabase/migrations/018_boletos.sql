-- Migration 018: Tabela de boletos (Banco Inter)
CREATE TABLE IF NOT EXISTS boletos (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  cpf            text        NOT NULL,
  nosso_numero   text        NOT NULL UNIQUE,
  valor          numeric     NOT NULL,
  vencimento     date        NOT NULL,
  linha_digitavel text,
  situacao       text        NOT NULL DEFAULT 'EMITIDO',  -- EMITIDO | PAGO | CANCELADO
  pdf_url        text,
  criado_em      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boletos_cpf_idx ON boletos (cpf);

-- Storage bucket para PDFs dos boletos
INSERT INTO storage.buckets (id, name, public)
VALUES ('boletos', 'boletos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: leitura pública (os PDFs já são públicos via Storage)
ALTER TABLE boletos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boletos_select_auth" ON boletos
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "boletos_insert_service" ON boletos
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "boletos_update_service" ON boletos
  FOR UPDATE TO service_role
  USING (true);
