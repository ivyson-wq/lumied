-- =====================================================
-- 073: Otimização DB — Fase 2
-- Consolidação de sessões, merge contratos, junction tables,
-- audit trail, FKs faltantes, cleanup
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- 1. CONSOLIDAR SESSÕES — tabela unificada
-- Adicionar suporte a 'admin' e 'aluno' na tabela sessoes
-- ═══════════════════════════════════════════════════════

-- Adicionar coluna usuario_tipo à tabela sessoes existente
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS usuario_tipo text DEFAULT 'gerente';
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em);
CREATE INDEX IF NOT EXISTS idx_sessoes_tipo ON sessoes(usuario_tipo);

-- Não migrar sessões legadas por enquanto (FK constraint para usuarios)
-- admin_sessoes e aluno_sessoes continuam funcionando independentemente
-- Migração completa será feita quando o código for adaptado

-- ═══════════════════════════════════════════════════════
-- 2. MERGE matricula_contratos → contratos
-- ═══════════════════════════════════════════════════════

-- Adicionar colunas faltantes em contratos para absorver matricula_contratos
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS template_html_merged text;

-- Migrar dados
INSERT INTO contratos (matricula_id, familia_email, dados_preenchidos, html_renderizado, status, criado_em)
SELECT mc.matricula_id,
       COALESCE(cm.email, ''),
       mc.dados_json,
       mc.template_html,
       mc.status,
       mc.criado_em
FROM matricula_contratos mc
LEFT JOIN crm_matriculas cm ON cm.id = mc.matricula_id
WHERE NOT EXISTS (
  SELECT 1 FROM contratos c WHERE c.matricula_id = mc.matricula_id
)
ON CONFLICT DO NOTHING;

-- Dropar tabela duplicada
DROP TABLE IF EXISTS matricula_contratos CASCADE;

-- ═══════════════════════════════════════════════════════
-- 3. NORMALIZAR JSONB — provas.questoes → junction table
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS provas_prova_questoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prova_id uuid NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  questao_id uuid NOT NULL REFERENCES provas_questoes(id) ON DELETE CASCADE,
  peso numeric DEFAULT 1.0,
  ordem integer DEFAULT 0,
  UNIQUE(prova_id, questao_id)
);
ALTER TABLE provas_prova_questoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ppq_prova ON provas_prova_questoes(prova_id);
CREATE INDEX IF NOT EXISTS idx_ppq_questao ON provas_prova_questoes(questao_id);

-- Migrar dados do JSONB para junction table
DO $$
DECLARE
  r RECORD;
  q JSONB;
  i INTEGER;
BEGIN
  FOR r IN SELECT id, questoes FROM provas WHERE questoes IS NOT NULL AND questoes != '[]'::jsonb LOOP
    i := 0;
    FOR q IN SELECT * FROM jsonb_array_elements(r.questoes) LOOP
      BEGIN
        INSERT INTO provas_prova_questoes (prova_id, questao_id, peso, ordem)
        VALUES (
          r.id,
          (q->>'questao_id')::uuid,
          COALESCE((q->>'peso')::numeric, 1.0),
          COALESCE((q->>'ordem')::integer, i)
        )
        ON CONFLICT (prova_id, questao_id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════
-- 4. NORMALIZAR JSONB — alm_requisicoes.itens → child table
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alm_requisicao_itens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requisicao_id uuid NOT NULL REFERENCES alm_requisicoes(id) ON DELETE CASCADE,
  insumo_id uuid REFERENCES alm_insumos(id) ON DELETE SET NULL,
  nome text NOT NULL,
  unidade text,
  qty_solicitado numeric NOT NULL DEFAULT 1,
  qty_aprovado numeric,
  preco_unit numeric,
  CONSTRAINT alm_req_item_qty CHECK (qty_solicitado > 0)
);
ALTER TABLE alm_requisicao_itens DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_alm_req_itens_req ON alm_requisicao_itens(requisicao_id);
CREATE INDEX IF NOT EXISTS idx_alm_req_itens_insumo ON alm_requisicao_itens(insumo_id);

-- Migrar dados do JSONB
DO $$
DECLARE
  r RECORD;
  item JSONB;
BEGIN
  FOR r IN SELECT id, itens FROM alm_requisicoes WHERE itens IS NOT NULL AND itens != '[]'::jsonb LOOP
    FOR item IN SELECT * FROM jsonb_array_elements(r.itens) LOOP
      BEGIN
        INSERT INTO alm_requisicao_itens (requisicao_id, insumo_id, nome, unidade, qty_solicitado, qty_aprovado, preco_unit)
        VALUES (
          r.id,
          CASE WHEN item->>'insumo_id' IS NOT NULL AND item->>'insumo_id' != '' THEN (item->>'insumo_id')::uuid ELSE NULL END,
          COALESCE(item->>'nome', 'Item'),
          item->>'unidade',
          COALESCE((item->>'qty')::numeric, (item->>'quantidade')::numeric, (item->>'qty_solicitado')::numeric, 1),
          CASE WHEN item->>'qty_aprovado' IS NOT NULL THEN (item->>'qty_aprovado')::numeric ELSE NULL END,
          CASE WHEN item->>'preco' IS NOT NULL THEN (item->>'preco')::numeric
               WHEN item->>'preco_unit' IS NOT NULL THEN (item->>'preco_unit')::numeric
               ELSE NULL END
        )
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════
-- 5. FKs FALTANTES
-- ═══════════════════════════════════════════════════════

