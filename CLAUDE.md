# CLAUDE.md — Lumied

## Visão Geral

Plataforma SaaS de gestão escolar completa com 23 módulos, multi-tenancy, feature gating por escola, 4 temas visuais, e LGPD compliance. Marca: **Lumied**.

**Domínios:**
- `lumied.com.br` — Landing page comercial (redirect para `/site/`)
- `escola.lumied.com.br` — Padrão SaaS (ex: `maplebearcaxias.lumied.com.br`)
- DNS gerido pelo **Cloudflare** (nameservers: `aleena.ns.cloudflare.com`, `yichun.ns.cloudflare.com`)

**Stack:**
- Frontend: HTML/CSS/JS + ES Modules, bundled com **esbuild**, hospedado no **Vercel**
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Render** (API Banco Inter)
- Chrome Extension: Manifest V3 para WhatsApp Web (templates CRM)
- CI/CD: **GitHub Actions** (lint → test → deploy)
- Testes: **Deno test** (44 unit) + **Playwright** (56 e2e) = 100 testes
- Monitoramento: **Sentry** (`lumied.sentry.io`) + **Better Stack** (API REST)
- Git: GitHub (`ivyson-wq/maple-bear-rs`)

**Supabase Project:** `https://brgorknbrjlfwvrrlwxj.supabase.co`

---

## Portais (7 HTML files)

| Portal | Arquivo | Público | Descrição |
|--------|---------|---------|-----------|
| Pais | `index.html` | Famílias | Login Google/Magic Link/biometria. Pickup, boletim, agenda digital, boletos |
| Gerente | `gerente.html` | Direção | ~45 painéis: analytics, financeiro, CRM, almoxarifado, acadêmico, comunicação |
| Professora | `professora.html` | Docentes | Chamada, notas, agenda digital, diplomas, materiais, growth plan |
| Secretaria | `secretaria.html` | Secretaria | Validação de atestados |
| Admin | `admin.html` | Superadmin (SaaS) | Dashboard, escolas, planos, módulos, status, LGPD, tickets, admins |
| Aluno | `aluno.html` | Alunos | Notas, frequência, provas, calendário |
| Hub | `area-restrita.html` | Staff | Seletor de portais |

---

## Edge Functions (19 ativas)

| Function | Padrão | Descrição |
|----------|--------|-----------|
| `admin` | **Router v2** | SaaS admin: escolas, planos, módulos, dashboard stats, tickets, LGPD, system health |
| `api` | **Hybrid** | Gerente: 139+ actions. Rate limit + sanitização + ticket_create |
| `diplomas` | **Hybrid** | Professora/pais: 108 actions |
| `academico` | Legado | Notas, frequência, diário, documentos, relatórios BNCC, portal aluno, provas |
| `comunicacao` | **Router v2** | Agenda digital, chat escola-família |
| `cobranca` | **Router v2** | Régua de cobrança automática |
| `operacional` | **Router v2** | Biblioteca, cantina, transporte |
| `financeiro-ext` | **Router v2** | PIX integrado, integração contábil |
| `rh` | **Router v2** | RH, folha de pagamento, ponto, férias |
| `loja` | **Router v2** | E-commerce / loja virtual |
| `health` | Standalone | Health check (DB + Storage latency) |
| `ticket-resolver` | Standalone | Auto-resposta de tickets via FAQ (pg_cron cada 15min) |
| `acesso` | Legado | Controle de acesso famílias |
| `boletos-list` | Legado | Integração mTLS Banco Inter |
| `boletos-sync` | Legado | Sync de boletos do Banco Inter |
| `calendar` | Legado | Agenda do responsável |
| `inter-webhook` | Legado | Webhook boletos Inter |
| `send-email` | Legado | Envio de emails (branding dinâmico) |
| `daily-digest` | Standalone | Resumo diário por aluno |

**Deploy:** `supabase functions deploy <nome> --no-verify-jwt --project-ref brgorknbrjlfwvrrlwxj --import-map supabase/functions/deno.json`

---

## Painel Admin (`admin.html`)

Painel de gestão SaaS completo com 8 seções:

| Seção | Descrição |
|-------|-----------|
| **Dashboard** | KPIs (escolas ativas, total alunos, MRR, tickets abertos), alertas, top módulos, tabela uso por escola |
| **Escolas** | CRUD de escolas com subdomínio, Supabase URL/Key, barras de uso, status (ativo/expirando/limite) |
| **Planos** | Gestão de planos de assinatura com preços e módulos incluídos |
| **Módulos** | Visão geral dos 38 módulos disponíveis |
| **Status** | Health check de cada escola (latência DB/Storage) |
| **LGPD** | Solicitações de dados (exportar/excluir/retificar) com aprovação/recusa |
| **Tickets** | Gestão de tickets de suporte com resposta e fechamento |
| **Admins** | CRUD de superadmins da plataforma |

**Endpoints admin:** `dashboard_stats`, `escola_uso_list`, `lgpd_solicitacoes_list`, `lgpd_solicitacoes_process`, `system_health`, `tickets_list`, `ticket_respond`, `ticket_close` + todos os CRUD originais.

