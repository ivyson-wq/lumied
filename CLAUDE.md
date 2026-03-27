# CLAUDE.md — Portal Escolar SaaS

## Visão Geral do Projeto

Portal web **multi-tenant SaaS** para gestão escolar — pais/responsáveis, professoras, secretaria e gerência.
Toda a configuração (nome, cores, turnos, módulos) é dinâmica via tabela `escola_config`.
Domínio atual: `app.maplebearcaxiasdosul.com.br`

**Stack:**
- Frontend: HTML/CSS/JS puro (sem framework), hospedado no **Vercel** (auto-deploy via push para `main`)
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Render** (para chamadas à API do Banco Inter)
- Chrome Extension: Manifest V3 para WhatsApp Web (templates CRM)
- Git: GitHub (`ivyson-wq/maple-bear-rs`)

**Arquivos principais:**
- `config.js` — **ÚNICO arquivo a editar por escola nova** (SUPABASE_URL + SUPABASE_ANON)
- `index.html` — Portal do pai/responsável (sidebar desktop ≥900px, bottom nav mobile)
- `gerente.html` — Painel da gerência (~7000+ linhas)
- `professora.html` — Portal das professoras
- `secretaria.html` — Portal da secretaria
- `area-restrita.html` — Hub de acesso aos portais staff
- `admin.html` — Painel de administração (superusuário, acesso direto por URL)
- `setup.html` — Wizard de configuração inicial (4 steps: escola, branding, módulos, gerente)
- `webauthn-client.js` — Helper WebAuthn/Passkeys para biometria
- `ml-conectado.html` — Página de sucesso OAuth do Mercado Livre
- `api/boletos-sync.js` — Vercel API Route (delega para Edge Function `boletos-list`)
- `sw.js` — Service Worker para PWA
- `chrome-extension/` — Extensão WhatsApp Web (manifest.json, popup.html, content.js, content.css)

**Edge Functions Supabase** (deploy via `supabase functions deploy <nome> --no-verify-jwt`):
- `api` — Gerência: login, config_publica, config_escola_save, admin_check, config_escola_admin, solicitações, séries, atividades, usuários, equipes manutenção, categorias insumos, notificações, WebAuthn, financeiro, CRM, calendário, analytics, emergências, impressões
- `diplomas` — Pickup, almoxarifado (insumos, entrada estoque XML/NF-e, busca preços), PDI, diplomas, professoras, secretaria, achados e perdidos, WebAuthn, Mercado Livre OAuth, impressões
- `acesso` — Controle de acesso e solicitações de famílias (emails dinâmicos)
- `send-email` — Envio de notificações por email (branding dinâmico via escola_config)
- `boletos-list` — Integração mTLS com Banco Inter
- `calendar` — Agenda/calendário do responsável
- `inter-webhook` — Webhook de boletos do Banco Inter
- `_shared/webauthn.ts` — Módulo compartilhado de verificação WebAuthn

**Supabase Project:** `https://brgorknbrjlfwvrrlwxj.supabase.co`

---

## Arquitetura Multi-Tenant (SaaS)

### Configuração Dinâmica
- Tabela `escola_config` (chave TEXT → valor JSONB) armazena **toda** a configuração da escola
- Todos os portais carregam `config_publica` ao iniciar e aplicam: nome, cores CSS, turnos/preços, módulos ativos, coordenadas
- **Nenhum nome de escola, cor, preço ou credencial está hardcoded** nos HTMLs — tudo vem do banco ou do `config.js`

### config.js (único arquivo por escola)
```js
const CONFIG = {
  SUPABASE_URL:  'https://xxxxx.supabase.co',
  SUPABASE_ANON: 'eyJ...',
};
```
Todos os HTMLs importam `<script src="/config.js">` e usam `CONFIG.SUPABASE_URL` / `CONFIG.SUPABASE_ANON`.

