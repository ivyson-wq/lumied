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

## Edge Functions (21 ativas)

| Function | Padrão | Descrição |
|----------|--------|-----------|
| `admin` | **Router v2** | SaaS admin: escolas, planos, módulos, dashboard stats, tickets, LGPD, system health |
| `api` | **Hybrid** | Gerente: 160+ actions. Inclui indicações B2C/B2B, suporte FAQ, WhatsApp SaaS endpoints |
| `compliance` | **Router v2** | Compliance: hora extra, incidentes/bullying, certificações, inspeções, políticas, calendário regulatório, score |
| `ponto` | **Router v2** | Parser AFD (Portaria 671), espelho de ponto, dashboard, justificativas |
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

### Design (v2 — redesign 2026-04-03)
- **Dark theme** com gradientes `#0A0A0F` → `#1A1030` alternando com seções claras `#FAFAFA`
- **Glass morphism** nos cards (backdrop-filter blur + bordas translúcidas rgba)
- **Primary:** `#6C63FF` com gradiente `#6C63FF → #3B82F6` nos CTAs
- **Glow orbs** animados no hero (pseudo-elements com blur)
- **Gradient text** no headline principal
- **Fontes:** Inter (body) + Playfair Display (headings)
- Inspirado em `social.menupass.com.br`

### Seções (em ordem)
1. **Hero** (dark) — Badge glow, headline gradiente, mockup 3D com perspective, 2 CTAs, avatares social proof
2. **Stats Bar** (dark) — Contadores animados (IntersectionObserver): 23 módulos, 6 portais, 200+ actions, 99.9% uptime
3. **Diferenciais** (light) — 3 cards com imagens: IA, WhatsApp, Compliance
4. **Problemas** (light) — 6 problem cards com ícones SVG e hover lift
5. **Features** (dark) — 6 módulos com screenshots e glass morphism
6. **Vídeos** (light) — 1 vídeo featured + 8 módulos em grid (hover play)
7. **Screenshots** (dark) — Tabs Desktop/Mobile/CRM, lightbox zoom
8. **Calculadora ROI** (dark gradiente) — Sliders interativos, cálculo em tempo real
9. **Como começar** (light) — 3 passos com linha conectora
10. **Pricing** (light) — 5 planos com toggle mensal/anual, plano featured com glow
11. **Implantação** (light) — 3 cards por tier
12. **Testimonials** (dark) — 4 depoimentos com ★★★★★ e avatares
13. **CTA Final** (gradiente) — Formulário nome/email/WhatsApp
14. **Footer** (very dark `#050507`)
15. **WhatsApp Float** — Botão fixo com pulse animation

### Animações
- Fade-up on scroll em todas as seções (IntersectionObserver)
- Count-up nos stats (0 → valor final)
- Hover glow + lift nos cards e botões
- Header transparente → glass blur ao scrollar
- Pulse ring no WhatsApp float
- Perspective 3D no mockup do hero

### Técnico
- HTML/CSS/JS puro (~1500 linhas, single file)
- 100% responsivo (mobile, tablet, desktop)
- `vercel.json` redireciona `lumied.com.br` → `/site/`
- Deploy automático via `git push origin main` → Vercel

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
- **Rate Limiting** em todas as edge functions (Router v2 + legacy via `checkRateLimit`)
- **Input Validation** com schemas + sanitização XSS (`sanitize()`: HTML entities, backtick, null bytes, ampersand)
- **CORS Whitelist** dinâmico por request — aceita `*.lumied.com.br` + whitelist + Vercel previews (rejeita origins desconhecidos)
- **PBKDF2** 100k-120k iterações para senhas — centralizado em `_shared/auth.ts` com `verificarSenhaAuto()` (auto-detect hex vs base64)
- **WebAuthn/Face ID** nos portais principais
- **CSP** Content-Security-Policy header no Vercel (script-src, connect-src, frame-ancestors none)
- **HSTS** + X-Frame DENY + Permissions-Policy + nosniff + Referrer-Policy
- **Meta Webhook Signature** — HMAC-SHA256 (X-Hub-Signature-256) nos WhatsApp Workers
- **Sentry** em todas as edge functions (Router v2 via middleware + legacy via try/catch + `captureException`)
- **PIX txid** gerado com `crypto.getRandomValues()` (não Math.random)
- **LGPD**: consentimento, export (`lgpd_exportar_dados()`), anonimização (`lgpd_anonimizar()`), audit log

