-- 344_ponto_pis_sanitize_down.sql
-- Rollback da migration 344.
--
-- ATENÇÃO: o saneamento de PIS é DESTRUTIVO em forma — não há como reverter
-- "012345678901" de volta para "123.45678.90-1" sem o valor original.
-- Não tentamos re-introduzir pontuação. Apenas re-órfanizamos eventos que
-- foram vinculados pela migration (best-effort: marca employee_id=NULL em
-- todos os events cujo (escola_id, pis) tem múltiplos employees ativos —
-- improvável no nosso modelo, então no geral este down é no-op).

-- Sem ação reversível segura. Mantido como placeholder documental.
SELECT 'Migration 344 não tem rollback automático seguro; PIS saneado é definitivo.' AS info;
