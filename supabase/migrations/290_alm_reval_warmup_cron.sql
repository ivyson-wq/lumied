-- ═══════════════════════════════════════════════════════════════
--  Migration 290 — Cron de pré-aquecimento do cache do Reval
-- ═══════════════════════════════════════════════════════════════
--  Reval rate-limita IPs que fazem muitas chamadas. Como o catálogo
--  escolar é estável (~50-100 itens), pré-popular o cache KV do
--  worker reval-proxy 1×/h com 3 itens diferentes resolve.
--
--  3 itens × 24 chamadas/dia = 72 itens populados/dia (cobre todo
--  catálogo escolar típico). Worker faz delay aleatório 5-9s entre
--  buscas pra simular comportamento humano e evitar anti-bot.
--
--  Edge function action: alm_reval_warmup
--  Auth: header x-cron-key = CRON_INTERNAL_KEY
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  PERFORM cron.unschedule('alm-reval-warmup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'alm-reval-warmup',
  '0 * * * *',  -- a cada hora cheia
  $cron$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/diplomas',
    '{"action":"alm_reval_warmup"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lumied_cron_key' LIMIT 1), '__missing_cron_key__')
    ),
    35000
  );
  $cron$
);

COMMENT ON EXTENSION pg_cron IS
  'Cron jobs Lumied — ver SELECT * FROM cron.job pra lista completa.';
