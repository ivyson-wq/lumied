-- =====================================================
-- 094: Confirmação de Ciência com Selfie
-- Professora deve confirmar ciência de notificações
-- de compliance (hora extra, etc) via selfie + ciente
-- =====================================================

-- ── Notificações pendentes de ciência ───────────────
CREATE TABLE IF NOT EXISTS compliance_ciencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid NOT NULL REFERENCES professoras(id),
  ocorrencia_id uuid REFERENCES compliance_ocorrencias(id),
  -- Contexto da notificação
  tipo text NOT NULL,                        -- 'hora_extra','incidente','advertencia','comunicado_rh'
  titulo text NOT NULL,                      -- "Hora extra não autorizada — 12/03/2026"
  descricao text NOT NULL,                   -- texto completo da notificação
  data_referencia date,                      -- data do fato
  -- Ciência
  status text DEFAULT 'pendente',            -- 'pendente','ciente','ciente_com_ressalva'
  ciente_em timestamptz,
  -- Selfie como comprovação
  selfie_url text,                           -- URL no Supabase Storage
  selfie_hash text,                          -- SHA-256 da imagem (integridade)
  selfie_metadata jsonb,                     -- {device, timestamp_exif, geolocation}
  -- Ressalva (campo obrigatório se "ciente com ressalva")
  ressalva text,                             -- justificativa/contestação da professora
  -- Metadata de auditoria
  ip_confirmacao text,
  user_agent text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_ciencias DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_comp_ciencia_prof ON compliance_ciencias(professora_id, status);
CREATE INDEX idx_comp_ciencia_pendente ON compliance_ciencias(professora_id) WHERE status = 'pendente';

-- ── Bucket para selfies de comprovação ──────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('compliance-selfies', 'compliance-selfies', false, 5242880)  -- 5MB max, privado
ON CONFLICT (id) DO NOTHING;

-- Policy: apenas service_role pode ler (privacidade)
-- Professora faz upload via edge function que usa service_role

-- ── Trigger atualizado_em ───────────────────────────
CREATE TRIGGER compliance_ciencias_atualizado
  BEFORE UPDATE ON compliance_ciencias
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ── Auto-criar ciência quando ocorrência é confirmada
-- (será feito via edge function, não trigger SQL)
