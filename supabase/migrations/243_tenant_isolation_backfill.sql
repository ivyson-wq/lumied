-- ═══════════════════════════════════════════════════════════════
--  Migration 243 — [P0] Tenant isolation: backfill + add escola_id
-- ═══════════════════════════════════════════════════════════════
-- Corrige vazamento cross-tenant demo↔maple descoberto em 16/04/2026.
-- Princípios:
--   1. ZERO DELETE. Só UPDATE/ALTER.
--   2. Backfill apenas quando evidência é 100% (email, FK, criado_em < demo).
--   3. Ambíguos ficam NULL para revisão humana.
--   4. NOT NULL será adicionado em migration separada após ambíguos resolvidos.
-- ═══════════════════════════════════════════════════════════════

-- IDs fixos (sanity check)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM escolas WHERE id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b') THEN
    RAISE EXCEPTION 'Maple Bear Caxias não encontrada no ID esperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM escolas WHERE id = 'e9b18a61-3894-4a7e-8024-eaf530420993') THEN
    RAISE EXCEPTION 'Demo Lumied não encontrada no ID esperado';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- PARTE A — UPDATE escola_id em tabelas que já têm a coluna
-- ────────────────────────────────────────────────────────────────

-- series: 3 "(Demo)" → demo; 11 pré-cutoff → maple
UPDATE series SET escola_id = 'e9b18a61-3894-4a7e-8024-eaf530420993'
  WHERE escola_id IS NULL AND nome ILIKE '%(demo)%';
UPDATE series SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';

-- professoras: email @caxias.maplebear OR pré-cutoff → maple; "(Demo)"/demo@ → demo
UPDATE professoras SET escola_id = 'e9b18a61-3894-4a7e-8024-eaf530420993'
  WHERE escola_id IS NULL AND (nome ILIKE '%(demo)%' OR email ILIKE '%demo@%');
UPDATE professoras SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND (email LIKE '%caxias.maplebear%' OR criado_em < '2026-04-15 17:00:10.914105+00');

-- alunos: 21 pré-cutoff → maple (0 ambíguos)
UPDATE alunos SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';

-- usuarios: email caxias OR pré-cutoff → maple
UPDATE usuarios SET escola_id = 'e9b18a61-3894-4a7e-8024-eaf530420993'
  WHERE escola_id IS NULL AND (nome ILIKE '%(demo)%' OR email ILIKE '%demo@%');
UPDATE usuarios SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND (email LIKE '%caxias.maplebear%' OR criado_em < '2026-04-15 17:00:10.914105+00');

-- gerentes: 1 órfão caxias.maplebear
UPDATE gerentes SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND email LIKE '%caxias.maplebear%';

-- secretarias: 3 órfãs caxias.maplebear
UPDATE secretarias SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND email LIKE '%caxias.maplebear%';

-- manutencoes: 12 pré-cutoff → maple; 1 ambíguo fica NULL
UPDATE manutencoes SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';

-- notas_config, notas_periodos, frequencia_config: sem criado_em confiável, ficam NULL para revisão humana

-- ────────────────────────────────────────────────────────────────
-- PARTE B — ADD COLUMN escola_id + backfill em tabelas sem a coluna
-- ────────────────────────────────────────────────────────────────

-- calendario_eventos: 70 pré-cutoff, 0 pós → tudo Maple
ALTER TABLE calendario_eventos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_calendario_eventos_escola ON calendario_eventos(escola_id);
UPDATE calendario_eventos SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b' WHERE escola_id IS NULL;

-- atividades: 7 pré-cutoff → Maple
ALTER TABLE atividades ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_atividades_escola ON atividades(escola_id);
UPDATE atividades SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b' WHERE escola_id IS NULL;

-- crm_matriculas: 210 registros, todos pré-cutoff; crm_leads está vazio → tudo Maple
ALTER TABLE crm_matriculas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_crm_matriculas_escola ON crm_matriculas(escola_id);
-- Primeiro tenta via FK
UPDATE crm_matriculas m SET escola_id = l.escola_id
  FROM crm_leads l WHERE m.lead_id = l.id AND m.escola_id IS NULL AND l.escola_id IS NOT NULL;
-- Restante (leads zerados) → Maple (únicos dados, pré-cutoff)
UPDATE crm_matriculas SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';

-- ausencias: 5 registros via email_resp → familias.email → escola_id
ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_ausencias_escola ON ausencias(escola_id);
UPDATE ausencias a SET escola_id = f.escola_id
  FROM familias f WHERE a.email_resp = f.email AND a.escola_id IS NULL;
