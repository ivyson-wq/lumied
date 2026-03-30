-- =====================================================
-- 076: Performance — Views materializadas, particionamento
-- =====================================================

-- 1. View materializada: Dashboard analytics (evita queries pesadas)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_stats AS
SELECT
  e.id AS escola_id,
  (SELECT count(*) FROM alunos a WHERE a.escola_id = e.id AND a.ativo = true) AS total_alunos,
  (SELECT count(*) FROM professoras p WHERE p.escola_id = e.id AND p.ativo = true) AS total_professoras,
  (SELECT count(*) FROM crm_leads l WHERE l.escola_id = e.id) AS total_leads,
  (SELECT count(*) FROM familias f WHERE f.escola_id = e.id) AS total_familias,
  (SELECT COALESCE(sum(valor),0) FROM fin_lancamentos fl
   WHERE fl.escola_id = e.id AND fl.tipo = 'receita'
   AND date_trunc('month', fl.data_lancamento) = date_trunc('month', CURRENT_DATE)) AS receita_mes,
  (SELECT COALESCE(sum(valor),0) FROM fin_lancamentos fl
   WHERE fl.escola_id = e.id AND fl.tipo = 'despesa'
   AND date_trunc('month', fl.data_lancamento) = date_trunc('month', CURRENT_DATE)) AS despesa_mes,
  now() AS atualizado_em
FROM escolas e WHERE e.ativo = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dashboard_escola ON mv_dashboard_stats(escola_id);

-- Função para refresh (chamar via cron a cada 5 min)
CREATE OR REPLACE FUNCTION refresh_dashboard_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats;
END;
$$ LANGUAGE plpgsql;

-- 2. View materializada: Frequência por aluno (usado no boletim e relatórios)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_frequencia_resumo AS
SELECT
  fr.aluno_email,
  fc.serie_id,
  EXTRACT(YEAR FROM fc.data)::integer AS ano,
  count(*) FILTER (WHERE fr.status = 'P') AS total_presencas,
  count(*) FILTER (WHERE fr.status IN ('A','F')) AS total_faltas,
  count(*) FILTER (WHERE fr.status = 'J') AS total_justificadas,
  count(*) AS total_chamadas,
  CASE WHEN count(*) > 0
    THEN round(count(*) FILTER (WHERE fr.status = 'P')::numeric / count(*) * 100, 1)
    ELSE 100
  END AS percent_presenca
FROM frequencia_registros fr
JOIN frequencia_chamadas fc ON fc.id = fr.chamada_id
GROUP BY fr.aluno_email, fc.serie_id, EXTRACT(YEAR FROM fc.data);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_freq_aluno ON mv_frequencia_resumo(aluno_email, serie_id, ano);

-- 3. Indexes compostos para queries mais comuns
CREATE INDEX IF NOT EXISTS idx_fin_lanc_escola_mes ON fin_lancamentos(escola_id, data_lancamento);
CREATE INDEX IF NOT EXISTS idx_notas_lanc_aval_aluno ON notas_lancamentos(avaliacao_id, aluno_email);
CREATE INDEX IF NOT EXISTS idx_chat_msg_conv_data ON chat_mensagens(conversa_id, criado_em DESC) WHERE excluida = false;
CREATE INDEX IF NOT EXISTS idx_crm_leads_escola_estagio ON crm_leads(escola_id, estagio_id);
CREATE INDEX IF NOT EXISTS idx_pickup_notif_data ON pickup_notificacoes(criado_em DESC);

-- 4. Partial indexes (queries filtradas frequentes)
CREATE INDEX IF NOT EXISTS idx_alunos_ativos ON alunos(escola_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_profs_ativas ON professoras(escola_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_leads_ativos ON crm_leads(escola_id, estagio_id) WHERE estagio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_biblio_emp_abertos ON biblioteca_emprestimos(aluno_email) WHERE status = 'emprestado';
CREATE INDEX IF NOT EXISTS idx_boletos_pendentes ON boletos(vencimento) WHERE situacao IN ('EMITIDO','A_RECEBER');

-- 5. Cleanup: limpar sessões expiradas (chamar via cron diário)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS integer AS $$
DECLARE
  deleted integer := 0;
  d integer;
BEGIN
  DELETE FROM gerente_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM professora_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM secretaria_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM admin_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM aluno_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  -- Cleanup WebAuthn challenges (expire after 5 min)
  DELETE FROM webauthn_challenges WHERE criado_em < now() - interval '5 minutes'; GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;
