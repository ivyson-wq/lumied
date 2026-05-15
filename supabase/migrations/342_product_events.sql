-- ═══════════════════════════════════════════════════════════════
-- Migration 342 — product_events (Lumied Activation Program)
--
-- Tabela de telemetria de produto. Pré-requisito do Lumied Health
-- Score (LHS) e métrica AMPS (Active Modules per School @ D60).
-- Cada ação importante do usuário emite 1 evento; LHS é calculado
-- a partir desses eventos.
--
-- Pilar 4 do LAP — Health Score & Telemetria.
-- Vide [[project_lumied_activation_program]].
--
-- Decisão: NÃO particionar por mês agora (volume baixo). Quando
-- crescer (>10M linhas / lentidão), migrar via mig futura pra
-- PARTITION BY RANGE(created_at).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_events (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id   uuid        NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  persona     text        CHECK (persona IN (
    'diretor','financeiro','secretaria','manutencao','almoxarife',
    'comercial','coord_pedagogico','professora','professora_assistente',
    'nutricionista','impressao','pais','aluno','staff_lumied','sistema'
  )),
  module      text        CHECK (module IN (
    'auth','onboarding','dashboard','financeiro','manutencao','almoxarifado',
    'ponto','compliance','crm','academico','comunicacao','cobranca','pickup',
    'agenda','contratos','rh','loja','ia','admin','operacional','outro'
  )),
  event_name  text        NOT NULL CHECK (event_name ~ '^[a-z_]+(\.[a-z_]+)+$'),
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  session_id  text,
  source      text        NOT NULL DEFAULT 'web' CHECK (source IN ('web','mobile','edge','cron','webhook','test')),
  idempotency_key text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Índices (priorizar queries de LHS: por escola+tempo, por evento, por persona) ───
CREATE INDEX IF NOT EXISTS idx_product_events_escola_time
  ON product_events(escola_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_escola_event_time
  ON product_events(escola_id, event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_escola_module_time
  ON product_events(escola_id, module, created_at DESC)
  WHERE module IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_events_escola_persona_time
  ON product_events(escola_id, persona, created_at DESC)
  WHERE persona IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_events_escola_user_time
  ON product_events(escola_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Idempotency: dedup janela de 60s (vide [[idempotency-check]])
-- Constraint UNIQUE só quando idempotency_key vem preenchida.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_events_idem
  ON product_events(escola_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── Tenant isolation (rejeita INSERT sem escola_id válido) ────
SELECT add_tenant_isolation('product_events');

-- ─── Constraint defensiva extra: payload max 16KB ─────────────
-- Evita evento gigante engasgar tabela. App-side já valida 10KB.
ALTER TABLE product_events
  ADD CONSTRAINT chk_product_events_payload_size
  CHECK (octet_length(payload::text) <= 16384);

COMMENT ON TABLE product_events IS
  'Telemetria de produto pro LAP (mig 342). Base de cálculo do LHS e AMPS. Eventos seguem taxonomia <modulo>.<entidade>.<acao> — vide docs/EVENTS.md.';
COMMENT ON COLUMN product_events.event_name IS
  'Namespace dotted snake_case, ex: financeiro.cobranca.gerada';
COMMENT ON COLUMN product_events.persona IS
  'Persona inferida do role do usuário no momento do evento';
COMMENT ON COLUMN product_events.idempotency_key IS
  'Opcional. Quando presente, garante dedup por escola+key.';
