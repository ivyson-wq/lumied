-- Trocar idade por data de nascimento no CRM
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS data_nascimento date;

-- Configuracao de series por idade (data de corte)
CREATE TABLE IF NOT EXISTS config_series_idade (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  serie text NOT NULL,
  idade_min_meses integer NOT NULL,
  idade_max_meses integer NOT NULL,
  data_corte_ref text NOT NULL DEFAULT '03-31', -- MM-DD
  ano_ref integer NOT NULL DEFAULT 2026,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean DEFAULT true,
  UNIQUE(serie, ano_ref)
);

INSERT INTO config_series_idade (serie, idade_min_meses, idade_max_meses, data_corte_ref, ano_ref, ordem) VALUES
  ('Bear Care', 18, 23, '03-31', 2026, 0),
  ('Toddler', 24, 35, '03-31', 2026, 1),
  ('Nursery', 36, 47, '03-31', 2026, 2),
  ('JK', 48, 59, '03-31', 2026, 3),
  ('SK', 60, 71, '03-31', 2026, 4),
  ('Year 1', 72, 83, '03-31', 2026, 5),
  ('Year 2', 84, 95, '03-31', 2026, 6),
  ('Year 3', 96, 107, '03-31', 2026, 7),
  ('Year 4', 108, 119, '03-31', 2026, 8),
  ('Year 5', 120, 131, '03-31', 2026, 9)
ON CONFLICT (serie, ano_ref) DO NOTHING;

ALTER TABLE config_series_idade DISABLE ROW LEVEL SECURITY;