### Módulos Toggle
- Config `modulos_ativos` (array JSON) controla quais módulos aparecem
- Elementos HTML com `data-module="xxx"` são ocultados se o módulo não está na lista
- Funciona no sidebar do gerente e nas tabs do portal dos pais

### Fluxo para escola nova
1. Criar projeto Supabase → anotar URL + Anon Key
2. Rodar migrations (009 a 048) no SQL Editor
3. Deploy Edge Functions (`supabase functions deploy`)
4. Clone do repo → editar **apenas** `config.js`
5. Deploy no Vercel → configurar domínio customizado
6. Acessar `setup.html` → wizard configura escola, cores, módulos, primeiro gerente
7. Configurar secrets no Supabase (RESEND_API_KEY, etc.) via `admin.html`

---

## Decisões Arquiteturais

### Git / Deploy
- Push direto para `main` → Vercel faz auto-deploy
- **Edge Functions Supabase** precisam de deploy manual (`supabase functions deploy <nome> --no-verify-jwt`)
- Supabase CLI disponível em `/tmp/supabase.exe` (baixado via curl no sandbox)

### Autenticação
- **Portal (`index.html`)**: Supabase Auth (Google OAuth + Magic Link + email/senha). Controle de acesso via tabela `familias`/`solicitacoes`.
- **Gerente (`gerente.html`)**: sistema próprio com senha (PBKDF2) + sessões na tabela `gerente_sessoes`.
- **Professoras**: sistema próprio (`professora_sessoes`).
- **Secretaria**: sistema próprio (`secretaria_sessoes`).
- **Admin (`admin.html`)**: Supabase Auth (Google OAuth) restrito ao superusuário (`ivyson@gmail.com` por padrão, configurável via `superusuario_email` na tabela `escola_config`). **Nenhum link** aponta para `admin.html` — acesso apenas por URL direta. Gerentes NÃO têm acesso.
- **WebAuthn/Passkeys**: login biométrico (Face ID, fingerprint) em todos os portais. Tabelas: `webauthn_credentials`, `webauthn_challenges`. Módulo: `_shared/webauthn.ts`. Auto-login em mobile.

### Almoxarifado
- Usa tabela `series` (mesma das séries de turno) em vez da antiga `alm_turmas`.
- Coluna `professoras.serie_id` referencia `series(id)`.
- Tabela `series` NÃO tem coluna `cor` — usar fallback `#3B82F6`.
- **Fracionamento**: `alm_insumos` tem `unidade_compra`, `qtd_por_embalagem`. Preço no catálogo é por embalagem; para professoras, mostra preço unitário (preco / qtd_por_embalagem).
- **Busca de preços**: Zoom.com.br (scraping), Mercado Livre (scraping), Shopee, Reval, Amazon.
- **Importação XML/NF-e**: parser de NF-e padrão SEFAZ + XML genérico para entrada de materiais. Detecta ML automaticamente pelo CNPJ. Match com catálogo existente. Endpoint `alm_entrada_estoque` incrementa estoque e atualiza preço.
- **Lista de insumos**: busca por texto, filtro de inativos, max-height com scroll.
- **Histórico de preços**: tabela `alm_insumo_historico` com log de todas as mudanças.
- **Categorias configuráveis**: tabela `alm_categorias`.
- **Equipes de manutenção**: tabela `manut_equipes`.

### Credenciais e Secrets
Todas as credenciais de APIs externas são configuradas como **env vars / secrets do Supabase Edge Functions**, nunca hardcoded:
- `RESEND_API_KEY` — API do Resend para envio de emails
- `ML_CLIENT_ID`, `ML_CLIENT_SECRET` — Mercado Livre OAuth
- `ML_REDIRECT_URI` — auto-gerado: `{SUPABASE_URL}/functions/v1/diplomas?action=ml_oauth_callback`
- `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`, `INTER_CONTA` — Banco Inter
- `INTER_RELAY_URL`, `RELAY_SECRET` — Relay mTLS no Render
- `GOOGLE_MAPS_KEY`, `GOOGLE_SERVICE_ACCOUNT` — Google Maps/Calendar
- `APP_URL` — URL pública do portal (redirect OAuth)

