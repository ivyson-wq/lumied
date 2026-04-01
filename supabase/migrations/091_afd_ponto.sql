-- =====================================================
-- 091: Módulo de Ponto — Integração AFD (Portaria 671)
-- Parser de arquivo AFD gerado por REP-C homologado
-- =====================================================

-- ── Funcionários com PIS (de-para para o AFD) ───────
CREATE TABLE IF NOT EXISTS ponto_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  pis varchar(12) NOT NULL,                  -- PIS sem formatação, zero-padded 12 chars
  cargo text,
  departamento text,
  rh_funcionario_id uuid REFERENCES rh_funcionarios(id), -- vínculo com RH existente
  work_schedule jsonb,                       -- {"seg":["07:00","12:00","13:00","17:00"], ...}
  daily_hours numeric(4,2) DEFAULT 8.0,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE(pis)
);
ALTER TABLE ponto_employees DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ponto_emp_pis ON ponto_employees(pis);

-- ── Importações de arquivo AFD ──────────────────────
CREATE TABLE IF NOT EXISTS afd_imports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  importado_por text,
  nome_arquivo text NOT NULL,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  cnpj_empregador varchar(14),
  razao_social text,
  total_eventos integer DEFAULT 0,
  total_funcionarios integer DEFAULT 0,
  pis_nao_encontrados integer DEFAULT 0,
  status text DEFAULT 'processando',         -- 'processando','concluido','erro'
  erro_detalhes text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE afd_imports DISABLE ROW LEVEL SECURITY;

-- ── Eventos brutos extraídos do AFD (imutável) ─────
CREATE TABLE IF NOT EXISTS afd_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id uuid NOT NULL REFERENCES afd_imports(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES ponto_employees(id),
  pis varchar(12) NOT NULL,
  data_evento date NOT NULL,
  hora_evento time NOT NULL,
  nsr integer NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE afd_events DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_afd_events_date ON afd_events(data_evento);
CREATE INDEX idx_afd_events_emp ON afd_events(employee_id, data_evento);
CREATE INDEX idx_afd_events_pis ON afd_events(pis);

-- ── Resumo diário por funcionário ───────────────────
CREATE TABLE IF NOT EXISTS ponto_daily_summary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES ponto_employees(id) ON DELETE CASCADE,
  data_resumo date NOT NULL,
  total_marcacoes integer DEFAULT 0,
  primeira_marcacao time,
  ultima_marcacao time,
  minutos_trabalhados integer,
  minutos_esperados integer,
  saldo_minutos integer,                     -- positivo = extra, negativo = débito
  status text DEFAULT 'presente',            -- 'presente','ausente','feriado','justificado','fim_de_semana','impar'
  marcacao_impar boolean DEFAULT false,       -- ímpar = esquecimento provável
  import_id uuid REFERENCES afd_imports(id),
  criado_em timestamptz DEFAULT now(),
  UNIQUE(employee_id, data_resumo)
);
ALTER TABLE ponto_daily_summary DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ponto_summary_emp ON ponto_daily_summary(employee_id, data_resumo);

-- ── Justificativas ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ponto_justificativas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES ponto_employees(id) ON DELETE CASCADE,
  summary_id uuid REFERENCES ponto_daily_summary(id),
  data_justificativa date NOT NULL,
  motivo text NOT NULL,                      -- 'atestado','folga','falta_justificada','ajuste_manual','outro'
  descricao text,
  aprovado_por text,
  aprovado_em timestamptz,
  status text DEFAULT 'pendente',            -- 'pendente','aprovado','rejeitado'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE ponto_justificativas DISABLE ROW LEVEL SECURITY;

-- ── Trigger atualizado_em ───────────────────────────
CREATE TRIGGER ponto_employees_atualizado
  BEFORE UPDATE ON ponto_employees
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();
