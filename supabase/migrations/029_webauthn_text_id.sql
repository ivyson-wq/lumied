-- Muda usuario_id de uuid para text para suportar email como ID (portal pais)
ALTER TABLE webauthn_credentials ALTER COLUMN usuario_id TYPE text;
ALTER TABLE webauthn_challenges ALTER COLUMN usuario_id TYPE text;
