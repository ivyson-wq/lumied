-- 344_ponto_pis_sanitize.sql
-- Normaliza PIS legado em ponto_employees (strip não-dígitos + lpad 12)
-- e re-vincula afd_events órfãos cujo employee_id ficou NULL por mismatch
-- de formatação (ex.: cadastro com pontuação "123.45678.90-1" vs AFD "012345678901").
-- Idempotente: rodar N vezes não muda resultado.

-- 1) Saneamento de PIS já cadastrados
UPDATE ponto_employees
   SET pis = lpad(regexp_replace(pis, '\D', '', 'g'), 12, '0')
 WHERE pis IS NOT NULL
   AND pis <> lpad(regexp_replace(pis, '\D', '', 'g'), 12, '0');

-- 2) Re-vincula afd_events órfãos cujo PIS bate com algum funcionário ativo da mesma escola
UPDATE afd_events e
   SET employee_id = m.id
  FROM ponto_employees m
 WHERE e.employee_id IS NULL
   AND e.escola_id   = m.escola_id
   AND e.pis         = m.pis
   AND m.ativo       = true;

-- 3) Atualiza contador pis_nao_encontrados nas importações (best-effort, snapshot pós-vínculo)
UPDATE afd_imports i
   SET pis_nao_encontrados = sub.cnt
  FROM (
    SELECT import_id, COUNT(*) AS cnt
      FROM afd_events
     WHERE employee_id IS NULL
     GROUP BY import_id
  ) sub
 WHERE i.id = sub.import_id;

UPDATE afd_imports
   SET pis_nao_encontrados = 0
 WHERE pis_nao_encontrados > 0
   AND NOT EXISTS (
     SELECT 1 FROM afd_events e WHERE e.import_id = afd_imports.id AND e.employee_id IS NULL
   );

-- Nota: a regeneração de ponto_daily_summary para os eventos recém-vinculados
-- é feita pela edge function `ponto_afd_reprocess` (action exposta no painel
-- e disparada automaticamente após cadastro/edição de funcionário).
-- Esta migration apenas normaliza dados; não recalcula resumos.
