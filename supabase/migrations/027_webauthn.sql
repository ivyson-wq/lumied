-- WebAuthn/Passkeys para login biométrico (Face ID, fingerprint)
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_tipo    text NOT NULL CHECK (usuario_tipo IN ('gerente','professora','secretaria')),
  usuario_id      uuid NOT NULL,
  credential_id   text UNIQUE NOT NULL,
  public_key      text NOT NULL,
  sign_count      bigint NOT NULL DEFAULT 0,
  transports      text[] DEFAULT '{}',
  rp_id           text NOT NULL,
  nome_dispositivo text,
  criado_em       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge   text UNIQUE NOT NULL,
  usuario_tipo text,
  usuario_id  uuid,
  email       text,
  tipo        text NOT NULL CHECK (tipo IN ('register','login')),
  rp_id       text NOT NULL,
  expira_em   timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  criado_em   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_usuario ON webauthn_credentials(usuario_tipo, usuario_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON webauthn_credentials(credential_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenge ON webauthn_challenges(challenge);

ALTER TABLE webauthn_credentials DISABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_challenges DISABLE ROW LEVEL SECURITY;
