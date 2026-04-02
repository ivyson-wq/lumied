-- =====================================================
-- 097: Responsável Financeiro da Conta
-- Todas as decisões financeiras passam por esta pessoa:
-- excedentes WhatsApp, upgrade/downgrade de tier,
-- compra de add-ons, contratação de extras
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- 1. RESPONSÁVEL FINANCEIRO POR ESCOLA
-- ═══════════════════════════════════════════════════════

ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_nome text;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_email text;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_telefone text;
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_cargo text DEFAULT 'Diretor(a) Financeiro(a)';
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS resp_financeiro_id uuid;  -- FK gerente que é o responsável

-- ═══════════════════════════════════════════════════════
-- 2. DECISÕES FINANCEIRAS (aprovação obrigatória)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS escola_decisoes_financeiras (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  -- Tipo de decisão
  tipo text NOT NULL,
    -- 'excedente_whatsapp'    → aprovar cobrança de msgs extras
    -- 'upgrade_tier'          → mudar para plano superior
    -- 'downgrade_tier'        → mudar para plano inferior
    -- 'addon_whatsapp'        → comprar pacote extra de msgs
    -- 'addon_storage'         → comprar storage extra
    -- 'addon_usuarios'        → comprar slots de usuários
    -- 'renovacao_contrato'    → renovar contrato anual
    -- 'cancelamento'          → cancelar assinatura
  -- Detalhes
  descricao text NOT NULL,
  valor_estimado numeric(10,2),               -- R$ estimado
  recorrente boolean DEFAULT false,           -- se é custo recorrente mensal
  -- Plano (para upgrade/downgrade)
  plano_atual text,                           -- slug do plano atual
  plano_solicitado text,                      -- slug do plano desejado
  -- Excedente (para WhatsApp)
  quantidade integer,                         -- msgs extras solicitadas
  preco_unitario numeric(10,2),               -- R$/msg
  -- Solicitante
  solicitado_por text NOT NULL,               -- nome de quem pediu
  solicitado_por_email text,
  solicitado_em timestamptz DEFAULT now(),
  -- Aprovação
  status text DEFAULT 'pendente',             -- 'pendente','aprovado','rejeitado','expirado'
  aprovado_por text,                          -- nome do resp financeiro
  aprovado_por_email text,
  aprovado_em timestamptz,
  motivo_rejeicao text,
  -- Notificações
  email_enviado boolean DEFAULT false,
  email_enviado_em timestamptz,
  lembrete_enviado boolean DEFAULT false,
  -- Execução
  executado boolean DEFAULT false,            -- se a ação foi aplicada após aprovação
  executado_em timestamptz,
  -- Metadata
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE escola_decisoes_financeiras DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_decisoes_escola ON escola_decisoes_financeiras(escola_id, status);
CREATE INDEX idx_decisoes_pendentes ON escola_decisoes_financeiras(escola_id) WHERE status = 'pendente';

-- ═══════════════════════════════════════════════════════
-- 3. PACOTES EXTRAS DISPONÍVEIS
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS escola_extras (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  nome text NOT NULL,
  descricao text,
  preco numeric(10,2) NOT NULL,
  recorrente boolean DEFAULT true,             -- mensal ou único
  unidade text,                                -- 'msgs','GB','usuarios'
  quantidade integer,                          -- por unidade de compra
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE escola_extras DISABLE ROW LEVEL SECURITY;

INSERT INTO escola_extras (slug, nome, descricao, preco, recorrente, unidade, quantidade) VALUES
('wa_100_msgs', 'Pacote 100 msgs WhatsApp', '100 templates WhatsApp extras por mês', 39.90, true, 'msgs', 100),
('wa_500_msgs', 'Pacote 500 msgs WhatsApp', '500 templates WhatsApp extras por mês', 149.90, true, 'msgs', 500),
('wa_1000_msgs', 'Pacote 1000 msgs WhatsApp', '1000 templates WhatsApp extras por mês', 249.90, true, 'msgs', 1000),
('storage_10gb', 'Storage Extra 10GB', '10GB de armazenamento adicional', 19.90, true, 'GB', 10),
('storage_50gb', 'Storage Extra 50GB', '50GB de armazenamento adicional', 79.90, true, 'GB', 50),
('usuarios_5', '5 Usuários Extras', '5 logins adicionais (professoras/secretárias)', 29.90, true, 'usuarios', 5),
('usuarios_20', '20 Usuários Extras', '20 logins adicionais', 89.90, true, 'usuarios', 20)
ON CONFLICT (slug) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- 4. EXTRAS CONTRATADOS POR ESCOLA
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS escola_extras_contratados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  extra_id uuid NOT NULL REFERENCES escola_extras(id),
  decisao_id uuid REFERENCES escola_decisoes_financeiras(id), -- decisão que aprovou
  quantidade integer DEFAULT 1,
  ativo boolean DEFAULT true,
  contratado_em timestamptz DEFAULT now(),
  cancelado_em timestamptz
);
ALTER TABLE escola_extras_contratados DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════
-- 5. ATUALIZAR FUNÇÃO DE ENVIO WHATSAPP — BLOQUEIO
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION wa_registrar_envio(
  p_escola_id uuid,
  p_tipo text DEFAULT 'template'
) RETURNS jsonb AS $$
DECLARE
  v_mes integer := EXTRACT(MONTH FROM NOW());
  v_ano integer := EXTRACT(YEAR FROM NOW());
  v_consumo wa_consumo_mensal;
  v_limite integer;
  v_extras_msgs integer;
  v_limite_total integer;
  v_pct numeric;
  v_bloqueado boolean;
  v_resultado jsonb;
BEGIN
  -- Upsert consumo mensal
  INSERT INTO wa_consumo_mensal (escola_id, mes, ano)
  VALUES (p_escola_id, v_mes, v_ano)
  ON CONFLICT (escola_id, mes, ano) DO NOTHING;

  -- Buscar consumo atual
  SELECT * INTO v_consumo FROM wa_consumo_mensal
  WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;

  -- Buscar limite do plano
  SELECT pl.limite INTO v_limite FROM plano_limites pl
  JOIN escolas e ON e.plano_id = pl.plano_id
  WHERE e.id = p_escola_id AND pl.recurso = 'wa_templates_mes';
  IF v_limite IS NULL THEN v_limite := 0; END IF;

  -- Somar extras contratados
  SELECT COALESCE(SUM(ee.quantidade * ec.quantidade), 0) INTO v_extras_msgs
  FROM escola_extras_contratados ec
  JOIN escola_extras ee ON ee.id = ec.extra_id
  WHERE ec.escola_id = p_escola_id AND ec.ativo = true AND ee.unidade = 'msgs';

  v_limite_total := v_limite + v_extras_msgs;

  -- BLOQUEIO: se atingiu 100% e é template, verificar se há aprovação pendente
  IF p_tipo = 'template' AND v_consumo.templates_enviados >= v_limite_total THEN
    -- Verificar se existe aprovação de excedente ativa
    PERFORM 1 FROM escola_decisoes_financeiras
    WHERE escola_id = p_escola_id
      AND tipo = 'excedente_whatsapp'
      AND status = 'aprovado'
      AND executado = true
      AND criado_em >= date_trunc('month', NOW());

    IF NOT FOUND THEN
      -- BLOQUEAR — criar solicitação se não existe
      PERFORM 1 FROM escola_decisoes_financeiras
      WHERE escola_id = p_escola_id
        AND tipo = 'excedente_whatsapp'
        AND status = 'pendente'
        AND criado_em >= date_trunc('month', NOW());

      IF NOT FOUND THEN
        INSERT INTO escola_decisoes_financeiras (
          escola_id, tipo, descricao, valor_estimado, recorrente,
          quantidade, preco_unitario,
          solicitado_por, solicitado_por_email, plano_atual
        )
        SELECT
          p_escola_id,
          'excedente_whatsapp',
          'Cota de ' || v_limite_total || ' mensagens WhatsApp atingida. Aprovar envio de mensagens extras a R$ ' || COALESCE(e.wa_preco_excedente, 0.50) || ' cada?',
          COALESCE(e.wa_preco_excedente, 0.50) * 50, -- estimativa de 50 msgs extras
          false,
          50,
          COALESCE(e.wa_preco_excedente, 0.50),
          'Sistema automático',
          e.resp_financeiro_email,
          p.slug
        FROM escolas e
        LEFT JOIN planos p ON p.id = e.plano_id
        WHERE e.id = p_escola_id;
      END IF;

      RETURN jsonb_build_object(
        'permitido', false,
        'bloqueado', true,
        'motivo', 'Cota de mensagens WhatsApp atingida. Aguardando aprovação do responsável financeiro.',
        'consumido', v_consumo.templates_enviados,
        'limite', v_limite_total,
        'percentual', 100
      );
    END IF;
  END IF;

  -- Incrementar contador
  IF p_tipo = 'template' THEN
    UPDATE wa_consumo_mensal SET
      templates_enviados = templates_enviados + 1,
      custo_templates = custo_templates + 0.35
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  ELSIF p_tipo = 'texto_livre' THEN
    UPDATE wa_consumo_mensal SET textos_livres_enviados = textos_livres_enviados + 1
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  ELSIF p_tipo = 'faq' THEN
    UPDATE wa_consumo_mensal SET faq_bot_consultas = faq_bot_consultas + 1, custo_ia = custo_ia + 0.002
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  ELSIF p_tipo = 'relatorio' THEN
    UPDATE wa_consumo_mensal SET relatorios_semanais = relatorios_semanais + 1, custo_ia = custo_ia + 0.001
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  END IF;

  -- Recalcular
  UPDATE wa_consumo_mensal SET
    custo_total = custo_templates + custo_ia,
    limite_templates = v_limite_total
  WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;

  -- Re-fetch
  SELECT * INTO v_consumo FROM wa_consumo_mensal
  WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;

  v_pct := CASE WHEN v_limite_total > 0 THEN (v_consumo.templates_enviados::numeric / v_limite_total) * 100 ELSE 0 END;

  -- Alertas 80% e 95%
  IF v_pct >= 80 AND NOT v_consumo.alerta_80_enviado THEN
    UPDATE wa_consumo_mensal SET alerta_80_enviado = true WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
    INSERT INTO wa_consumo_alertas (escola_id, tipo, mensagem, valor_consumido, limite, percentual)
    VALUES (p_escola_id, '80_pct', 'Sua escola atingiu 80% da cota mensal de WhatsApp (' || v_consumo.templates_enviados || '/' || v_limite_total || ').', v_consumo.templates_enviados, v_limite_total, v_pct);
  END IF;

  IF v_pct >= 95 AND NOT v_consumo.alerta_95_enviado THEN
    UPDATE wa_consumo_mensal SET alerta_95_enviado = true WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
    INSERT INTO wa_consumo_alertas (escola_id, tipo, mensagem, valor_consumido, limite, percentual)
    VALUES (p_escola_id, '95_pct', 'ATENÇÃO: 95% da cota de WhatsApp atingida (' || v_consumo.templates_enviados || '/' || v_limite_total || '). O envio será BLOQUEADO ao atingir 100% até aprovação do responsável financeiro.', v_consumo.templates_enviados, v_limite_total, v_pct);
  END IF;

  -- Excedente (se aprovado)
  IF v_consumo.templates_enviados > v_limite_total THEN
    UPDATE wa_consumo_mensal SET
      templates_excedentes = v_consumo.templates_enviados - v_limite_total,
      custo_excedente = (v_consumo.templates_enviados - v_limite_total) * COALESCE((SELECT wa_preco_excedente FROM escolas WHERE id = p_escola_id), 0.50)
    WHERE escola_id = p_escola_id AND mes = v_mes AND ano = v_ano;
  END IF;

  RETURN jsonb_build_object(
    'permitido', true,
    'bloqueado', false,
    'consumido', v_consumo.templates_enviados,
    'limite', v_limite_total,
    'percentual', round(v_pct, 1),
    'excedente', GREATEST(0, v_consumo.templates_enviados - v_limite_total)
  );
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════
-- 6. TRIGGERS
-- ═══════════════════════════════════════════════════════

CREATE TRIGGER escola_decisoes_atualizado
  BEFORE UPDATE ON escola_decisoes_financeiras
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();
