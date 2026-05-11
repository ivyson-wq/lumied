-- ═══════════════════════════════════════════════════════════════
--  Migration 321: Financial Module Improvements
--
--  1. metodo_pagamento + referencia in fin_lancamentos
--  2. fin_recibos table + auto-generation trigger
--  3. fin_reajustes table (annual tuition adjustment)
--  4. fin_notificacao_config (notification rules)
--  5. fin_notificacao_log (sent notifications)
--  6. Desconto approval workflow (status column)
--  7. PIX expiry cron helper
--  8. NF batch support (lancamento_id FK)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Payment method tracking ──────────────────────────────
ALTER TABLE fin_lancamentos
  ADD COLUMN IF NOT EXISTS metodo_pagamento text
    CHECK (metodo_pagamento IS NULL OR metodo_pagamento IN ('boleto','pix','cartao','cheque','dinheiro','ted','outro')),
  ADD COLUMN IF NOT EXISTS referencia_pagamento text;

-- Set metodo for existing boleto-paid lancamentos
UPDATE fin_lancamentos l SET metodo_pagamento = 'boleto'
WHERE l.status = 'pago' AND l.metodo_pagamento IS NULL
  AND EXISTS (SELECT 1 FROM fin_boletos_emitidos b WHERE b.mensalidade_id = l.mensalidade_id AND b.status = 'pago');

-- ── 2. Recibos de pagamento ─────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_recibos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_recibo serial,
  lancamento_id uuid REFERENCES fin_lancamentos(id) ON DELETE SET NULL,
  mensalidade_id uuid REFERENCES fin_mensalidades(id) ON DELETE SET NULL,
  boleto_id uuid REFERENCES fin_boletos_emitidos(id) ON DELETE SET NULL,
  familia_email text NOT NULL,
  familia_nome text,
  crianca_nome text,
  valor numeric NOT NULL,
  data_pagamento date NOT NULL,
  metodo_pagamento text,
  descricao text,
  escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_recibos_familia ON fin_recibos(familia_email);
CREATE INDEX IF NOT EXISTS idx_fin_recibos_escola ON fin_recibos(escola_id);
ALTER TABLE fin_recibos DISABLE ROW LEVEL SECURITY;

-- Trigger: auto-generate recibo when lancamento marked pago
CREATE OR REPLACE FUNCTION trg_lancamento_gerar_recibo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only when status transitions to 'pago'
  IF NEW.status = 'pago' AND (OLD.status IS NULL OR OLD.status != 'pago') THEN
    INSERT INTO fin_recibos (
      lancamento_id, mensalidade_id, familia_email, familia_nome,
      valor, data_pagamento, metodo_pagamento, descricao, escola_id
    )
    SELECT
      NEW.id,
      NEW.mensalidade_id,
      NEW.familia_email,
      NEW.familia_nome,
      NEW.valor,
      COALESCE(NEW.data_pagamento, CURRENT_DATE),
      NEW.metodo_pagamento,
      NEW.descricao,
      NEW.escola_id
    WHERE NEW.familia_email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM fin_recibos r WHERE r.lancamento_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_lanc_recibo ON fin_lancamentos;
CREATE TRIGGER trg_fin_lanc_recibo
  AFTER UPDATE ON fin_lancamentos
  FOR EACH ROW
  EXECUTE FUNCTION trg_lancamento_gerar_recibo();

