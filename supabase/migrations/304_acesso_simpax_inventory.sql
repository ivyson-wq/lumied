-- ═══════════════════════════════════════════════════════════════
--  Migration 304 — Inventário Simpax / catálogo de terminais Face
--
--  Enriquece acesso_dispositivos com metadata vinda do export do
--  Simpax (Terminal.csv): serial real, lado, modelo detalhado,
--  agrupamento pra mapa visual, e snapshot do último estado externo.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE acesso_dispositivos
  ADD COLUMN IF NOT EXISTS serial_externo text,
  ADD COLUMN IF NOT EXISTS lado text CHECK (lado IS NULL OR lado IN ('esquerdo','direito')),
  ADD COLUMN IF NOT EXISTS modelo_detalhe text,
  ADD COLUMN IF NOT EXISTS grupo_mapa text,
  ADD COLUMN IF NOT EXISTS simpax_meta jsonb,
  ADD COLUMN IF NOT EXISTS simpax_ultima_sincronia timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_acesso_disp_serial_externo
  ON acesso_dispositivos(serial_externo)
  WHERE serial_externo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acesso_disp_grupo_mapa
  ON acesso_dispositivos(grupo_mapa)
  WHERE grupo_mapa IS NOT NULL;

COMMENT ON COLUMN acesso_dispositivos.serial_externo IS 'Serial/MAC reportado pelo Simpax (ex 4408801109358150). Chave de UPSERT do importer.';
COMMENT ON COLUMN acesso_dispositivos.lado IS 'esquerdo|direito|null — útil pra distinguir pares (ex Entrada Responsável esq/dir).';
COMMENT ON COLUMN acesso_dispositivos.modelo_detalhe IS 'Modelo refinado do Simpax: ControliD idFace Acesso, ControliD idBlock, SiMPAX Mobile/Integra Box/Geoloc/Cadastrador.';
COMMENT ON COLUMN acesso_dispositivos.grupo_mapa IS 'Agrupamento na grade visual: entrada_resp, saida_infantil, catraca_entrada, catraca_saida, entrada_fundamental, app_mobile.';
COMMENT ON COLUMN acesso_dispositivos.simpax_meta IS 'Snapshot do export Simpax: ultimo_registro, ultima_comunicacao, total_registros, atestado_tecnico, exige_bio, contratante, refeitorio, possui_atualizacao.';
COMMENT ON COLUMN acesso_dispositivos.simpax_ultima_sincronia IS 'Quando o último import CSV rodou.';

-- ────────────────────────────────────────────────────────────────
--  View materializada lógica pro mapa (não materializada física —
--  só syntactic sugar pra queries do front):
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_acesso_dispositivos_mapa AS
SELECT
  d.id,
  d.escola_id,
  d.nome,
  d.tipo,
  d.localizacao,
  d.modelo,
  d.modelo_detalhe,
  d.lado,
  d.grupo_mapa,
  d.serial_externo,
  d.ativo,
  d.simpax_meta,
  d.simpax_ultima_sincronia,
  (d.simpax_meta->>'ultimo_registro')::timestamptz AS ultimo_registro,
  (d.simpax_meta->>'ultima_comunicacao')::timestamptz AS ultima_comunicacao,
  COALESCE((d.simpax_meta->>'total_registros')::int, 0) AS total_registros,
  CASE
    WHEN NOT d.ativo THEN 'inativo'
    WHEN (d.simpax_meta->>'ultimo_registro') IS NULL THEN 'sem_dados'
    WHEN (d.simpax_meta->>'ultimo_registro')::timestamptz > now() - interval '2 days' THEN 'ok'
    WHEN (d.simpax_meta->>'ultimo_registro')::timestamptz > now() - interval '7 days' THEN 'lento'
    ELSE 'mudo'
  END AS status_mapa
FROM acesso_dispositivos d;

COMMENT ON VIEW v_acesso_dispositivos_mapa IS 'Devices Face/RFID com status derivado para a grade visual. ok=últ. registro <2d, lento=2-7d, mudo=>7d, sem_dados=nunca, inativo=desativado.';
