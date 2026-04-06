-- ══════════════════════════════════════════════════════════
--  083 — Features por secretária + metas comerciais
--  Funde secretaria + comercial num único papel com feature gating
-- ══════════════════════════════════════════════════════════

-- 1. Coluna de features na tabela secretarias
--    Cada secretária pode ter um subconjunto de features habilitadas
--    Features disponíveis: atestados, crm, templates, metas
ALTER TABLE secretarias ADD COLUMN IF NOT EXISTS features text[] DEFAULT '{atestados}';
ALTER TABLE secretarias ADD COLUMN IF NOT EXISTS telefone text;
ALTER TABLE secretarias ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;

-- 2. Atribuição de leads à secretária/comercial
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS responsavel_id uuid REFERENCES secretarias(id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_responsavel ON crm_leads(responsavel_id);

-- 3. Metas comerciais (vinculadas à secretária com feature 'metas')
CREATE TABLE IF NOT EXISTS comercial_metas (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  secretaria_id    uuid NOT NULL REFERENCES secretarias(id) ON DELETE CASCADE,
  mes              integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano              integer NOT NULL,
  meta_leads       integer DEFAULT 0,
  meta_matriculas  integer DEFAULT 0,
  meta_valor       numeric(12,2) DEFAULT 0,
  criado_em        timestamptz DEFAULT now(),
  UNIQUE(secretaria_id, mes, ano)
);

ALTER TABLE comercial_metas DISABLE ROW LEVEL SECURITY;

-- 4. Dar todas as features para secretárias existentes
UPDATE secretarias SET features = '{atestados,crm,templates,metas}' WHERE features IS NULL OR features = '{}';
