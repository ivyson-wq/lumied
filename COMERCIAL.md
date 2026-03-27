# Portal de Gestao Escolar — Apresentacao Comercial

Sistema completo de gestao escolar em nuvem. Portais dedicados para pais, professoras, secretaria e gestao. Personalizavel com as cores e identidade visual da sua escola. Funciona em qualquer dispositivo — computador, tablet ou celular.

---

## Portais

### Portal dos Pais
Acesso pelo celular ou computador. Interface simples e intuitiva.

- Login seguro com Google, e-mail ou biometria (Face ID / impressao digital)
- Solicitacao de mudanca de turno com precos e horarios
- Inscricao em atividades extracurriculares com deteccao de conflito de horarios
- Visualizacao de boletos e status de pagamento
- Aviso "Estou a Caminho" com localizacao em tempo real para busca de alunos
- Agenda da crianca com registro de ausencias
- Achados & Perdidos — visualizacao de itens encontrados na escola
- Instalavel como app no celular (PWA)
- Login biometrico automatico (Face ID, impressao digital)

### Portal das Professoras
Ferramentas do dia a dia para o corpo docente.

- Annual Growth Plan (Plano de Desenvolvimento Individual) por aluno
- Upload e ranking de diplomas/certificacoes
- Envio de atestados medicos com fluxo de aprovacao
- Requisicao de materiais do almoxarifado com orcamento por turma
- Solicitacao de impressoes com cota mensal
- Registro de chamados de manutencao
- Registro de achados & perdidos com foto
- Notificacoes em tempo real (aprovacoes, rejeicoes, feedbacks)
- Login biometrico

### Portal da Secretaria
Fluxo administrativo simplificado.

- Validacao de atestados medicos
- Notificacoes de novos atestados pendentes
- Login biometrico

### Painel do Gerente
Centro de controle completo da escola.

- Dashboard analitico com metricas em tempo real
- Gestao de turnos — dashboard, series, estatisticas, exportacao PDF
- Gestao de atividades extracurriculares — CRUD, vagas, inscricoes
- Gestao de equipe — professoras, secretarias, atribuicao de turmas
- Controle de acesso de familias — aprovacao, importacao Excel, exportacao CSV
- Calendario escolar — CRUD de eventos
- Alertas de emergencia (incendio, lockdown, evacuacao, abrigo)
- Relatorios exportaveis em PDF e compartilhaveis via WhatsApp
- Notificacoes unificadas de todos os modulos

---

## Modulos (ativaveis por escola)

Cada escola escolhe quais modulos utilizar. Modulos desativados ficam completamente ocultos.

### Almoxarifado
Controle completo de suprimentos escolares.

- Catalogo de insumos com categorias configuraveis
- Fracionamento automatico (preco por embalagem vs preco unitario)
- Requisicao de materiais pelas professoras com limite de orcamento por turma
- Aprovacao pelo gerente com busca automatica de precos em 5 plataformas:
  - Mercado Livre, Shopee, Zoom, Reval, Amazon
- Encaminhamento automatico para compra com link direto ao carrinho
- Controle de estoque com entrada e saida
- Importacao de insumos via planilha Excel
- Entrada de materiais via XML de nota fiscal (NF-e)
  - Leitura automatica de NF-e padrao SEFAZ
  - Deteccao automatica de fornecedor (Mercado Livre, etc.)
  - Match inteligente com catalogo existente
  - Atualizacao automatica de estoque e precos
- Historico completo de precos com graficos
- Integracao OAuth com Mercado Livre para precos em tempo real
- Orcamento mensal por turma com acompanhamento visual
- Relatorio de gastos por turma vs orcamento

### CRM (Gestao de Leads e Matriculas)
Pipeline comercial completo para captacao de alunos.

- Kanban drag-and-drop com estagios configuraveis
  - Novo Lead > Primeiro Contato > Visita Agendada > Visita Realizada > Proposta > Negociacao > Matricula Fechada
- Formulario de leads com calculo automatico de serie por data de nascimento
- Historico de interacoes por lead (ligacoes, WhatsApp, emails, visitas)
- Templates de WhatsApp por categoria com variaveis dinamicas
- Extensao Chrome para WhatsApp Web — envio de templates direto no chat
- Agendamento de reunioes com integracao Google Calendar
- Gestao de vagas por serie/ano com barra de ocupacao visual
- Matriculas e reservas — transferencia automatica de dados do lead
- Configuracao de faixas etarias por serie (meses, data de corte, ano referencia)
- Replicacao de series entre anos letivos

### Financeiro
Controle financeiro completo da escola.

- Dashboard com receitas vs despesas e saldo mensal
- Lancamentos financeiros (receitas e despesas) com plano de contas
- Gestao de mensalidades
- DRE — Demonstracao do Resultado do Exercicio com breakdown mensal
- Balanco Patrimonial (Ativo, Passivo, Patrimonio Liquido)
- Conciliacao bancaria com auto-matching de extratos
- Emissao de boletos via Banco Inter (integracao API)
- Consulta de pagamentos em tempo real

### Manutencao e Infraestrutura
Gestao de chamados e equipes de manutencao.

