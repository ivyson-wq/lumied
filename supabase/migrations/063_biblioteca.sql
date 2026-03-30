-- =====================================================
-- 063: Gestão de Biblioteca
-- =====================================================

CREATE TABLE IF NOT EXISTS biblioteca_acervo (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,
  autor text,
  isbn text,
  editora text,
  codigo_barras text UNIQUE,
  categoria text,                          -- 'infantil','juvenil','didatico','referencia'
  localizacao text,                        -- 'estante A3','prateleira 2'
  quantidade integer DEFAULT 1,
  disponivel integer DEFAULT 1,
  capa_url text,
  sinopse text,
  ano_publicacao integer,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE biblioteca_acervo DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS biblioteca_emprestimos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  acervo_id uuid NOT NULL REFERENCES biblioteca_acervo(id),
  aluno_email text NOT NULL,
  aluno_nome text,
  data_emprestimo date NOT NULL DEFAULT CURRENT_DATE,
  data_devolucao_prevista date NOT NULL,
  data_devolucao_real date,
  status text DEFAULT 'emprestado',        -- 'emprestado','devolvido','atrasado','perdido'
  multa numeric DEFAULT 0,
  observacao text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE biblioteca_emprestimos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS biblioteca_reservas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  acervo_id uuid NOT NULL REFERENCES biblioteca_acervo(id),
  aluno_email text NOT NULL,
  aluno_nome text,
  data_reserva date NOT NULL DEFAULT CURRENT_DATE,
  status text DEFAULT 'ativa',             -- 'ativa','atendida','cancelada','expirada'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE biblioteca_reservas DISABLE ROW LEVEL SECURITY;
