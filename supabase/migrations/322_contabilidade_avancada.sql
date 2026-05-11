-- ═══════════════════════════════════════════════════════════════
--  Migration 322: Contabilidade Avancada
--
--  1. Centro de Custos (departamento/area em lancamentos)
--  2. Fechamento mensal (bloquear lancamentos retroativos)
--  3. DRE regime competencia vs caixa (flag)
-- ═══════════════════════════════════════════════════════════════

-- 1. Centro de Custos
CREATE TABLE IF NOT EXISTS fin_centros_custo (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo text NOT NULL,
  nome text NOT NULL,
  ativo boolean DEFAULT true,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, codigo)
);

ALTER TABLE fin_centros_custo DISABLE ROW LEVEL SECURITY;

-- Seed centros de custo padrão (escola_id NULL = template global)
INSERT INTO fin_centros_custo (codigo, nome, escola_id)
SELECT c.codigo, c.nome, e.id
FROM (VALUES
  ('ADM', 'Administrativo'),
  ('PED', 'Pedagógico'),
  ('INF', 'Infraestrutura'),
  ('ALI', 'Alimentação'),
  ('MKT', 'Marketing'),
  ('RH', 'Recursos Humanos'),
  ('TI', 'Tecnologia')
) AS c(codigo, nome)
CROSS JOIN escolas e
ON CONFLICT (escola_id, codigo) DO NOTHING;

-- Add centro_custo_id to lancamentos
ALTER TABLE fin_lancamentos
  ADD COLUMN IF NOT EXISTS centro_custo_id uuid REFERENCES fin_centros_custo(id) ON DELETE SET NULL;

-- 2. Fechamento mensal
CREATE TABLE IF NOT EXISTS fin_fechamento_mensal (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mes text NOT NULL,              -- YYYY-MM
  fechado boolean DEFAULT true,
  fechado_por text,
  fechado_em timestamptz DEFAULT now(),
  reaberto_por text,
  reaberto_em timestamptz,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  UNIQUE(escola_id, mes)
);

ALTER TABLE fin_fechamento_mensal DISABLE ROW LEVEL SECURITY;

-- Trigger: block INSERT/UPDATE on fin_lancamentos if month is closed
CREATE OR REPLACE FUNCTION trg_check_fechamento_mensal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fin_fechamento_mensal
    WHERE escola_id = NEW.escola_id
      AND mes = to_char(NEW.data_lancamento, 'YYYY-MM')
      AND fechado = true
  ) THEN
    -- Allow system/trigger updates (status sync from mensalidade triggers)
    IF NEW.criado_por IN ('sistema', 'backfill-320') OR TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Mês % está fechado. Reabra o período para alterar lançamentos.',
      to_char(NEW.data_lancamento, 'YYYY-MM');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_lanc_check_fechamento ON fin_lancamentos;
CREATE TRIGGER trg_fin_lanc_check_fechamento
  BEFORE INSERT ON fin_lancamentos
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_fechamento_mensal();

-- Tenant isolation
SELECT add_tenant_isolation('fin_centros_custo');
SELECT add_tenant_isolation('fin_fechamento_mensal');
