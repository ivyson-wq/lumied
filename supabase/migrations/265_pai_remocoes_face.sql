-- ═══════════════════════════════════════════════════════════════
--  Migration 265 — Remoção de faces no iDFace quando autorização expira
--
--  Quando uma autorização de retirada vence (ou é revogada) e o
--  responsável não tem MAIS NENHUMA autorização ativa, marca a face
--  com status `aguardando_remocao` para ser removida do iDFace via
--  Bridge na próxima rodada do worker.
-- ═══════════════════════════════════════════════════════════════

-- 1. Estende sync_status pra incluir aguardando_remocao + removido
ALTER TABLE acesso_faces DROP CONSTRAINT IF EXISTS acesso_faces_sync_status_check;
ALTER TABLE acesso_faces ADD CONSTRAINT acesso_faces_sync_status_check
  CHECK (sync_status IN ('pendente','sincronizado','erro','aguardando_aprovacao','aguardando_remocao','removido'));

COMMENT ON COLUMN acesso_faces.sync_status IS
  'Estados: pendente | sincronizado | erro | aguardando_aprovacao (foto enviada por família, falta gerente aprovar) | aguardando_remocao (autorização expirou, processar remove no iDFace) | removido';

-- 2. Reescreve cleanup_autorizacoes_vencidas para também marcar faces de responsáveis
CREATE OR REPLACE FUNCTION cleanup_autorizacoes_vencidas() RETURNS void AS $$
BEGIN
  -- Marca faces dos responsáveis cuja autorização vai expirar — APENAS
  -- se o responsável NÃO tiver outra autorização ativa em qualquer aluno
  -- (mãe pode ser autorizada de 2 filhos; se só uma vence, a face fica)
  UPDATE acesso_faces f
  SET sync_status = 'aguardando_remocao',
      atualizado_em = now()
  WHERE f.ativo = true
    AND f.pessoa_tipo = 'responsavel'
    AND f.sync_status NOT IN ('aguardando_remocao', 'removido')
    AND f.pessoa_id IN (
      SELECT DISTINCT p.responsavel_id
      FROM acesso_permissoes_retirada p
      WHERE p.autorizado = true
        AND p.validade IS NOT NULL
        AND p.validade < CURRENT_DATE
        AND p.responsavel_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM acesso_permissoes_retirada p2
          WHERE p2.responsavel_id = p.responsavel_id
            AND p2.autorizado = true
            AND (p2.validade IS NULL OR p2.validade >= CURRENT_DATE)
        )
    );

  -- Desativa as autorizações vencidas
  UPDATE acesso_permissoes_retirada
  SET autorizado = false
  WHERE autorizado = true
    AND validade IS NOT NULL
    AND validade < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- 3. Cron novo: processa fila de remoções a cada 15 min
--    (chama a edge function que itera faces aguardando_remocao
--    e dispara delete_user nos iDFace via Bridge).
SELECT cron.unschedule('processar-remocoes-face')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'processar-remocoes-face');

SELECT cron.schedule(
  'processar-remocoes-face',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/acesso',
    '{"action":"acesso_processar_remocoes_face"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.settings.cron_internal_key', true)
    ),
    5000
  );
  $cron$
);
