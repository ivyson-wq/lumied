# CLAUDE.md — Maple Bear RS Portal

## Visão Geral do Projeto

Portal web para pais/responsáveis, professoras, secretaria e gerência da escola Maple Bear Caxias do Sul (CNPJ 44.034.235/0001-70).
Domínio: `app.maplebearcaxiasdosul.com.br`

**Stack:**
- Frontend: HTML/CSS/JS puro (sem framework), hospedado no **Vercel** (deploy via `npx vercel --yes --prod --name maple-bear-rs`)
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Render** (para chamadas à API do Banco Inter) — `https://inter-relay-maple-bear-rs.onrender.com`
- Chrome Extension: Manifest V3 para WhatsApp Web (templates CRM)
- Git: GitHub (`ivyson-wq/maple-bear-rs`)

**Arquivos principais:**
- `index.html` — Portal do pai/responsável
- `gerente.html` — Painel da gerência (~6500+ linhas)
- `professora.html` — Portal das professoras
- `secretaria.html` — Portal da secretaria
- `area-restrita.html` — Hub de acesso aos portais staff
- `webauthn-client.js` — Helper WebAuthn/Passkeys para biometria
- `ml-conectado.html` — Página de sucesso OAuth do Mercado Livre
- `api/boletos-sync.js` — Vercel API Route (delega para Edge Function `boletos-list`)
- `sw.js` — Service Worker para PWA
- `chrome-extension/` — Extensão WhatsApp Web (manifest.json, popup.html, content.js, content.css)
- `.github/workflows/auto-merge-claude.yml` — Auto-merge de branches Claude

**Edge Functions Supabase** (deploy via `supabase functions deploy <nome> --no-verify-jwt`):
- `diplomas` — Função principal: pickup, almoxarifado, PDI (Annual Growth Plan), diplomas, professoras, secretaria, achados e perdidos, WebAuthn, Mercado Livre OAuth, busca de preços, impressões
- `api` — Gerência: login, solicitações, séries, atividades, usuários, equipes manutenção, categorias insumos, notificações, WebAuthn, financeiro (DRE, balanço, conciliação, boletos Inter), CRM (leads, kanban, templates, vagas, matrículas), calendário, analytics, emergências, impressões
- `acesso` — Controle de acesso e solicitações de famílias
- `boletos-list` — Integração mTLS com Banco Inter
- `calendar` — Agenda/calendário do responsável
- `inter-webhook` — Webhook de boletos do Banco Inter
- `_shared/webauthn.ts` — Módulo compartilhado de verificação WebAuthn

**Supabase Project:** `https://brgorknbrjlfwvrrlwxj.supabase.co`

---

## Decisões Arquiteturais

### Git / Deploy
- **Claude só pode fazer push para `claude/**`** — o proxy Git bloqueia push direto para `main` com 403. Porém pushes diretos para `main` funcionam fora do sandbox do Claude Code.
- **Auto-merge via GitHub Actions** elimina a necessidade de merge manual de PRs.
- **Vercel** NÃO faz auto-deploy — precisa rodar `npx vercel --yes --prod --name maple-bear-rs` manualmente (fora do sandbox Claude Code).
- **Edge Functions Supabase** NÃO são deployadas pelo Vercel — precisam de deploy manual (`supabase functions deploy <nome> --no-verify-jwt`).

### Autenticação
- **Portal (`index.html`)**: Supabase Auth (Google OAuth + Magic Link + email/senha). Controle de acesso via tabela `familias`/`solicitacoes`.
- **Gerente (`gerente.html`)**: sistema próprio com senha (PBKDF2) + sessões na tabela `gerente_sessoes`.
- **Professoras**: sistema próprio (`professora_sessoes`).
- **Secretaria**: sistema próprio (`secretaria_sessoes`).
- **WebAuthn/Passkeys**: login biométrico (Face ID, fingerprint) em todos os portais. Tabelas: `webauthn_credentials`, `webauthn_challenges`. Módulo: `_shared/webauthn.ts`. Auto-login em mobile.