### Hardening realizado (2026-04-03)
- Eliminada duplicação de `hashSenha`/`gerarToken`/`validarSessao` em 4 arquivos → centralizado em `_shared/auth.ts`
- CORS bypass corrigido (antes aceitava qualquer origin)
- Rate limiting adicionado a 5 functions legadas (academico, send-email, acesso, calendar, boletos-list)
- XSS corrigido em innerHTML de boletim, achados, AI chat/insights (index.html, gerente.html)
- Token key mismatch professora corrigido (`mb_prof_token` → `prof_token`)
- Ownership check em `ausencia_delete`
- Credenciais ML hardcoded removidas
- Superuser email hardcoded removido
- Divisão por zero em cálculo de notas corrigida
- getProfessora não aceita mais gerente como professora
- Ticket escalado agora marca status "escalado" (não "respondido")

---

## Permissões (RBAC)

Sistema de controle de acesso granular por papel + overrides por usuário.

### 7 Papéis
`gerente`, `diretor`, `financeiro`, `professora`, `professora_assistente`, `secretaria`, `manutencao`

### 25 Módulos
`dashboard`, `alunos`, `turmas`, `turnos`, `atividades`, `notas`, `frequencia`, `comunicacao`, `crm`, `financeiro`, `diplomas`, `atestados`, `almoxarifado`, `compliance`, `biblioteca`, `cantina`, `transporte`, `rh`, `whatsapp`, `loja`, `analytics`, `equipe`, `familias`, `config`, `historico_aluno`

### Tabelas
- `permissoes_papel` — Defaults por papel (pode_ver, pode_editar por módulo)
- `permissoes_usuario` — Overrides por usuário (gerente pode personalizar)

### Lógica de merge
`permissoes_get` retorna defaults do papel + overrides do usuário (overrides prevalecem).

### Defaults por papel
| Papel | Acesso |
|-------|--------|
| **gerente/diretor** | Tudo (ver+editar) |
| **financeiro** | Dashboard(ver), financeiro(edit), familias(ver), boletos(edit) |
| **professora** | Dashboard(ver), notas(edit), frequencia(edit), comunicacao(edit), diplomas(edit), atividades(ver) |
| **prof. assistente** | Dashboard(ver), frequencia(edit), comunicacao(ver) |
| **secretaria** | Dashboard(ver), alunos(edit), familias(edit), atestados(edit), turmas(ver), crm(ver) |
| **manutencao** | Almoxarifado(edit) |

### UI
Botão 🔐 na lista da equipe → modal com 25 módulos × checkboxes (ver/editar) → salvar/restaurar padrão.

### Endpoints
- `permissoes_get` — Busca permissões do usuário (merge papel + overrides)
- `permissoes_update` — Salva overrides personalizados
- `permissoes_reset` — Remove overrides, volta ao padrão do papel

---

## WhatsApp Document Intake

Staff (coordenação/direção/secretaria) envia documentos via WhatsApp → classificação automática por IA → confirmação → arquivamento.

### Fluxo
1. Staff envia foto ou PDF via WhatsApp
2. Gateway detecta remetente na tabela `wa_staff`
3. Baixa mídia da Meta API → salva no bucket `wa-documentos` (Supabase Storage)
4. Claude Haiku classifica em 13 categorias
5. Envia resultado + botões [✅ Confirmar] [🔄 Reclassificar]
6. Staff confirma → status `confirmado`

### 13 Categorias
`atestado_medico`, `certificacao`, `politica`, `inspecao`, `documento_aluno`, `ata_aluno`, `contrato`, `nota_fiscal`, `comprovante`, `comunicado`, `ata_reuniao`, `relatorio`, `outro`

### Tabelas
- `wa_documentos` — Tracking de documentos recebidos (classificação, status, contexto IA)
- `wa_staff` — Staff autorizado a enviar documentos via WhatsApp
- `aluno_historico` — Atas do aluno (acesso restrito coordenação/direção)

### Bucket Storage
- `wa-documentos` — Público, 10MB, mimes: JPEG, PNG, WebP, PDF, DOC, DOCX, XLSX

---

## Banco de Dados

