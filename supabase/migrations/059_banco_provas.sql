-- =====================================================
-- 059: Banco de Provas / Avaliações Online
-- =====================================================

-- Banco de questões
CREATE TABLE IF NOT EXISTS provas_questoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  disciplina_id uuid REFERENCES notas_disciplinas(id),
  texto text NOT NULL,
  tipo text NOT NULL DEFAULT 'multipla',  -- 'multipla','dissertativa','verdadeiro_falso','associacao'
  opcoes jsonb DEFAULT '[]'::jsonb,       -- [{texto, correta: bool}]
  resposta_correta text,                   -- para dissertativa: resposta esperada
  dificuldade text DEFAULT 'media',        -- 'facil','media','dificil'
  habilidade_bncc text,                    -- código BNCC
  explicacao text,                         -- explicação da resposta
  criado_por uuid REFERENCES professoras(id),
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE provas_questoes DISABLE ROW LEVEL SECURITY;

-- Provas montadas
CREATE TABLE IF NOT EXISTS provas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,
  disciplina_id uuid REFERENCES notas_disciplinas(id),
  serie_id uuid REFERENCES series(id),
  periodo_id uuid REFERENCES notas_periodos(id),
  questoes jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{questao_id, peso, ordem}]
  data_inicio timestamptz,
  data_fim timestamptz,
  tempo_limite integer,                     -- minutos (NULL = sem limite)
  pontuacao_total numeric DEFAULT 10,
  permite_revisao boolean DEFAULT true,
  embaralhar boolean DEFAULT false,
  status text DEFAULT 'rascunho',           -- 'rascunho','publicada','encerrada'
  criado_por uuid REFERENCES professoras(id),
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE provas DISABLE ROW LEVEL SECURITY;

-- Respostas dos alunos
CREATE TABLE IF NOT EXISTS provas_respostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prova_id uuid NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  aluno_email text NOT NULL,
  aluno_nome text,
  respostas jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {questao_id: resposta}
  pontuacao numeric,
  pontuacao_detalhada jsonb,               -- {questao_id: {pontos, max, correta}}
  inicio timestamptz,
  fim timestamptz,
  corrigido boolean DEFAULT false,
  corrigido_por text,
  corrigido_em timestamptz,
  UNIQUE(prova_id, aluno_email)
);
ALTER TABLE provas_respostas DISABLE ROW LEVEL SECURITY;

-- Índices
CREATE INDEX IF NOT EXISTS idx_provas_questoes_disc ON provas_questoes(disciplina_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_provas_serie ON provas(serie_id, status);
