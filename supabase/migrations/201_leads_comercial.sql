-- ═══════════════════════════════════════════════════════════════
--  Migration 201: Leads Comerciais (site lumied.com.br)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leads_comerciais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_escola TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT,
  origem TEXT DEFAULT 'site',               -- 'site', 'whatsapp', 'indicacao', 'google_ads'
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  mensagem TEXT,
  status TEXT DEFAULT 'novo' CHECK (status IN ('novo','contatado','qualificado','demo_agendada','proposta','fechado','perdido')),
  ip TEXT,
  user_agent TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  contatado_em TIMESTAMPTZ,
  notas TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads_comerciais(status);
CREATE INDEX IF NOT EXISTS idx_leads_criado ON leads_comerciais(criado_em DESC);
ALTER TABLE leads_comerciais ENABLE ROW LEVEL SECURITY;
