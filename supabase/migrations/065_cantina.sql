-- =====================================================
-- 065: Gestão de Cantina / Refeitório
-- =====================================================

CREATE TABLE IF NOT EXISTS cantina_cardapio (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data date NOT NULL,
  refeicao text NOT NULL,                  -- 'cafe_manha','almoco','lanche_tarde','lanche_manha'
  itens jsonb NOT NULL DEFAULT '[]'::jsonb, -- ["Arroz integral","Frango grelhado","Salada"]
  observacoes text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(data, refeicao)
);
ALTER TABLE cantina_cardapio DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS cantina_creditos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text UNIQUE NOT NULL,
  aluno_nome text,
  saldo numeric DEFAULT 0,
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE cantina_creditos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS cantina_transacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  tipo text NOT NULL,                      -- 'credito','debito'
  valor numeric NOT NULL,
  descricao text,
  data timestamptz DEFAULT now()
);
ALTER TABLE cantina_transacoes DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS cantina_restricoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  aluno_nome text,
  tipo text NOT NULL,                      -- 'alergia','intolerancia','restricao','preferencia','vegetariano','vegano'
  descricao text NOT NULL,
  severidade text DEFAULT 'media',         -- 'leve','media','grave'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE cantina_restricoes DISABLE ROW LEVEL SECURITY;
