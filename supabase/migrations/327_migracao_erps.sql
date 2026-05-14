-- ═══════════════════════════════════════════════════════════════
--  Migration 327 — Migração de ERPs Educacionais (S1)
--
--  Pipeline staging para importar dados de Escolaweb/Sponte/WPensar/
--  Sophia/TOTVS/GVDasa/Excel para o Lumied. Sempre assistida por
--  operador Lumied (lumied_staff). Decisões em
--  memory:project_migracao_erps (2026-05-14).
--
--  Estágios: INGEST → PARSE → STAGE (estas tabelas) → VALIDATE → PROMOTE.
--  Cada estágio é idempotente e reversível até PROMOTE.
-- ═══════════════════════════════════════════════════════════════

-- ── Job de migração (um por escola/ERP-fonte) ────────────────
CREATE TABLE IF NOT EXISTS migracao_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  erp_origem text NOT NULL CHECK (erp_origem IN (
    'excel','escolaweb','sponte','wpensar','agenda_edu','sophia','totvs_rm','gvdasa','outro'
  )),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho','ingerido','parseado','validado','promovido','cancelado','erro'
  )),
  operador_staff_id uuid REFERENCES lumied_staff(id),
  observacao text,
  resumo jsonb DEFAULT '{}'::jsonb,  -- contagens, somas, hashes
  iniciado_em timestamptz DEFAULT now(),
  parseado_em timestamptz,
  validado_em timestamptz,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migjobs_escola ON migracao_jobs(escola_id);
CREATE INDEX IF NOT EXISTS idx_migjobs_status ON migracao_jobs(status, escola_id);
CREATE INDEX IF NOT EXISTS idx_migjobs_operador ON migracao_jobs(operador_staff_id);

-- ── Arquivos de origem (referência ao storage) ────────────────
CREATE TABLE IF NOT EXISTS migracao_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome_original text NOT NULL,
  storage_path text NOT NULL,        -- migracao-anexos/{escola_id}/{job_id}/...
  mime text,
  tamanho_bytes bigint,
  sha256 text,
  entidade_alvo text,                -- alunos, responsaveis, financeiro, etc.
  linhas_total integer DEFAULT 0,
  linhas_parseadas integer DEFAULT 0,
  enviado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migarq_job ON migracao_arquivos(job_id);
CREATE INDEX IF NOT EXISTS idx_migarq_escola ON migracao_arquivos(escola_id);

-- ── Staging: alunos ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migracao_staging_alunos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,                  -- hash determinístico da linha bruta
  -- campos canônicos
  nome text,
  email text,
  cpf text,
  data_nascimento date,
  serie_origem text,                 -- nome bruto da série/turma vindo do ERP
  responsavel_email text,            -- pra ligar com staging_responsaveis
  responsavel_cpf text,
  ativo boolean DEFAULT true,
  -- estado de validação/promoção
  flags jsonb DEFAULT '[]'::jsonb,   -- [{code, msg, severity}]
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,                 -- id em alunos após promote
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migalu_job ON migracao_staging_alunos(job_id);
CREATE INDEX IF NOT EXISTS idx_migalu_escola ON migracao_staging_alunos(escola_id);
CREATE INDEX IF NOT EXISTS idx_migalu_hash ON migracao_staging_alunos(job_id, origem_hash);
CREATE INDEX IF NOT EXISTS idx_migalu_cpf ON migracao_staging_alunos(escola_id, cpf) WHERE cpf IS NOT NULL;

-- ── Staging: responsáveis ────────────────────────────────────
CREATE TABLE IF NOT EXISTS migracao_staging_responsaveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,
  nome text,
  email text,
  cpf text,
  telefone text,
  whatsapp text,
  endereco text,
  cidade text,
  uf text,
  cep text,
  parentesco text,                   -- pai, mae, tutor, avo
  aluno_email text,                  -- vínculo com aluno
  aluno_cpf text,
  responsavel_financeiro boolean DEFAULT false,
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  match_familia_id uuid,             -- match com familias existentes
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migresp_job ON migracao_staging_responsaveis(job_id);
CREATE INDEX IF NOT EXISTS idx_migresp_escola ON migracao_staging_responsaveis(escola_id);
CREATE INDEX IF NOT EXISTS idx_migresp_aluno ON migracao_staging_responsaveis(job_id, aluno_email);

-- ── Staging: turmas/séries ───────────────────────────────────
CREATE TABLE IF NOT EXISTS migracao_staging_turmas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,
  nome text NOT NULL,                -- "Year 3", "5o ano A", etc.
  ano integer,
  turno text,                        -- manha, tarde, integral
  ordem integer,
  match_serie_id uuid,               -- match com series existentes
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migturma_job ON migracao_staging_turmas(job_id);
CREATE INDEX IF NOT EXISTS idx_migturma_escola ON migracao_staging_turmas(escola_id);