- **103 migrations** (009-103)
- Migrations relevantes:
  - `085-088` — Compliance: hora extra, incidentes, certificações, inspeções, políticas, calendário
  - `086` — Indicações B2C (pais indicam famílias)
  - `089` — Indicações B2B (escolas indicam escolas)
  - `090` — WhatsApp atendimento departamental
  - `091` — Ponto AFD (Portaria 671)
  - `092` — WhatsApp gateway escola→família
  - `093` — Reorganização comercial: 5 tiers (Starter/Gestão/Automação/Avançado/Rede)
  - `094` — Ciência com selfie (bloqueio do portal da professora)
  - `095` — Quiz de compliance com geração automática via Claude AI
  - `096` — WhatsApp incluído nos tiers com travas de consumo (80%/95%/100%)
  - `097` — Responsável financeiro + decisões financeiras + pacotes extras
  - `098` — Correção de preços extras (margem saudável) + resp financeiro imutável
  - `099` — IA Nativa (ia_insights, ia_conversas, ia_config)
  - `100` — ROI Calculator (roi_config, roi_resultados)
  - `101` — WhatsApp Document Intake (wa_documentos, wa_staff)
  - `102` — Histórico do Aluno (aluno_historico, atas restritas)
  - `103` — Permissões por usuário (permissoes_usuario, defaults 7 papéis × 25 módulos)

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

### Cloudflare Workers
- Account ID: `d0d79afc2b86f65653d10dbef3ceaee7`
- API Token: `cfut_6zo3yVZSvAF8GFmGlRVgFpzPKJYw9oj7vYKmBPQOd1b0dd3e`

| Worker | URL | Cron | Descrição |
|--------|-----|------|-----------|
| `lumied-monitor` | `https://lumied-monitor.ivyson.workers.dev` | `*/15 * * * *` | Monitoramento Sentry/Vercel/Supabase |
| `whatsapp-worker` | `https://whatsapp-worker.ivyson.workers.dev` | `*/30 * * * *` | Atendimento departamental + push comercial (Maple Bear BG) |
| `whatsapp-gateway` | `https://whatsapp-gateway.ivyson.workers.dev` | `0 9 * * 6` | Comunicação escola→família: confirmações, FAQ bot (Claude), relatório semanal (Claude), estou-a-caminho |

**Deploy Workers:**
```bash
cd whatsapp-gateway  # ou whatsapp-worker
CLOUDFLARE_API_TOKEN=cfut_6zo3yVZSvAF8GFmGlRVgFpzPKJYw9oj7vYKmBPQOd1b0dd3e CLOUDFLARE_ACCOUNT_ID=d0d79afc2b86f65653d10dbef3ceaee7 npx wrangler deploy
```

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
| `indicar.html` | Página de indicação B2C (pais indicam famílias) |
| `parceiros.html` | Página de indicação B2B (escolas indicam escolas — Lumied Partners) |
| `suporte-widget.js` | Widget de suporte inteligente (FAQ + ticket) em todos os portais |
| `whatsapp-worker/` | Cloudflare Worker — atendimento departamental WhatsApp |
| `whatsapp-gateway/` | Cloudflare Worker — comunicação escola→família WhatsApp |
| `lumied-ux.js` | UX Kit: onboarding, empty states, validação, toasts, busca sidebar |

---

## Planos Comerciais (5 tiers)

| Tier | Preço/mês | Anual | Alunos | Módulos | WhatsApp |
|------|-----------|-------|--------|---------|----------|
| **Starter** | R$ 259 | R$ 207 | 80 | 6 | — |
| **Gestão** | R$ 649 | R$ 519 | 300 | 19 | — |
| **Automação** | R$ 1.249 | R$ 999 | 800 | 30 | 200 msgs/mês |
| **Avançado** | R$ 2.079 | R$ 1.659 | 1.500 | 35 | 500 msgs/mês |
| **Rede** | R$ 2.939 | R$ 2.351 | Ilimitado | Todos | 2.000 msgs/mês |

### Pacotes Extras (aprovação do resp financeiro)

| Extra | Preço | Margem |
|-------|-------|--------|
| 100 msgs WhatsApp | R$ 69,90/mês | 50% |
| 500 msgs WhatsApp | R$ 299,90/mês | 42% |
| 1.000 msgs WhatsApp | R$ 549,90/mês | 36% |
| Excedente avulso | R$ 0,75/msg | 53% |
| 10 GB storage | R$ 19,90/mês | 94% |
| 50 GB storage | R$ 79,90/mês | 93% |
| 5 usuários | R$ 29,90/mês | ~100% |
| 20 usuários | R$ 89,90/mês | ~100% |

### WhatsApp — Travas de consumo
- **80%** cota: alerta informativo ao gerente
- **95%** cota: alerta URGENTE
- **100%** cota: **BLOQUEADO** — cria decisão financeira pendente → resp financeiro deve aprovar

