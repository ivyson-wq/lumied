-- ═══════════════════════════════════════════════════════════════
--  Migration 296 — Controle de Acesso Veicular (LPR Fase 1)
--
--  Leitura de placas via câmera RTSP + daemon Lumied Bridge.
--  Fase 1: cadastro de placas + log de eventos (sem GPIO real,
--  apenas evento → opcional webhook → log).
--
--  Componentes:
--   1. acesso_lpr_placas — placas autorizadas por escola
--   2. acesso_lpr_eventos — log de toda leitura (autorizada ou não)
--   3. Bucket privado lpr-fotos (snapshots da câmera)
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. Placas cadastradas
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acesso_lpr_placas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  placa text NOT NULL,                              -- normalizada: A-Z0-9, sem hífen, uppercase
  owner_tipo text NOT NULL CHECK (owner_tipo IN ('familia','funcionario','aluno','visitante','outro')),
  owner_id uuid,                                    -- opcional (FK lógica, sem REFERENCES por ser polimórfica)
  apelido text,                                     -- "Carro mãe Ana", "Van escolar"
  ativo boolean NOT NULL DEFAULT true,
  validade_inicio date,                             -- NULL = sem início
  validade_fim date,                                -- NULL = sem expiração
  janela_horaria jsonb,                             -- ex: {"seg":[{"inicio":"06:30","fim":"19:00"}], ...}; NULL = 24/7
  observacao text,
  criado_por uuid,                                  -- usuario que cadastrou
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acesso_lpr_placas DISABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lpr_placas_escola_placa
  ON acesso_lpr_placas(escola_id, placa);
CREATE INDEX IF NOT EXISTS idx_lpr_placas_ativo
  ON acesso_lpr_placas(escola_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_lpr_placas_owner
  ON acesso_lpr_placas(owner_tipo, owner_id) WHERE owner_id IS NOT NULL;

COMMENT ON TABLE acesso_lpr_placas IS 'Placas autorizadas por escola. Sincronizadas pro daemon Lumied Bridge via comando lpr_sync.';
COMMENT ON COLUMN acesso_lpr_placas.placa IS 'Normalizada: A-Z 0-9, uppercase, sem hífen. Ex: ABC1234 ou ABC1D23 (Mercosul).';
COMMENT ON COLUMN acesso_lpr_placas.janela_horaria IS 'JSON {dom:[],seg:[{inicio,fim}],...}. NULL = autorizado 24/7.';

SELECT add_tenant_isolation('acesso_lpr_placas');
ALTER TABLE acesso_lpr_placas ALTER COLUMN escola_id SET NOT NULL;

-- atualizado_em automático
CREATE OR REPLACE FUNCTION trg_lpr_placas_touch() RETURNS trigger AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lpr_placas_touch ON acesso_lpr_placas;
CREATE TRIGGER trg_lpr_placas_touch
  BEFORE UPDATE ON acesso_lpr_placas
  FOR EACH ROW EXECUTE FUNCTION trg_lpr_placas_touch();

-- ────────────────────────────────────────────────────────────────
-- 2. Eventos de leitura (toda placa lida, autorizada ou não)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acesso_lpr_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  placa_lida text NOT NULL,                         -- texto cru do OCR (já normalizado pelo daemon)
  placa_id uuid REFERENCES acesso_lpr_placas(id) ON DELETE SET NULL,
  confidence numeric(4,3),                          -- 0.000 a 1.000
  autorizado boolean NOT NULL,
  motivo text NOT NULL CHECK (motivo IN (
    'autorizado','nao_cadastrada','fora_validade','fora_horario','inativa','baixa_confianca'
  )),
  foto_path text,                                   -- bucket lpr-fotos (privado, signed URL on read)
  acao_tomada text,                                 -- 'cancela_aberta','apenas_log',null
  ts timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acesso_lpr_eventos DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_lpr_eventos_escola_ts
  ON acesso_lpr_eventos(escola_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_lpr_eventos_placa_id
  ON acesso_lpr_eventos(placa_id) WHERE placa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lpr_eventos_autorizado
  ON acesso_lpr_eventos(escola_id, autorizado, ts DESC);

COMMENT ON TABLE acesso_lpr_eventos IS 'Log de toda placa lida pela câmera LPR. Inclui não-cadastradas (visibilidade total). Foto em bucket privado lpr-fotos.';

SELECT add_tenant_isolation('acesso_lpr_eventos');
ALTER TABLE acesso_lpr_eventos ALTER COLUMN escola_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. Bucket privado pra snapshots
-- ────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('lpr-fotos', 'lpr-fotos', false)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- 4. Cleanup automático: eventos > 90 dias e fotos órfãs
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_lpr_eventos() RETURNS void AS $$
BEGIN
  -- Purga eventos > 90 dias (LGPD: minimização de dados)
  DELETE FROM acesso_lpr_eventos WHERE ts < now() - interval '90 days';
  -- Storage cleanup é feito por job separado lendo foto_path órfãs
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_lpr_eventos() IS 'Purga eventos LPR > 90 dias. Rodado diariamente por pg_cron.';

DO $$
BEGIN
  PERFORM cron.unschedule('lpr-eventos-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lpr-eventos-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('lpr-eventos-cleanup', '15 3 * * *', $$SELECT cleanup_lpr_eventos();$$);