- Abertura de chamados pelas professoras com descricao e local
- Equipes de manutencao configuraveis
- Relatorio por equipe com envio via WhatsApp
- Achados & Perdidos com publicacao automatica apos 12h

### Impressoes
Controle de impressoes com cotas.

- Solicitacao de impressoes pelas professoras
- Cota mensal configuravel por turma
- Aprovacao/rejeicao pelo gerente

### Calendario Escolar
Agenda de eventos da escola.

- CRUD de eventos com datas e descricoes
- Visualizacao por mes

### Emergencia
Sistema de alertas para situacoes criticas.

- Tipos: incendio, lockdown, evacuacao, abrigo no local
- Alerta instantaneo para todos os portais
- Multilingue (portugues e ingles)

### Pickup (Estou a Caminho)
Aviso de chegada dos pais para busca de alunos.

- Pai envia aviso pelo app com um toque
- Escola recebe alerta em tempo real
- Deteccao automatica de chegada por GPS (raio configuravel)
- Historico de avisos do dia

### Boletos
Visualizacao e gestao de boletos.

- Sincronizacao automatica com Banco Inter
- Status em tempo real: pago, em aberto, vencido
- Visualizacao no portal dos pais

### Atividades Extracurriculares
Gestao completa de atividades extracurriculares.

- Cadastro de atividades com turmas, horarios, vagas e precos
- Inscricao pelo portal dos pais com deteccao de conflito de horarios
- Dashboard com ocupacao por atividade
- Opcao de almoco por turma

### Turnos
Gestao de turnos e solicitacoes.

- Configuracao de turnos com precos (integral, semi-integral, tarde, diaria)
- Solicitacao de mudanca de turno pelo portal dos pais
- Dashboard com estatisticas e distribuicao por turno
- Exportacao de relatorios em PDF

---

## Diferenciais Tecnicos

### Personalizacao Completa
- Nome, cores, logotipo e icone da escola — tudo configuravel
- Cada escola tem sua propria identidade visual em todos os portais
- Modulos ativaveis individualmente conforme a necessidade

### Seguranca
- Login biometrico (Face ID, impressao digital) em todos os portais
- Autenticacao Google OAuth para pais
- Sistema de sessoes com expiracao automatica para equipe
- Controle de acesso — familias precisam ser autorizadas para acessar o portal
- Painel de administracao com acesso restrito por autenticacao Google

### Multi-plataforma
- Funciona em qualquer navegador (Chrome, Safari, Firefox, Edge)
- Layout responsivo — desktop, tablet e celular
- Sidebar no desktop, navegacao inferior no celular
- Instalavel como app (PWA) no Android e iOS
- Extensao Chrome para WhatsApp Web (CRM)

### Integracoes
- **Google**: OAuth (login), Calendar (reunioes), Maps (localizacao)
- **Banco Inter**: emissao de boletos, consulta de pagamentos, webhooks
- **Mercado Livre**: busca de precos de insumos, OAuth
- **Resend**: envio de emails transacionais com dominio proprio
- **WhatsApp**: compartilhamento de relatorios, templates CRM via extensao Chrome
- **Shopee, Amazon, Zoom, Reval**: busca comparativa de precos

### Dados e Relatorios
- Exportacao em PDF com compartilhamento via WhatsApp
- Importacao de dados via Excel (familias, insumos, requisicoes)
- Importacao de notas fiscais via XML (NF-e)
- Exportacao de familias em CSV
- Historico completo de precos de insumos
- DRE, Balanco Patrimonial, Conciliacao Bancaria

---

## Planos Sugeridos

### Essencial
Para escolas que precisam do basico.

Modulos incluidos:
- Portal dos Pais (login, turnos, atividades)
- Painel do Gerente (dashboard, series, atividades, equipe, familias)
- Calendario Escolar
- Controle de Acesso

### Profissional
Para escolas que querem gestao completa.

Tudo do Essencial, mais:
- Almoxarifado completo
- CRM com Kanban e templates WhatsApp
- Portal das Professoras (Growth Plan, atestados, diplomas)
- Portal da Secretaria
- Impressoes
- Manutencao e Infraestrutura
- Achados & Perdidos
- Pickup (Estou a Caminho)
- Emergencia
- Boletos

### Completo
Para escolas que querem tudo.

Tudo do Profissional, mais:
- Modulo Financeiro completo (DRE, Balanco, Conciliacao)
- Emissao de boletos via Banco Inter
- Busca automatica de precos (5 plataformas)
- Integracao Mercado Livre OAuth
- Importacao XML/NF-e
- Extensao Chrome para WhatsApp (CRM)
- Google Calendar integrado

---

## Numeros do Sistema

| Metrica | Valor |
|---------|-------|
| Portais | 4 (pais, professoras, secretaria, gerente) + admin |
| Modulos ativaveis | 14 |
| Tabelas no banco | 30+ |
| Edge Functions | 7 |
| Integracoes externas | 6 (Google, Inter, ML, Resend, WhatsApp, Shopee) |
| Plataformas de busca de preco | 5 |
| Tipos de login | 5 (email/senha, Google, Magic Link, Face ID, fingerprint) |
| Tipos de exportacao | 4 (PDF, Excel, CSV, WhatsApp) |
| Tipos de importacao | 3 (Excel, CSV, XML NF-e) |
