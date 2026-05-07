-- ═══════════════════════════════════════════════════════════════
--  Migration 282 — Fix storage.objects policies pra buckets privados
--
--  Smoke test pós-281 detectou: bucket manutencoes virou public=false
--  mas a policy "Allow public read" em storage.objects ainda incluía
--  manutencoes/atestados/documentos na whitelist. Resultado: arquivos
--  acessíveis sem signed URL via /object/public/*.
--
--  Fix: reescreve a policy pra incluir SÓ buckets que devem ficar
--  públicos (não-PII).
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow public read" ON storage.objects;

CREATE POLICY "Allow public read" ON storage.objects
  FOR SELECT
  USING (bucket_id = ANY (ARRAY[
    'agenda',
    'diplomas',
    'logos',
    'relatorios',
    'achados-perdidos',
    'instagram-posts'
  ]));

-- atestados, documentos, manutencoes, impressoes, boletos, wa-documentos:
--   removidos da whitelist; só acessíveis via signed URL pelos handlers.
