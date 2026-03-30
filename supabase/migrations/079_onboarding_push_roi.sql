-- =====================================================
-- 079: Onboarding wizard + Push subscriptions + ROI + Streaks
-- =====================================================

-- 1. Onboarding progress per school
CREATE TABLE IF NOT EXISTS onboarding_progresso (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  etapa text NOT NULL,               -- 'dados_escola','series','professoras','familias','primeiro_aviso'
  completada boolean DEFAULT false,
  completada_em timestamptz,
  UNIQUE(escola_id, etapa)
);
ALTER TABLE onboarding_progresso DISABLE ROW LEVEL SECURITY;

-- 2. Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  portal text NOT NULL,              -- 'pais','professora','gerente'
  endpoint text NOT NULL,
  keys_p256dh text NOT NULL,
  keys_auth text NOT NULL,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(email, portal, endpoint)
);
ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_push_sub_email ON push_subscriptions(email, portal);

-- 3. ROI metrics (snapshots mensais)
CREATE TABLE IF NOT EXISTS roi_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  mes text NOT NULL,                 -- '2026-03'
  mensagens_enviadas integer DEFAULT 0,
  boletos_emitidos integer DEFAULT 0,
  boletos_pagos integer DEFAULT 0,
  valor_arrecadado numeric DEFAULT 0,
  leads_convertidos integer DEFAULT 0,
  frequencia_media numeric DEFAULT 0,
  horas_economizadas numeric DEFAULT 0,  -- estimativa
  criado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, mes)
);
ALTER TABLE roi_snapshots DISABLE ROW LEVEL SECURITY;

-- 4. Teacher streaks
CREATE TABLE IF NOT EXISTS teacher_streaks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  tipo text NOT NULL,                -- 'chamada_diaria','agenda_diaria','login_consecutivo'
  streak_atual integer DEFAULT 0,
  melhor_streak integer DEFAULT 0,
  ultimo_registro date,
  UNIQUE(professora_id, tipo)
);
ALTER TABLE teacher_streaks DISABLE ROW LEVEL SECURITY;

-- 5. Milestones
CREATE TABLE IF NOT EXISTS milestones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_email text NOT NULL,
  usuario_tipo text NOT NULL,
  tipo text NOT NULL,                -- 'fotos_compartilhadas','mensagens_enviadas','chamadas_realizadas'
  valor integer NOT NULL,            -- milestone value (100, 500, 1000)
  alcancado_em timestamptz DEFAULT now(),
  UNIQUE(usuario_email, tipo, valor)
);
ALTER TABLE milestones DISABLE ROW LEVEL SECURITY;
