-- ═══════════════════════════════════════════════════════════════
-- 342_crm_templates_dedup.sql — Remove duplicatas + trava por UNIQUE
--
-- Sintoma: UI da extensão mostrava 2x cada template (Boas-vindas,
-- Follow-up, etc) na mesma escola_id. Causa provável: o seed do
-- crm_templates na mig 043 inseria sem escola_id, e o provisionamento
-- de escola (staff_criar_escola) reinjetava com escola_id sem upsert.
--
-- Solução:
--   1. Desativar duplicatas (mantém a mais usada / mais recente)
--   2. Partial unique index: 1 ativo por (escola_id, nome)
-- ═══════════════════════════════════════════════════════════════

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY escola_id, nome
      ORDER BY COALESCE(usos, 0) DESC, criado_em DESC, id
    ) AS rn
  FROM crm_templates WHERE ativo = true
)
UPDATE crm_templates SET ativo = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_templates_escola_nome_ativo
  ON crm_templates(escola_id, nome) WHERE ativo = true;

COMMENT ON INDEX idx_crm_templates_escola_nome_ativo
  IS 'Mig 342: 1 template ativo por (escola_id, nome). Permite múltiplos inativos pra histórico.';