-- Fallback: todas pré-cutoff → Maple
UPDATE ausencias SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';

-- boletos: 1 registro via CPF → familias.cpf
ALTER TABLE boletos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_boletos_escola ON boletos(escola_id);
UPDATE boletos b SET escola_id = f.escola_id
  FROM familias f WHERE b.cpf = f.cpf AND b.escola_id IS NULL;

-- alm_insumos: 152 pré → Maple; 12 pós (timestamp seed demo) → Demo
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_alm_insumos_escola ON alm_insumos(escola_id);
UPDATE alm_insumos SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';
UPDATE alm_insumos SET escola_id = 'e9b18a61-3894-4a7e-8024-eaf530420993'
  WHERE escola_id IS NULL AND criado_em = '2026-04-15 17:37:39.708696+00';

-- alm_requisicoes: 33 pré → Maple via FK; 11 pós (todas prof @caxias) → Maple
ALTER TABLE alm_requisicoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_alm_requisicoes_escola ON alm_requisicoes(escola_id);
-- Via professora primeiro (mais confiável)
UPDATE alm_requisicoes r SET escola_id = p.escola_id
  FROM professoras p WHERE r.professora_id = p.id AND r.escola_id IS NULL AND p.escola_id IS NOT NULL;
-- Via série (turma_id)
UPDATE alm_requisicoes r SET escola_id = s.escola_id
  FROM series s WHERE r.turma_id = s.id AND r.escola_id IS NULL AND s.escola_id IS NOT NULL;
-- Fallback pré-cutoff
UPDATE alm_requisicoes SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
  WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';

-- alm_orcamentos: via turma_id → series.escola_id
ALTER TABLE alm_orcamentos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_alm_orcamentos_escola ON alm_orcamentos(escola_id);
UPDATE alm_orcamentos o SET escola_id = s.escola_id
  FROM series s WHERE o.turma_id = s.id AND o.escola_id IS NULL AND s.escola_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- PARTE C — ADD COLUMN (só estrutura, sem backfill — estão vazias)
-- Previne inserts futuros sem escola_id
-- ────────────────────────────────────────────────────────────────

ALTER TABLE fin_mensalidades ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_fin_mensalidades_escola ON fin_mensalidades(escola_id);

ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_fin_boletos_emitidos_escola ON fin_boletos_emitidos(escola_id);

ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_diario_registros_escola ON diario_registros(escola_id);

ALTER TABLE frequencia_chamadas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_frequencia_chamadas_escola ON frequencia_chamadas(escola_id);

ALTER TABLE frequencia_registros ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_frequencia_registros_escola ON frequencia_registros(escola_id);

ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_mensagens_escola ON chat_mensagens(escola_id);

ALTER TABLE contratos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_contratos_escola ON contratos(escola_id);

ALTER TABLE boletins ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_boletins_escola ON boletins(escola_id);

ALTER TABLE autorizacoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_autorizacoes_escola ON autorizacoes(escola_id);

ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_agenda_itens_escola ON agenda_itens(escola_id);

-- ────────────────────────────────────────────────────────────────
-- PARTE D — Relatório final (sanity check)
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '───────── Mig 243 — resumo pós-backfill ─────────';
  FOR r IN
    SELECT 'series' t, COUNT(*) FILTER (WHERE escola_id IS NULL) null_, COUNT(*) total FROM series
    UNION ALL SELECT 'professoras', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM professoras
    UNION ALL SELECT 'alunos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alunos
    UNION ALL SELECT 'usuarios', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM usuarios
    UNION ALL SELECT 'gerentes', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM gerentes
    UNION ALL SELECT 'secretarias', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM secretarias
    UNION ALL SELECT 'manutencoes', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM manutencoes
    UNION ALL SELECT 'calendario_eventos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM calendario_eventos
    UNION ALL SELECT 'atividades', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM atividades
    UNION ALL SELECT 'crm_matriculas', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM crm_matriculas
    UNION ALL SELECT 'ausencias', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM ausencias
    UNION ALL SELECT 'boletos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM boletos
    UNION ALL SELECT 'alm_insumos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alm_insumos
    UNION ALL SELECT 'alm_requisicoes', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alm_requisicoes
    UNION ALL SELECT 'alm_orcamentos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alm_orcamentos
  LOOP
    RAISE NOTICE '  % — NULL: % / Total: %', r.t, r.null_, r.total;
  END LOOP;
END $$;
