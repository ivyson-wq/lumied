-- ═══════════════════════════════════════════════════════════════
--  Migration 260 — Workflow Automation Engine
--
--  Tabelas: workflows + workflow_execucoes
--  Templates pré-construídos: 5 workflows comuns de gestão escolar
--  Tenant isolation via add_tenant_isolation helper
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  ativo boolean DEFAULT true,
  -- Trigger
  trigger_tipo text NOT NULL CHECK (trigger_tipo IN ('evento','cron','manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}',
  -- Conditions (optional filters evaluated before executing actions)
  condicoes jsonb DEFAULT '[]',
  -- Actions (ordered list of steps to execute)
  acoes jsonb NOT NULL DEFAULT '[]',
  -- Stats
  execucoes_total integer DEFAULT 0,
  ultima_execucao timestamptz,
  criado_por uuid,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','executando','sucesso','falha','parcial')),
  trigger_data jsonb DEFAULT '{}',
  resultado jsonb DEFAULT '{}',
  erro text,
  iniciado_em timestamptz DEFAULT now(),
  finalizado_em timestamptz
);

-- Tarefas geradas por workflows (ação criar_tarefa)
CREATE TABLE IF NOT EXISTS tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  atribuido_para text,  -- papel ou nome do responsável
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida','cancelada')),
  prioridade text DEFAULT 'normal' CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  contexto jsonb DEFAULT '{}',  -- dados do evento que gerou a tarefa
  workflow_id uuid REFERENCES workflows(id) ON DELETE SET NULL,
  workflow_execucao_id uuid REFERENCES workflow_execucoes(id) ON DELETE SET NULL,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX idx_workflows_escola ON workflows(escola_id);
CREATE INDEX idx_workflows_ativo ON workflows(escola_id, ativo) WHERE ativo = true;
CREATE INDEX idx_workflows_trigger ON workflows(trigger_tipo, escola_id) WHERE ativo = true;
CREATE INDEX idx_wf_exec_workflow ON workflow_execucoes(workflow_id);
CREATE INDEX idx_wf_exec_escola ON workflow_execucoes(escola_id, iniciado_em DESC);
CREATE INDEX idx_tarefas_escola ON tarefas(escola_id, status);

SELECT add_tenant_isolation('workflows');
SELECT add_tenant_isolation('workflow_execucoes');
SELECT add_tenant_isolation('tarefas');

-- ── Pre-built workflow templates ─────────────────────────────
-- Inserted for the first escola_id found (demo escola). In production,
-- admins clone these templates per escola via workflow_create with is_template=true logic.
-- These are inserted as escola_id = NULL placeholder using a CTE that resolves the demo escola.

DO $$
DECLARE
  demo_escola_id uuid;
BEGIN
  SELECT id INTO demo_escola_id FROM escolas ORDER BY criado_em LIMIT 1;
  IF demo_escola_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflows (escola_id, nome, descricao, ativo, trigger_tipo, trigger_config, condicoes, acoes) VALUES

  -- 1. Alerta 3 faltas consecutivas
  (demo_escola_id,
   'Alerta 3 Faltas Consecutivas',
   'Envia WhatsApp ao responsável e notificação à coordenadora quando aluno acumula 3+ faltas consecutivas.',
   true,
   'evento',
   '{"evento":"aluno_falta","condicao":{"faltas_consecutivas":3}}',
   '[]',
   '[
     {"tipo":"enviar_whatsapp","template":"lembrete_falta","para":"responsavel","mensagem":"Prezado(a) {{responsavel_nome}}, informamos que {{aluno_nome}} acumula {{faltas_consecutivas}} falta(s) consecutiva(s). Por favor, entre em contato com a escola."},
     {"tipo":"criar_notificacao","para":"coordenadora","mensagem":"Aluno {{aluno_nome}} ({{turma}}) acumula {{faltas_consecutivas}} faltas consecutivas. Contato com família necessário.","prioridade":"alta"}
   ]'
  ),

  -- 2. Lembrete boleto 3 dias antes do vencimento
  (demo_escola_id,
   'Lembrete Boleto 3 Dias',
   'Envia e-mail ao responsável financeiro 3 dias antes do vencimento do boleto.',
   true,
   'cron',
   '{"cron":"0 8 * * *","antecedencia_dias":3}',
   '[]',
   '[
     {"tipo":"enviar_email","assunto":"Lembrete de Vencimento — {{escola_nome}}","para":"responsavel_financeiro","template":"lembrete_boleto","vars":{"vencimento":"{{boleto_vencimento}}","valor":"{{boleto_valor}}","aluno":"{{aluno_nome}}"}}
   ]'
  ),

  -- 3. Boas-vindas nova matrícula
  (demo_escola_id,
   'Boas-vindas Nova Matrícula',
   'Envia e-mail de boas-vindas à família e notifica a secretaria quando uma nova matrícula é criada.',
   true,
   'evento',
   '{"evento":"matricula_criada"}',
   '[]',
   '[
     {"tipo":"enviar_email","assunto":"Bem-vindo(a) à {{escola_nome}}!","para":"responsavel","template":"boas_vindas_matricula","vars":{"aluno":"{{aluno_nome}}","turma":"{{turma_nome}}","inicio":"{{data_inicio}}"}},
     {"tipo":"criar_notificacao","para":"secretaria","mensagem":"Nova matrícula: {{aluno_nome}} na turma {{turma_nome}}. Documentos pendentes: {{documentos_pendentes}}.","prioridade":"normal"}
   ]'
  ),

  -- 4. Aniversariante do dia
  (demo_escola_id,
   'Aniversariante do Dia',
   'Notifica a professora da turma todos os dias às 8h com os aniversariantes do dia.',
   true,
   'cron',
   '{"cron":"0 8 * * *"}',
   '[]',
   '[
     {"tipo":"criar_notificacao","para":"professora_turma","mensagem":"Hoje fazem aniversário: {{aniversariantes_lista}}. Que tal uma surpresa especial? 🎂","prioridade":"normal"}
   ]'
  ),

  -- 5. Follow-up lead parado no CRM
  (demo_escola_id,
   'Follow-up Lead Parado (7 dias)',
   'Notifica o comercial quando um lead fica sem movimentação por 7 ou mais dias.',
   true,
   'evento',
   '{"evento":"lead_sem_atividade","condicao":{"dias_inativo":7}}',
   '[]',
   '[
     {"tipo":"criar_notificacao","para":"comercial","mensagem":"Lead {{lead_nome}} ({{lead_email}}) está sem movimentação há {{dias_inativo}} dias. Etapa atual: {{lead_etapa}}. Agende um contato!","prioridade":"alta"}
   ]'
  );

END $$;
