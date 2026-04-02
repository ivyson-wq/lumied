-- =====================================================
-- 096: WhatsApp incluído nos tiers + travas de consumo
-- Automação+: WhatsApp Gateway incluído com cota
-- Rede: WhatsApp completo (Gateway + Departamental)
-- Alertas automáticos em 80% e 95% do consumo
-- =====================================================

-- ── Registrar módulos WhatsApp no catálogo ──────────
INSERT INTO modulos (slug, nome, descricao, icone, grupo, portais, ordem, ativo) VALUES
('whatsapp_gateway', 'WhatsApp Comunicação', 'Comunicação escola→família via WhatsApp: confirmações, FAQ bot, relatório semanal', '💬', 'comunicacao', ARRAY['gerente','pais'], 40, true),
('whatsapp_departamental', 'WhatsApp Atendimento', 'Atendimento por departamento via WhatsApp: menu, urgências, push comercial', '📱', 'comunicacao', ARRAY['gerente'], 41, true)
ON CONFLICT (slug) DO NOTHING;

-- ── Vincular aos planos ─────────────────────────────
-- Automação: Gateway incluído
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'automacao' AND m.slug = 'whatsapp_gateway'
ON CONFLICT DO NOTHING;

-- Avançado: Gateway incluído
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'avancado' AND m.slug = 'whatsapp_gateway'
ON CONFLICT DO NOTHING;

-- Rede: Gateway + Departamental
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'rede' AND m.slug IN ('whatsapp_gateway', 'whatsapp_departamental')
ON CONFLICT DO NOTHING;

-- ── Limites de mensagens WhatsApp por plano ─────────
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('wa_templates_mes', 200)        -- 200 templates/mês no Automação
) AS r(recurso, limite)
WHERE p.slug = 'automacao'
ON CONFLICT DO NOTHING;

INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('wa_templates_mes', 500)        -- 500 templates/mês no Avançado
) AS r(recurso, limite)
WHERE p.slug = 'avancado'
ON CONFLICT DO NOTHING;

INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('wa_templates_mes', 2000)       -- 2000 templates/mês no Rede
) AS r(recurso, limite)
WHERE p.slug = 'rede'
ON CONFLICT DO NOTHING;

-- ── Consumo mensal de WhatsApp por escola ───────────
CREATE TABLE IF NOT EXISTS wa_consumo_mensal (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  mes integer NOT NULL,
  ano integer NOT NULL,
  -- Contadores
  templates_enviados integer DEFAULT 0,
  textos_livres_enviados integer DEFAULT 0,   -- gratuitos (dentro da janela)
  faq_bot_consultas integer DEFAULT 0,
  relatorios_semanais integer DEFAULT 0,
  -- Custos
  custo_templates numeric(10,2) DEFAULT 0,    -- R$ (Meta API)
  custo_ia numeric(10,2) DEFAULT 0,           -- R$ (Anthropic)
  custo_total numeric(10,2) DEFAULT 0,
  -- Limites e alertas
  limite_templates integer,                    -- cota do plano
  alerta_80_enviado boolean DEFAULT false,
  alerta_95_enviado boolean DEFAULT false,
  bloqueado boolean DEFAULT false,             -- true quando excede 100%
  -- Excedente
  templates_excedentes integer DEFAULT 0,
  custo_excedente numeric(10,2) DEFAULT 0,    -- R$ 0,50/template excedente
  --
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, mes, ano)
);
ALTER TABLE wa_consumo_mensal DISABLE ROW LEVEL SECURITY;

-- ── Alertas de consumo enviados ─────────────────────
CREATE TABLE IF NOT EXISTS wa_consumo_alertas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id),
  tipo text NOT NULL,                          -- '80_pct','95_pct','100_pct','excedente'
  mensagem text NOT NULL,
  valor_consumido integer,
  limite integer,
  percentual numeric(5,2),
  email_enviado boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE wa_consumo_alertas DISABLE ROW LEVEL SECURITY;

-- ── Preço do excedente por template ─────────────────
-- Configurável por escola (default R$ 0,50)
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS wa_preco_excedente numeric(10,2) DEFAULT 0.50;

-- ── Trigger atualizado_em ───────────────────────────
CREATE TRIGGER wa_consumo_atualizado
  BEFORE UPDATE ON wa_consumo_mensal
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ── Função para registrar envio e verificar limites ─
CREATE OR REPLACE FUNCTION wa_registrar_envio(
  p_escola_id uuid,
  p_tipo text DEFAULT 'template'  -- 'template','texto_livre','faq','relatorio'
) RETURNS jsonb AS $$
DECLARE
  v_mes integer := EXTRACT(MONTH FROM NOW());
  v_ano integer := EXTRACT(YEAR FROM NOW());
  v_consumo wa_consumo_mensal;
  v_limite integer;
  v_pct numeric;
  v_resultado jsonb;