### Mercado Livre OAuth
- Client ID/Secret via env vars (fallback para valores antigos se não configurado)
- Redirect URI gerado dinamicamente: `{SUPABASE_URL}/functions/v1/diplomas?action=ml_oauth_callback`
- Auth URL: `https://auth.mercadolivre.com.br/authorization` (com V, não B)
- API: `api.mercadolibre.com` (com B — domínio espanhol)
- Tokens em `ml_tokens` com auto-refresh.

### mTLS / Banco Inter
- Relay mTLS no **Render**.
- Host Inter: `cdpj.partners.bancointer.com.br` (API v3).
- Status Inter: `RECEBIDO` = pago, `A_RECEBER` = em aberto, `EXPIRADO` = vencido.

### PDI → Annual Growth Plan
- A nomenclatura foi alterada de "PDI / Plano de Desenvolvimento Individual" para "Annual Growth Plan" em todos os portais.
- IDs e variáveis JS mantêm o prefixo `pdi` por compatibilidade.

### CRM
- **Kanban**: drag-and-drop entre estágios configuráveis (`crm_estagios`).
- **Leads**: formulário com data de nascimento → cálculo automático de série via `config_series_idade`.
- **Interações**: histórico de ligações, WhatsApp, emails, visitas por lead.
- **Templates WhatsApp**: categorias com variáveis `{{nome}}`, `{{crianca}}`, etc.
- **Chrome Extension**: branding configurável via config API. Botão flutuante + painel lateral no WhatsApp Web.
- **Reuniões**: agendamento com integração Google Calendar.
- **Vagas**: tabela `crm_turmas_vagas` com `vagas_total` GENERATED ALWAYS AS (`qtd_turmas * vagas_por_turma`).
- **Matrículas/Reservas**: tabela `crm_matriculas` com status (reserva → matriculado → cancelado). Dados transferidos do lead.
- **Config séries/idade**: `config_series_idade` com faixas etárias em meses, data de corte, ano de referência.

### Módulo Financeiro
- **Dashboard**: receitas vs despesas (gráfico), saldo mensal.
- **Lançamentos**: tabela `fin_lancamentos` (receita/despesa), plano de contas (`fin_plano_contas`).
- **DRE**: Demonstração do Resultado do Exercício com breakdown mensal.
- **Balanço Patrimonial**: Ativo, Passivo, Patrimônio Líquido.
- **Conciliação Bancária**: auto-matching de extratos com lançamentos.
- **Boletos**: emissão via Banco Inter (relay mTLS no Render).

### Email Templates Dinâmicos
- Todas as Edge Functions (`acesso`, `send-email`) leem `escola_config` para branding
- Remetente: `{escola_nome} <{escola_email_sender}>` (ex: "Maple Bear <noreply@escola.com.br>")
- Cor do header, nome da escola, URL — tudo dinâmico
- Destinatário de notificações: `escola_email_notif` (configurável no admin)

---

## Funcionalidades Implementadas

### Portal dos Pais (`index.html`)
- Login: email/senha, Google OAuth, Magic Link, Face ID biometrics
- Controle de acesso: verifica email em `familias`/`solicitacoes`
- Sidebar fixa à esquerda em desktop (≥900px), bottom nav em mobile
- Tabs: Início, Mudança de Turno, Atividades Extracurriculares, Boletos, Achados & Perdidos
- Turnos e preços carregados dinamicamente do `escola_config`
- Tabs ocultáveis via `modulos_ativos`
- Pickup "Estou a Caminho" com coordenadas configuráveis
- Boletos lazy-load
- WebAuthn/biometria com auto-login em mobile

