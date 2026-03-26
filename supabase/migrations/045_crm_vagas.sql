-- Turmas com vagas por ano
CREATE TABLE IF NOT EXISTS crm_turmas_vagas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  serie text NOT NULL,
  ano integer NOT NULL,
  qtd_turmas integer NOT NULL DEFAULT 1,
  vagas_por_turma integer NOT NULL DEFAULT 18,
  vagas_total integer GENERATED ALWAYS AS (qtd_turmas * vagas_por_turma) STORED,
  ordem integer DEFAULT 0,
  UNIQUE(serie, ano)
);

ALTER TABLE crm_turmas_vagas DISABLE ROW LEVEL SECURITY;

-- Seed 2026
INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem) VALUES
  ('Bear Care', 2026, 1, 12, 0),
  ('Toddler', 2026, 2, 17, 1),
  ('Nursery', 2026, 3, 18, 2),
  ('JK', 2026, 2, 18, 3),
  ('SK', 2026, 2, 18, 4),
  ('Year 1', 2026, 1, 21, 5),
  ('Year 2', 2026, 1, 21, 6),
  ('Year 3', 2026, 1, 21, 7)
ON CONFLICT (serie, ano) DO NOTHING;

-- Seed 2027
INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem) VALUES
  ('Bear Care', 2027, 1, 12, 0),
  ('Toddler', 2027, 2, 17, 1),
  ('Nursery', 2027, 3, 18, 2),
  ('JK', 2027, 3, 18, 3),
  ('SK', 2027, 2, 18, 4),
  ('Year 1', 2027, 2, 21, 5),
  ('Year 2', 2027, 2, 21, 6),
  ('Year 3', 2027, 1, 21, 7),
  ('Year 4', 2027, 1, 21, 8)
ON CONFLICT (serie, ano) DO NOTHING;

-- Matriculas/reservas fechadas
CREATE TABLE IF NOT EXISTS crm_matriculas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL,
  nome_responsavel text NOT NULL,
  nome_crianca text NOT NULL,
  serie text NOT NULL,
  ano integer NOT NULL,
  status text NOT NULL DEFAULT 'reserva' CHECK (status IN ('reserva','matriculado','cancelado')),
  data_reserva date,
  data_matricula date,
  data_cancelamento date,
  observacao text,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_matr_serie_ano ON crm_matriculas(serie, ano, status);
ALTER TABLE crm_matriculas DISABLE ROW LEVEL SECURITY;

-- Adicionar ano_matricula no lead
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ano_matricula integer;
