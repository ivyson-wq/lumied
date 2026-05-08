-- ═══════════════════════════════════════════════════════════════
--  Migration 299 — LPR Fase 3: multi-câmera + ROI + GPIO
--
--  Substitui config single-camera via env var (LPR_RTSP_URL etc.) por
--  config DB-driven, plural por escola. Daemon recebe lista via comando
--  lpr_cameras_sync (similar a lpr_sync de placas) e mantém um worker
--  por câmera ativa.
--
--   1. acesso_lpr_cameras  — config por câmera (RTSP, ALPR, ROI, gate)
--   2. acesso_lpr_eventos.camera_id — qual câmera leu
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS acesso_lpr_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome text NOT NULL,                                    -- "Portão de carros", "Garagem fundos"
  rtsp_url text NOT NULL,                                -- rtsp://user:pass@ip:porta/path
  alpr_url text NOT NULL DEFAULT 'http://localhost:32168/v1/vision/alpr',
  scan_interval_ms int NOT NULL DEFAULT 2000 CHECK (scan_interval_ms BETWEEN 500 AND 30000),
  confidence_min numeric(4,3) NOT NULL DEFAULT 0.85 CHECK (confidence_min >= 0 AND confidence_min <= 1),
  -- ROI: array de {x,y} normalizado [0..1]. NULL = câmera processa frame inteiro.
  -- Daemon descarta detecções cujo bbox center caia fora do polígono.
  roi_polygon jsonb,
  gate_webhook_url text,                                 -- POSTa quando autoriza
  gate_webhook_token text,                               -- Bearer opcional
  gpio_pin int,                                          -- libgpiod chip0 line N (alternativa ao webhook)
  gpio_pulse_ms int NOT NULL DEFAULT 500,                -- duração do pulso GPIO
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acesso_lpr_cameras DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_lpr_cam_escola
  ON acesso_lpr_cameras(escola_id) WHERE ativa = true;

COMMENT ON TABLE acesso_lpr_cameras IS 'Câmeras LPR por escola. Daemon recebe via lpr_cameras_sync e roda 1 worker por câmera ativa.';
COMMENT ON COLUMN acesso_lpr_cameras.roi_polygon IS 'JSON [{x:0..1, y:0..1}, …] normalizado. Detecção fora do polígono é descartada. NULL=frame inteiro.';
COMMENT ON COLUMN acesso_lpr_cameras.gpio_pin IS 'Pino libgpiod no chip0. Quando setado, daemon usa gpioset em vez do webhook.';

SELECT add_tenant_isolation('acesso_lpr_cameras');
ALTER TABLE acesso_lpr_cameras ALTER COLUMN escola_id SET NOT NULL;

-- atualizado_em automático
CREATE OR REPLACE FUNCTION trg_lpr_cameras_touch() RETURNS trigger AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lpr_cameras_touch ON acesso_lpr_cameras;
CREATE TRIGGER trg_lpr_cameras_touch
  BEFORE UPDATE ON acesso_lpr_cameras
  FOR EACH ROW EXECUTE FUNCTION trg_lpr_cameras_touch();

-- ────────────────────────────────────────────────────────────────
-- 2. camera_id em acesso_lpr_eventos
-- ────────────────────────────────────────────────────────────────

ALTER TABLE acesso_lpr_eventos
  ADD COLUMN IF NOT EXISTS camera_id uuid REFERENCES acesso_lpr_cameras(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lpr_eventos_camera
  ON acesso_lpr_eventos(camera_id, ts DESC) WHERE camera_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. Função de relatório diário (consumida pela action acesso_lpr_relatorio)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lpr_relatorio_diario(p_escola uuid, p_dias int DEFAULT 30)
RETURNS TABLE(
  dia date,
  total bigint,
  autorizadas bigint,
  nao_cadastradas bigint,
  fora_horario bigint,
  fora_validade bigint,
  inativas bigint,
  baixa_conf bigint
) AS $$
  SELECT
    ts::date AS dia,
    count(*) AS total,
    count(*) FILTER (WHERE motivo = 'autorizado') AS autorizadas,
    count(*) FILTER (WHERE motivo = 'nao_cadastrada') AS nao_cadastradas,
    count(*) FILTER (WHERE motivo = 'fora_horario') AS fora_horario,
    count(*) FILTER (WHERE motivo = 'fora_validade') AS fora_validade,
    count(*) FILTER (WHERE motivo = 'inativa') AS inativas,
    count(*) FILTER (WHERE motivo = 'baixa_confianca') AS baixa_conf
  FROM acesso_lpr_eventos
  WHERE escola_id = p_escola
    AND ts >= (now() - (p_dias || ' days')::interval)
  GROUP BY ts::date
  ORDER BY dia DESC;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION lpr_relatorio_diario IS 'Agregação diária de eventos LPR por motivo. Default 30 dias.';
