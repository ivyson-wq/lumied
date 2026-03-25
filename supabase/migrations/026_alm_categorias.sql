-- Categorias de insumos configuráveis
CREATE TABLE IF NOT EXISTS alm_categorias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

INSERT INTO alm_categorias (nome) VALUES
  ('Papelaria'), ('Canetas'), ('Decoração'), ('Limpeza'),
  ('Higiene'), ('Descartáveis'), ('Didático'), ('Escritório')
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE alm_categorias DISABLE ROW LEVEL SECURITY;
