-- =====================================================
-- 061: Régua de Cobrança Automática
-- =====================================================

CREATE TABLE IF NOT EXISTS regua_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evento text NOT NULL,                    -- 'lembrete_vencimento','pos_vencimento','negativacao'
  canal text NOT NULL,                     -- 'email','sms','whatsapp','carta'
  dias_offset integer NOT NULL,            -- D-5, D-1, D+1, D+15, D+30
  template_assunto text,
  template_corpo text,
  ativo boolean DEFAULT true,
  ordem integer DEFAULT 0,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(evento, canal, dias_offset)
);
ALTER TABLE regua_config DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS regua_execucoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id uuid REFERENCES regua_config(id),
  boleto_id uuid,
  familia_email text NOT NULL,
  canal text NOT NULL,
  status text DEFAULT 'enviado',           -- 'enviado','entregue','erro','bounce'
  erro_msg text,
  enviado_em timestamptz DEFAULT now()
);
ALTER TABLE regua_execucoes DISABLE ROW LEVEL SECURITY;

-- Seed: régua padrão
INSERT INTO regua_config (evento, canal, dias_offset, template_assunto, template_corpo, ordem) VALUES
  ('lembrete_vencimento', 'email', -5, 'Lembrete: mensalidade vence em 5 dias', 'Olá {{nome}}, sua mensalidade de R$ {{valor}} vence em {{data_vencimento}}.', 1),
  ('lembrete_vencimento', 'whatsapp', -1, NULL, 'Olá {{nome}}! Amanhã vence sua mensalidade de R$ {{valor}}. Evite juros pagando em dia.', 2),
  ('pos_vencimento', 'email', 1, 'Mensalidade em atraso', 'Olá {{nome}}, identificamos que sua mensalidade de R$ {{valor}} está em atraso desde {{data_vencimento}}.', 3),
  ('pos_vencimento', 'whatsapp', 3, NULL, 'Olá {{nome}}, sua mensalidade está em atraso há 3 dias. Valor: R$ {{valor}}. Regularize para evitar multa.', 4),
  ('pos_vencimento', 'email', 15, 'Urgente: mensalidade com 15 dias de atraso', 'Olá {{nome}}, sua mensalidade está com 15 dias de atraso. Entre em contato conosco.', 5),
  ('negativacao', 'email', 30, 'Aviso de negativação', 'Olá {{nome}}, informamos que seu débito de R$ {{valor}} será encaminhado para negativação.', 6)
ON CONFLICT (evento, canal, dias_offset) DO NOTHING;
