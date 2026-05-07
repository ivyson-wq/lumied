-- ═══════════════════════════════════════════════════════════════
--  Migration 273 — Índices pra telas reportadas como lentas
--  (manutencoes, inscrições em atividades, alunos por turno)
-- ═══════════════════════════════════════════════════════════════

-- ── Manutenções: lista escola_id + ordenação por urgencia/criado_em
-- Mig 256 já criou idx em escola_id e usuario_id; falta o composto que
-- evita o table scan + sort manual quando o gerente lista as últimas.
CREATE INDEX IF NOT EXISTS idx_manutencoes_escola_status_data
  ON manutencoes(escola_id, status, criado_em DESC);

-- Versão parcial pros chamados ABERTOS (mais hot que a lista geral)
CREATE INDEX IF NOT EXISTS idx_manutencoes_abertas
  ON manutencoes(escola_id, criado_em DESC)
  WHERE status NOT IN ('concluida', 'rejeitada');

-- ── Inscrições em atividades extras: tabela "alunos" filtrada por
-- atividades_ids IS NOT NULL. Sem índice parcial, sequential scan da
-- escola inteira. Com filhos da escola crescendo, isso vai ficando caro.
CREATE INDEX IF NOT EXISTS idx_alunos_atividades_partial
  ON alunos(escola_id, nome)
  WHERE atividades_ids IS NOT NULL;

-- ── Turnos: alunos ativos por escola + turno (tela "Turnos & Horários")
-- O ORDER BY nome em cima de tabela sem composite escola+nome obriga
-- sort em memória; com 1k+ alunos isso pesa.
CREATE INDEX IF NOT EXISTS idx_alunos_escola_ativo_nome
  ON alunos(escola_id, ativo, nome) WHERE ativo IS NOT FALSE;

-- ── Atividades extras (turmas + dias): consultas que filtram por
-- atividade_id (texto/uuid). Garantia de cobertura.
CREATE INDEX IF NOT EXISTS idx_alunos_atividades_ids_gin
  ON alunos USING gin (atividades_ids)
  WHERE atividades_ids IS NOT NULL;
