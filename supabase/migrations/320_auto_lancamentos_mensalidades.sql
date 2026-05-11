-- ═══════════════════════════════════════════════════════════════
--  Migration 320: Auto-link mensalidades → lançamentos → DRE
--
--  Problem: fin_mensalidades existed in isolation from fin_lancamentos.
--  DRE and Balanço query fin_lancamentos only, so tuition revenue was
--  invisible to financial reporting.
--
--  Solution:
--  1. Add mensalidade_id FK to fin_lancamentos
--  2. Trigger on fin_mensalidades INSERT → auto-create lançamento
--  3. Trigger on fin_mensalidades UPDATE (status) → update lançamento
--  4. Backfill existing mensalidades that have no lançamento
-- ═══════════════════════════════════════════════════════════════

-- 1. Add mensalidade_id column to fin_lancamentos
ALTER TABLE fin_lancamentos
  ADD COLUMN IF NOT EXISTS mensalidade_id uuid REFERENCES fin_mensalidades(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fin_lanc_mensalidade
  ON fin_lancamentos(mensalidade_id) WHERE mensalidade_id IS NOT NULL;

-- 2. Helper: resolve conta_id for "Mensalidades" (code 1.1) for a given escola
CREATE OR REPLACE FUNCTION _fin_conta_mensalidades(p_escola_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM fin_plano_contas
  WHERE codigo = '1.1'
    AND (escola_id = p_escola_id OR escola_id IS NULL)
  ORDER BY escola_id NULLS LAST  -- prefer school-specific, fallback to global
  LIMIT 1;
$$;

-- 3. Trigger function: auto-create lançamento on mensalidade INSERT
CREATE OR REPLACE FUNCTION trg_mensalidade_to_lancamento()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_conta_id uuid;
  v_data date;
BEGIN
  -- Only create for mensalidades with value > 0
  IF NEW.valor_total <= 0 THEN
    RETURN NEW;
  END IF;

  v_conta_id := _fin_conta_mensalidades(NEW.escola_id);
  -- Parse mes (YYYY-MM) to first day of month as data_lancamento
  v_data := (NEW.mes || '-01')::date;

  INSERT INTO fin_lancamentos (
    tipo, conta_id, descricao, valor,
    data_lancamento, data_vencimento, data_pagamento,
    status, familia_email, familia_nome,
    mensalidade_id, escola_id, criado_por
  ) VALUES (
    'receita',
    v_conta_id,
    'Mensalidade ' || NEW.mes || ' — ' || COALESCE(NEW.crianca_nome, 'Aluno'),
    NEW.valor_total,
    v_data,
    NEW.data_vencimento,
    CASE WHEN NEW.status = 'pago' THEN COALESCE(NEW.data_pagamento, CURRENT_DATE) ELSE NULL END,
    CASE
      WHEN NEW.status = 'pago' THEN 'pago'
      WHEN NEW.status = 'cancelado' THEN 'cancelado'
      ELSE 'pendente'
    END,
    NEW.familia_email,
    NEW.familia_nome,
    NEW.id,
    NEW.escola_id,
    'sistema'
  )
  ON CONFLICT DO NOTHING;  -- safety: avoid duplicate if trigger fires twice

  RETURN NEW;
END;
$$;

-- 4. Trigger function: sync lançamento when mensalidade status/valor changes
CREATE OR REPLACE FUNCTION trg_mensalidade_update_lancamento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only act if status or valor changed
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.valor_total IS DISTINCT FROM NEW.valor_total
     OR OLD.data_pagamento IS DISTINCT FROM NEW.data_pagamento
  THEN
    UPDATE fin_lancamentos SET
      status = CASE
        WHEN NEW.status = 'pago' THEN 'pago'
        WHEN NEW.status = 'cancelado' THEN 'cancelado'
        WHEN NEW.status = 'atrasado' THEN 'atrasado'
        ELSE 'pendente'
      END,
      valor = NEW.valor_total,
      data_pagamento = CASE
        WHEN NEW.status = 'pago' THEN COALESCE(NEW.data_pagamento, CURRENT_DATE)
        ELSE NULL
      END,
      data_vencimento = NEW.data_vencimento
    WHERE mensalidade_id = NEW.id;

    -- If no lançamento exists yet (legacy data), create one
    IF NOT FOUND AND NEW.valor_total > 0 AND NEW.status != 'cancelado' THEN
      INSERT INTO fin_lancamentos (
        tipo, conta_id, descricao, valor,
        data_lancamento, data_vencimento, data_pagamento,
        status, familia_email, familia_nome,
        mensalidade_id, escola_id, criado_por
      ) VALUES (
        'receita',
        _fin_conta_mensalidades(NEW.escola_id),
        'Mensalidade ' || NEW.mes || ' — ' || COALESCE(NEW.crianca_nome, 'Aluno'),
        NEW.valor_total,
        (NEW.mes || '-01')::date,
        NEW.data_vencimento,
        CASE WHEN NEW.status = 'pago' THEN COALESCE(NEW.data_pagamento, CURRENT_DATE) ELSE NULL END,
        CASE WHEN NEW.status = 'pago' THEN 'pago' ELSE 'pendente' END,
        NEW.familia_email,
        NEW.familia_nome,
        NEW.id,
        NEW.escola_id,
        'sistema'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Attach triggers
DROP TRIGGER IF EXISTS trg_fin_mens_insert_lancamento ON fin_mensalidades;
CREATE TRIGGER trg_fin_mens_insert_lancamento
  AFTER INSERT ON fin_mensalidades
  FOR EACH ROW
  EXECUTE FUNCTION trg_mensalidade_to_lancamento();

DROP TRIGGER IF EXISTS trg_fin_mens_update_lancamento ON fin_mensalidades;
CREATE TRIGGER trg_fin_mens_update_lancamento
  AFTER UPDATE ON fin_mensalidades
  FOR EACH ROW
  EXECUTE FUNCTION trg_mensalidade_update_lancamento();

-- 6. Backfill: create lançamentos for existing mensalidades that have none
INSERT INTO fin_lancamentos (
  tipo, conta_id, descricao, valor,
  data_lancamento, data_vencimento, data_pagamento,
  status, familia_email, familia_nome,
  mensalidade_id, escola_id, criado_por
)
SELECT
  'receita',
  _fin_conta_mensalidades(m.escola_id),
  'Mensalidade ' || m.mes || ' — ' || COALESCE(m.crianca_nome, 'Aluno'),
  m.valor_total,
  (m.mes || '-01')::date,
  m.data_vencimento,
  CASE WHEN m.status = 'pago' THEN COALESCE(m.data_pagamento, CURRENT_DATE) ELSE NULL END,
  CASE
    WHEN m.status = 'pago' THEN 'pago'
    WHEN m.status = 'cancelado' THEN 'cancelado'
    WHEN m.status = 'atrasado' THEN 'atrasado'
    ELSE 'pendente'
  END,
  m.familia_email,
  m.familia_nome,
  m.id,
  m.escola_id,
  'backfill-320'
FROM fin_mensalidades m
WHERE m.valor_total > 0
  AND NOT EXISTS (
    SELECT 1 FROM fin_lancamentos l WHERE l.mensalidade_id = m.id
  );

-- 7. Ensure plano de contas "Atividades Extracurriculares" (1.2) exists per escola too
-- (for future use when valor_atividades > 0)

-- 8. Add Contas a Receber to balanço patrimonial if missing
INSERT INTO fin_plano_contas (codigo, nome, tipo)
SELECT '3.2', 'Contas a Receber', 'ativo'
WHERE NOT EXISTS (SELECT 1 FROM fin_plano_contas WHERE codigo = '3.2' AND tipo = 'ativo');

-- 9. View for quick accounting health check
CREATE OR REPLACE VIEW v_fin_integridade AS
SELECT
  e.nome AS escola,
  (SELECT count(*) FROM fin_mensalidades m WHERE m.escola_id = e.id) AS total_mensalidades,
  (SELECT count(*) FROM fin_lancamentos l WHERE l.escola_id = e.id AND l.mensalidade_id IS NOT NULL) AS lancamentos_vinculados,
  (SELECT count(*) FROM fin_mensalidades m WHERE m.escola_id = e.id
    AND NOT EXISTS (SELECT 1 FROM fin_lancamentos l WHERE l.mensalidade_id = m.id)) AS mensalidades_sem_lancamento,
  (SELECT COALESCE(sum(valor_total),0) FROM fin_mensalidades m WHERE m.escola_id = e.id AND m.status = 'pago') AS receita_mensalidades_pago,
  (SELECT COALESCE(sum(valor),0) FROM fin_lancamentos l WHERE l.escola_id = e.id AND l.tipo = 'receita' AND l.status = 'pago') AS receita_lancamentos_pago
FROM escolas e;
