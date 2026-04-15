-- ═══════════════════════════════════════════════════════════════
--  Migration 226 — Governance Foundations
--
--  1. audit_eventos: log unificado (ator/recurso/ação/antes/depois)
--  2. feature_flags: kill-switches sem redeploy
--  3. escola_ia_uso: budget cap de IA por escola
--  4. RLS auto-coverage: ativa RLS e cria policy escola_id em
--     qualquer tabela pública com coluna escola_id que ainda não
--     tenha policy, com salvaguarda para tabelas já explicitamente
--     policeadas.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. AUDIT UNIFICADO ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_eventos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at         timestamptz NOT NULL DEFAULT now(),
  escola_id  uuid,
  ator_tipo  text,              -- 'staff' | 'gerente' | 'professora' | 'secretaria' | 'pai' | 'system'
  ator_id    uuid,
  ator_email text,
  recurso    text NOT NULL,     -- ex: 'aluno', 'boleto', 'contrato'
  recurso_id text,
  acao       text NOT NULL,     -- ex: 'criar', 'editar', 'deletar', 'exportar'
  antes      jsonb,
  depois     jsonb,
  ip         text,
  user_agent text,
  metadata   jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_eventos_at       ON audit_eventos(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_eventos_escola   ON audit_eventos(escola_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_eventos_recurso  ON audit_eventos(recurso, recurso_id);
CREATE INDEX IF NOT EXISTS idx_audit_eventos_ator     ON audit_eventos(ator_tipo, ator_id);

ALTER TABLE audit_eventos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY audit_eventos_service_role ON audit_eventos
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. FEATURE FLAGS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
  chave       text PRIMARY KEY,
  descricao   text,
  ativo       boolean NOT NULL DEFAULT true,
  escolas     uuid[] DEFAULT NULL,   -- null = todas; array = só estas
  rollout_pct smallint DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  atualizado_em timestamptz DEFAULT now(),
  atualizado_por text
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY feature_flags_read_public ON feature_flags
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY feature_flags_write_service ON feature_flags
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed flags comuns
INSERT INTO feature_flags (chave, descricao, ativo) VALUES
  ('kill_switch_ia',          'Desliga todas as chamadas Anthropic',  false),
  ('kill_switch_whatsapp',    'Desliga envio de WhatsApp',            false),
  ('kill_switch_boletos',     'Desliga geração de boletos Inter',     false),
  ('beta_lumi_ai_professora', 'Libera Lumi para portal da professora', true),
  ('beta_onboarding_guiado',  'Ativa checklist guiado no gerente',     true)
ON CONFLICT (chave) DO NOTHING;

-- ── 3. BUDGET DE IA POR ESCOLA ─────────────────────────────────
CREATE TABLE IF NOT EXISTS escola_ia_uso (
  escola_id     uuid NOT NULL,
  mes           date NOT NULL,  -- primeiro dia do mês
  tokens_input  bigint NOT NULL DEFAULT 0,
  tokens_output bigint NOT NULL DEFAULT 0,
  custo_usd     numeric(10,4) NOT NULL DEFAULT 0,
  requests      integer NOT NULL DEFAULT 0,
  cap_usd       numeric(10,2) DEFAULT 20.00,   -- teto mensal default; nulo = sem teto
  bloqueado     boolean NOT NULL DEFAULT false, -- setado ao atingir cap
  atualizado_em timestamptz DEFAULT now(),
  PRIMARY KEY (escola_id, mes)
);

CREATE INDEX IF NOT EXISTS idx_ia_uso_bloqueado ON escola_ia_uso(bloqueado) WHERE bloqueado = true;

ALTER TABLE escola_ia_uso ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY ia_uso_service ON escola_ia_uso
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: registra uso e retorna se escola está dentro do cap
CREATE OR REPLACE FUNCTION registrar_ia_uso(
  p_escola_id uuid,
  p_input bigint,
  p_output bigint,
  p_custo numeric
) RETURNS TABLE(dentro_cap boolean, custo_mes numeric, cap numeric) AS $$
DECLARE
  v_mes date := date_trunc('month', current_date);
  v_row escola_ia_uso;
BEGIN
  INSERT INTO escola_ia_uso (escola_id, mes, tokens_input, tokens_output, custo_usd, requests)
  VALUES (p_escola_id, v_mes, p_input, p_output, p_custo, 1)
  ON CONFLICT (escola_id, mes) DO UPDATE SET
    tokens_input  = escola_ia_uso.tokens_input  + p_input,
    tokens_output = escola_ia_uso.tokens_output + p_output,
    custo_usd     = escola_ia_uso.custo_usd     + p_custo,
    requests      = escola_ia_uso.requests      + 1,
    atualizado_em = now()
  RETURNING * INTO v_row;

  -- Marca bloqueado se atingiu cap
  IF v_row.cap_usd IS NOT NULL AND v_row.custo_usd >= v_row.cap_usd AND NOT v_row.bloqueado THEN
    UPDATE escola_ia_uso SET bloqueado = true WHERE escola_id = p_escola_id AND mes = v_mes;
    v_row.bloqueado := true;
  END IF;

  RETURN QUERY SELECT (NOT v_row.bloqueado), v_row.custo_usd, v_row.cap_usd;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. RLS AUTO-COVERAGE ───────────────────────────────────────
-- Ativa RLS + cria policy basic de service_role em qualquer tabela
-- pública com coluna escola_id que ainda não tenha policy.
-- Tabelas com policies explícitas (gerenciadas por migrations anteriores)
-- são preservadas — DO $$ só adiciona, nunca remove.

DO $$
DECLARE
  t record;
  has_policy boolean;
  has_rls boolean;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'escola_id'
      AND c.table_name NOT IN ('escolas')  -- escolas é o próprio tenant
  LOOP
    -- Checa se já tem policy
    SELECT EXISTS(
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t.table_name
    ) INTO has_policy;

    -- Checa se RLS está ativo
    SELECT relrowsecurity FROM pg_class
      WHERE relname = t.table_name AND relnamespace = 'public'::regnamespace
    INTO has_rls;

    -- Ativa RLS se não estiver
    IF has_rls IS NOT NULL AND NOT has_rls THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
      RAISE NOTICE 'RLS ativado em %', t.table_name;
    END IF;

    -- Adiciona policy service_role universal se não houver policy nenhuma
    -- (edge functions usam service role; portais usam edge functions como proxy)
    IF NOT has_policy THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t.table_name || '_service_role', t.table_name);
      RAISE NOTICE 'Policy service_role criada em %', t.table_name;
    END IF;
  END LOOP;
END $$;

-- ── 5. VIEW DE AUDITORIA DE COBERTURA RLS ──────────────────────
-- Queriável pelo staff via MCP/dashboard para monitorar lacunas.
CREATE OR REPLACE VIEW v_rls_coverage AS
SELECT
  t.table_name,
  EXISTS(SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = t.table_name
         AND c.column_name = 'escola_id') AS is_tenant,
  c.relrowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = t.table_name) AS policy_count
FROM information_schema.tables t
JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = 'public'::regnamespace
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

COMMENT ON TABLE audit_eventos   IS 'Log unificado de eventos de negócio — usar ao invés de logs específicos';
COMMENT ON TABLE feature_flags   IS 'Kill-switches e rollouts sem redeploy — client cacheia 30s';
COMMENT ON TABLE escola_ia_uso   IS 'Budget mensal de IA (Anthropic) por escola; bloqueado=true pára chamadas';
COMMENT ON VIEW  v_rls_coverage  IS 'Auditoria de cobertura RLS — SELECT * WHERE is_tenant AND NOT rls_enabled para lacunas';