### Portal das Professoras (`professora.html`)
- Branding dinâmico (nome, cores, ícone)
- Páginas: Fila, Diplomas, Growth Plan, Materiais, Atestados, Manutenção, Impressões, Achados & Perdidos
- Almoxarifado: navegador mês/ano, requisição com layout 2 colunas
- WebAuthn/biometria

### Portal da Secretaria (`secretaria.html`)
- Branding dinâmico
- Validação de atestados
- WebAuthn/biometria

### Painel do Gerente (`gerente.html`)
- Branding dinâmico (sidebar, login, relatórios PDF/WhatsApp)
- Sidebar colapsável com seções toggle por `data-module`
- **Almoxarifado**: importação XML/NF-e, busca/filtro de insumos, entrada de estoque
- Todos os relatórios PDF/WhatsApp usam nome dinâmico da escola
- Link "Admin / Setup" removido — sem acesso ao admin

### Admin (`admin.html`)
- **Acesso**: Google OAuth exclusivo para superusuário (endpoint `admin_check`)
- **Sem links** — acessível apenas por URL direta
- **Seções**: Status do Sistema, Dados da Escola, Cores/Branding (preview ao vivo), Email/Resend (com instruções), ML OAuth, Banco Inter, Google Maps/Calendar, Supabase/Deploy, Módulos Ativos
- Salva via endpoint `config_escola_admin` (validação de superusuário)

### Setup Wizard (`setup.html`)
- 4 steps: Dados da Escola, Cores/Branding, Módulos, Primeiro Gerente
- Funciona apenas quando não existe gerente cadastrado
- Salva configs via `config_escola_setup`

### Chrome Extension (`chrome-extension/`)
- Manifest V3 para WhatsApp Web
- Branding configurável via config API
- Templates CRM com variáveis `{{nome}}`, busca/filtro
- Inserção automática no chat ou fallback clipboard

### Sistema de Notificações
- Tabela `notificacoes` unificada para todos os portais
- Almoxarifado tem sistema próprio em `alm_notificacoes`

### Achados & Perdidos
- Tabela `achados_perdidos` com auto-publicação após 12h

---

## Tabelas Principais

| Tabela | Uso |
|--------|-----|
| `escola_config` | **Config dinâmica da escola** (chave/valor JSONB) — nome, cores, turnos, módulos, etc. |
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
| `crm_matriculas` | Matrículas/reservas |
| `config_series_idade` | Faixas etárias por série (meses, data corte, ano ref) |
| `impressoes` | Solicitações de impressão |

---

## Migrations

Migrations em `supabase/migrations/` seguem padrão `NNN_nome.sql` (009 a 048):
- `044_crm_nascimento.sql` — `data_nascimento` em leads, tabela `config_series_idade`
- `045_crm_vagas.sql` — `crm_turmas_vagas`, `crm_matriculas`, seed 2026/2027
- `046_matriculas_dados_completos.sql` — Adiciona email, telefone, data_nascimento em `crm_matriculas`
- `047_matriculas_turma.sql` — Separação de matrículas por turma
- `048_escola_config.sql` — **Tabela `escola_config`** (configuração dinâmica multi-tenant) + seed completo

---

## Comandos Úteis

```bash
# ── Deploy de novo cliente (automatizado) ──────────
bash deploy-novo-cliente.sh <PROJECT_REF> <SUPABASE_ACCESS_TOKEN>
# Roda 41 migrations + deploya 7 Edge Functions com um comando

# ── Atualizar TODOS os clientes (código) ───────────
git push origin main
# Todos os projetos Vercel conectados fazem auto-deploy

# ── Deploy manual de Edge Functions ────────────────
supabase functions deploy api --no-verify-jwt --project-ref <REF>
supabase functions deploy diplomas --no-verify-jwt --project-ref <REF>
supabase functions deploy acesso --no-verify-jwt --project-ref <REF>
supabase functions deploy send-email --no-verify-jwt --project-ref <REF>

# ── SQL remoto via Management API ──────────────────
curl --ssl-no-revoke -s -X POST "https://api.supabase.com/v1/projects/<REF>/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT * FROM escola_config"}'

# ── Deploy Vercel manual (se auto-deploy não estiver ativo) ──
npx vercel --yes --prod --name maple-bear-rs
```

