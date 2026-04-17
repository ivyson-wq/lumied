-- Lead scoring + follow-up automation columns
ALTER TABLE leads_comerciais ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE leads_comerciais ADD COLUMN IF NOT EXISTS reativado_em timestamptz;
ALTER TABLE leads_comerciais ADD COLUMN IF NOT EXISTS demo_em timestamptz;
ALTER TABLE leads_comerciais ADD COLUMN IF NOT EXISTS followup_passo integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_score ON leads_comerciais(score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_status_criado ON leads_comerciais(status, criado_em);

-- pg_cron jobs (run via Supabase dashboard or SQL)
-- Reativação de leads frios: diário às 10:00 BRT
-- SELECT cron.schedule('reativar-leads-frios', '0 13 * * *',
--   $$SELECT net.http_post('https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/admin',
--     '{"action":"cron_reativar_leads","_cron_key":"' || current_setting('app.cron_internal_key', true) || '"}',
--     '{"Content-Type":"application/json"}')$$);

-- Lead scoring: a cada 6h
-- SELECT cron.schedule('lead-scoring', '0 */6 * * *',
--   $$SELECT net.http_post('https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/admin',
--     '{"action":"cron_lead_scoring","_cron_key":"' || current_setting('app.cron_internal_key', true) || '"}',
--     '{"Content-Type":"application/json"}')$$);

-- Follow-up pós-demo: diário às 09:00 BRT
-- SELECT cron.schedule('followup-demo', '0 12 * * *',
--   $$SELECT net.http_post('https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/admin',
--     '{"action":"cron_followup_demo","_cron_key":"' || current_setting('app.cron_internal_key', true) || '"}',
--     '{"Content-Type":"application/json"}')$$);
