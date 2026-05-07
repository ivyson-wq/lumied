-- ═══════════════════════════════════════════════════════════════
--  Migration 285 — Normaliza strings double-encoded em escola_config
--
--  Bug original: chaves de cor (cor_primaria/cor_escura/cor_cream)
--  ficaram salvas como string JSONB *contendo* aspas dentro:
--    valor = "\"#C8102E\""   (jsonb)
--    extracted = "#C8102E"   (text com aspas literais)
--
--  lumied-delight.js fazia setProperty('--red', valor) → CSS variable
--  inválida → button caía no estilo nativo (cinza claro). Quem
--  reportou: caso "Novo Recurso" cinza+texto branco em Recursos &
--  Reservas (Maple Bear Caxias).
--
--  Fix do JS: lumied-delight.js comm be21ba7 — strip aspas + valida hex.
--  Este SQL: limpa o banco pra qualquer escola onde o problema persiste.
--  Idempotente: roda cada vez que aplicado, só ajusta o que precisa.
-- ═══════════════════════════════════════════════════════════════

-- Colunas/chaves comumente afetadas: armazenam strings que deveriam
-- ser hex/CSS values mas vieram double-encoded (provável upsert via
-- JSON.stringify duplo).
UPDATE escola_config
   SET valor = to_jsonb(trim(both '"' from valor #>> '{}'))
 WHERE valor #>> '{}' LIKE '"%"'
   AND chave IN (
     'cor_primaria', 'cor_escura', 'cor_cream', 'cor_light',
     'cor_secundaria', 'cor_terciaria',
     'escola_cor_primaria', 'escola_cor_secundaria',
     'theme_color', 'theme_primary'
   );
