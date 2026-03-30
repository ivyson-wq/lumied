-- =====================================================
-- 051: Diário de Classe Digital
-- =====================================================

CREATE TABLE IF NOT EXISTS diario_registros (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  serie_id uuid REFERENCES series(id),
  disciplina_id uuid REFERENCES notas_disciplinas(id),
  data date NOT NULL,
  professor_id uuid REFERENCES professoras(id),
  conteudo_planejado text,
  conteudo_executado text,
  observacoes text,
  habilidades_bncc jsonb DEFAULT '[]'::jsonb,  -- ["EF01LP01","EF02MA03"]
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE diario_registros DISABLE ROW LEVEL SECURITY;

-- Tabela de referência BNCC (seed simplificado)
CREATE TABLE IF NOT EXISTS diario_bncc_habilidades (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo text UNIQUE NOT NULL,        -- 'EF01LP01'
  descricao text NOT NULL,
  componente text,                    -- 'Língua Portuguesa', 'Matemática'
  ano_serie text,                     -- '1º ano', '2º ano'
  area text                           -- 'Linguagens', 'Matemática', 'Ciências'
);
ALTER TABLE diario_bncc_habilidades DISABLE ROW LEVEL SECURITY;

-- Seed: algumas habilidades BNCC de exemplo
INSERT INTO diario_bncc_habilidades (codigo, descricao, componente, ano_serie, area) VALUES
  ('EF01LP01', 'Reconhecer que textos são lidos e escritos da esquerda para a direita e de cima para baixo da página', 'Língua Portuguesa', '1º ano', 'Linguagens'),
  ('EF01LP02', 'Escrever, espontaneamente ou por ditado, palavras e frases de forma alfabética', 'Língua Portuguesa', '1º ano', 'Linguagens'),
  ('EF01MA01', 'Utilizar números naturais como indicador de quantidade ou de ordem em diferentes situações cotidianas', 'Matemática', '1º ano', 'Matemática'),
  ('EF01MA02', 'Contar de maneira exata ou aproximada, utilizando diferentes estratégias como o pareamento', 'Matemática', '1º ano', 'Matemática'),
  ('EF02LP01', 'Utilizar, ao produzir o texto, grafia correta de palavras conhecidas ou com estruturas silábicas já dominadas', 'Língua Portuguesa', '2º ano', 'Linguagens'),
  ('EF02MA01', 'Comparar e ordenar números naturais (até a ordem de centenas) pela compreensão de características do sistema de numeração decimal', 'Matemática', '2º ano', 'Matemática'),
  ('EF15LP01', 'Identificar a função social de textos que circulam em campos da vida social', 'Língua Portuguesa', '1º ao 5º ano', 'Linguagens'),
  ('EF15LP02', 'Estabelecer expectativas em relação ao texto que vai ler', 'Língua Portuguesa', '1º ao 5º ano', 'Linguagens')
ON CONFLICT (codigo) DO NOTHING;