### Almoxarifado
- Usa tabela `series` (mesma das séries de turno) em vez da antiga `alm_turmas`.
- Coluna `professoras.serie_id` referencia `series(id)`.
- Tabela `series` NÃO tem coluna `cor` — usar fallback `#3B82F6`.
- **Fracionamento**: `alm_insumos` tem `unidade_compra`, `qtd_por_embalagem`. Preço no catálogo é por embalagem; para professoras, mostra preço unitário (preco / qtd_por_embalagem).
- **Busca de preços**: Zoom.com.br (scraping, funciona server-side), Mercado Livre (scraping do site), Shopee, Reval, Amazon.
- **ML API de busca está bloqueada (403)** mesmo com OAuth. Usa scraping de `lista.mercadolivre.com.br`.
- **Histórico de preços**: tabela `alm_insumo_historico` com log de todas as mudanças.
- **Categorias configuráveis**: tabela `alm_categorias`.
- **Equipes de manutenção**: tabela `manut_equipes`.
- Painéis do almoxarifado são páginas separadas na sidebar do gerente (não tabs internas).

### Mercado Livre OAuth
- Client ID: `1358685762306521`
- Redirect URI: `https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/diplomas?action=ml_oauth_callback`
- Auth URL: `https://auth.mercadolivre.com.br/authorization` (com V, não B)
- API: `api.mercadolibre.com` (com B — domínio espanhol)
- Tokens em `ml_tokens` com auto-refresh.
- Página de sucesso: `ml-conectado.html` (redirect após callback).

### mTLS / Banco Inter
- Relay mTLS no **Render** (`inter-relay-maple-bear-rs`).
- Host Inter: `cdpj.partners.bancointer.com.br` (API v3).
- Status Inter: `RECEBIDO` = pago, `A_RECEBER` = em aberto, `EXPIRADO` = vencido.

### PDI → Annual Growth Plan
- A nomenclatura foi alterada de "PDI / Plano de Desenvolvimento Individual" para "Annual Growth Plan" em todos os portais.
- IDs e variáveis JS mantêm o prefixo `pdi` por compatibilidade.

### CRM
- **Kanban**: drag-and-drop entre estágios configuráveis (`crm_estagios`). Estágios padrão: Novo Lead, Primeiro Contato, Visita Agendada, Visita Realizada, Proposta, Negociação, Matrícula Fechada, Perdido.
- **Leads**: formulário com data de nascimento → cálculo automático de série via `config_series_idade` (campo série bloqueado, preenchido pelo sistema).
- **Interações**: histórico de ligações, WhatsApp, emails, visitas por lead.
- **Templates WhatsApp**: categorias (boas-vindas, follow-up, visita, pós-visita, proposta, matrícula, geral) com variáveis `{{nome}}`, `{{crianca}}`, etc.
- **Chrome Extension**: botão flutuante 🍁 no WhatsApp Web, painel lateral com templates, substituição de variáveis, inserção no chat.
- **Reuniões**: agendamento com integração Google Calendar (abre evento no navegador).
- **Vagas**: tabela `crm_turmas_vagas` com `vagas_total` GENERATED ALWAYS AS (`qtd_turmas * vagas_por_turma`). Barras de progresso de ocupação.
- **Matrículas/Reservas**: tabela `crm_matriculas` com status (reserva → matriculado → cancelado). Página agrupada por série com cards visuais. Dados transferidos automaticamente do lead (nome, criança, série, nascimento, email, telefone).
- **Config séries/idade**: `config_series_idade` com faixas etárias em meses, data de corte (MM-DD), ano de referência. Botão para replicar todas as séries de um ano para outro.
- **Vagas por ano**: dados seed para 2026 e 2027 com séries Bear Care até Year 4.