-- Also on INSERT (for backfilled lancamentos created as 'pago')
CREATE OR REPLACE FUNCTION trg_lancamento_insert_recibo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pago' AND NEW.familia_email IS NOT NULL THEN
    INSERT INTO fin_recibos (
      lancamento_id, mensalidade_id, familia_email, familia_nome,
      valor, data_pagamento, metodo_pagamento, descricao, escola_id
    )
    SELECT NEW.id, NEW.mensalidade_id, NEW.familia_email, NEW.familia_nome,
      NEW.valor, COALESCE(NEW.data_pagamento, CURRENT_DATE),
      NEW.metodo_pagamento, NEW.descricao, NEW.escola_id
    WHERE NOT EXISTS (SELECT 1 FROM fin_recibos r WHERE r.lancamento_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_lanc_insert_recibo ON fin_lancamentos;
CREATE TRIGGER trg_fin_lanc_insert_recibo
  AFTER INSERT ON fin_lancamentos
  FOR EACH ROW
  EXECUTE FUNCTION trg_lancamento_insert_recibo();

-- ── 3. Reajuste anual ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_reajustes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ano_letivo int NOT NULL,
  taxa_percentual numeric NOT NULL,          -- ex: 8.5 para 8.5%
  indice text DEFAULT 'manual',              -- manual, igpm, ipca
  data_vigencia date NOT NULL,               -- when new price takes effect
  motivo text,
  aplicado boolean DEFAULT false,
  aplicado_em timestamptz,
  criado_por text,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, ano_letivo)
);

ALTER TABLE fin_reajustes DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS fin_reajuste_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reajuste_id uuid REFERENCES fin_reajustes(id) ON DELETE CASCADE,
  turno text NOT NULL,
  preco_anterior numeric NOT NULL,
  preco_novo numeric NOT NULL,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE fin_reajuste_historico DISABLE ROW LEVEL SECURITY;

-- ── 4. Notificação financeira config ────────────────────────
CREATE TABLE IF NOT EXISTS fin_notificacao_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL,  -- boleto_emitido, vencimento_proximo, vencido, pago
  canal text NOT NULL DEFAULT 'email',  -- email, whatsapp
  habilitado boolean DEFAULT true,
  dias_offset int DEFAULT 0,            -- negative = before vencimento, positive = after
  template_assunto text,
  template_corpo text,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, tipo, canal)
);

ALTER TABLE fin_notificacao_config DISABLE ROW LEVEL SECURITY;

-- Seed default notification config (will be duplicated per-school on first use)
-- Schools can customize these later

CREATE TABLE IF NOT EXISTS fin_notificacao_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL,
  canal text NOT NULL,
  familia_email text NOT NULL,
  mensalidade_id uuid REFERENCES fin_mensalidades(id) ON DELETE SET NULL,
  status text DEFAULT 'enviado',  -- enviado, erro, agendado
  erro_msg text,
  escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_notif_log_escola ON fin_notificacao_log(escola_id, criado_em DESC);
ALTER TABLE fin_notificacao_log DISABLE ROW LEVEL SECURITY;

-- ── 5. Desconto approval workflow ───────────────────────────
ALTER TABLE fin_ajustes_aluno
  ADD COLUMN IF NOT EXISTS status_aprovacao text
    DEFAULT 'aprovado'
    CHECK (status_aprovacao IN ('pendente','aprovado','rejeitado')),
  ADD COLUMN IF NOT EXISTS aprovado_por text,
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz;

-- ── 6. NF linkage to lancamento ─────────────────────────────
ALTER TABLE fin_notas_fiscais
  ADD COLUMN IF NOT EXISTS lancamento_id uuid REFERENCES fin_lancamentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fin_nf_escola ON fin_notas_fiscais(escola_id);

-- ── 7. PIX expiry helper ────────────────────────────────────
-- Function to expire stale PIX cobranças (called by cron)
CREATE OR REPLACE FUNCTION fin_pix_expirar()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  UPDATE pix_cobrancas SET status = 'expirada'
  WHERE status = 'ativa' AND expira_em < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ── 8. Tenant isolation for new tables ──────────────────────
SELECT add_tenant_isolation('fin_recibos');
SELECT add_tenant_isolation('fin_reajustes');
SELECT add_tenant_isolation('fin_reajuste_historico');
SELECT add_tenant_isolation('fin_notificacao_config');
SELECT add_tenant_isolation('fin_notificacao_log');
