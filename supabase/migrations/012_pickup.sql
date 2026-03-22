-- Migration 012: Sistema "Estou a Caminho" — aviso de busca em tempo real

-- 1. Séries que cada professora monitora (para filtrar a fila de busca)
ALTER TABLE professoras
  ADD COLUMN IF NOT EXISTS series_monitoras text[] DEFAULT '{}';

-- 2. Tabela de avisos de busca
CREATE TABLE IF NOT EXISTS pickup_notificacoes (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identificação do responsável e da criança
  email_pai     text        NOT NULL,
  nome_resp     text        NOT NULL,
  nome_crianca  text        NOT NULL,
  serie         text,

  -- Localização pontual (capturada UMA VEZ no momento do aviso — LGPD)
  lat_pai       decimal(10, 7),
  lon_pai       decimal(10, 7),

  -- ETA calculado (Google Maps) ou informado manualmente
  eta_minutos   integer,
  eta_modo      text        DEFAULT 'manual'
                              CHECK (eta_modo IN ('google_maps', 'calculo_local', 'manual')),

  -- Ciclo de vida
  saiu_em       timestamptz DEFAULT now(),
  chegou_em     timestamptz,
  entregue_em   timestamptz,
  entregue_por  text,

  -- Status
  status        text        DEFAULT 'a_caminho'
                              CHECK (status IN ('a_caminho', 'chegou', 'entregue', 'cancelado')),

  observacao    text,
  criado_em     timestamptz DEFAULT now()
);

-- 3. Índices
CREATE INDEX IF NOT EXISTS idx_pickup_data_status
  ON pickup_notificacoes(DATE(saiu_em), status);
CREATE INDEX IF NOT EXISTS idx_pickup_email
  ON pickup_notificacoes(email_pai);
CREATE INDEX IF NOT EXISTS idx_pickup_serie
  ON pickup_notificacoes(serie, DATE(saiu_em));
