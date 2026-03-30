-- =====================================================
-- 050: Controle de Frequência / Chamada
-- =====================================================

CREATE TABLE IF NOT EXISTS frequencia_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  limite_faltas_percent numeric DEFAULT 25,   -- % máximo de faltas permitidas
  alerta_percent numeric DEFAULT 15,          -- % de faltas para gerar alerta
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE frequencia_config DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS frequencia_chamadas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  serie_id uuid REFERENCES series(id),
  disciplina_id uuid REFERENCES notas_disciplinas(id),
  data date NOT NULL,
  horario text,                    -- '1º horário', '2º horário'
  professor_id uuid REFERENCES professoras(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE frequencia_chamadas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS frequencia_registros (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chamada_id uuid NOT NULL REFERENCES frequencia_chamadas(id) ON DELETE CASCADE,
  aluno_email text NOT NULL,
  aluno_nome text NOT NULL,
  status text NOT NULL DEFAULT 'P',   -- P=Presente, A=Ausente, F=Falta justificada, J=Justificado
  observacao text,
  UNIQUE(chamada_id, aluno_email)
);
ALTER TABLE frequencia_registros DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS frequencia_alertas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  aluno_nome text NOT NULL,
  serie_id uuid REFERENCES series(id),
  tipo text DEFAULT 'alerta',       -- 'alerta','critico','conselho_tutelar'
  percent_faltas numeric,
  total_aulas integer,
  total_faltas integer,
  periodo text,                     -- 'Bimestre 1', '2026'
  enviado boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE frequencia_alertas DISABLE ROW LEVEL SECURITY;

INSERT INTO frequencia_config (limite_faltas_percent, alerta_percent)
VALUES (25, 15)
ON CONFLICT DO NOTHING;
