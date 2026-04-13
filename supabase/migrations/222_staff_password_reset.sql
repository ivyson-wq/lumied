-- Migration 222: Add password reset columns to lumied_staff
ALTER TABLE lumied_staff ADD COLUMN IF NOT EXISTS reset_codigo_hash text;
ALTER TABLE lumied_staff ADD COLUMN IF NOT EXISTS reset_expira_em timestamptz;
ALTER TABLE lumied_staff ADD COLUMN IF NOT EXISTS reset_tentativas integer DEFAULT 0;
