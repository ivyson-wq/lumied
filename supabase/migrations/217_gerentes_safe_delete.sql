-- ═══════════════════════════════════════════════════════════════
--  Migration 217 — Gerentes: delete atômico mantendo pelo menos 1
--  Corrige race condition em gerentes_delete
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION gerentes_safe_delete(p_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  LOCK TABLE gerentes IN SHARE ROW EXCLUSIVE MODE;
  SELECT COUNT(*) INTO v_count FROM gerentes;
  IF v_count <= 1 THEN
    RETURN FALSE;
  END IF;
  DELETE FROM gerentes WHERE id = p_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
