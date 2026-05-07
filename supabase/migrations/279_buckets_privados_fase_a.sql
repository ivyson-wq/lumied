-- ═══════════════════════════════════════════════════════════════
--  Migration 279 — Fase A: documentos + wa-documentos privados
--
--  Auditoria pós-278: tabelas alvo estão vazias em produção
--  (matricula_documentos=0, wa_documentos=0, acesso_faces=0,
--  acesso_permissoes_retirada=0, acesso_eventos=0). Backfill trivial,
--  zero risco de perder dados.
-- ═══════════════════════════════════════════════════════════════

-- Adiciona arquivo_path nas tabelas que usam
ALTER TABLE matricula_documentos      ADD COLUMN IF NOT EXISTS arquivo_path text;
ALTER TABLE wa_documentos              ADD COLUMN IF NOT EXISTS arquivo_path text;
ALTER TABLE acesso_faces               ADD COLUMN IF NOT EXISTS foto_path text;
ALTER TABLE acesso_permissoes_retirada ADD COLUMN IF NOT EXISTS responsavel_foto_path text;
ALTER TABLE acesso_eventos             ADD COLUMN IF NOT EXISTS foto_captura_path text;

-- Buckets privados
UPDATE storage.buckets SET public=false WHERE name IN ('documentos','wa-documentos');

-- Órfão de wa-documentos (1 obj sem registro relacionado): será limpo
-- via Storage API após esta migração (DELETE direto em storage.objects
-- é bloqueado por trigger storage.protect_delete()).
