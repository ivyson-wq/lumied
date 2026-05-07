-- ═══════════════════════════════════════════════════════════════
--  Migration 291 — Inventário físico do almoxarifado
--
--  Sessão de contagem persistida (rascunho), com itens individuais
--  que registram saldo do sistema vs saldo contado. Ao finalizar,
--  emite ajustes em alm_movimentacoes para todos os itens com
--  divergência e atualiza alm_insumos.estoque_qty.
-- ═══════════════════════════════════════════════════════════════

-- 1) Localização física no catálogo (sala/armário/prateleira)
ALTER TABLE alm_insumos
  ADD COLUMN IF NOT EXISTS localizacao text;

CREATE INDEX IF NOT EXISTS idx_alm_insumos_localizacao
  ON alm_insumos(escola_id, localizacao) WHERE ativo = true;

-- 2) Sessão de inventário (cabeçalho)
CREATE TABLE IF NOT EXISTS alm_inventarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id     uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  descricao     text,
  status        text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'finalizado', 'cancelado')),
  filtro_categoria    text,
  filtro_localizacao  text,
  total_itens         int NOT NULL DEFAULT 0,
  total_contados      int NOT NULL DEFAULT 0,
  total_divergencias  int NOT NULL DEFAULT 0,
  criado_por    uuid,
  criado_em     timestamptz DEFAULT now(),
  finalizado_em timestamptz,
  finalizado_por uuid,
  cancelado_em  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_alm_inv_escola
  ON alm_inventarios(escola_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_alm_inv_status
  ON alm_inventarios(escola_id, status);

-- 3) Item da sessão (uma linha por insumo participante)
CREATE TABLE IF NOT EXISTS alm_inventario_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id      uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  inventario_id  uuid NOT NULL REFERENCES alm_inventarios(id) ON DELETE CASCADE,
  insumo_id      uuid NOT NULL REFERENCES alm_insumos(id) ON DELETE CASCADE,
  -- Snapshot do catálogo no momento da abertura (pra sobreviver a edição/exclusão do insumo)
  nome_snapshot       text,
  unidade_snapshot    text,
  categoria_snapshot  text,
  localizacao_snapshot text,
  saldo_sistema       numeric NOT NULL DEFAULT 0,
  saldo_contado       numeric,
  contado             boolean NOT NULL DEFAULT false,
  observacao          text,
  contado_por         uuid,
  contado_em          timestamptz,
  UNIQUE (inventario_id, insumo_id)
);

CREATE INDEX IF NOT EXISTS idx_alm_inv_itens_inv
  ON alm_inventario_itens(inventario_id);
CREATE INDEX IF NOT EXISTS idx_alm_inv_itens_pendentes
  ON alm_inventario_itens(inventario_id, contado);

-- 4) Tenant isolation
DO $$ BEGIN
  PERFORM add_tenant_isolation('alm_inventarios');
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON alm_inventarios FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
END $$;

DO $$ BEGIN
  PERFORM add_tenant_isolation('alm_inventario_itens');
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON alm_inventario_itens FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
END $$;

COMMENT ON TABLE alm_inventarios IS
  'Sessão de inventário físico (rascunho persistido). Ao finalizar emite alm_movimentacoes tipo=ajuste para divergências.';
COMMENT ON TABLE alm_inventario_itens IS
  'Linha de inventário: snapshot do insumo + saldo contado pelo conferente. Mantida em rascunho até finalização da sessão.';
