-- Newsletter subscribers (blog + lead magnet)
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  nome text,
  origem text NOT NULL DEFAULT 'blog', -- blog, exit_intent, inline_cta
  utm_source text,
  utm_medium text,
  utm_campaign text,
  confirmado boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email)
);

-- Index for lookups
CREATE INDEX idx_newsletter_email ON newsletter_subscribers(email);
CREATE INDEX idx_newsletter_criado ON newsletter_subscribers(criado_em DESC);

-- RLS
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anon can insert (public signup)
CREATE POLICY "anon_insert_newsletter" ON newsletter_subscribers
  FOR INSERT TO anon WITH CHECK (true);

-- Staff can read
CREATE POLICY "staff_read_newsletter" ON newsletter_subscribers
  FOR SELECT TO authenticated USING (true);
