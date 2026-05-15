-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Onda 5 — Pilot: namespacing do domínio "migracao"                 ║
-- ║  Move 11 tabelas migracao_* de public → migracao                   ║
-- ╠════════════════════════════════════════════════════════════════════╣
-- ║  Por que migracao primeiro:                                        ║
-- ║   - Domínio isolado (1 edge fn, 0 cron jobs, 0 cross-domain FK)    ║
-- ║   - Sem RLS policies (controlled by edge fn + tenant trigger)      ║
-- ║   - Volume baixo de tráfego (importação manual, não real-time)     ║
-- ║   - Se falhar, blast radius mínimo                                 ║
-- ║                                                                    ║
-- ║  O que NÃO move (fica em public por design):                       ║
-- ║   - v_migracao_job_resumo (view — referência por OID, continua ok) ║
-- ║   - public.enforce_tenant_escola_id() — usada por 217 tabelas      ║
-- ║   - public.migracao_jobs_set_atualizado_em() — usado por trigger,  ║
-- ║     OID binding preserva referência                                ║
-- ║                                                                    ║
-- ║  Pós-migration externa (não-SQL):                                  ║
-- ║   - PATCH /v1/projects/{ref}/postgrest com migracao em db_schema   ║
-- ║   - Deploy migracao/index.ts com .schema('migracao').from(...)     ║
-- ╚════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1) Schema + grants (mesmo padrão de insta_publisher já em uso)
CREATE SCHEMA IF NOT EXISTS migracao;
GRANT USAGE ON SCHEMA migracao TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA migracao
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA migracao
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA migracao
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- 2) Move das 11 tabelas. ALTER TABLE SET SCHEMA preserva:
--    - Triggers (incluindo trg_tenant_check via OID)
--    - Foreign keys (não há cross-domain FKs nessas tabelas)
--    - Indexes
--    - Grants/RLS (não há RLS, mas se houvesse seguiria)
ALTER TABLE public.migracao_jobs                  SET SCHEMA migracao;
ALTER TABLE public.migracao_arquivos              SET SCHEMA migracao;
ALTER TABLE public.migracao_audit                 SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_alunos        SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_responsaveis  SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_turmas        SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_matriculas    SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_funcionarios  SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_financeiro    SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_notas         SET SCHEMA migracao;
ALTER TABLE public.migracao_staging_documentos    SET SCHEMA migracao;

-- 3) Grants explícitos nas tabelas movidas (defesa em profundidade,
--    DEFAULT PRIVILEGES acima cobre futuras, mas as existentes precisam)
GRANT ALL ON ALL TABLES    IN SCHEMA migracao TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA migracao TO anon, authenticated, service_role;

-- 4) Verificação inline — vai falhar a transação se algo não moveu
DO $$
DECLARE
  c_public int;
  c_migracao int;
BEGIN
  SELECT count(*) INTO c_public
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'migracao_%' AND table_type='BASE TABLE';
  SELECT count(*) INTO c_migracao
    FROM information_schema.tables
    WHERE table_schema='migracao' AND table_type='BASE TABLE';
  IF c_public <> 0 THEN
    RAISE EXCEPTION 'Onda 5 pilot: % tabela(s) migracao_* ainda em public', c_public;
  END IF;
  IF c_migracao < 11 THEN
    RAISE EXCEPTION 'Onda 5 pilot: esperado >=11 em migracao schema, achou %', c_migracao;
  END IF;
END $$;

COMMIT;
