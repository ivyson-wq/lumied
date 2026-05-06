-- ═══════════════════════════════════════════════════════════════
--  Migration 262: wa_clicks — log de cliques no shortlink → WhatsApp
-- ═══════════════════════════════════════════════════════════════
-- Tracking server-side de cliques em /ig, /li, /yt, /email, /qr, /wa
-- (Vercel rewrites em vercel.json → site/ig/index.html → fetch beacon).
-- Permite ligar utm origem ↔ leads que vierem depois (mesmo IP, mesma sessão).

CREATE TABLE IF NOT EXISTS wa_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utm_source TEXT,         -- instagram | linkedin | youtube | email | qr_code | shortlink
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  path TEXT,               -- /ig, /li etc
  referrer TEXT,
  ip TEXT,
  user_agent TEXT,
  matched_lead_id UUID REFERENCES leads_comerciais(id) ON DELETE SET NULL,  -- preenchido se lead vir depois com mesmo email/IP
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_clicks_criado ON wa_clicks(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_wa_clicks_utm ON wa_clicks(utm_source, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_wa_clicks_ip ON wa_clicks(ip) WHERE ip IS NOT NULL;

ALTER TABLE wa_clicks ENABLE ROW LEVEL SECURITY;
-- Sem policies = service role only (uso interno)
