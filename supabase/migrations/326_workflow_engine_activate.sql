-- ══════════════════════════════════════════════════════════════
--  326 — Ativar Workflow Engine completamente
--
--  1. RPCs para event resolvers (faltas, boletos, aniversariantes)
--  2. pg_cron job para processar eventos a cada 30min
--  3. Seed templates para TODAS as escolas que ainda não têm
-- ══════════════════════════════════════════════════════════════

-- ─── 1. RPC: Faltas consecutivas ─────────────────────────────
-- Retorna alunos com N+ faltas consecutivas (últimas chamadas)
CREATE OR REPLACE FUNCTION get_alunos_faltas_consecutivas(
  p_escola_id uuid,
  p_min_faltas integer DEFAULT 3
)
RETURNS TABLE (
  aluno_email text,
  aluno_nome text,
  serie text,
  turma text,
  faltas_consecutivas bigint,
  responsavel_email text,
  responsavel_nome text,
  responsavel_telefone text
)
LANGUAGE sql STABLE
AS $$
  WITH ultimas_chamadas AS (
    -- Últimas chamadas por aluno, ordenadas por data desc
    SELECT
      fr.aluno_email,
      fr.aluno_nome,
      fr.status,
      fc.data,
      s.nome AS serie,
      ROW_NUMBER() OVER (PARTITION BY fr.aluno_email ORDER BY fc.data DESC) AS rn
    FROM frequencia_registros fr
    JOIN frequencia_chamadas fc ON fc.id = fr.chamada_id
    JOIN series s ON s.id = fc.serie_id
    WHERE s.escola_id = p_escola_id
  ),
  faltas_seq AS (
    -- Conta faltas consecutivas a partir da data mais recente
    SELECT
      aluno_email,
      aluno_nome,
      serie,
      COUNT(*) AS faltas_consecutivas
    FROM ultimas_chamadas
    WHERE rn <= 20 -- Olha últimas 20 chamadas no máximo
      AND status IN ('A', 'F') -- A=Ausente, F=Falta
      -- Só conta enquanto for falta consecutiva
      AND rn <= (
        SELECT COALESCE(MIN(rn2.rn) - 1, 20)
        FROM ultimas_chamadas rn2
        WHERE rn2.aluno_email = ultimas_chamadas.aluno_email
          AND rn2.status = 'P'
      )
    GROUP BY aluno_email, aluno_nome, serie
    HAVING COUNT(*) >= p_min_faltas
  )
  SELECT
    fs.aluno_email,
    fs.aluno_nome,
    fs.serie,
    '' AS turma,
    fs.faltas_consecutivas,
    COALESCE(a.familia_email, '') AS responsavel_email,
    COALESCE(f.nome_responsavel, '') AS responsavel_nome,
    '' AS responsavel_telefone
  FROM faltas_seq fs
  LEFT JOIN alunos a ON a.email = fs.aluno_email AND a.escola_id = p_escola_id
  LEFT JOIN familias f ON f.email = a.familia_email AND f.escola_id = p_escola_id
  LIMIT 10;
$$;

