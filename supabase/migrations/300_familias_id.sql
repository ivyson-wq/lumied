-- ═══════════════════════════════════════════════════════════════
--  Migration 298 — familias.id (resolve ressalva LPR Fase 2)
--
--  Descoberta na Fase 2 do LPR: familias não tinha PK uuid,
--  só (cpf, atualizado_em, escola_id, ...). Várias actions do portal
--  família usavam `familia.id` em selects e joins que falhavam silenciosamente
--  (PostgREST retornava 400, JS client devolvia null em data, code path
--  retornava early com array vazio).
--
--  Esta migração adiciona id uuid PK + DEFAULT gen_random_uuid().
--  Tabelas dependentes (acesso_faces[responsavel], acesso_permissoes_retirada)
--  estavam vazias em produção (verificado), então sem necessidade de
--  backfill cruzado. Correção do call site de alunos.familia_id (que tampouco
--  existe na tabela) é feita no código (passa a usar familia_email).
-- ═══════════════════════════════════════════════════════════════

-- ADD COLUMN com DEFAULT preenche existentes via reescrita interna,
-- SEM disparar trigger trg_sync_familia_aluno (que ainda está quebrado por
-- conta da tenant isolation — não passa NEW.escola_id no INSERT em alunos.
-- Issue separada, não escopo desta mig).
ALTER TABLE familias
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

-- PK (idempotente — só adiciona se não houver PK ainda)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.familias'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE familias ADD CONSTRAINT familias_pkey PRIMARY KEY (id);
  END IF;
END $$;

COMMENT ON COLUMN familias.id IS 'PK uuid adicionada na mig 298. Antes a tabela tinha só chave natural (cpf+escola_id) e selects de id falhavam.';
