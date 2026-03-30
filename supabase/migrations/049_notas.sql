-- =====================================================
-- 049: Sistema de Notas / Boletim / Conceitos
-- =====================================================

-- Configuração global de notas da escola
CREATE TABLE IF NOT EXISTS notas_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo_avaliacao text NOT NULL DEFAULT 'numerico',  -- 'numerico' ou 'conceito'
  media_aprovacao numeric DEFAULT 7.0,
  conceitos_escala jsonb DEFAULT '["A","B","C","D","E"]'::jsonb,
  conceito_minimo text DEFAULT 'C',
  formula_media text DEFAULT 'aritmetica',  -- 'aritmetica' ou 'ponderada'
  permite_recuperacao boolean DEFAULT true,
  peso_recuperacao numeric DEFAULT 0.4,  -- 40% recuperação + 60% média original
  periodos_tipo text DEFAULT 'bimestral',  -- 'bimestral','trimestral','semestral'
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE notas_config DISABLE ROW LEVEL SECURITY;

-- Períodos letivos (bimestres/trimestres)
CREATE TABLE IF NOT EXISTS notas_periodos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,            -- 'Bimestre 1', 'Trimestre 2'
  numero integer NOT NULL,       -- 1,2,3,4
  ano integer NOT NULL,
  data_inicio date,
  data_fim date,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE notas_periodos DISABLE ROW LEVEL SECURITY;

-- Disciplinas por série
CREATE TABLE IF NOT EXISTS notas_disciplinas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,               -- 'Mathematics', 'Language Arts'
  serie_id uuid REFERENCES series(id),
  professor_id uuid REFERENCES professoras(id),
  carga_horaria integer DEFAULT 0,  -- horas semanais
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE notas_disciplinas DISABLE ROW LEVEL SECURITY;

-- Avaliações (provas, trabalhos)
CREATE TABLE IF NOT EXISTS notas_avaliacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  disciplina_id uuid NOT NULL REFERENCES notas_disciplinas(id) ON DELETE CASCADE,
  periodo_id uuid NOT NULL REFERENCES notas_periodos(id) ON DELETE CASCADE,
  nome text NOT NULL,           -- 'Prova 1', 'Trabalho em grupo'
  tipo text DEFAULT 'prova',    -- 'prova','trabalho','participacao','recuperacao'
  peso numeric DEFAULT 1.0,
  data_avaliacao date,
  valor_maximo numeric DEFAULT 10.0,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE notas_avaliacoes DISABLE ROW LEVEL SECURITY;

-- Lançamento de notas (nota por aluno por avaliação)
CREATE TABLE IF NOT EXISTS notas_lancamentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  avaliacao_id uuid NOT NULL REFERENCES notas_avaliacoes(id) ON DELETE CASCADE,
  aluno_email text NOT NULL,     -- referencia familias.email
  aluno_nome text NOT NULL,      -- nome do aluno
  valor numeric,                 -- nota numérica (0-10)
  conceito text,                 -- conceito (A,B,C,D,E) se tipo conceito
  observacao text,
  lancado_por uuid REFERENCES professoras(id),
  lancado_em timestamptz DEFAULT now(),
  UNIQUE(avaliacao_id, aluno_email)
);
ALTER TABLE notas_lancamentos DISABLE ROW LEVEL SECURITY;

-- Boletins gerados (snapshot para consulta dos pais)
CREATE TABLE IF NOT EXISTS boletins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  aluno_nome text NOT NULL,
  periodo_id uuid REFERENCES notas_periodos(id),
  ano integer NOT NULL,
  dados jsonb NOT NULL,         -- { disciplinas: [{ nome, media, conceito, avaliacoes: [...] }] }
  media_geral numeric,
  status text DEFAULT 'gerado', -- 'gerado','publicado'
  gerado_por text,
  gerado_em timestamptz DEFAULT now()
);
ALTER TABLE boletins DISABLE ROW LEVEL SECURITY;

-- Seed: config padrão
INSERT INTO notas_config (tipo_avaliacao, media_aprovacao, formula_media, periodos_tipo)
VALUES ('numerico', 7.0, 'ponderada', 'bimestral')
ON CONFLICT DO NOTHING;

-- Seed: 4 bimestres para o ano atual
INSERT INTO notas_periodos (nome, numero, ano, data_inicio, data_fim) VALUES
  ('1º Bimestre', 1, EXTRACT(YEAR FROM CURRENT_DATE)::int, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-02-03')::date, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-04-11')::date),
  ('2º Bimestre', 2, EXTRACT(YEAR FROM CURRENT_DATE)::int, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-04-14')::date, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-07-04')::date),
  ('3º Bimestre', 3, EXTRACT(YEAR FROM CURRENT_DATE)::int, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-07-21')::date, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-09-26')::date),
  ('4º Bimestre', 4, EXTRACT(YEAR FROM CURRENT_DATE)::int, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-09-29')::date, (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-12-12')::date)
ON CONFLICT DO NOTHING;
