-- ═══════════════════════════════════════════════════════════════
-- Migration 347 — lap_magic_links
--
-- Sprint 10 LAP. Suporte a convites passwordless via WhatsApp/Email.
-- 1 uso, expira em 7 dias.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lap_magic_links (
  token         text        PRIMARY KEY,
  escola_id     uuid        NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  email         text        NOT NULL,
  nome          text,
  papel         text        NOT NULL CHECK (papel IN (
    'diretor','gerente','financeiro','secretaria','comercial',
    'manutencao','almoxarifado','nutricionista','impressao',
    'coord_pedagogico','professora','professora_assistente'
  )),
  canal         text        NOT NULL CHECK (canal IN ('whatsapp','email')),
  telefone      text,
  criado_por    uuid,                              -- gerente que enviou (sem FK pra não acoplar)
  criado_por_nome text,
  expira_em     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  usado_em      timestamptz,
  usuario_id    uuid,                              -- preenchido após redeem
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lap_invite_escola
  ON lap_magic_links(escola_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_lap_invite_pendentes
  ON lap_magic_links(escola_id, expira_em)
  WHERE usado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_lap_invite_email
  ON lap_magic_links(escola_id, lower(email));

-- Tenant isolation
SELECT add_tenant_isolation('lap_magic_links');

COMMENT ON TABLE lap_magic_links IS
  'Convites passwordless 1-uso (mig 347). Token urlsafe 32+ chars, expira 7d, marca usado_em ao redimir.';
