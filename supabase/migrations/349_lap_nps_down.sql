-- Reverte fn_lumied_health_score pra versão sem NPS (mig 343)
-- E remove tabela NPS.
DROP FUNCTION IF EXISTS fn_nps_escola(uuid);
DROP TABLE IF EXISTS lap_nps_responses CASCADE;
-- Nota: fn_lumied_health_score volta a usar default sentiment=0.75
-- via re-execução manual da mig 343.
