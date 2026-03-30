-- =====================================================
-- 057: Relatórios Pedagógicos / BNCC
-- =====================================================

CREATE TABLE IF NOT EXISTS relatorios_pedagogicos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  aluno_nome text NOT NULL,
  professor_id uuid REFERENCES professoras(id),
  periodo_id uuid REFERENCES notas_periodos(id),
  ano integer NOT NULL,
  tipo text DEFAULT 'descritivo',         -- 'descritivo','competencias','parecer_ed_infantil'
  texto text,                              -- parecer descritivo livre
  status text DEFAULT 'rascunho',          -- 'rascunho','finalizado','aprovado','publicado'
  aprovado_por text,
  aprovado_em timestamptz,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE relatorios_pedagogicos DISABLE ROW LEVEL SECURITY;

-- Competências BNCC avaliadas
CREATE TABLE IF NOT EXISTS bncc_competencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo text UNIQUE NOT NULL,
  area text NOT NULL,                      -- 'Linguagens','Matemática','Ciências da Natureza','Ciências Humanas','Ensino Religioso'
  componente text,                         -- 'Língua Portuguesa','Matemática','Ciências','Geografia','História','Arte','Ed. Física','Inglês'
  descricao text NOT NULL,
  ano_serie text,                          -- '1º ano','Ed. Infantil','1º ao 5º ano'
  tipo text DEFAULT 'habilidade'           -- 'competencia_geral','competencia_area','habilidade','campo_experiencia'
);
ALTER TABLE bncc_competencias DISABLE ROW LEVEL SECURITY;

-- Avaliação por competência em relatórios
CREATE TABLE IF NOT EXISTS relatorio_competencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  relatorio_id uuid NOT NULL REFERENCES relatorios_pedagogicos(id) ON DELETE CASCADE,
  competencia_id uuid NOT NULL REFERENCES bncc_competencias(id),
  nivel text NOT NULL DEFAULT 'ED',        -- EP=Em Processo, ED=Em Desenvolvimento, D=Desenvolvida, A=Avançada
  observacao text,
  UNIQUE(relatorio_id, competencia_id)
);
ALTER TABLE relatorio_competencias DISABLE ROW LEVEL SECURITY;

-- Seed: competências gerais BNCC + campos de experiência Ed. Infantil
INSERT INTO bncc_competencias (codigo, area, componente, descricao, ano_serie, tipo) VALUES
  -- Competências Gerais BNCC
  ('CG01', 'Geral', NULL, 'Valorizar e utilizar os conhecimentos historicamente construídos sobre o mundo físico, social, cultural e digital', 'Todos', 'competencia_geral'),
  ('CG02', 'Geral', NULL, 'Exercitar a curiosidade intelectual e recorrer à abordagem própria das ciências', 'Todos', 'competencia_geral'),
  ('CG03', 'Geral', NULL, 'Valorizar e fruir as diversas manifestações artísticas e culturais', 'Todos', 'competencia_geral'),
  ('CG04', 'Geral', NULL, 'Utilizar diferentes linguagens – verbal, corporal, visual, sonora e digital', 'Todos', 'competencia_geral'),
  ('CG05', 'Geral', NULL, 'Compreender, utilizar e criar tecnologias digitais de informação e comunicação', 'Todos', 'competencia_geral'),
  -- Campos de Experiência (Ed. Infantil)
  ('EI-TS', 'Ed. Infantil', NULL, 'O eu, o outro e o nós', 'Ed. Infantil', 'campo_experiencia'),
  ('EI-CG', 'Ed. Infantil', NULL, 'Corpo, gestos e movimentos', 'Ed. Infantil', 'campo_experiencia'),
  ('EI-EF', 'Ed. Infantil', NULL, 'Escuta, fala, pensamento e imaginação', 'Ed. Infantil', 'campo_experiencia'),
  ('EI-TS2', 'Ed. Infantil', NULL, 'Traços, sons, cores e formas', 'Ed. Infantil', 'campo_experiencia'),
  ('EI-ET', 'Ed. Infantil', NULL, 'Espaços, tempos, quantidades, relações e transformações', 'Ed. Infantil', 'campo_experiencia')
ON CONFLICT (codigo) DO NOTHING;
