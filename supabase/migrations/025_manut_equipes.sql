-- Equipes de manutenção configuráveis
CREATE TABLE IF NOT EXISTS manut_equipes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

-- Seed com equipes padrão
INSERT INTO manut_equipes (nome) VALUES
  ('Elétrica'), ('Hidráulica'), ('Gesso'), ('Pedreiro'),
  ('Pintor'), ('Montador de Móveis'), ('Faz Tudo')
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE manut_equipes DISABLE ROW LEVEL SECURITY;
