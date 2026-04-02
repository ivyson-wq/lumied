-- =====================================================
-- 098: Corrigir preços dos extras (margem saudável)
-- + Resp financeiro só alterável pelo staff Lumied
-- =====================================================

-- ── Corrigir preços WhatsApp (margem mínima 36%) ────
UPDATE escola_extras SET preco = 69.90,  descricao = '100 templates WhatsApp extras por mês'  WHERE slug = 'wa_100_msgs';
UPDATE escola_extras SET preco = 299.90, descricao = '500 templates WhatsApp extras por mês'  WHERE slug = 'wa_500_msgs';
UPDATE escola_extras SET preco = 549.90, descricao = '1000 templates WhatsApp extras por mês' WHERE slug = 'wa_1000_msgs';

-- ── Corrigir preço do excedente avulso ──────────────
UPDATE escolas SET wa_preco_excedente = 0.75;
ALTER TABLE escolas ALTER COLUMN wa_preco_excedente SET DEFAULT 0.75;

-- ── Resp financeiro: proteger contra alteração ──────
-- Campo que indica se foi definido no onboarding (imutável por gerente)
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_definido boolean DEFAULT false;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_definido_em timestamptz;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_definido_por text; -- 'onboarding' ou 'staff_lumied'

-- ── Histórico de alterações do resp financeiro ──────
CREATE TABLE IF NOT EXISTS resp_financeiro_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  acao text NOT NULL,                        -- 'definido','alterado'
  nome_anterior text,
  email_anterior text,
  nome_novo text NOT NULL,
  email_novo text NOT NULL,
  alterado_por text NOT NULL,                -- 'onboarding','staff:nome_admin'
  motivo text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE resp_financeiro_historico DISABLE ROW LEVEL SECURITY;
