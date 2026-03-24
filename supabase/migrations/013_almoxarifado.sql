-- Migration 013: Almoxarifado (Warehouse / Supply Management)
-- Run this SQL in Supabase Dashboard > SQL Editor

-- 1. Turmas (classes) for supply budget allocation
CREATE TABLE IF NOT EXISTS alm_turmas (
  id    uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  nome  text    NOT NULL UNIQUE,
  cor   text    NOT NULL DEFAULT '#3B82F6',
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

-- 2. Link professoras to their turma
ALTER TABLE professoras
  ADD COLUMN IF NOT EXISTS alm_turma_id uuid REFERENCES alm_turmas(id) ON DELETE SET NULL;

-- 3. Supply catalog
CREATE TABLE IF NOT EXISTS alm_insumos (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        text    NOT NULL,
  descricao   text,
  unidade     text    NOT NULL DEFAULT 'unidade',
  estoque_qty numeric NOT NULL DEFAULT 0 CHECK (estoque_qty >= 0),
  preco       numeric NOT NULL DEFAULT 0 CHECK (preco >= 0),
  categoria   text,
  ativo       boolean DEFAULT true,
  criado_em   timestamptz DEFAULT now()
);

-- 4. Monthly budget per turma
CREATE TABLE IF NOT EXISTS alm_orcamentos (
  id        uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  turma_id  uuid    NOT NULL REFERENCES alm_turmas(id) ON DELETE CASCADE,
  mes       text    NOT NULL,   -- format: YYYY-MM
  valor     numeric NOT NULL DEFAULT 0 CHECK (valor >= 0),
  UNIQUE(turma_id, mes)
);

-- 5. Supply requests from teachers
CREATE TABLE IF NOT EXISTS alm_requisicoes (
  id             uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id  uuid    NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  turma_id       uuid    REFERENCES alm_turmas(id) ON DELETE SET NULL,
  mes            text    NOT NULL,   -- format: YYYY-MM
  itens          jsonb   NOT NULL DEFAULT '[]',
  -- item schema: [{insumo_id, nome, unidade, qty_solicitado, qty_aprovado, preco_unit}]
  total          numeric NOT NULL DEFAULT 0,
  observacao     text,
  status         text    NOT NULL DEFAULT 'pendente'
                           CHECK (status IN ('pendente','aprovado','rejeitado')),
  nota_gerente   text,
  criado_em      timestamptz DEFAULT now(),
  aprovado_em    timestamptz,
  rejeitado_em   timestamptz
);

-- 6. Delivery tracking (approved items actually delivered)
CREATE TABLE IF NOT EXISTS alm_entregas (
  id             uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  requisicao_id  uuid    NOT NULL REFERENCES alm_requisicoes(id) ON DELETE CASCADE,
  insumo_id      uuid    REFERENCES alm_insumos(id) ON DELETE SET NULL,
  qty_entregue   numeric NOT NULL DEFAULT 0,
  entregue_em    timestamptz DEFAULT now(),
  entregue_por   text   -- gerente name
);

-- 7. Notifications for teachers
CREATE TABLE IF NOT EXISTS alm_notificacoes (
  id             uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id  uuid    REFERENCES professoras(id) ON DELETE CASCADE,
  requisicao_id  uuid    REFERENCES alm_requisicoes(id) ON DELETE CASCADE,
  mensagem       text    NOT NULL,
  lida           boolean DEFAULT false,
  criado_em      timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alm_reqs_prof   ON alm_requisicoes(professora_id);
CREATE INDEX IF NOT EXISTS idx_alm_reqs_status ON alm_requisicoes(status);
CREATE INDEX IF NOT EXISTS idx_alm_reqs_mes    ON alm_requisicoes(mes);
CREATE INDEX IF NOT EXISTS idx_alm_notif_prof  ON alm_notificacoes(professora_id, lida);
CREATE INDEX IF NOT EXISTS idx_alm_orc_turma   ON alm_orcamentos(turma_id, mes);
CREATE INDEX IF NOT EXISTS idx_alm_insumos_cat ON alm_insumos(categoria) WHERE ativo = true;