-- ─── 2. RPC: Boletos vencendo em N dias ──────────────────────
CREATE OR REPLACE FUNCTION get_boletos_vencendo(
  p_escola_id uuid,
  p_dias_antecedencia integer DEFAULT 3
)
RETURNS TABLE (
  boleto_id uuid,
  familia_email text,
  familia_nome text,
  crianca_nome text,
  valor numeric,
  vencimento date,
  dias_para_vencer integer,
  responsavel_email text,
  responsavel_telefone text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    b.id AS boleto_id,
    b.familia_email,
    b.familia_nome,
    b.crianca_nome,
    b.valor,
    b.vencimento,
    (b.vencimento - CURRENT_DATE)::integer AS dias_para_vencer,
    COALESCE(b.familia_email, '') AS responsavel_email,
    '' AS responsavel_telefone
  FROM fin_boletos_emitidos b
  WHERE b.escola_id = p_escola_id
    AND b.status = 'emitido'
    AND b.vencimento BETWEEN CURRENT_DATE AND (CURRENT_DATE + p_dias_antecedencia)
  ORDER BY b.vencimento
  LIMIT 50;
$$;

-- ─── 3. RPC: Aniversariantes do dia ─────────────────────────
CREATE OR REPLACE FUNCTION get_aniversariantes_hoje(
  p_escola_id uuid
)
RETURNS TABLE (
  aluno_nome text,
  aluno_email text,
  serie text,
  idade integer,
  responsavel_email text,
  responsavel_nome text,
  responsavel_telefone text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.nome AS aluno_nome,
    a.email AS aluno_email,
    COALESCE(s.nome, '') AS serie,
    EXTRACT(YEAR FROM age(CURRENT_DATE, a.data_nascimento))::integer AS idade,
    COALESCE(a.familia_email, '') AS responsavel_email,
    COALESCE(f.nome_responsavel, '') AS responsavel_nome,
    '' AS responsavel_telefone
  FROM alunos a
  LEFT JOIN series s ON s.id = a.serie_id
  LEFT JOIN familias f ON f.email = a.familia_email AND f.escola_id = p_escola_id
  WHERE a.escola_id = p_escola_id
    AND a.ativo = true
    AND a.data_nascimento IS NOT NULL
    AND EXTRACT(MONTH FROM a.data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
    AND EXTRACT(DAY FROM a.data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)
  ORDER BY a.nome;
$$;

-- ─── 4. pg_cron: processar workflows a cada 30 min ──────────
SELECT cron.schedule(
  'workflow-processar-eventos',
  '*/30 * * * *',
  $$SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/workflows',
    '{"action":"workflow_processar_eventos","_cron_key":"' || current_setting('app.settings.cron_internal_key', true) || '"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )$$
);

-- ─── 5. Seed templates para todas as escolas ─────────────────
-- Insere os 5 templates padrão para cada escola que ainda não possui workflows
DO $$
DECLARE
  esc RECORD;
  has_workflows boolean;
BEGIN
  FOR esc IN SELECT id FROM escolas WHERE ativo = true LOOP
    SELECT EXISTS(SELECT 1 FROM workflows WHERE escola_id = esc.id) INTO has_workflows;
    IF NOT has_workflows THEN
      INSERT INTO workflows (escola_id, nome, descricao, ativo, trigger_tipo, trigger_config, condicoes, acoes) VALUES

      (esc.id,
       'Alerta 3 Faltas Consecutivas',
       'Envia WhatsApp ao responsável e notificação à coordenadora quando aluno acumula 3+ faltas consecutivas.',
       true, 'evento',
       '{"evento":"aluno_falta","condicao":{"faltas_consecutivas":3}}',
       '[]',
       '[{"tipo":"enviar_whatsapp","template":"lembrete_falta","para":"responsavel","mensagem":"Prezado(a) {{responsavel_nome}}, informamos que {{aluno_nome}} acumula {{faltas_consecutivas}} falta(s) consecutiva(s). Por favor, entre em contato com a escola."},{"tipo":"criar_notificacao","para":"coordenadora","mensagem":"Aluno {{aluno_nome}} ({{serie}}) acumula {{faltas_consecutivas}} faltas consecutivas.","prioridade":"alta"}]'
      ),

      (esc.id,
       'Lembrete Boleto 3 Dias',
       'Envia e-mail ao responsável financeiro 3 dias antes do vencimento do boleto.',
       true, 'cron',
       '{"cron":"0 8 * * *","antecedencia_dias":3}',
       '[]',
       '[{"tipo":"enviar_email","assunto":"Lembrete de Vencimento — {{escola_nome}}","para":"responsavel","template":"lembrete_boleto","vars":{"vencimento":"{{vencimento}}","valor":"{{valor}}","aluno":"{{crianca_nome}}"}}]'
      ),

      (esc.id,
       'Boas-vindas Nova Matrícula',
       'Envia e-mail de boas-vindas à família quando uma nova matrícula é criada.',
       true, 'evento',
       '{"evento":"matricula_criada"}',
       '[]',
       '[{"tipo":"enviar_email","assunto":"Bem-vindo(a) à {{escola_nome}}!","para":"responsavel","template":"boas_vindas_matricula","vars":{"aluno":"{{aluno_nome}}","turma":"{{turma_nome}}","inicio":"{{data_inicio}}"}},{"tipo":"criar_notificacao","para":"secretaria","mensagem":"Nova matrícula: {{aluno_nome}} na turma {{turma_nome}}.","prioridade":"normal"}]'
      ),

      (esc.id,
       'Aniversariante do Dia',
       'Notifica a professora da turma todos os dias às 8h com os aniversariantes do dia.',
       true, 'cron',
       '{"cron":"0 8 * * *"}',
       '[]',
       '[{"tipo":"criar_notificacao","para":"professora","mensagem":"Hoje fazem aniversário: {{aniversariantes_lista}}. Que tal uma surpresa especial?","prioridade":"normal"}]'
      ),

      (esc.id,
       'Follow-up Lead Parado (7 dias)',
       'Notifica o comercial quando um lead fica sem movimentação por 7 ou mais dias.',
       true, 'evento',
       '{"evento":"lead_sem_atividade","condicao":{"dias_inativo":7}}',
       '[]',
       '[{"tipo":"criar_notificacao","para":"comercial","mensagem":"Lead {{lead_nome}} ({{lead_email}}) está sem movimentação há {{dias_inativo}} dias. Etapa atual: {{lead_etapa}}. Agende um contato!","prioridade":"alta"}]'
      );
    END IF;
  END LOOP;
END $$;
