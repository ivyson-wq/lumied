-- ═══════════════════════════════════════════════════════════════
--  Migration 297 — LPR Fase 2: foto persistente + auto-cadastro família
--
--   1. acesso_lpr_eventos.foto_path — bucket lpr-fotos
--   2. acesso_lpr_solicitacoes — pais pedem cadastro de placa
--      via portal família, gerente aprova/rejeita
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. Foto persistente nos eventos
-- ────────────────────────────────────────────────────────────────

ALTER TABLE acesso_lpr_eventos
  ADD COLUMN IF NOT EXISTS foto_path text;

COMMENT ON COLUMN acesso_lpr_eventos.foto_path IS 'Path no bucket lpr-fotos (privado). Padrão: <escola_id>/eventos/<event_id>.jpg. Signed URL gerada on-demand pela edge.';

CREATE INDEX IF NOT EXISTS idx_lpr_eventos_foto
  ON acesso_lpr_eventos(escola_id, ts DESC) WHERE foto_path IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 2. Solicitações de cadastro pelo portal família
-- ────────────────────────────────────────────────────────────────

-- familias não tem PK uuid (chave natural = cpf), então usamos cpf direto.
CREATE TABLE IF NOT EXISTS acesso_lpr_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  familia_cpf text NOT NULL,                        -- chave natural de familias
  familia_email text,                               -- snapshot pra contato/UX
  familia_nome text,                                -- snapshot pra display
  placa text NOT NULL,                              -- normalizada
  apelido text,
  observacao text,                                  -- nota da família
  foto_path text,                                   -- foto da placa enviada pelos pais
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovada','rejeitada')),
  motivo_rejeicao text,
  aprovada_por uuid,                                -- usuario_id do gerente
  aprovada_em timestamptz,
  placa_id uuid REFERENCES acesso_lpr_placas(id) ON DELETE SET NULL,  -- preenchido após aprovar
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acesso_lpr_solicitacoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_lpr_sol_escola_status
  ON acesso_lpr_solicitacoes(escola_id, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lpr_sol_familia
  ON acesso_lpr_solicitacoes(familia_cpf, criado_em DESC);

COMMENT ON TABLE acesso_lpr_solicitacoes IS 'Pais cadastram veículos via portal família; gerente aprova → cria registro em acesso_lpr_placas. familia_cpf é a chave natural (familias não tem id uuid).';

-- Coluna pra rastrear família dona em acesso_lpr_placas (owner_tipo='familia')
ALTER TABLE acesso_lpr_placas ADD COLUMN IF NOT EXISTS owner_cpf text;
CREATE INDEX IF NOT EXISTS idx_lpr_placas_owner_cpf
  ON acesso_lpr_placas(escola_id, owner_cpf) WHERE owner_cpf IS NOT NULL;
COMMENT ON COLUMN acesso_lpr_placas.owner_cpf IS 'CPF da família dona, quando owner_tipo=familia. Usado em vez de owner_id porque familias não tem PK uuid.';

SELECT add_tenant_isolation('acesso_lpr_solicitacoes');
ALTER TABLE acesso_lpr_solicitacoes ALTER COLUMN escola_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. Cleanup de fotos órfãs
--    Quando deleta um evento (cron de 90d) ou rejeita solicitação,
--    o storage object vira órfão. Job separado limpará via Storage API
--    (DELETE direto em storage.objects bloqueado por trigger).
--    Aqui só uma view auxiliar pra auditar.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW lpr_fotos_em_uso AS
  SELECT foto_path FROM acesso_lpr_eventos WHERE foto_path IS NOT NULL
  UNION
  SELECT foto_path FROM acesso_lpr_solicitacoes WHERE foto_path IS NOT NULL;

COMMENT ON VIEW lpr_fotos_em_uso IS 'União dos paths atualmente referenciados. Job de cleanup compara com storage.objects pra achar órfãs.';
