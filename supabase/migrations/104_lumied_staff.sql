-- ═══════════════════════════════════════════════════════════════
--  Migration 104: Lumied Staff — Superusuários
--  Staff Lumied tem acesso total a todos os portais de todos os clientes
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lumied_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  cargo TEXT NOT NULL DEFAULT 'suporte' CHECK (cargo IN ('fundador', 'cto', 'suporte', 'comercial', 'cs')),
  ativo BOOLEAN DEFAULT TRUE,
  ultimo_acesso TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Sessões dos superusuários (separadas de admins de escola)
CREATE TABLE IF NOT EXISTS lumied_staff_sessoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES lumied_staff(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_sessoes_token ON lumied_staff_sessoes(token);

-- RLS
ALTER TABLE lumied_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumied_staff_sessoes ENABLE ROW LEVEL SECURITY;

-- Log de ações dos superusuários (auditoria)
CREATE TABLE IF NOT EXISTS lumied_staff_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES lumied_staff(id),
  staff_nome TEXT,
  acao TEXT NOT NULL,
  detalhes JSONB DEFAULT '{}',
  escola_id UUID REFERENCES escolas(id),
  ip TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_audit_staff ON lumied_staff_audit(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_audit_escola ON lumied_staff_audit(escola_id);