### Módulo Financeiro
- **Dashboard**: receitas vs despesas (gráfico), saldo mensal.
- **Lançamentos**: tabela `fin_lancamentos` (receita/despesa), plano de contas (`fin_plano_contas`).
- **DRE**: Demonstração do Resultado do Exercício com breakdown mensal.
- **Balanço Patrimonial**: Ativo, Passivo, Patrimônio Líquido.
- **Conciliação Bancária**: auto-matching de extratos com lançamentos.
- **Boletos**: emissão via Banco Inter (relay mTLS no Render).
- **NFS-e**: módulo desativado (complexidade SOAP/XML com certificado A1).

---

## Funcionalidades Implementadas

### Portal dos Pais (`index.html`)
- Login: email/senha, Google OAuth, Magic Link, Face ID biometrics
- Controle de acesso: verifica email em `familias`/`solicitacoes`
- Tabs: Início, Mudança de Turno, Atividades Extracurriculares, Boletos, Achados & Perdidos
- Pickup "Estou a Caminho" com fallback para tabela `familias`
- Boletos lazy-load (só carrega ao clicar na aba)
- WebAuthn/biometria (Face ID) com auto-login em mobile
- Banner biometria aparece 1x por sessão (sessionStorage)

### Portal das Professoras (`professora.html`)
- Páginas via bottom nav (mobile) / sidebar (desktop): Fila, Diplomas, Growth Plan, Materiais, Atestados, Manutenção, Impressões, Achados & Perdidos
- Saudação "Olá, [nome]" + data
- Notificações (sino) para diplomas, atestados, PDI
- Almoxarifado: navegador mês/ano, requisição com layout 2 colunas + itens não cadastrados
- Impressões: solicitação com cota mensal por turma
- Achados & Perdidos: formulário com foto
- WebAuthn/biometria

### Portal da Secretaria (`secretaria.html`)
- Saudação + notificações
- Validação de atestados
- WebAuthn/biometria

### Painel do Gerente (`gerente.html`)
- Sidebar colapsável com seções: Turnos, Atividades, Professoras, Almoxarifado, Infraestrutura, Financeiro, CRM, Escola, Configurações
- **Analytics**: dashboard com métricas, gráficos
- **Almoxarifado** em páginas separadas: Dashboard, Pendentes, Requisições, Insumos, Turmas, Orçamentos, Relatório, Compras
- Navegador mês/ano com setas separadas
- Orçamento padrão: aplicar a todas as turmas + ano inteiro
- Insumos: importação Excel, categorias configuráveis, fracionamento (embalagem vs consumo)
- Busca de preços: Zoom, ML (scraping), Shopee, Reval, Amazon
- Atualização automática de preços com detecção de embalagem e histórico
- ML OAuth integrado
- Review de requisições com seleção de fornecedor
- **Equipe**: atribuição de turma/série para professoras
- **Famílias**: tabela com edição de série, importação Excel
- **Manutenção**: equipes configuráveis, relatório por equipe com WhatsApp
- **Achados & Perdidos**: publicar, devolver, excluir
- **Calendário escolar**: CRUD de eventos
- **Impressões**: aprovação/rejeição, cotas por turma
- **Emergência**: alertas (incêndio, lockdown, etc.)
- **Financeiro**: Dashboard, Lançamentos, Mensalidades, Plano de Contas, DRE, Balanço Patrimonial, Conciliação Bancária, Boletos Inter
- **CRM**: Pipeline Kanban, Leads, Templates WhatsApp, Vagas, Matrículas/Reservas, Config Séries/Idade
- Notificações unificadas
- WebAuthn/biometria
- Annual Growth Plan (antigo PDI)

### Chrome Extension (`chrome-extension/`)
- Manifest V3 para WhatsApp Web
- Botão flutuante 🍁 + painel lateral
- Templates CRM com variáveis `{{nome}}`, busca/filtro
- Inserção automática no chat ou fallback clipboard

