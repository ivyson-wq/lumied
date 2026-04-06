-- ═══════════════════════════════════════════════════════════════
--  Migration 112: View unificada de ponto + consolidação
--  Resolve duplicação entre compliance_ponto_* e afd_*/ponto_*
-- ═══════════════════════════════════════════════════════════════

-- As tabelas compliance_ponto_* (085/111) e afd_*/ponto_* (091) coexistem:
--   - compliance_ponto_* = importação manual CSV (sistema Lumied)
--   - afd_*/ponto_* = importação de arquivo AFD de relógio ponto (Portaria 671)
-- Ambas são fontes legítimas de dados de ponto.
-- Esta view unifica as duas fontes numa consulta única.

CREATE OR REPLACE VIEW vw_ponto_unificado AS

-- Fonte 1: compliance_ponto_registros (CSV manual)
SELECT
  'compliance' AS fonte,
  cpr.id,
  cpr.professora_id AS funcionario_id,
  p.nome AS funcionario_nome,
  p.email AS funcionario_email,
  cpr.data,
  cpr.hora_entrada,
  cpr.hora_saida,
  cpr.horas_trabalhadas,
  cpr.hora_extra_minutos,
  cpr.hora_extra_50_min,
  cpr.hora_extra_100_min,
  cpr.hora_noturna_min,
  cpr.adicional_noturno_pct,
  cpr.atraso_min,
  cpr.falta,
  cpr.tipo_dia,
  cpr.banco_horas_min,
  cpr.intervalo_minutos,
  cpr.horas_normais_min,
  cpr.processado,
  cpr.alertas,
  cpr.dentro_horario,
  cpr.criado_em
FROM compliance_ponto_registros cpr
LEFT JOIN professoras p ON p.id = cpr.professora_id

UNION ALL

-- Fonte 2: ponto_daily_summary (AFD/relógio ponto)
SELECT
  'afd' AS fonte,
  pds.id,
  pds.employee_id AS funcionario_id,
  pe.nome AS funcionario_nome,
  NULL AS funcionario_email,
  pds.data_resumo AS data,
  pds.primeira_marcacao AS hora_entrada,
  pds.ultima_marcacao AS hora_saida,
  CASE WHEN pds.minutos_trabalhados IS NOT NULL
    THEN pds.minutos_trabalhados / 60.0 ELSE NULL END AS horas_trabalhadas,
  GREATEST(0, COALESCE(pds.saldo_minutos, 0)) AS hora_extra_minutos,
  NULL AS hora_extra_50_min,
  NULL AS hora_extra_100_min,
  NULL AS hora_noturna_min,
  NULL AS adicional_noturno_pct,
  CASE WHEN pds.saldo_minutos < 0 THEN ABS(pds.saldo_minutos) ELSE 0 END AS atraso_min,
  (pds.status = 'ausente') AS falta,
  CASE pds.status
    WHEN 'feriado' THEN 'feriado'
    WHEN 'fim_de_semana' THEN 'sabado'
    ELSE 'util' END AS tipo_dia,
  NULL AS banco_horas_min,
  NULL AS intervalo_minutos,
  pds.minutos_trabalhados AS horas_normais_min,
  true AS processado,
  CASE WHEN pds.marcacao_impar THEN ARRAY['⚠️ Marcação ímpar detectada'] ELSE NULL END AS alertas,
  (pds.saldo_minutos <= 0) AS dentro_horario,
  pds.criado_em
FROM ponto_daily_summary pds
LEFT JOIN ponto_employees pe ON pe.id = pds.employee_id;

-- Comentário explicativo
COMMENT ON VIEW vw_ponto_unificado IS 'View que unifica dados de ponto de duas fontes: compliance (CSV manual) e AFD (relógio ponto Portaria 671). Usar esta view para relatórios consolidados.';
