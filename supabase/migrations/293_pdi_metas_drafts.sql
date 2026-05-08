-- ═══════════════════════════════════════════════════════════════
--  Migration 293 — Permite metas de PDI em rascunho com campos vazios
--
--  Antes: descricao/indicador/prazo eram NOT NULL — autosave parcial
--  do formulário de metas era impossível.
--  Agora: campos viram NULL-able. O submit final (pdi_metas_submit)
--  continua validando obrigatoriedade no app antes de fixar a versão.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE pdi_metas
  ALTER COLUMN descricao DROP NOT NULL,
  ALTER COLUMN indicador DROP NOT NULL,
  ALTER COLUMN prazo     DROP NOT NULL;
