-- ═══════════════════════════════════════════════════════════════
--  Migration 216 — Biblioteca: empréstimo/devolução atômicos
--  Corrige race condition em biblioteca_acervo.disponivel
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION biblioteca_emprestar(p_acervo_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  UPDATE biblioteca_acervo
     SET disponivel = disponivel - 1
   WHERE id = p_acervo_id
     AND disponivel > 0
  RETURNING TRUE INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION biblioteca_devolver(p_acervo_id UUID) RETURNS VOID AS $$
BEGIN
  UPDATE biblioteca_acervo
     SET disponivel = disponivel + 1
   WHERE id = p_acervo_id;
END;
$$ LANGUAGE plpgsql;
