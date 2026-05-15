-- ═══════════════════════════════════════════════════════════════
--  Migration 336 — Manutenção → solicitar material via alm_compras
--
--  Liga chamado de manutenção ao fluxo de aquisição do almoxarifado
--  reaproveitando alm_compras (sem entidade "cotação" nova).
--
--  • manutencoes.precisa_material: marca chamado que demanda compra
--  • alm_compras.origem / origem_id: rastreia procedência (turma/manut/avulso)
--  • alm_compras.aprovado_financeiro: gate p/ compras acima do teto
--  • escola_config.compra_limite_gerente: teto p/ aprovação direta (R$)
-- ═══════════════════════════════════════════════════════════════

-- 1. Manutenção
ALTER TABLE manutencoes
  ADD COLUMN IF NOT EXISTS precisa_material boolean NOT NULL DEFAULT false;

-- 2. alm_compras — origem e financeiro
ALTER TABLE alm_compras
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'requisicao_turma',
  ADD COLUMN IF NOT EXISTS origem_id uuid,
  ADD COLUMN IF NOT EXISTS aprovado_financeiro boolean,
  ADD COLUMN IF NOT EXISTS aprovado_financeiro_em timestamptz,
  ADD COLUMN IF NOT EXISTS aprovado_financeiro_por text;

-- requisicao_id deixa de ser obrigatório (origem != requisicao_turma)
ALTER TABLE alm_compras ALTER COLUMN requisicao_id DROP NOT NULL;

-- CHECK constraint p/ origem (drop+add idempotente)
ALTER TABLE alm_compras DROP CONSTRAINT IF EXISTS alm_compras_origem_check;
ALTER TABLE alm_compras
  ADD CONSTRAINT alm_compras_origem_check
  CHECK (origem IN ('requisicao_turma','manutencao','ad_hoc'));

-- Backfill: linhas antigas mantêm 'requisicao_turma' (default já cuida)
-- mas amarra origem_id ao requisicao_id existente quando nulo
UPDATE alm_compras
   SET origem_id = requisicao_id
 WHERE origem = 'requisicao_turma'
   AND origem_id IS NULL
   AND requisicao_id IS NOT NULL;

-- Backfill aprovado_financeiro=true para todo histórico existente
-- (fluxo de turma vinha de requisição já aprovada — gate só aplica daqui pra frente)
UPDATE alm_compras
   SET aprovado_financeiro = true
 WHERE aprovado_financeiro IS NULL;

CREATE INDEX IF NOT EXISTS idx_alm_compras_origem
  ON alm_compras(origem, origem_id);

CREATE INDEX IF NOT EXISTS idx_alm_compras_aprov_fin_pendente
  ON alm_compras(escola_id, encaminhado_em DESC)
  WHERE aprovado_financeiro IS NULL AND status = 'pendente';

-- 3. Param compra_limite_gerente — seed por escola (não sobrescreve)
-- Default R$ 300: gerente aprova sozinho até esse valor; acima exige
-- aprovação de papel financeiro/diretor.
INSERT INTO escola_config (chave, valor, descricao, categoria, escola_id)
SELECT 'compra_limite_gerente',
       '300'::jsonb,
       'Teto (R$) para gerente aprovar compras sem passar pelo financeiro',
       'almoxarifado',
       e.id
  FROM escolas e
 WHERE NOT EXISTS (
   SELECT 1 FROM escola_config c
    WHERE c.chave = 'compra_limite_gerente' AND c.escola_id = e.id
 );

-- 4. Comentários
COMMENT ON COLUMN manutencoes.precisa_material IS
  'Marca chamado que originou solicitação de material (vinculada via alm_compras.origem_id).';
COMMENT ON COLUMN alm_compras.origem IS
  'requisicao_turma (default, fluxo professora) | manutencao | ad_hoc';
COMMENT ON COLUMN alm_compras.origem_id IS
  'FK lógica: aponta para manutencoes.id quando origem=manutencao, alm_requisicoes.id quando origem=requisicao_turma. Sem FK formal pra evitar acoplamento entre módulos.';
COMMENT ON COLUMN alm_compras.aprovado_financeiro IS
  'NULL = não precisou (abaixo do teto compra_limite_gerente). true/false = decisão do financeiro/diretor.';
