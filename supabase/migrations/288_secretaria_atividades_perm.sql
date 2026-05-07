-- ═══════════════════════════════════════════════════════════════
--  Migration 288 — Permissões secretaria para atividades extras
--
--  Suporta novo botão "+ Nova inscrição" no painel de atividades.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('secretaria', 'atividades',     true, true),
  ('secretaria', 'historico_aluno', true, false)
ON CONFLICT (papel, modulo) DO UPDATE SET
  pode_ver = EXCLUDED.pode_ver,
  pode_editar = EXCLUDED.pode_editar;
