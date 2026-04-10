-- Migration 215: Credenciais por dispositivo Control iD (substitui admin/admin hardcoded)

ALTER TABLE acesso_dispositivos
  ADD COLUMN IF NOT EXISTS api_login TEXT,
  ADD COLUMN IF NOT EXISTS api_password TEXT;

-- Comentário de segurança: em produção, considerar cifrar api_password com pgsodium ou Vault.
COMMENT ON COLUMN acesso_dispositivos.api_password IS 'Senha da API do dispositivo Control iD. Em produção, preferir env var CONTROLID_DEFAULT_PASSWORD ou cifrar com pgsodium.';
