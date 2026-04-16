-- ═══════════════════════════════════════════════════════════════
--  Migration 249: Sincronizar saas_faturas → lumied_contas_receber
-- ═══════════════════════════════════════════════════════════════
--  Trigger one-way: toda fatura SaaS vira uma linha de CR no
--  Financeiro Interno, para consolidar o fluxo de caixa da Lumied.
--
--  Mapeamento de status:
--    saas_faturas.status              → lumied_contas_receber.status
--    PENDING                          → aberto
--    OVERDUE                          → vencido
--    RECEIVED / RECEIVED_IN_CASH      → recebido (valor_recebido = valor_pago,
--                                                 data_recebimento = data_pagamento)
--    CANCELLED / ERROR                → cancelado
--    outros                           → aberto (fallback)
-- ═══════════════════════════════════════════════════════════════

-- ── UNIQUE para evitar duplicação em caso de retry/replay ──
ALTER TABLE lumied_contas_receber
  ADD CONSTRAINT lumied_cr_saas_fatura_unique UNIQUE (saas_fatura_id);

-- ── Função de sincronização ──
CREATE OR REPLACE FUNCTION sync_saas_fatura_to_cr() RETURNS TRIGGER AS $$
DECLARE
  novo_status TEXT;
  novo_valor_rec NUMERIC(12,2);
  novo_data_rec DATE;
