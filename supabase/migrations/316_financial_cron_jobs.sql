-- ══════════════════════════════════════════════════════════════
--  316 — pg_cron jobs para workflows financeiros
--  boletos_gerar_batch (dia 28), inadimplencia, conciliacao, relatorio
-- ══════════════════════════════════════════════════════════════

-- Boletos automáticos — dia 28 às 08:00 BRT (11 UTC)
-- Gera lote para o mês seguinte. Pula alunos que já têm boleto (sob demanda).
SELECT cron.schedule(
  'boletos-gerar-batch-mensal',
  '0 11 28 * *',
  $$SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    '{"action":"boletos_gerar_batch","_cron_key":"' || current_setting('app.settings.cron_internal_key', true) || '"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )$$
);

-- Inadimplência — seg-sex 09:00 BRT (12 UTC)
-- Verifica mensalidades vencidas, atualiza buckets, escala extrajudicial 28d+.
SELECT cron.schedule(
  'inadimplencia-verificar-diario',
  '0 12 * * 1-5',
  $$SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    '{"action":"inadimplencia_verificar","_cron_key":"' || current_setting('app.settings.cron_internal_key', true) || '"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )$$
);

-- Conciliação bancária — seg-sex 07:00 BRT (10 UTC)
-- Busca extrato Inter do dia anterior e concilia com lançamentos.
SELECT cron.schedule(
  'conciliacao-bancaria-diaria',
  '0 10 * * 1-5',
  $$SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    '{"action":"conciliacao_automatica","_cron_key":"' || current_setting('app.settings.cron_internal_key', true) || '"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )$$
);

-- Relatório mensal — dia 3 às 08:00 BRT (11 UTC)
-- Gera P&L + sugestões IA e envia ao resp financeiro.
SELECT cron.schedule(
  'relatorio-financeiro-mensal',
  '0 11 3 * *',
  $$SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    '{"action":"relatorio_mensal_enviar","_cron_key":"' || current_setting('app.settings.cron_internal_key', true) || '"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )$$
);

-- Adicionar coluna aluno_id em fin_boletos_emitidos se não existir
DO $$ BEGIN
  ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS aluno_id uuid REFERENCES alunos(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_fin_boletos_emitidos_aluno ON fin_boletos_emitidos(aluno_id) WHERE aluno_id IS NOT NULL;