-- ── Staging: matrículas (aluno × turma × ano) ─────────────────
CREATE TABLE IF NOT EXISTS migracao_staging_matriculas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,
  aluno_email text,
  aluno_cpf text,
  turma_origem text,                 -- nome bruto da turma
  ano integer NOT NULL,
  status text DEFAULT 'matriculado', -- matriculado, cancelado, transferido, evadido
  data_matricula date,
  data_cancelamento date,
  observacao text,
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migmatr_job ON migracao_staging_matriculas(job_id);
CREATE INDEX IF NOT EXISTS idx_migmatr_escola ON migracao_staging_matriculas(escola_id);
CREATE INDEX IF NOT EXISTS idx_migmatr_ano ON migracao_staging_matriculas(job_id, ano);

-- ── Staging: funcionários ────────────────────────────────────
CREATE TABLE IF NOT EXISTS migracao_staging_funcionarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,
  nome text,
  email text,
  cpf text,
  telefone text,
  cargo text,
  papel_lumied text,                 -- mapeamento: gerente|diretor|financeiro|secretaria|professora|...
  ativo boolean DEFAULT true,
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migfunc_job ON migracao_staging_funcionarios(job_id);
CREATE INDEX IF NOT EXISTS idx_migfunc_escola ON migracao_staging_funcionarios(escola_id);

-- ── Staging: financeiro (CR + CP, abertos + liquidados) ───────
CREATE TABLE IF NOT EXISTS migracao_staging_financeiro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,
  tipo text NOT NULL CHECK (tipo IN ('receita','despesa')),
  categoria_origem text,             -- nome bruto da categoria/plano de contas
  conta_lumied_codigo text,          -- código pós-mapping (1.1, 2.3, etc.)
  descricao text,
  valor numeric NOT NULL,
  data_lancamento date,
  data_vencimento date,
  data_pagamento date,
  status_origem text,                -- texto bruto do ERP fonte
  status_lumied text CHECK (status_lumied IN ('pendente','pago','cancelado','atrasado')),
  fornecedor text,
  familia_email text,
  familia_cpf text,
  familia_nome text,
  documento text,                    -- nº boleto / NF
  observacao text,
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migfin_job ON migracao_staging_financeiro(job_id);
CREATE INDEX IF NOT EXISTS idx_migfin_escola ON migracao_staging_financeiro(escola_id);
CREATE INDEX IF NOT EXISTS idx_migfin_familia ON migracao_staging_financeiro(job_id, familia_email);
CREATE INDEX IF NOT EXISTS idx_migfin_venc ON migracao_staging_financeiro(job_id, data_vencimento);

-- ── Staging: notas históricas (opcional, mais leve) ───────────
CREATE TABLE IF NOT EXISTS migracao_staging_notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  origem_arquivo_id uuid REFERENCES migracao_arquivos(id) ON DELETE SET NULL,
  origem_linha integer,
  origem_hash text,
  aluno_email text,
  ano integer,
  periodo text,                      -- "1o bim", "2o tri", etc.
  disciplina text,
  nota numeric,
  conceito text,
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mignotas_job ON migracao_staging_notas(job_id);
CREATE INDEX IF NOT EXISTS idx_mignotas_escola ON migracao_staging_notas(escola_id);

-- ── Documentos/anexos (refs a storage) ────────────────────────
CREATE TABLE IF NOT EXISTS migracao_staging_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  aluno_email text,
  familia_email text,
  tipo text,                         -- contrato, comprovante, declaracao, foto
  nome_original text,
  storage_path text NOT NULL,
  mime text,
  tamanho_bytes bigint,
  flags jsonb DEFAULT '[]'::jsonb,
  is_valido boolean DEFAULT false,
  ignorado boolean DEFAULT false,
  promovido_id uuid,
  promovido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migdoc_job ON migracao_staging_documentos(job_id);
CREATE INDEX IF NOT EXISTS idx_migdoc_escola ON migracao_staging_documentos(escola_id);

-- ── Trilha de auditoria do operador ───────────────────────────
CREATE TABLE IF NOT EXISTS migracao_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migracao_jobs(id) ON DELETE CASCADE,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  operador_staff_id uuid REFERENCES lumied_staff(id),
  operador_nome text,
  acao text NOT NULL,                -- ingest, parse, validate, promote, override, ignore_row, ...
  detalhes jsonb DEFAULT '{}'::jsonb,
  ip text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migaudit_job ON migracao_audit(job_id);
CREATE INDEX IF NOT EXISTS idx_migaudit_escola ON migracao_audit(escola_id);
CREATE INDEX IF NOT EXISTS idx_migaudit_staff ON migracao_audit(operador_staff_id);

