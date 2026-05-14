-- ═══════════════════════════════════════════════════════════════
--  Migration 328 — escola_banco_config (multi-banco por escola)
--
--  Objetivo: permitir N bancos por escola pra emissão de boleto/PIX.
--  Hoje só Inter está integrado via env vars globais (INTER_*).
--  Esta tabela vira a fonte canônica de credenciais bancárias por
--  escola, lida pelos adapters em _shared/banks/.
--
--  Sprint 0 do plano de expansão bancária. Adapters Sicredi/BB/
--  Itaú/Bradesco entram em sprints seguintes lendo desta tabela.
-- ═══════════════════════════════════════════════════════════════

-- ── Enum de providers suportados ──
DO $$ BEGIN
  CREATE TYPE banco_provider AS ENUM ('inter','sicredi','bb','itau','bradesco');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela de configuração ──
CREATE TABLE IF NOT EXISTS escola_banco_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  banco banco_provider NOT NULL,

  -- Identificação da conta
  agencia text NOT NULL,
  conta text NOT NULL,
  conta_digito text,
  convenio text,                 -- BB, Bradesco
  carteira text,                 -- Itaú, Bradesco, Sicredi
  beneficiario_cnpj text NOT NULL,
  beneficiario_nome text NOT NULL,

  -- Credenciais OAuth (criptografadas via secret name)
  client_id text,                -- registrado em Supabase secrets
  client_secret_name text,       -- nome do secret (ex: BANK_CLIENT_SECRET_<id>)

  -- Certificado mTLS (path no bucket bank-certs)
  cert_storage_path text,        -- bank-certs/<escola_id>/<banco>.pfx
  cert_secret_key text,          -- nome do secret p/ senha do PFX
  cert_validade date,            -- p/ alerta de expiração (cron)

  -- PIX
  pix_chave text,
  pix_tipo text CHECK (pix_tipo IN ('cpf','cnpj','email','telefone','aleatoria') OR pix_tipo IS NULL),

  -- Webhook
  webhook_secret text,           -- HMAC validation
  webhook_url text,              -- URL configurada no portal do banco (referência)

  -- Status
  ativo boolean DEFAULT true,
  padrao boolean DEFAULT false,  -- 1 padrão por escola
  homologado boolean DEFAULT false,
  ultima_emissao timestamptz,
  ultimo_erro text,
  ultimo_erro_em timestamptz,

  -- Audit
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES lumied_staff(id),

  UNIQUE(escola_id, banco)
);

CREATE INDEX IF NOT EXISTS idx_escola_banco_escola ON escola_banco_config(escola_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_escola_banco_padrao ON escola_banco_config(escola_id) WHERE padrao = true AND ativo = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_escola_banco_padrao ON escola_banco_config(escola_id) WHERE padrao = true;

-- Tenant isolation (trigger enforce_tenant_escola_id)
SELECT add_tenant_isolation('escola_banco_config');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_escola_banco_config_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS escola_banco_config_updated_at ON escola_banco_config;
CREATE TRIGGER escola_banco_config_updated_at
  BEFORE UPDATE ON escola_banco_config
  FOR EACH ROW EXECUTE FUNCTION trg_escola_banco_config_updated_at();

-- ── Bucket privado pra certificados ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-certs', 'bank-certs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Policy: somente service_role acessa (lê/escreve via edge function)
DROP POLICY IF EXISTS "bank_certs_service_only" ON storage.objects;
CREATE POLICY "bank_certs_service_only" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'bank-certs') WITH CHECK (bucket_id = 'bank-certs');

-- ── Seed Inter existente (placeholder pra cada escola com boletos) ──
-- Staff completa CNPJ, agência, conta via UI Bancos. Marca como
-- não-homologado até validar emissão de teste.
INSERT INTO escola_banco_config
  (escola_id, banco, agencia, conta, beneficiario_cnpj, beneficiario_nome,
   ativo, padrao, homologado)
SELECT DISTINCT
  e.id,
  'inter'::banco_provider,
  '0001',
  '0',
  COALESCE(regexp_replace(e.cnpj, '\D', '', 'g'), '00000000000000'),
  e.nome,
  true,
  true,
  false  -- staff revalida via UI
FROM escolas e
WHERE EXISTS (SELECT 1 FROM boletos b WHERE b.escola_id = e.id LIMIT 1)
ON CONFLICT (escola_id, banco) DO NOTHING;

-- Comentários
COMMENT ON TABLE escola_banco_config IS 'Config bancária por escola — multi-provider (inter, sicredi, bb, itau, bradesco). Lida pelos adapters em _shared/banks/.';
COMMENT ON COLUMN escola_banco_config.cert_storage_path IS 'Path no bucket bank-certs (ex: <escola_id>/sicredi.pfx). Bucket é privado, lido só pelo bank-relay.';
COMMENT ON COLUMN escola_banco_config.cert_secret_key IS 'Nome do Supabase secret com a senha do PFX. Convenção: BANK_CERT_PASS_<short_id>.';
COMMENT ON COLUMN escola_banco_config.padrao IS 'Banco padrão pra emissão de boleto. Apenas 1 por escola (unique partial index).';
