-- ══════════════════════════════════════════════════════════════
--  315 — Desabilita módulo webauthn (login biométrico) globalmente
--  Remove dos planos e força override false para todas as escolas.
--  Re-habilitar via admin.html > Módulos > toggle webauthn.
--  Frontend (gerente.html, professora.html) agora verifica módulo
--  antes de mostrar o botão de login biométrico.
-- ══════════════════════════════════════════════════════════════

DELETE FROM plano_modulos
WHERE modulo_id = (SELECT id FROM modulos WHERE slug = 'webauthn');

UPDATE escola_modulos
SET habilitado = false
WHERE modulo_id = (SELECT id FROM modulos WHERE slug = 'webauthn');
