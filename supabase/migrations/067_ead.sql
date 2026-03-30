-- =====================================================
-- 067: EAD / Aulas Online
-- =====================================================

CREATE TABLE IF NOT EXISTS ead_aulas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  serie_id uuid REFERENCES series(id),
  disciplina_id uuid REFERENCES notas_disciplinas(id),
  titulo text NOT NULL,
  descricao text,
  tipo text NOT NULL DEFAULT 'ao_vivo',    -- 'ao_vivo','gravada'
  plataforma text,                          -- 'google_meet','teams','zoom','youtube'
  url text,                                 -- link da aula
  data_hora timestamptz,
  duracao integer,                          -- minutos
  gravacao_url text,                        -- link da gravação
  professor_id uuid REFERENCES professoras(id),
  status text DEFAULT 'agendada',           -- 'agendada','ao_vivo','encerrada','cancelada'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE ead_aulas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ead_materiais (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aula_id uuid REFERENCES ead_aulas(id) ON DELETE CASCADE,
  serie_id uuid REFERENCES series(id),
  titulo text NOT NULL,
  tipo text DEFAULT 'pdf',                  -- 'pdf','video','link','documento','slide'
  url text NOT NULL,
  tamanho_bytes bigint,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE ead_materiais DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ead_presencas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aula_id uuid NOT NULL REFERENCES ead_aulas(id) ON DELETE CASCADE,
  aluno_email text NOT NULL,
  aluno_nome text,
  presente boolean DEFAULT true,
  duracao_assistida integer,                -- minutos
  entrou_em timestamptz,
  saiu_em timestamptz,
  UNIQUE(aula_id, aluno_email)
);
ALTER TABLE ead_presencas DISABLE ROW LEVEL SECURITY;