-- ── Tenant isolation: trigger enforce_tenant_escola_id ────────
-- (definido em migrations 243-244 — helper add_tenant_isolation)
SELECT add_tenant_isolation('migracao_jobs');
SELECT add_tenant_isolation('migracao_arquivos');
SELECT add_tenant_isolation('migracao_staging_alunos');
SELECT add_tenant_isolation('migracao_staging_responsaveis');
SELECT add_tenant_isolation('migracao_staging_turmas');
SELECT add_tenant_isolation('migracao_staging_matriculas');
SELECT add_tenant_isolation('migracao_staging_funcionarios');
SELECT add_tenant_isolation('migracao_staging_financeiro');
SELECT add_tenant_isolation('migracao_staging_notas');
SELECT add_tenant_isolation('migracao_staging_documentos');
SELECT add_tenant_isolation('migracao_audit');

-- ── RLS: estas tabelas são acessadas só via edge function com
--    service-role + auth de lumied_staff. Disable RLS para evitar
--    bloqueio nas funções; segurança é feita no handler.
ALTER TABLE migracao_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_arquivos DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_alunos DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_responsaveis DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_turmas DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_matriculas DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_funcionarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_financeiro DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_notas DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_staging_documentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE migracao_audit DISABLE ROW LEVEL SECURITY;

-- ── Bucket privado tenant-scoped pra anexos ───────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'migracao-anexos',
  'migracao-anexos',
  false,
  104857600,  -- 100 MB por arquivo (planilhas grandes + dumps)
  ARRAY[
    'text/csv','application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf','application/zip','text/plain','application/json',
    'image/png','image/jpeg','image/jpg'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies: somente service-role escreve/lê (handlers fazem o
-- filtro por escola_id). Não criar policy para anon/authenticated.
-- (Service-role bypassa RLS automaticamente.)

-- ── Trigger atualizado_em em migracao_jobs ────────────────────
CREATE OR REPLACE FUNCTION migracao_jobs_set_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_migjobs_atualizado_em ON migracao_jobs;
CREATE TRIGGER trg_migjobs_atualizado_em
  BEFORE UPDATE ON migracao_jobs
  FOR EACH ROW EXECUTE FUNCTION migracao_jobs_set_atualizado_em();

-- ── View resumo do job (pra UI mostrar contagens rápidas) ─────
CREATE OR REPLACE VIEW v_migracao_job_resumo AS
SELECT
  j.id AS job_id,
  j.escola_id,
  j.erp_origem,
  j.status,
  j.operador_staff_id,
  (SELECT count(*) FROM migracao_arquivos a WHERE a.job_id = j.id) AS arquivos,
  (SELECT count(*) FROM migracao_staging_alunos s WHERE s.job_id = j.id AND NOT s.ignorado) AS alunos,
  (SELECT count(*) FROM migracao_staging_responsaveis s WHERE s.job_id = j.id AND NOT s.ignorado) AS responsaveis,
  (SELECT count(*) FROM migracao_staging_turmas s WHERE s.job_id = j.id AND NOT s.ignorado) AS turmas,
  (SELECT count(*) FROM migracao_staging_matriculas s WHERE s.job_id = j.id AND NOT s.ignorado) AS matriculas,
  (SELECT count(*) FROM migracao_staging_funcionarios s WHERE s.job_id = j.id AND NOT s.ignorado) AS funcionarios,
  (SELECT count(*) FROM migracao_staging_financeiro s WHERE s.job_id = j.id AND NOT s.ignorado) AS financeiro_qtd,
  (SELECT coalesce(sum(valor),0) FROM migracao_staging_financeiro s
     WHERE s.job_id = j.id AND NOT s.ignorado AND s.tipo='receita' AND s.status_lumied='pendente') AS cr_aberto,
  (SELECT coalesce(sum(valor),0) FROM migracao_staging_financeiro s
     WHERE s.job_id = j.id AND NOT s.ignorado AND s.tipo='despesa' AND s.status_lumied='pendente') AS cp_aberto,
  (SELECT count(*) FROM migracao_staging_alunos s WHERE s.job_id = j.id AND s.flags::text <> '[]') AS flags_alunos,
  (SELECT count(*) FROM migracao_staging_responsaveis s WHERE s.job_id = j.id AND s.flags::text <> '[]') AS flags_responsaveis,
  (SELECT count(*) FROM migracao_staging_financeiro s WHERE s.job_id = j.id AND s.flags::text <> '[]') AS flags_financeiro,
  j.iniciado_em, j.parseado_em, j.validado_em, j.promovido_em
FROM migracao_jobs j;

COMMENT ON TABLE migracao_jobs IS 'Job único de migração (escola × ERP-fonte). Operado por lumied_staff. Decisões em memory:project_migracao_erps.';
COMMENT ON TABLE migracao_staging_alunos IS 'Alunos parseados de ERP-fonte. Promovido para alunos via migracao-promover. Cada registro tem origem_hash e flags.';
COMMENT ON TABLE migracao_staging_financeiro IS 'Histórico financeiro completo (CR + CP, abertos + liquidados). Sem corte temporal — decisão ivyson 2026-05-14.';
