-- ═══════════════════════════════════════════════════════════════
-- 302: REP físico (ponto eletrônico) cadastrado por escola
-- Permite ao Lumied Bridge buscar AFD diariamente sem intervenção.
-- Suporta marca Henry (Hexa, Prima, Vega) por padrão; outras marcas
-- são possíveis usando url_afd_template + método de auth configurável.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ponto_rep_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome text NOT NULL,                          -- ex: "REP Recepção"
  marca text NOT NULL DEFAULT 'henry',         -- henry | controlid | topdata | madis | outro
  modelo text,                                 -- ex: "Hexa", "Prima", "Vega"
  ip text NOT NULL,                            -- IP na LAN da escola
  porta integer NOT NULL DEFAULT 80,
  protocolo text NOT NULL DEFAULT 'http',      -- http | https
  -- Auth: dois modos suportados pelo daemon (form_login = POST form com cookie session)
  auth_modo text NOT NULL DEFAULT 'form_login',  -- form_login | basic | none
  usuario text,
  senha text,                                  -- TODO: criptografar via vault em fase futura
  -- URLs (templates com {DATAINI}/{DATAFIM} no formato DDMMAAAA, e {SESSION} se precisar)
  url_login text,                              -- ex: /cgi-bin/login.cgi
  url_afd_template text NOT NULL,              -- ex: /cgi-bin/afd.cgi?dataini={DATAINI}&datafim={DATAFIM}
  -- Operacional
  ativo boolean DEFAULT true,
  -- Estado da última coleta
  ultimo_pull_em timestamptz,
  ultimo_pull_status text,                     -- ok | erro_login | erro_download | erro_parse | sem_dados
  ultimo_pull_erro text,
  ultimo_pull_eventos integer,
  -- Auditoria
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ponto_rep_escola ON ponto_rep_devices(escola_id) WHERE ativo = true;

-- Tenant isolation (mig 244 — trigger guard)
SELECT add_tenant_isolation('ponto_rep_devices');

-- Trigger atualizado_em
DROP TRIGGER IF EXISTS ponto_rep_devices_atualizado ON ponto_rep_devices;
CREATE TRIGGER ponto_rep_devices_atualizado
  BEFORE UPDATE ON ponto_rep_devices
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- Marca origem das importações pra distinguir auto vs manual
ALTER TABLE afd_imports ADD COLUMN IF NOT EXISTS origem text DEFAULT 'manual';   -- manual | bridge_auto
ALTER TABLE afd_imports ADD COLUMN IF NOT EXISTS rep_device_id uuid REFERENCES ponto_rep_devices(id) ON DELETE SET NULL;

COMMENT ON TABLE ponto_rep_devices IS 'REPs físicos (Henry/ControlID/etc) cadastrados por escola — buscados pelo Lumied Bridge daemon';
COMMENT ON COLUMN ponto_rep_devices.url_afd_template IS 'Path com {DATAINI}/{DATAFIM} no formato DDMMAAAA. Ex Henry Hexa: /cgi-bin/afd.cgi?dataini={DATAINI}&datafim={DATAFIM}';
