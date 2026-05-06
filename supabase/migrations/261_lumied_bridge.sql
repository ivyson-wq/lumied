-- ═══════════════════════════════════════════════════════════════
--  Migration 261 — Lumied Bridge (Fase 1)
--  Schema para o relay local que conecta iDFace na LAN ao SaaS.
--
--  Componentes:
--   1. escolas.bridge_token + bridge_ultimo_heartbeat
--   2. acesso_dispositivos.via_bridge (default true — todo device novo
--      assume estar atrás de bridge a menos que tenha IP público)
--   3. acesso_bridge_comandos — fila de comandos edge → bridge
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. Token de autenticação do bridge por escola
-- ────────────────────────────────────────────────────────────────

ALTER TABLE escolas
  ADD COLUMN IF NOT EXISTS bridge_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS bridge_ultimo_heartbeat timestamptz;

CREATE INDEX IF NOT EXISTS idx_escolas_bridge_token ON escolas(bridge_token) WHERE bridge_token IS NOT NULL;

COMMENT ON COLUMN escolas.bridge_token IS 'Token de auth do Lumied Bridge daquela escola (long random). Stored in clear; rotação manual via UI.';
COMMENT ON COLUMN escolas.bridge_ultimo_heartbeat IS 'Última conexão WS recebida do bridge. NULL = nunca conectou.';

-- ────────────────────────────────────────────────────────────────
-- 2. Flag por dispositivo: fala via bridge (LAN) ou IP público direto
-- ────────────────────────────────────────────────────────────────

ALTER TABLE acesso_dispositivos
  ADD COLUMN IF NOT EXISTS via_bridge boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN acesso_dispositivos.via_bridge IS 'true (default): comandos passam pelo Lumied Bridge da escola. false: edge fala HTTPS direto (requer IP público).';

-- ────────────────────────────────────────────────────────────────
-- 3. Fila de comandos edge → bridge
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acesso_bridge_comandos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  dispositivo_id uuid REFERENCES acesso_dispositivos(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN (
    'http_proxy',     -- repassa request HTTP genérico (ip+porta+path+method+body)
    'enroll_user',    -- /create_objects.fcgi users
    'enroll_face',    -- /user_set_image.fcgi
    'delete_user',    -- /destroy_objects.fcgi
    'enroll_card',    -- /create_objects.fcgi cards
    'ping',           -- /login.fcgi (heartbeat)
    'sync_all'        -- batch: enroll_user + enroll_face para todas as faces ativas
  )),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_execucao','concluido','erro','timeout')),
  resultado jsonb,
  tentativas int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

ALTER TABLE acesso_bridge_comandos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bridge_cmd_escola_status ON acesso_bridge_comandos(escola_id, status, criado_em);
CREATE INDEX IF NOT EXISTS idx_bridge_cmd_dispositivo ON acesso_bridge_comandos(dispositivo_id);
CREATE INDEX IF NOT EXISTS idx_bridge_cmd_expira ON acesso_bridge_comandos(expira_em) WHERE status IN ('pendente','em_execucao');

COMMENT ON TABLE acesso_bridge_comandos IS 'Fila de comandos para o Lumied Bridge. Ciclo: pendente → em_execucao → (concluido|erro|timeout). Comandos > expira_em viram timeout via cron.';

-- Tenant isolation: trigger garante escola_id em todo INSERT
SELECT add_tenant_isolation('acesso_bridge_comandos');

-- Reforça NOT NULL (add_tenant_isolation deixa nullable por compat com tabelas legadas)
ALTER TABLE acesso_bridge_comandos ALTER COLUMN escola_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 4. Cleanup automático: comandos antigos viram timeout, depois são purgados
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_bridge_comandos() RETURNS void AS $$
BEGIN
  -- Marca como timeout o que ficou pendente/em_execucao além de expira_em
  UPDATE acesso_bridge_comandos
     SET status = 'timeout',
         concluido_em = now(),
         resultado = jsonb_build_object('error', 'Comando expirou sem resposta do bridge')
   WHERE status IN ('pendente', 'em_execucao')
     AND expira_em < now();

  -- Purga comandos concluídos/erro/timeout > 7 dias
  DELETE FROM acesso_bridge_comandos
   WHERE status IN ('concluido', 'erro', 'timeout')
     AND concluido_em < now() - interval '7 days';
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_bridge_comandos() IS 'Marca comandos expirados como timeout e purga histórico antigo. Rodado por pg_cron a cada 5 min.';

-- pg_cron: rodar a cada 5 minutos (idempotente — desagenda se já existe)
DO $$
BEGIN
  PERFORM cron.unschedule('bridge-comandos-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bridge-comandos-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('bridge-comandos-cleanup', '*/5 * * * *', $$SELECT cleanup_bridge_comandos();$$);

-- ────────────────────────────────────────────────────────────────
-- 5. Helper: gerar bridge_token para uma escola
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gerar_bridge_token(p_escola_id uuid) RETURNS text AS $$
DECLARE
  v_token text;
BEGIN
  v_token := 'lbr_' || encode(gen_random_bytes(32), 'hex');
  UPDATE escolas SET bridge_token = v_token WHERE id = p_escola_id;
  RETURN v_token;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION gerar_bridge_token(uuid) IS 'Gera/rotaciona token do bridge para uma escola. Retorna o token novo. Chamar via edge function autenticada.';