---

## Sistema de Tickets de Suporte

### 3 Camadas de Atendimento

| Camada | Frequência | Mecanismo |
|--------|-----------|-----------|
| **Email imediato** | Instantâneo | `ticket_create` em `api/index.ts` envia email via Resend para `ivyson@gmail.com` |
| **Auto-resposta FAQ** | A cada 15 min | `ticket-resolver` Edge Function via pg_cron. 9 categorias: login, lento, boleto, turno, pickup, biometria, erro, impressão, almoxarifado |
| **Claude AI Agent** | A cada 1 hora | Remote Trigger no Claude Code. Lê código, diagnostica bugs, corrige e faz deploy |

### Widget (`ticket-widget.js`)
- Botão "?" flutuante no canto inferior direito de todos os portais
- Captura automática: URL, portal, email, user-agent, resolução
- Usuário escolhe tipo (bug/dúvida/sugestão/urgente) + descrição
- Link para Central de Ajuda filtrada por portal
- Não aparece no admin.html

### Tabela `tickets`
```sql
id, escola_id, email, nome, portal, tipo, descricao, url_pagina,
user_agent, resolucao_tela, screenshot_url, status, resposta,
respondido_por, criado_em, atualizado_em
```

### pg_cron Job
- Nome: `ticket-resolver-15min`
- Schedule: `*/15 * * * *`
- Chama: `POST /functions/v1/ticket-resolver` com service_role key

### Remote Trigger (Claude Code)
- ID: `trig_01PTaCsfDfdNrUGwfUeZJZ96`
- Schedule: a cada 1 hora
- Repo: `ivyson-wq/maple-bear-rs`
- Gerenciar: `https://claude.ai/code/scheduled/trig_01PTaCsfDfdNrUGwfUeZJZ96`

---

## Central de Ajuda (`/ajuda/`)

Help Center in-app completo em `ajuda/index.html`:

- **45 artigos** cobrindo todos os 6 portais
- **Mockups HTML/CSS** inline simulando as telas com dados de exemplo
- **Busca full-text** em tempo real (título, descrição, keywords)
- **Navegação por portal** com sidebar collapsible
- **FAQ** em cada artigo (2-3 perguntas)
- **Exportar PDF** via `window.print()` com @media print
- **Filtragem por portal**: `?portal=pais|gerente|professora|secretaria|aluno` — cada usuário só vê sua seção
- **Mobile responsive** com menu hamburger

URLs por portal:
- `/ajuda/?portal=pais` — Portal dos Pais
- `/ajuda/?portal=gerente` — Portal do Gerente
- `/ajuda/?portal=professora` — Portal da Professora
- `/ajuda/?portal=secretaria` — Portal da Secretaria
- `/ajuda/?portal=aluno` — Portal do Aluno
- `/ajuda/` — Completo (admin)

---

## Site Comercial (Landing Page)

Landing page em `site/index.html` — marca **Lumied**.

**URL:** `https://lumied.com.br` (redirect para `/site/`)

### Seções
- Hero com mockup dashboard, stats animados
- Problemas que resolve (WhatsApp, planilhas, sistemas desconectados)
- 6 features com screenshots e descrições
- Galeria de screenshots (desktop + mobile) com lightbox zoom
- Planos de preços (Essencial, Profissional, Premium, Enterprise)
- Depoimentos
- Formulário de contato
- Footer

### Técnico
- HTML/CSS/JS puro (Inter + Playfair Display)
- Lightbox com animação zoom em todas as imagens
- 100% responsivo (mobile, tablet, desktop)
- `vercel.json` redireciona `lumied.com.br` → `/site/`

---

## Multi-tenancy

- `escola_id` em 30+ tabelas de dados
- `plano_limites`: limites por recurso (max_alunos, max_storage_gb, etc.)
- `check_limite()`: função SQL para verificar limites
- `escola_uso` + `escola_uso_historico`: tracking de uso
- Subdomínios por escola (`escolas.subdominio` → `escola.lumied.com.br`)
- Feature gating granular: `plano_modulos` + `escola_modulos` override
- 4 temas visuais (Corporativo, Lúdico, Sério, Interativo)

---

## Segurança

- **RLS** habilitado em 20+ tabelas com policies restritivas
- **Rate Limiting** em todas as 19 edge functions
- **Input Validation** com schemas + sanitização XSS
- **PBKDF2** 100k-120k iterações para senhas
- **WebAuthn/Face ID** nos portais principais
- **HSTS** + X-Frame DENY + Permissions-Policy + nosniff
- **LGPD**: consentimento, export (`lgpd_exportar_dados()`), anonimização (`lgpd_anonimizar()`), audit log

---

## Banco de Dados

- **82 migrations** (009-082)
- Últimas migrations relevantes:
  - `048_planos_modulos.sql` — escolas, planos, modulos, admins
  - `075_multitenancy_limites.sql` — plano_limites, escola_uso
  - `078_lgpd.sql` — consentimentos, solicitações, audit log
  - `081_tickets.sql` — tabela tickets de suporte
  - `082_ticket_resolver_cron.sql` — pg_cron job para auto-resposta

