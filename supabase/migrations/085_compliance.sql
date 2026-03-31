-- =====================================================
-- 085: Módulo de Compliance — Controle de Hora Extra
-- =====================================================

-- ── Horários pré-configurados por professora ────────
CREATE TABLE IF NOT EXISTS compliance_horarios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  dia_semana integer NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),  -- 1=seg, 7=dom
  hora_entrada time NOT NULL,
  hora_saida time NOT NULL,
  tolerancia_minutos integer DEFAULT 10,  -- margem antes de considerar extra
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE(professora_id, dia_semana)
);
ALTER TABLE compliance_horarios DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_compliance_horarios_prof ON compliance_horarios(professora_id);

-- ── Importações de arquivo de ponto ─────────────────
CREATE TABLE IF NOT EXISTS compliance_ponto_importacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome_arquivo text NOT NULL,
  tipo text DEFAULT 'manual',             -- 'manual' | 'automatico'
  total_registros integer DEFAULT 0,
  registros_processados integer DEFAULT 0,
  registros_com_erro integer DEFAULT 0,
  status text DEFAULT 'processando',      -- 'processando' | 'concluido' | 'erro'
  erro_detalhes text,
  importado_por text,                     -- nome do gerente que importou
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_ponto_importacoes DISABLE ROW LEVEL SECURITY;

-- ── Registros de ponto parseados ────────────────────
CREATE TABLE IF NOT EXISTS compliance_ponto_registros (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  importacao_id uuid NOT NULL REFERENCES compliance_ponto_importacoes(id) ON DELETE CASCADE,
  professora_id uuid NOT NULL REFERENCES professoras(id),
  data date NOT NULL,
  hora_entrada time,
  hora_saida time,
  horas_trabalhadas numeric,              -- total em horas decimais
  hora_extra_minutos integer DEFAULT 0,   -- minutos excedentes
  dentro_horario boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_ponto_registros DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_compliance_ponto_reg_prof ON compliance_ponto_registros(professora_id, data);
CREATE INDEX idx_compliance_ponto_reg_imp ON compliance_ponto_registros(importacao_id);

-- ── Ocorrências detectadas (hora extra sem autorização)
CREATE TABLE IF NOT EXISTS compliance_ocorrencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id uuid NOT NULL REFERENCES professoras(id),
  ponto_registro_id uuid REFERENCES compliance_ponto_registros(id),
  data_ocorrencia date NOT NULL,
  hora_prevista_saida time NOT NULL,
  hora_real_saida time NOT NULL,
  minutos_excedentes integer NOT NULL,
  tipo text DEFAULT 'hora_extra_nao_autorizada',
  status text DEFAULT 'pendente',         -- 'pendente' | 'confirmada' | 'justificada' | 'descartada'
  justificativa text,                     -- preenchida se justificada/descartada
  confirmada_por text,                    -- nome do gerente que confirmou
  confirmada_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_ocorrencias DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_compliance_ocorr_prof ON compliance_ocorrencias(professora_id, data_ocorrencia);
CREATE INDEX idx_compliance_ocorr_status ON compliance_ocorrencias(status);

-- ── Alertas de e-mail enviados ──────────────────────
CREATE TABLE IF NOT EXISTS compliance_alertas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ocorrencia_id uuid NOT NULL REFERENCES compliance_ocorrencias(id),
  professora_id uuid NOT NULL REFERENCES professoras(id),
  email_destino text NOT NULL,
  tipo_alerta text DEFAULT 'hora_extra',  -- 'hora_extra' | 'reincidencia'
  assunto text NOT NULL,
  corpo_html text,
  enviado boolean DEFAULT false,
  erro_envio text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_alertas DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_compliance_alertas_ocorr ON compliance_alertas(ocorrencia_id);

-- ── Trigger atualizado_em ───────────────────────────
CREATE TRIGGER compliance_horarios_atualizado
  BEFORE UPDATE ON compliance_horarios
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ── Registrar módulo compliance ─────────────────────
INSERT INTO modulos (slug, nome, descricao, icone, grupo, portais, ordem, ativo)
VALUES (
  'compliance',
  'Compliance',
  'Controle de hora extra, alertas automáticos, auditoria de ponto de professoras',
  '⚖️',
  'gestao',
  ARRAY['gerente'],
  39,
  true
) ON CONFLICT (slug) DO NOTHING;

-- Disponível a partir do plano Premium
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id
FROM planos p, modulos m
WHERE p.slug IN ('premium', 'enterprise')
  AND m.slug = 'compliance'
ON CONFLICT DO NOTHING;

-- ── Cron: verificar ponto a cada 12h ────────────────
-- Executa às 06:00 e 18:00 UTC (03:00 e 15:00 BRT)
SELECT cron.schedule(
  'compliance-verificar-ponto',
  '0 6,18 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/compliance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"action":"compliance_verificar_ponto_auto"}'::jsonb
  )$$
);