BEGIN
  -- Map status SaaS → CR
  novo_status := CASE
    WHEN NEW.status IN ('RECEIVED','RECEIVED_IN_CASH','CONFIRMED','PAGO') THEN 'recebido'
    WHEN NEW.status = 'OVERDUE' THEN 'vencido'
    WHEN NEW.status IN ('CANCELLED','ERROR','REFUNDED') THEN 'cancelado'
    ELSE 'aberto'
  END;

  IF novo_status = 'recebido' THEN
    novo_valor_rec := COALESCE(NEW.valor_pago, NEW.valor);
    novo_data_rec := COALESCE(NEW.data_pagamento, CURRENT_DATE);
  ELSE
    novo_valor_rec := NULL;
    novo_data_rec := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO lumied_contas_receber (
      origem, escola_id, descricao, valor, data_vencimento,
      status, valor_recebido, data_recebimento,
      forma_pagamento, saas_fatura_id, criado_em
    ) VALUES (
      'saas', NEW.escola_id,
      COALESCE(NEW.descricao, 'Mensalidade Lumied'),
      NEW.valor, NEW.data_vencimento,
      novo_status, novo_valor_rec, novo_data_rec,
      NEW.forma_pagamento, NEW.id, now()
    )
    ON CONFLICT (saas_fatura_id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE lumied_contas_receber SET
      valor = NEW.valor,
      data_vencimento = NEW.data_vencimento,
      descricao = COALESCE(NEW.descricao, descricao),
      status = novo_status,
      valor_recebido = novo_valor_rec,
      data_recebimento = novo_data_rec,
      forma_pagamento = NEW.forma_pagamento,
      atualizado_em = now()
    WHERE saas_fatura_id = NEW.id;
    -- Se não existe (fatura criada antes do trigger existir), cria agora
    IF NOT FOUND THEN
      INSERT INTO lumied_contas_receber (
        origem, escola_id, descricao, valor, data_vencimento,
        status, valor_recebido, data_recebimento,
        forma_pagamento, saas_fatura_id, criado_em
      ) VALUES (
        'saas', NEW.escola_id,
        COALESCE(NEW.descricao, 'Mensalidade Lumied'),
        NEW.valor, NEW.data_vencimento,
        novo_status, novo_valor_rec, novo_data_rec,
        NEW.forma_pagamento, NEW.id, now()
      )
      ON CONFLICT (saas_fatura_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saas_fatura_to_cr ON saas_faturas;
CREATE TRIGGER trg_saas_fatura_to_cr
  AFTER INSERT OR UPDATE OF status, valor, valor_pago, data_pagamento, data_vencimento, descricao, forma_pagamento
  ON saas_faturas
  FOR EACH ROW EXECUTE FUNCTION sync_saas_fatura_to_cr();

-- ── Também propagar DELETE (raro — cancela linha do CR) ──
CREATE OR REPLACE FUNCTION sync_saas_fatura_delete_cr() RETURNS TRIGGER AS $$
BEGIN
  -- Marca como cancelado ao invés de deletar (preserva auditoria)
  UPDATE lumied_contas_receber SET status='cancelado', atualizado_em=now()
   WHERE saas_fatura_id = OLD.id;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saas_fatura_del_cr ON saas_faturas;
CREATE TRIGGER trg_saas_fatura_del_cr
  AFTER DELETE ON saas_faturas
  FOR EACH ROW EXECUTE FUNCTION sync_saas_fatura_delete_cr();

-- ── Backfill: faturas SaaS que já existem e ainda não têm CR correspondente ──
INSERT INTO lumied_contas_receber (
  origem, escola_id, descricao, valor, data_vencimento,
  status, valor_recebido, data_recebimento,
  forma_pagamento, saas_fatura_id, criado_em
)
SELECT
  'saas', f.escola_id,
  COALESCE(f.descricao, 'Mensalidade Lumied'),
  f.valor, f.data_vencimento,
  CASE
    WHEN f.status IN ('RECEIVED','RECEIVED_IN_CASH','CONFIRMED','PAGO') THEN 'recebido'
    WHEN f.status = 'OVERDUE' THEN 'vencido'
    WHEN f.status IN ('CANCELLED','ERROR','REFUNDED') THEN 'cancelado'
    ELSE 'aberto'
  END,
  CASE WHEN f.status IN ('RECEIVED','RECEIVED_IN_CASH','CONFIRMED','PAGO') THEN COALESCE(f.valor_pago, f.valor) ELSE NULL END,
  CASE WHEN f.status IN ('RECEIVED','RECEIVED_IN_CASH','CONFIRMED','PAGO') THEN COALESCE(f.data_pagamento, CURRENT_DATE) ELSE NULL END,
  f.forma_pagamento, f.id, f.criado_em
FROM saas_faturas f
WHERE NOT EXISTS (SELECT 1 FROM lumied_contas_receber cr WHERE cr.saas_fatura_id = f.id)
ON CONFLICT (saas_fatura_id) DO NOTHING;

-- ── Proteção: cr_upsert no admin NÃO deve permitir editar linhas origem='saas' (são espelho)
-- Regra aplicada na edge function admin/index.ts, via lookup do origem antes de update.
-- Aqui adiciono também um trigger defensivo BEFORE UPDATE que bloqueia mudanças destrutivas:
CREATE OR REPLACE FUNCTION cr_saas_readonly_guard() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.origem = 'saas' AND OLD.saas_fatura_id IS NOT NULL THEN
    -- Permitir apenas campos que fazem sentido editar manualmente (observacao).
    -- Status/valor/data vêm do saas_faturas — qualquer tentativa de mudar é bloqueada.
    NEW.origem := OLD.origem;
    NEW.escola_id := OLD.escola_id;
    NEW.valor := OLD.valor;
    NEW.data_vencimento := OLD.data_vencimento;
    NEW.status := OLD.status;
    NEW.valor_recebido := OLD.valor_recebido;
    NEW.data_recebimento := OLD.data_recebimento;
    NEW.saas_fatura_id := OLD.saas_fatura_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cr_saas_readonly ON lumied_contas_receber;
CREATE TRIGGER trg_cr_saas_readonly
  BEFORE UPDATE ON lumied_contas_receber
  FOR EACH ROW EXECUTE FUNCTION cr_saas_readonly_guard();

COMMENT ON FUNCTION sync_saas_fatura_to_cr IS 'Sincroniza saas_faturas → lumied_contas_receber (espelho one-way). Linhas origem=saas são read-only no CR.';
COMMENT ON FUNCTION cr_saas_readonly_guard IS 'Impede mudança manual de campos de linhas origem=saas no CR — elas são espelhadas da saas_faturas.';