---

## Observabilidade

### Sentry (`lumied.sentry.io`)
- Frontend: SDK Browser v9.25.0 via `sentry-init.js` em todos os portais
- Edge Functions: `_shared/sentry.ts` reporter HTTP
- Performance: tracesSampleRate 0.2 (prod), Session Replay 10%
- Alertas: High Error Rate, New Issues, P95 > 3s

### Better Stack
- Monitoramento via API REST (sem CLI)
- Integrado no painel admin (Status do Sistema)

---

## Comandos Úteis

```bash
# Deploy Edge Functions
supabase functions deploy <nome> --no-verify-jwt --project-ref brgorknbrjlfwvrrlwxj --import-map supabase/functions/deno.json

# Deploy todas as functions
for fn in admin api diplomas academico comunicacao cobranca operacional financeiro-ext rh loja health ticket-resolver; do
  supabase functions deploy $fn --no-verify-jwt --project-ref brgorknbrjlfwvrrlwxj --import-map supabase/functions/deno.json
done

# SQL remoto via Management API
curl --ssl-no-revoke -s -X POST "https://api.supabase.com/v1/projects/brgorknbrjlfwvrrlwxj/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT * FROM escola_config"}'

# Build frontend
node build.js

# Testes
npm test
npx playwright test

# Deploy frontend (auto via push para main)
git push origin main

# Health check
curl https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/health
```

---

## Deploy Multi-Tenant

```
GitHub (1 repo) ──push──> Vercel Projeto A (env: SUPABASE_URL=xxx) → escola-a.lumied.com.br
                     └──> Vercel Projeto B (env: SUPABASE_URL=yyy) → escola-b.lumied.com.br
```

### Novo Cliente (9 passos, ~15 min)
1. **Supabase**: criar projeto → anotar REF + Anon Key
2. **Script**: `bash deploy-novo-cliente.sh <REF> <TOKEN>` (migrations + Edge Functions)
3. **Supabase Auth**: Site URL + Redirect URLs + Google Provider
4. **Vercel**: import repo + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON`)
5. **DNS (Cloudflare)**: CNAME `escola` → `cname.vercel-dns.com` (wildcard `*` já configurado)
6. **Google OAuth**: adicionar redirect URI do novo Supabase
7. **setup.html**: wizard (nome, cores, módulos, primeiro gerente)
8. **admin.html**: configurar secrets (RESEND obrigatório, ML/Inter/Google opcionais)
9. **Testar** todos os portais

> Guia detalhado: `NOVO-CLIENTE.md`

---

## Credenciais e Secrets

### Supabase Edge Functions Secrets
- `RESEND_API_KEY` — API do Resend para envio de emails
- `APP_URL` — URL pública do portal (ex: `https://maplebearcaxias.lumied.com.br`)
- `ML_CLIENT_ID`, `ML_CLIENT_SECRET` — Mercado Livre OAuth
- `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`, `INTER_CONTA` — Banco Inter
- `INTER_RELAY_URL`, `RELAY_SECRET` — Relay mTLS no Render
- `GOOGLE_MAPS_KEY`, `GOOGLE_SERVICE_ACCOUNT` — Google Maps/Calendar
- `SENTRY_DSN` — Sentry event ingestion

### Google OAuth
- Client ID: `88100226947-3i672iq8v2uk1ijjp11ba25p893gp6nu.apps.googleusercontent.com`
- Authorized JS origins: `https://maplebearcaxias.lumied.com.br`
- Redirect URI: `https://brgorknbrjlfwvrrlwxj.supabase.co/auth/v1/callback`

### DNS (Cloudflare)
- Zone: `lumied.com.br` (ID: `8b2c34bf85fc32f734de3facd380956d`)
- Nameservers: `aleena.ns.cloudflare.com`, `yichun.ns.cloudflare.com`
- A `@` → `76.76.21.21` (Vercel)
- CNAME `*` → `cname.vercel-dns.com`
- CNAME `www` → `cname.vercel-dns.com`
- Proxy: **OFF** (DNS only) — SSL gerido pelo Vercel

---

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| `CLAUDE.md` | Documentação técnica completa (este arquivo) |
| `NOVO-CLIENTE.md` | Guia passo a passo para deploy de novo cliente |
| `COMERCIAL.md` | Apresentação comercial: módulos, funcionalidades, planos |
| `CONTEXTO.md` | Contexto histórico do projeto |
| `ajuda/index.html` | Central de Ajuda (45 artigos, todos os portais) |
| `site/index.html` | Landing page comercial Lumied |
| `ticket-widget.js` | Widget flutuante de suporte (todos os portais) |
| `deploy-novo-cliente.sh` | Script automatizado de deploy |
| `build.sh` | Build script Vercel (gera config.js) |
| `sentry-init.js` | Inicialização Sentry frontend |
