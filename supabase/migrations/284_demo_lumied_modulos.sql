-- ═══════════════════════════════════════════════════════════════
--  Migration 284 — Popula escola_modulos para Demo Lumied
--
--  Auditoria detectou: escola Demo Lumied (e9b18a61-3894-4a7e-8024-
--  eaf530420993) tinha ZERO entradas em escola_modulos. Demos
--  comerciais não mostravam nenhum módulo do produto.
--  Fix: habilita TODOS os módulos disponíveis na demo.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO escola_modulos (escola_id, modulo_id, habilitado)
SELECT 'e9b18a61-3894-4a7e-8024-eaf530420993'::uuid, m.id, true
FROM modulos m
WHERE NOT EXISTS (
  SELECT 1 FROM escola_modulos em
  WHERE em.escola_id = 'e9b18a61-3894-4a7e-8024-eaf530420993'::uuid
    AND em.modulo_id = m.id
);
