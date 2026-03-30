-- =====================================================
-- 052: Documentos do Aluno
-- =====================================================

CREATE TABLE IF NOT EXISTS documentos_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text UNIQUE NOT NULL,          -- 'historico','declaracao_matricula','declaracao_transferencia','ficha_individual'
  nome text NOT NULL,
  template_html text NOT NULL,        -- HTML com variáveis {{aluno_nome}}, {{serie}}, etc.
  variaveis jsonb DEFAULT '[]'::jsonb, -- lista de variáveis disponíveis
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE documentos_templates DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS documentos_gerados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  aluno_nome text NOT NULL,
  tipo text NOT NULL,
  dados_json jsonb,                    -- dados usados para preencher o template
  pdf_url text,                        -- URL do PDF gerado (Supabase Storage)
  gerado_por text,
  gerado_em timestamptz DEFAULT now()
);
ALTER TABLE documentos_gerados DISABLE ROW LEVEL SECURITY;

-- Seed: templates básicos
INSERT INTO documentos_templates (tipo, nome, template_html, variaveis) VALUES
  ('declaracao_matricula', 'Declaração de Matrícula',
   '<div style="font-family:serif;max-width:700px;margin:40px auto;padding:40px;">
<div style="text-align:center;margin-bottom:40px;">
<h2 style="margin:0;">MAPLE BEAR CAXIAS DO SUL</h2>
<p style="margin:4px 0;font-size:12px;">CNPJ: 44.034.235/0001-70</p>
</div>
<h3 style="text-align:center;margin-bottom:30px;">DECLARAÇÃO DE MATRÍCULA</h3>
<p style="line-height:2;text-align:justify;">Declaramos, para os devidos fins, que <strong>{{aluno_nome}}</strong>, está devidamente matriculado(a) neste estabelecimento de ensino, na série <strong>{{serie}}</strong>, no ano letivo de <strong>{{ano}}</strong>.</p>
<p style="line-height:2;text-align:justify;">Responsável: <strong>{{responsavel_nome}}</strong></p>
<br><br>
<p style="text-align:right;">Caxias do Sul, {{data_extenso}}</p>
<br><br><br>
<div style="text-align:center;border-top:1px solid #000;width:300px;margin:0 auto;padding-top:8px;">Secretaria Escolar</div>
</div>',
   '["aluno_nome","serie","ano","responsavel_nome","data_extenso"]'::jsonb),

  ('declaracao_transferencia', 'Declaração de Transferência',
   '<div style="font-family:serif;max-width:700px;margin:40px auto;padding:40px;">
<div style="text-align:center;margin-bottom:40px;">
<h2 style="margin:0;">MAPLE BEAR CAXIAS DO SUL</h2>
<p style="margin:4px 0;font-size:12px;">CNPJ: 44.034.235/0001-70</p>
</div>
<h3 style="text-align:center;margin-bottom:30px;">DECLARAÇÃO DE TRANSFERÊNCIA</h3>
<p style="line-height:2;text-align:justify;">Declaramos que <strong>{{aluno_nome}}</strong>, que cursava a série <strong>{{serie}}</strong> neste estabelecimento de ensino, está sendo transferido(a) a pedido do(a) responsável <strong>{{responsavel_nome}}</strong>.</p>
<p style="line-height:2;">Nada consta em seus registros que o(a) desabone.</p>
<br><br>
<p style="text-align:right;">Caxias do Sul, {{data_extenso}}</p>
<br><br><br>
<div style="text-align:center;border-top:1px solid #000;width:300px;margin:0 auto;padding-top:8px;">Secretaria Escolar</div>
</div>',
   '["aluno_nome","serie","responsavel_nome","data_extenso"]'::jsonb),

  ('ficha_individual', 'Ficha Individual do Aluno',
   '<div style="font-family:serif;max-width:700px;margin:40px auto;padding:40px;">
<div style="text-align:center;margin-bottom:30px;">
<h2 style="margin:0;">MAPLE BEAR CAXIAS DO SUL</h2>
<h3>FICHA INDIVIDUAL DO ALUNO</h3>
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr><td style="border:1px solid #ccc;padding:8px;width:30%;font-weight:bold;">Aluno:</td><td style="border:1px solid #ccc;padding:8px;">{{aluno_nome}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;font-weight:bold;">Série:</td><td style="border:1px solid #ccc;padding:8px;">{{serie}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;font-weight:bold;">Ano:</td><td style="border:1px solid #ccc;padding:8px;">{{ano}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;font-weight:bold;">Responsável:</td><td style="border:1px solid #ccc;padding:8px;">{{responsavel_nome}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;font-weight:bold;">Email:</td><td style="border:1px solid #ccc;padding:8px;">{{email}}</td></tr>
</table>
<h4>Notas e Frequência</h4>
<p>{{notas_resumo}}</p>
</div>',
   '["aluno_nome","serie","ano","responsavel_nome","email","notas_resumo"]'::jsonb)
ON CONFLICT (tipo) DO NOTHING;
