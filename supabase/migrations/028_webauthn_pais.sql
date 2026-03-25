-- Adiciona 'pais' ao check constraint de usuario_tipo
ALTER TABLE webauthn_credentials DROP CONSTRAINT IF EXISTS webauthn_credentials_usuario_tipo_check;
ALTER TABLE webauthn_credentials ADD CONSTRAINT webauthn_credentials_usuario_tipo_check
  CHECK (usuario_tipo IN ('gerente','professora','secretaria','pais'));

ALTER TABLE webauthn_challenges DROP CONSTRAINT IF EXISTS webauthn_challenges_tipo_check;
-- tipo is register/login, not usuario_tipo — keep as is
