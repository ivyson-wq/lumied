-- Migra o almoxarifado de alm_turmas para series
-- Drop FKs antigos
ALTER TABLE professoras DROP CONSTRAINT IF EXISTS professoras_alm_turma_id_fkey;
ALTER TABLE alm_orcamentos DROP CONSTRAINT IF EXISTS alm_orcamentos_turma_id_fkey;
ALTER TABLE alm_requisicoes DROP CONSTRAINT IF EXISTS alm_requisicoes_turma_id_fkey;

-- Renomeia coluna em professoras para serie_id
ALTER TABLE professoras RENAME COLUMN alm_turma_id TO serie_id;

-- Adiciona novas FKs para series
ALTER TABLE professoras
  ADD CONSTRAINT professoras_serie_id_fkey FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE SET NULL;
ALTER TABLE alm_orcamentos
  ADD CONSTRAINT alm_orcamentos_turma_id_fkey FOREIGN KEY (turma_id) REFERENCES series(id) ON DELETE CASCADE;
ALTER TABLE alm_requisicoes
  ADD CONSTRAINT alm_requisicoes_turma_id_fkey FOREIGN KEY (turma_id) REFERENCES series(id) ON DELETE SET NULL;
