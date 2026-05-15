-- ═══════════════════════════════════════════════════════════════
-- 340_crm_v2.sql — CRM v2 (Chrome Extension 1.7.0)
--
-- Adiciona: score IA, sentiment, tags, templates com mídia,
-- cadências de follow-up, snooze (envio agendado), broadcast
-- segmentado, WA number check, bulk CSV import, registro de
-- ligações (já existe via crm_interacoes tipo='ligacao').
--
-- Todas as tabelas novas: escola_id NOT NULL + trigger tenant.
-- ═══════════════════════════════════════════════════════════════

-- ─── crm_leads: score + sentiment ───────────────────────────
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS score smallint CHECK (score BETWEEN 1 AND 5);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS score_motivo text;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS score_atualizado_em timestamptz;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sentiment text CHECK (sentiment IN ('quente','morno','frio','em_risco'));
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sentiment_motivo text;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sentiment_atualizado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_leads_score ON crm_leads(escola_id, score DESC) WHERE score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_leads_sentiment ON crm_leads(escola_id, sentiment) WHERE sentiment IS NOT NULL;

-- ─── crm_templates: mídia + analytics ───────────────────────
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS midia_url text;
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS midia_tipo text CHECK (midia_tipo IN ('imagem','doc','audio','video'));
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS midia_nome text;
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS usos integer NOT NULL DEFAULT 0;
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS respostas integer NOT NULL DEFAULT 0;
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS conversoes integer NOT NULL DEFAULT 0;
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS ultimo_uso_em timestamptz;

-- ─── Tags ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_tags (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cor text DEFAULT '#6b7280',
  descricao text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (escola_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_crm_tags_escola ON crm_tags(escola_id);

CREATE TABLE IF NOT EXISTS crm_lead_tags (
  lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_tag ON crm_lead_tags(tag_id);

-- ─── Cadências de follow-up ─────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_cadencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  -- passos: [{ ordem, dias_apos, template_id, descricao }]
  passos jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- parar_quando: matricula|perdido|manual|qualquer_resposta
  parar_quando text NOT NULL DEFAULT 'qualquer_resposta',
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_cadencias_escola ON crm_cadencias(escola_id);

CREATE TABLE IF NOT EXISTS crm_lead_cadencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  cadencia_id uuid NOT NULL REFERENCES crm_cadencias(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  passo_atual smallint NOT NULL DEFAULT 0,
  ultimo_disparo_em timestamptz,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','pausada','concluida','cancelada')),
  UNIQUE (lead_id, cadencia_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_lead_cad_ativas
  ON crm_lead_cadencias(escola_id, ultimo_disparo_em)
  WHERE status = 'ativa';

-- ─── Snooze (envio agendado) ────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_snooze (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  template_id uuid REFERENCES crm_templates(id) ON DELETE SET NULL,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  agendado_para timestamptz NOT NULL,
  mensagem_preview text,
  criado_por text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','notificado','cancelado','expirado')),
  notificado_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_snooze_pendente
  ON crm_snooze(agendado_para)
  WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_crm_snooze_lead ON crm_snooze(lead_id);

-- ─── Broadcasts segmentados ─────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_broadcasts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  template_id uuid REFERENCES crm_templates(id) ON DELETE SET NULL,
  nome text NOT NULL,
  -- filtro: { estagio_id, tag_id, sentiment, parado_dias, origem }
  filtro jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_leads integer NOT NULL DEFAULT 0,
  enviados integer NOT NULL DEFAULT 0,
  erros integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','em_andamento','concluido','cancelado')),
  criado_por text,
  criado_em timestamptz DEFAULT now(),
  finalizado_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_crm_broadcasts_escola ON crm_broadcasts(escola_id, status);

CREATE TABLE IF NOT EXISTS crm_broadcast_envios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_id uuid NOT NULL REFERENCES crm_broadcasts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','erro','ignorado')),
  motivo_erro text,
  enviado_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_broadcast_envios_status
  ON crm_broadcast_envios(broadcast_id, status);

-- ─── WhatsApp number check log ──────────────────────────────
CREATE TABLE IF NOT EXISTS crm_wa_checks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  exists_on_wa boolean NOT NULL,
  checked_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_wa_checks_phone
  ON crm_wa_checks(escola_id, telefone, checked_em DESC);

-- ─── Bulk import jobs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_bulk_imports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  arquivo_nome text,
  total integer NOT NULL DEFAULT 0,
  importados integer NOT NULL DEFAULT 0,
  ignorados integer NOT NULL DEFAULT 0,
  erros integer NOT NULL DEFAULT 0,
  detalhes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'processando' CHECK (status IN ('processando','concluido','erro')),
  criado_por text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_bulk_imports_escola
  ON crm_bulk_imports(escola_id, criado_em DESC);

-- ─── Tenant isolation triggers ──────────────────────────────
SELECT add_tenant_isolation('crm_tags');
SELECT add_tenant_isolation('crm_lead_tags');
SELECT add_tenant_isolation('crm_cadencias');
SELECT add_tenant_isolation('crm_lead_cadencias');
SELECT add_tenant_isolation('crm_snooze');
SELECT add_tenant_isolation('crm_broadcasts');
SELECT add_tenant_isolation('crm_broadcast_envios');
SELECT add_tenant_isolation('crm_wa_checks');
SELECT add_tenant_isolation('crm_bulk_imports');

-- ─── Seed: tags default por escola ──────────────────────────
-- (idempotente: só insere se a escola não tem nenhuma tag)
INSERT INTO crm_tags (escola_id, nome, cor, descricao)
SELECT e.id, t.nome, t.cor, t.descricao
FROM escolas e
CROSS JOIN (VALUES
  ('Indicação',    '#10b981', 'Veio por indicação de família atual'),
  ('Site',         '#3b82f6', 'Captado via site/landing page'),
  ('Instagram',    '#ec4899', 'Veio do Instagram'),
  ('Feira/Evento', '#f59e0b', 'Conheceu em feira ou evento'),
  ('Já matriculou irmão', '#8b5cf6', 'Família já tem outro filho na escola'),
  ('Quente',       '#ef4444', 'Alta probabilidade de conversão'),
  ('Indeciso',     '#6b7280', 'Pais demonstram dúvida'),
  ('Bolsa',        '#0ea5e9', 'Interesse em bolsa de estudos')
) AS t(nome, cor, descricao)
WHERE NOT EXISTS (
  SELECT 1 FROM crm_tags ct WHERE ct.escola_id = e.id
)
ON CONFLICT (escola_id, nome) DO NOTHING;

-- ─── Seed: cadência default "Funil padrão" ──────────────────
INSERT INTO crm_cadencias (escola_id, nome, descricao, passos, parar_quando)
SELECT
  e.id,
  'Funil padrão',
  'Cadência básica: boas-vindas → follow-up → agendar visita → pós-visita',
  '[]'::jsonb,
  'qualquer_resposta'
FROM escolas e
WHERE NOT EXISTS (
  SELECT 1 FROM crm_cadencias cc WHERE cc.escola_id = e.id
);

COMMENT ON TABLE crm_tags IS 'Tags livres pra categorizar leads (mig 340)';
COMMENT ON TABLE crm_cadencias IS 'Sequências de follow-up automático (mig 340)';
COMMENT ON TABLE crm_snooze IS 'Envio agendado de templates pra um lead (mig 340)';
COMMENT ON TABLE crm_broadcasts IS 'Disparo em massa segmentado, respeitando travas WhatsApp (mig 340)';
