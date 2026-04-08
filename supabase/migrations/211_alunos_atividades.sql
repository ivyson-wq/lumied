-- Migration 211: Add atividades extras columns to alunos table
-- Dashboard de atividades agora lê de alunos em vez de inscricoes_atividades

ALTER TABLE alunos ADD COLUMN IF NOT EXISTS atividades_ids uuid[];
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS turmas_selecionadas jsonb;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS almoco_dias jsonb;
