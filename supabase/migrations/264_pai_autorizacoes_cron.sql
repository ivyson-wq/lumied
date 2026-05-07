-- ═══════════════════════════════════════════════════════════════
--  Migration 264 — Cron + config + email pai_autorizou
--
--  1. pg_cron diário: desativa autorizações de retirada com validade vencida
--  2. escola_config: max_autorizados_por_aluno (default 10)
-- ═══════════════════════════════════════════════════════════════

-- 1. Schedule cleanup diário (06:00 UTC = 03:00 BRT)
SELECT cron.unschedule('cleanup-autorizacoes-vencidas')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-autorizacoes-vencidas');

SELECT cron.schedule(
  'cleanup-autorizacoes-vencidas',
  '0 6 * * *',
  $$SELECT cleanup_autorizacoes_vencidas();$$
);

COMMENT ON FUNCTION cleanup_autorizacoes_vencidas IS
  'Desativa autorizações com validade < CURRENT_DATE. Rodado pelo cron `cleanup-autorizacoes-vencidas` (06:00 UTC = 03:00 BRT).';

-- 2. Config padrão: max 10 autorizações ativas por aluno (anti-abuso)
--    Cada escola pode override via UI admin (escola_config).
INSERT INTO escola_config (escola_id, chave, valor)
SELECT e.id, 'max_autorizados_por_aluno', '10'
FROM escolas e
WHERE e.ativo = true
  AND NOT EXISTS (
    SELECT 1 FROM escola_config c
    WHERE c.escola_id = e.id AND c.chave = 'max_autorizados_por_aluno'
  );