-- rh_funcionarios.usuario_id → usuarios
DO $$ BEGIN
  ALTER TABLE rh_funcionarios ADD CONSTRAINT rh_func_usuario_fk
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;

-- pix_cobrancas.boleto_id (sem FK definida — boletos pode ser fin_boletos_emitidos ou boletos)
-- Não adicionamos FK aqui pois o nome da tabela de referência é ambíguo

-- ═══════════════════════════════════════════════════════
-- 6. AUDIT TRAIL — colunas *_por text → adicionar *_por_id uuid
-- ═══════════════════════════════════════════════════════

-- Adicionar colunas de ID (mantendo text por compatibilidade)
ALTER TABLE documentos_gerados ADD COLUMN IF NOT EXISTS gerado_por_id uuid;
ALTER TABLE boletins ADD COLUMN IF NOT EXISTS gerado_por_id uuid;
ALTER TABLE contabil_exportacoes ADD COLUMN IF NOT EXISTS gerado_por_id uuid;
ALTER TABLE pesquisas ADD COLUMN IF NOT EXISTS criado_por_id uuid;

-- ═══════════════════════════════════════════════════════
-- 7. CONFIG SINGLETON — garantir apenas 1 row
-- ═══════════════════════════════════════════════════════

ALTER TABLE notas_config ADD COLUMN IF NOT EXISTS singleton boolean DEFAULT true;
DO $$ BEGIN
  ALTER TABLE notas_config ADD CONSTRAINT notas_config_singleton UNIQUE (singleton);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE frequencia_config ADD COLUMN IF NOT EXISTS singleton boolean DEFAULT true;
DO $$ BEGIN
  ALTER TABLE frequencia_config ADD CONSTRAINT freq_config_singleton UNIQUE (singleton);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════
-- 8. CASCADING DELETES faltantes
-- ═══════════════════════════════════════════════════════

-- biblioteca_emprestimos → CASCADE on acervo delete
ALTER TABLE biblioteca_emprestimos DROP CONSTRAINT IF EXISTS biblioteca_emprestimos_acervo_id_fkey;
DO $$ BEGIN
  ALTER TABLE biblioteca_emprestimos ADD CONSTRAINT biblioteca_emprestimos_acervo_id_fkey
    FOREIGN KEY (acervo_id) REFERENCES biblioteca_acervo(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- transporte_rastreio → CASCADE on rota delete
ALTER TABLE transporte_rastreio DROP CONSTRAINT IF EXISTS transporte_rastreio_rota_id_fkey;
DO $$ BEGIN
  ALTER TABLE transporte_rastreio ADD CONSTRAINT transporte_rastreio_rota_id_fkey
    FOREIGN KEY (rota_id) REFERENCES transporte_rotas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- transporte_notificacoes → CASCADE on rota delete
ALTER TABLE transporte_notificacoes DROP CONSTRAINT IF EXISTS transporte_notificacoes_rota_id_fkey;
DO $$ BEGIN
  ALTER TABLE transporte_notificacoes ADD CONSTRAINT transporte_notificacoes_rota_id_fkey
    FOREIGN KEY (rota_id) REFERENCES transporte_rotas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ead_materiais → SET NULL on serie delete (materiais podem existir sem serie)
ALTER TABLE ead_materiais DROP CONSTRAINT IF EXISTS ead_materiais_serie_id_fkey;

-- ═══════════════════════════════════════════════════════
-- 9. SOFT DELETE — padronizar com coluna 'ativo'
-- ═══════════════════════════════════════════════════════

ALTER TABLE chat_conversas ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE agenda_registros ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE ead_aulas ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE regua_config ADD COLUMN IF NOT EXISTS deletado boolean DEFAULT false;

-- ═══════════════════════════════════════════════════════
-- 10. TRIGGERS atualizado_em em tabelas principais
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trigger_set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'familias','notas_lancamentos','frequencia_registros','pesquisas',
    'contratos','provas','provas_respostas','biblioteca_emprestimos',
    'ead_aulas','rh_funcionarios','loja_produtos','planos','escolas',
    'boletos','alunos','crm_leads'
  ]) LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS set_atualizado_em ON %I', t);
      EXECUTE format('CREATE TRIGGER set_atualizado_em BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em()', t);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════
-- 11. crm_turmas_vagas.serie → adicionar serie_id FK
-- ═══════════════════════════════════════════════════════

ALTER TABLE crm_turmas_vagas ADD COLUMN IF NOT EXISTS serie_id uuid REFERENCES series(id);
-- Popupar serie_id a partir do nome da serie
UPDATE crm_turmas_vagas tv SET serie_id = s.id
FROM series s WHERE s.nome = tv.serie AND tv.serie_id IS NULL;

ALTER TABLE config_series_idade ADD COLUMN IF NOT EXISTS serie_id uuid REFERENCES series(id);
UPDATE config_series_idade csi SET serie_id = s.id
FROM series s WHERE s.nome = csi.serie AND csi.serie_id IS NULL;

-- ═══════════════════════════════════════════════════════
-- 12. CLEANUP — colunas redundantes
-- ═══════════════════════════════════════════════════════

-- impressoes: professora_nome e turma_nome são redundantes (tem FK)
ALTER TABLE impressoes DROP COLUMN IF EXISTS professora_nome;
ALTER TABLE impressoes DROP COLUMN IF EXISTS turma_nome;
