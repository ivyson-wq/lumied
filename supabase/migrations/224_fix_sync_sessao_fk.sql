-- ═══════════════════════════════════════════════════════
-- 224 — Fix FK violation em sync_sessao_to_legacy
--
-- Problema: trigger em 221 inseria em professora_sessoes/gerente_sessoes/
-- secretaria_sessoes usando NEW.usuario_id (= usuarios.id) como FK.
-- Mas tabelas legadas podem ter id != usuarios.id (há casos no banco onde
-- professoras/secretarias foram criadas antes da unificação e mantêm ID
-- próprio). A FK violation abortava toda a INSERT em `sessoes`.
-- Sintoma: unified_login retornava token mas sessão não existia → toda
-- chamada autenticada voltava 401 → frontend kickava pra login → LOOP.
--
-- Fix: resolver o ID real da tabela legada via lookup por email antes de
-- inserir. Se não existe linha legada, apenas pula (sessão fica em `sessoes`
-- e é validada via fallback).
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_sessao_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_papel text;
  v_papeis text[];
  v_email text;
  v_legacy_id uuid;
BEGIN
  SELECT papel, papeis, email INTO v_papel, v_papeis, v_email
  FROM usuarios WHERE id = NEW.usuario_id;
  v_papeis := COALESCE(v_papeis, ARRAY[v_papel]);

  -- gerente_sessoes
  IF v_papel IN ('gerente','diretor','financeiro')
     OR v_papeis && ARRAY['gerente','diretor','financeiro'] THEN
    SELECT id INTO v_legacy_id FROM gerentes WHERE email = v_email LIMIT 1;
    IF v_legacy_id IS NOT NULL THEN
      INSERT INTO gerente_sessoes (gerente_id, token, expira_em, criado_em)
      VALUES (v_legacy_id, NEW.token, NEW.expira_em, NEW.criado_em)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- professora_sessoes
  IF v_papel IN ('professora','professora_assistente','manutencao')
     OR v_papeis && ARRAY['professora','professora_assistente','manutencao'] THEN
    SELECT id INTO v_legacy_id FROM professoras WHERE email = v_email LIMIT 1;
    IF v_legacy_id IS NOT NULL THEN
      INSERT INTO professora_sessoes (professora_id, token, expira_em, criado_em)
      VALUES (v_legacy_id, NEW.token, NEW.expira_em, NEW.criado_em)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- secretaria_sessoes
  IF v_papel IN ('secretaria','comercial','financeiro','diretor','manutencao','impressao')
     OR v_papeis && ARRAY['secretaria','comercial','financeiro','diretor','manutencao','impressao'] THEN
    SELECT id INTO v_legacy_id FROM secretarias WHERE email = v_email LIMIT 1;
    IF v_legacy_id IS NOT NULL THEN
      INSERT INTO secretaria_sessoes (secretaria_id, token, expira_em, criado_em)
      VALUES (v_legacy_id, NEW.token, NEW.expira_em, NEW.criado_em)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