BEGIN
  -- Upsert consumo mensal
  INSERT INTO wa_consumo_mensal (escola_id, mes, ano)
  VALUES (p_escola_id, v_mes, v_ano)
  ON CONFLICT (escola_id, mes, ano) DO NOTHING;

  -- Incrementar contador
  IF p_tipo = 'template' THEN
    UPDATE wa_consumo_mensal SET templates_enviados = templates_enviados + 1,
      custo_templates = custo_templates + 0.35
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  ELSIF p_tipo = 'texto_livre' THEN
    UPDATE wa_consumo_mensal SET textos_livres_enviados = textos_livres_enviados + 1
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  ELSIF p_tipo = 'faq' THEN
    UPDATE wa_consumo_mensal SET faq_bot_consultas = faq_bot_consultas + 1,
      custo_ia = custo_ia + 0.002
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  ELSIF p_tipo = 'relatorio' THEN
    UPDATE wa_consumo_mensal SET relatorios_semanais = relatorios_semanais + 1,
      custo_ia = custo_ia + 0.001
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  END IF;

  -- Recalcular total
  UPDATE wa_consumo_mensal SET custo_total = custo_templates + custo_ia
  WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;

  -- Buscar consumo atualizado e limite
  SELECT * INTO v_consumo FROM wa_consumo_mensal
  WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;

  SELECT pl.limite INTO v_limite FROM plano_limites pl
  JOIN escolas e ON e.plano_id = pl.plano_id
  WHERE e.id = p_escola_id AND pl.recurso = 'wa_templates_mes';

  IF v_limite IS NULL THEN v_limite := 200; END IF;

  -- Atualizar limite no registro
  UPDATE wa_consumo_mensal SET limite_templates = v_limite
  WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;

  v_pct := (v_consumo.templates_enviados::numeric / v_limite) * 100;

  -- Verificar 80%
  IF v_pct >= 80 AND NOT v_consumo.alerta_80_enviado THEN
    UPDATE wa_consumo_mensal SET alerta_80_enviado = true
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
    INSERT INTO wa_consumo_alertas (escola_id, tipo, mensagem, valor_consumido, limite, percentual)
    VALUES (p_escola_id, '80_pct',
      'Sua escola atingiu 80% da cota mensal de mensagens WhatsApp (' || v_consumo.templates_enviados || '/' || v_limite || '). Considere reduzir o envio de templates ou entrar em contato para aumentar a cota.',
      v_consumo.templates_enviados, v_limite, v_pct);
  END IF;

  -- Verificar 95%
  IF v_pct >= 95 AND NOT v_consumo.alerta_95_enviado THEN
    UPDATE wa_consumo_mensal SET alerta_95_enviado = true
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
    INSERT INTO wa_consumo_alertas (escola_id, tipo, mensagem, valor_consumido, limite, percentual)
    VALUES (p_escola_id, '95_pct',
      'ATENÇÃO: Sua escola está em 95% da cota mensal de WhatsApp (' || v_consumo.templates_enviados || '/' || v_limite || '). Mensagens excedentes serão cobradas a R$ 0,50 cada.',
      v_consumo.templates_enviados, v_limite, v_pct);
  END IF;

  -- Verificar 100% (não bloqueia, mas cobra excedente)
  IF v_consumo.templates_enviados > v_limite THEN
    UPDATE wa_consumo_mensal SET
      templates_excedentes = v_consumo.templates_enviados - v_limite,
      custo_excedente = (v_consumo.templates_enviados - v_limite) * COALESCE((SELECT wa_preco_excedente FROM escolas WHERE id = p_escola_id), 0.50)
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  END IF;

  v_resultado := jsonb_build_object(
    'permitido', true,
    'consumido', v_consumo.templates_enviados,
    'limite', v_limite,
    'percentual', round(v_pct, 1),
    'excedente', GREATEST(0, v_consumo.templates_enviados - v_limite)
  );

  RETURN v_resultado;
END;
$$ LANGUAGE plpgsql;

-- ── Atualizar preços dos planos (WhatsApp incluído) ─
-- Automação: +R$ 80 (absorve custo WhatsApp básico)
UPDATE planos SET preco_mensal = 1249, preco_anual = 999
WHERE slug = 'automacao';

-- Avançado: +R$ 100
UPDATE planos SET preco_mensal = 1659, preco_anual = 1327
WHERE slug = 'avancado';

-- Rede: +R$ 150 (WhatsApp completo)
UPDATE planos SET preco_mensal = 2099, preco_anual = 1679
WHERE slug = 'rede';