### Responsável Financeiro
- Definido no **onboarding** (primeira vez)
- Após definição: **imutável por gerentes** — campos read-only
- Só **staff Lumied** pode alterar (action `staff_alterar_resp_financeiro` via admin.html)
- Histórico em `resp_financeiro_historico` (quem alterou, quando, motivo)
- Aprova: excedentes, upgrades, downgrades, compra de extras

---

## Compliance (Automação+)

### Módulos
- **Hora extra**: horários, ponto, verificação automática (cron 12/12h), alerta email
- **Incidentes/Bullying**: registro, investigação, encaminhamento Conselho Tutelar
- **Certificações**: 8 tipos obrigatórios, vencimento automático, treinamentos
- **Inspeções**: checklists (cantina, infraestrutura, transporte), score conformidade
- **Políticas**: repositório com versão, aceite obrigatório
- **Calendário regulatório**: 13 obrigações (RAIS, eSocial, FGTS, Censo, AVCB, LGPD RIPD)
- **Score**: 0-100 baseado em problemas abertos

### Ciência com Selfie
- Ocorrência confirmada → cria ciência pendente → **bloqueia portal da professora**
- Professora: lê notificação → tira selfie (câmera frontal) → opcionalmente escreve ressalva → confirma
- Selfie: bucket privado, hash SHA-256, metadata (IP, device, timestamp)
- Status: "ciente" ou "ciente_com_ressalva"

### Quiz de Compliance (IA)
- Gerente seleciona política/protocolo → **Claude Haiku gera perguntas automaticamente**
- Múltipla escolha, 3 tentativas, nota mínima 70% configurável
- Temas: evacuação, primeiros socorros, incêndio, bullying, LGPD, higiene
- Periodicidade: mensal, trimestral, semestral, anual
- Professora: banner no portal → quiz fullscreen → resultado imediato
- Cron diário expira quizzes vencidos

---

## Ponto AFD (Portaria MTP 671/2021)
- Parser AFD (registros tipo 1/3/5/9) de REP-C homologado
- De-para PIS→funcionário, cálculo pares entrada/saída, espelho mensal
- Justificativas com aprovação, dashboard
- Edge Function `ponto` (15 actions)

## Indicações
- **B2C** (`indicar.html`): pais indicam famílias, R$100+R$300, CRM auto
- **B2B** (`parceiros.html`): escolas indicam escolas, bonificações configuráveis

## WhatsApp
- **Worker** (`whatsapp-worker`): atendimento departamental, urgências, push comercial
- **Gateway** (`whatsapp-gateway`): comunicação escola→família, confirmações, FAQ bot Claude, relatório semanal, estou-a-caminho, janela 24h

## UX Kit (`lumied-ux.js`)
- Onboarding tour de primeiro uso (por portal, 3-5 steps)
- Empty states melhorados (ícone + explicação + próximo passo)
- Confirmação para ações destrutivas (modal)
- Validação inline (blur, email, obrigatório)
- Toast global (success/error/info com ícone)
- Touch targets 44px no mobile
- Busca na sidebar do gerente (filtra 45+ painéis)

---

## Pendências de Configuração (WhatsApp)

### Secrets ainda não configurados nos Workers:
1. `WHATSAPP_TOKEN` — Obtido após criar app no Meta Business Manager
2. `WHATSAPP_VERIFY_TOKEN` — Inventar uma string (ex: `lumied_wa_verify_2026`)
3. `META_PHONE_NUMBER_ID` — Obtido no Meta Developers → WhatsApp → API Setup
4. `META_APP_SECRET` — App Secret do Meta Developers (para validação HMAC-SHA256 do webhook)
5. `SUPABASE_SERVICE_KEY` — Supabase Dashboard → Settings → API → service_role
6. `ANTHROPIC_API_KEY` — console.anthropic.com (para FAQ bot + relatório semanal)
7. `APP_INTERNAL_SECRET` — Inventar uma string para auth entre Worker e app
8. `APP_BASE_URL` — URL do Supabase ou do app

### Meta Business Manager — Passos pendentes:
1. Conta verificada no Meta Business Manager (CNPJ + site) — 3-7 dias
2. App criado no Meta Developers com produto WhatsApp
3. Número dedicado cadastrado e verificado
4. Templates cadastrados e aprovados (1-3 dias):
   - `aviso_escolar_v1` (Utility) — comunicados
   - `maple_bear_lembrete_24h` (Utility)
   - `maple_bear_lembrete_2h` (Utility)
   - `maple_bear_followup` (Utility)
5. Webhook configurado → `https://whatsapp-gateway.ivyson.workers.dev/webhook`
