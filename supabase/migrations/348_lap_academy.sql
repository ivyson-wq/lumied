-- ═══════════════════════════════════════════════════════════════
-- Migration 348 — Lumied Academy + Certificação (Sprint 14+15)
-- ═══════════════════════════════════════════════════════════════

-- Progresso de cada usuário em cada trilha/lição
CREATE TABLE IF NOT EXISTS lap_academy_progress (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id       uuid        NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  user_email      text,
  user_nome       text,
  trilha          text        NOT NULL,
  licao           text,
  status          text        NOT NULL DEFAULT 'iniciado' CHECK (status IN ('iniciado','concluido','quiz_passou','quiz_falhou')),
  quiz_score      smallint,
  duracao_seg     integer,
  iniciado_em     timestamptz NOT NULL DEFAULT now(),
  concluido_em    timestamptz,
  UNIQUE (escola_id, user_id, trilha, licao)
);

CREATE INDEX IF NOT EXISTS idx_academy_user
  ON lap_academy_progress(escola_id, user_id, trilha);

CREATE INDEX IF NOT EXISTS idx_academy_trilha_status
  ON lap_academy_progress(trilha, status);

-- Certificações concedidas
CREATE TABLE IF NOT EXISTS lap_academy_certificacoes (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo          text        NOT NULL UNIQUE,             -- ex: "LUM-OPL-A1B2C3"
  escola_id       uuid        NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  user_nome       text        NOT NULL,
  user_email      text,
  trilha          text        NOT NULL,
  trilha_nome     text        NOT NULL,
  emitido_em      timestamptz NOT NULL DEFAULT now(),
  valido_ate      timestamptz,                              -- null = vitalício
  revogado_em     timestamptz,
  metadata        jsonb       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_acad_cert_user
  ON lap_academy_certificacoes(escola_id, user_id);

CREATE INDEX IF NOT EXISTS idx_acad_cert_codigo
  ON lap_academy_certificacoes(codigo);

SELECT add_tenant_isolation('lap_academy_progress');
SELECT add_tenant_isolation('lap_academy_certificacoes');

COMMENT ON TABLE lap_academy_progress IS 'Progresso por usuário/trilha na Lumied Academy (mig 348)';
COMMENT ON TABLE lap_academy_certificacoes IS 'Certificados emitidos após conclusão de trilha + quiz aprovado (mig 348)';
