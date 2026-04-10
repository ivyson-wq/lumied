-- =====================================================
-- 218: DB-backed rate limiting
-- Replaces the in-memory Map in _shared/ratelimit.ts which
-- resets on every edge function cold start and is not shared
-- across instances.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket
  ON public.rate_limits(bucket_start);

ALTER TABLE public.rate_limits DISABLE ROW LEVEL SECURITY;

-- Atomic increment-and-check RPC.
-- Uses a fixed-window algorithm aligned to UNIX time.
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key TEXT,
  p_window_seconds INTEGER,
  p_max_requests INTEGER
) RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, retry_after INTEGER) AS $$
DECLARE
  v_bucket_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  -- Align bucket to UNIX window (same bucket for all requests in the window)
  v_bucket_start := to_timestamp(
    (EXTRACT(EPOCH FROM NOW())::bigint / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (key, bucket_start, count)
  VALUES (p_key, v_bucket_start, 1)
  ON CONFLICT (key, bucket_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING public.rate_limits.count INTO v_count;

  IF v_count > p_max_requests THEN
    RETURN QUERY SELECT
      FALSE,
      v_count,
      (p_window_seconds - (EXTRACT(EPOCH FROM (NOW() - v_bucket_start))::int))::int;
  ELSE
    RETURN QUERY SELECT TRUE, v_count, 0;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Periodic cleanup of old buckets (call from pg_cron daily).
CREATE OR REPLACE FUNCTION public.rate_limits_cleanup() RETURNS VOID AS $$
BEGIN
  DELETE FROM public.rate_limits
  WHERE bucket_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Ensure anon/authenticated can execute (service_role always can)
GRANT EXECUTE ON FUNCTION public.rate_limit_check(TEXT, INTEGER, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_limits_cleanup() TO service_role;