### Sistema de Notificações
- Tabela `notificacoes` unificada para todos os portais
- Eventos: diploma aprovado/rejeitado, atestado aprovado/rejeitado, PDI aprovado/devolvido, novo diploma (→gerente), novo atestado (→secretaria)
- Almoxarifado tem sistema próprio em `alm_notificacoes`

### Achados & Perdidos
- Tabela `achados_perdidos` com auto-publicação após 12h
- Professora posta item com descrição, local, foto
- Gerente pode publicar imediatamente ou aguardar 12h
- Pais veem apenas itens publicados (tab dedicada)

---

## Tabelas Principais

| Tabela | Uso |
|--------|-----|
| `solicitacoes` | Matrículas/solicitações de turno |
| `familias` | Dados de famílias (cpf, nome_responsavel, nome_aluno, email, serie) |
| `series` | Séries/turmas da escola (usada também pelo almoxarifado) |
| `gerentes` / `gerente_sessoes` | Auth gerentes |
| `professoras` / `professora_sessoes` | Auth professoras (serie_id referencia series) |
| `secretarias` / `secretaria_sessoes` | Auth secretárias |
| `usuarios` | Tabela unificada de usuários |
| `atividades` | Atividades extracurriculares |
| `pickup_notificacoes` | Avisos "Estou a Caminho" |
| `diplomas_professoras` | Diplomas enviados |
| `atestados_professoras` | Atestados médicos |
| `pdis` | Annual Growth Plan (antigo PDI) |
| `alm_insumos` | Catálogo de insumos (com fracionamento) |
| `alm_categorias` | Categorias de insumos configuráveis |
| `alm_orcamentos` | Orçamentos mensais por turma |
| `alm_requisicoes` | Requisições de material |
| `alm_notificacoes` | Notificações do almoxarifado |
| `alm_insumo_historico` | Histórico de preços dos insumos |
| `manutencoes` | Chamados de manutenção |
| `manut_equipes` | Equipes de manutenção configuráveis |
| `notificacoes` | Notificações unificadas (todos os portais) |
| `achados_perdidos` | Achados & Perdidos |
| `webauthn_credentials` | Credenciais biométricas |
| `webauthn_challenges` | Challenges WebAuthn (efêmeros) |
| `ml_tokens` | Tokens OAuth do Mercado Livre |
| `boletos` | Boletos sincronizados do Banco Inter |
| `fin_lancamentos` | Lançamentos financeiros (receita/despesa) |
| `fin_plano_contas` | Plano de contas contábil |
| `fin_conciliacao` | Conciliação bancária |
| `crm_leads` | Leads do CRM |
| `crm_estagios` | Estágios do pipeline Kanban |
| `crm_interacoes` | Histórico de interações com leads |
| `crm_templates` | Templates WhatsApp |
| `crm_reunioes` | Reuniões agendadas |
| `crm_turmas_vagas` | Vagas por série/ano (GENERATED vagas_total) |
| `crm_matriculas` | Matrículas/reservas (nome, criança, série, nascimento, email, telefone) |
| `config_series_idade` | Faixas etárias por série (meses, data corte, ano ref) |
| `impressoes` | Solicitações de impressão |

---

## Migrations

Migrations em `supabase/migrations/` seguem padrão `NNN_nome.sql` (009 a 046):
- `044_crm_nascimento.sql` — `data_nascimento` em leads, tabela `config_series_idade`
- `045_crm_vagas.sql` — `crm_turmas_vagas`, `crm_matriculas`, seed 2026/2027
- `046_matriculas_dados_completos.sql` — Adiciona email, telefone, data_nascimento em `crm_matriculas`

---

## Comandos Úteis

```bash
# Deploy de Edge Functions
supabase functions deploy diplomas --no-verify-jwt
supabase functions deploy api --no-verify-jwt

# Push migrations
supabase db push

# Deploy Vercel (FORA do sandbox Claude Code)
npx vercel --yes --prod --name maple-bear-rs

# Push para branch Claude (auto-merge)
git push origin HEAD:claude/<nome>

# Push direto para main
git push origin main
```
