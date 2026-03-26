-- Modulo de Impressoes
CREATE TABLE IF NOT EXISTS impressoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  professora_nome text,
  turma_id uuid REFERENCES series(id) ON DELETE SET NULL,
  turma_nome text,
  arquivo_url text NOT NULL,
  arquivo_nome text,
  copias integer NOT NULL DEFAULT 1 CHECK (copias > 0),
  tipo_papel text NOT NULL DEFAULT 'sulfite' CHECK (tipo_papel IN ('sulfite','desenho','cartolina','foto','adesivo')),
  para_dia date,
  observacao text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado','impresso','entregue')),
  aprovado_por text,
  aprovado_em timestamptz,
  impresso_em timestamptz,
  entregue_em timestamptz,
  entregue_por text,
  nota_gerente text,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impressoes_prof ON impressoes(professora_id);
CREATE INDEX IF NOT EXISTS idx_impressoes_status ON impressoes(status);
ALTER TABLE impressoes DISABLE ROW LEVEL SECURITY;

-- Orcamento mensal de impressoes por turma
CREATE TABLE IF NOT EXISTS impressoes_orcamento (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  turma_id uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  mes text NOT NULL,
  limite integer NOT NULL DEFAULT 50,
  UNIQUE(turma_id, mes)
);

ALTER TABLE impressoes_orcamento DISABLE ROW LEVEL SECURITY;

-- Storage bucket para arquivos de impressao
INSERT INTO storage.buckets (id, name, public) VALUES ('impressoes', 'impressoes', true)
ON CONFLICT (id) DO NOTHING;
