-- ═══════════════════════════════════════════════════════════════
--  Migration 111: Ponto CLT — Cálculos trabalhistas completos
--  Hora extra 50%/100%, hora noturna, banco de horas, feriados
-- ═══════════════════════════════════════════════════════════════

-- New columns on compliance_ponto_registros
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS intervalo_minutos integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS horas_normais_min integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS hora_extra_50_min integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS hora_extra_100_min integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS hora_noturna_min integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS atraso_min integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS falta boolean DEFAULT false;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS tipo_dia text DEFAULT 'util';
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS banco_horas_min integer DEFAULT 0;
ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS processado boolean DEFAULT false;

-- New columns on compliance_horarios
ALTER TABLE compliance_horarios ADD COLUMN IF NOT EXISTS intervalo_minutos integer DEFAULT 60;
ALTER TABLE compliance_horarios ADD COLUMN IF NOT EXISTS jornada_diaria_min integer DEFAULT 480;
ALTER TABLE compliance_horarios ADD COLUMN IF NOT EXISTS tipo_jornada text DEFAULT 'integral';

-- Banco de horas mensal por professora
CREATE TABLE IF NOT EXISTS compliance_banco_horas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano integer NOT NULL,
  saldo_anterior_min integer DEFAULT 0,
  creditos_min integer DEFAULT 0,
  debitos_min integer DEFAULT 0,
  saldo_final_min integer DEFAULT 0,
  fechado boolean DEFAULT false,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(professora_id, mes, ano)
);
ALTER TABLE compliance_banco_horas DISABLE ROW LEVEL SECURITY;

-- Feriados da escola
CREATE TABLE IF NOT EXISTS compliance_feriados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data date NOT NULL UNIQUE,
  descricao text NOT NULL,
  tipo text DEFAULT 'feriado',
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_feriados DISABLE ROW LEVEL SECURITY;

-- Configuracao de politica de horas extras
CREATE TABLE IF NOT EXISTS compliance_config_ponto (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chave text UNIQUE NOT NULL,
  valor text NOT NULL,
  descricao text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_config_ponto DISABLE ROW LEVEL SECURITY;

-- Default configs
INSERT INTO compliance_config_ponto (chave, valor, descricao) VALUES
  ('banco_horas_ativo', 'true', 'Se true, hora extra vai para banco de horas ao inves de pagamento'),
  ('banco_horas_prazo_meses', '6', 'Prazo para compensacao do banco de horas (CLT art. 59 par.5)'),
  ('tolerancia_entrada_min', '10', 'Tolerancia para atraso na entrada (CLT art. 58 par.1)'),
  ('tolerancia_saida_min', '10', 'Tolerancia para saida antecipada'),
  ('adicional_he_50', '50', 'Percentual adicional hora extra dia util (CLT art. 59)'),
  ('adicional_he_100', '100', 'Percentual adicional hora extra domingo/feriado'),
  ('limite_he_diaria_min', '120', 'Limite de hora extra diaria (2h - CLT art. 59)'),
  ('jornada_maxima_diaria_min', '600', 'Jornada maxima diaria (10h - CLT art. 59)'),
  ('hora_noturna_inicio', '22:00', 'Inicio do periodo noturno'),
  ('hora_noturna_fim', '05:00', 'Fim do periodo noturno'),
  ('hora_noturna_reducao', '52.5', 'Duracao hora noturna em minutos (CLT art. 73 par.1)')
ON CONFLICT (chave) DO NOTHING;