---

## Deploy Multi-Tenant

### Arquitetura
```
GitHub (1 repo) ──push──> Vercel Projeto A (env: SUPABASE_URL=xxx) → domínio escola A
                     └──> Vercel Projeto B (env: SUPABASE_URL=yyy) → domínio escola B
                     └──> Vercel Projeto C (env: SUPABASE_URL=zzz) → domínio escola C
```

### Build Script
- `build.sh` gera `config.js` a partir de env vars do Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON`)
- Se env vars não existem, mantém `config.js` do repo (fallback para escola atual)
- `vercel.json` → `buildCommand: "bash build.sh"`

### Novo Cliente (9 passos, ~15 min)
1. **Supabase**: criar projeto → anotar REF + Anon Key
2. **Script**: `bash deploy-novo-cliente.sh <REF> <TOKEN>` (migrations + Edge Functions)
3. **Supabase Auth**: Site URL + Redirect URLs + Google Provider
4. **Vercel**: import repo + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON`)
5. **DNS**: CNAME `app` → `cname.vercel-dns.com`
6. **Google OAuth**: adicionar redirect URI do novo Supabase
7. **setup.html**: wizard (nome, cores, módulos, primeiro gerente)
8. **admin.html**: configurar secrets (RESEND obrigatório, ML/Inter/Google opcionais)
9. **Testar** todos os portais

> Guia detalhado: `NOVO-CLIENTE.md`

---

## Documentação do Projeto

| Arquivo | Conteúdo |
|---------|----------|
| `CLAUDE.md` | Documentação técnica completa (este arquivo) |
| `NOVO-CLIENTE.md` | Guia passo a passo para deploy de novo cliente |
| `COMERCIAL.md` | Apresentação comercial: módulos, funcionalidades, planos, diferenciais |
| `CONTEXTO.md` | Contexto histórico do projeto (legado) |
| `MANIFEST.md` | Manifest de desenvolvimento (legado) |
| `deploy-novo-cliente.sh` | Script automatizado de deploy (migrations + Edge Functions) |
| `build.sh` | Build script Vercel (gera config.js a partir de env vars) |
| `config.js` | Credenciais Supabase (fallback — sobrescrito no build por env vars) |

---

## Modelo Comercial (SaaS por Assinatura)

### Planos sugeridos (base + por aluno/mês)

| Plano | Base/mês | Por aluno | Exemplo 300 alunos | Módulos |
|-------|----------|-----------|---------------------|---------|
| **Essencial** | R$ 199 | R$ 2,90 | R$ 1.069 | Pais + Gerente, turnos, atividades, calendário |
| **Profissional** | R$ 399 | R$ 4,90 | R$ 1.869 | + Almoxarifado, CRM, Professoras, Secretaria, Pickup, Emergência |
| **Completo** | R$ 699 | R$ 6,90 | R$ 2.769 | Todos os 14 módulos + todas as integrações |

### Concorrência (referência de preço para 300 alunos)
- WPensar: ~R$ 600 (básico)
- Sistema Quality: ~R$ 1.500-2.200
- Proesc: ~R$ 1.500-2.100
- Sponte: ~R$ 2.000-2.500
- ClassApp: ~R$ 1.200 (só comunicação)
- TOTVS: R$ 5.000+ (enterprise)

### Diferenciais competitivos
- Almoxarifado com NF-e XML + busca de preços em 5 plataformas
- CRM com extensão Chrome para WhatsApp
- Pickup GPS em tempo real
- Sistema de emergência (lockdown)
- Login biométrico (Face ID/fingerprint)
- White-label completo (cores, logo, módulos)
- Zero taxa de implantação
- Deploy em 15 minutos

> Apresentação completa: `COMERCIAL.md`
