# CLAUDE.md — Lumied (Maple Bear RS Portal)

## Visão Geral do Projeto

Plataforma SaaS de gestão escolar completa com 23 módulos, multi-tenancy, feature gating por escola, 4 temas visuais, e LGPD compliance. Originalmente desenvolvida para Maple Bear Caxias do Sul, agora vendável como produto para qualquer escola bilíngue.

**Domínio:** `maplebearcaxias.lumied.com.br` (padrão: `escola.lumied.com.br`)
**Site comercial:** `maplebearcaxias.lumied.com.br/site/`

**Stack:**
- Frontend: HTML/CSS/JS + ES Modules, bundled com **esbuild** (32ms build), hospedado no **Vercel**
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Render** (API Banco Inter)
- Chrome Extension: Manifest V3 para WhatsApp Web (templates CRM)
- CI/CD: **GitHub Actions** (lint → test → deploy)
- Testes: **Deno test** (44 unit) + **Playwright** (56 e2e) = 100 testes
- Git: GitHub (`ivyson-wq/maple-bear-rs`)

---

## Arquitetura

### Portais (7 HTML files)
| Portal | Arquivo | Público | Descrição |
|--------|---------|---------|-----------|
| Pais | `index.html` | Famílias | Login Google/Magic Link/biometria. Pickup, boletim, agenda digital, boletos |
| Gerente | `gerente.html` | Direção | ~45 painéis: analytics, financeiro, CRM, almoxarifado, acadêmico, comunicação |
| Professora | `professora.html` | Docentes | Chamada, notas, agenda digital, diplomas, materiais, growth plan |
| Secretaria | `secretaria.html` | Secretaria | Validação de atestados |
| Admin | `admin.html` | Superadmin (SaaS) | Gestão de escolas, planos, módulos, temas |
| Aluno | `aluno.html` | Alunos | Notas, frequência, provas, calendário |
| Hub | `area-restrita.html` | Staff | Seletor de portais |

### Edge Functions (17 + 1 health)
| Function | Padrão | Descrição |
|----------|--------|-----------|
| `admin` | **Router v2** | Escolas, planos, módulos. Auth + rate limit + validation |
| `api` | **Hybrid** (Router parcial + legado) | Gerente: 139 actions. Rate limit + sanitização |
| `diplomas` | **Hybrid** (legado + rate limit) | Professora/pais: 108 actions |
| `academico` | Legado | Notas, frequência, diário, documentos, relatórios BNCC, portal aluno, provas |
| `comunicacao` | **Router v2** | Agenda digital, chat escola-família |
| `cobranca` | **Router v2** | Régua de cobrança automática |
| `operacional` | **Router v2** | Biblioteca, cantina, transporte |
| `financeiro-ext` | **Router v2** | PIX integrado, integração contábil |
| `rh` | **Router v2** | RH, folha de pagamento, ponto, férias |
| `loja` | **Router v2** | E-commerce / loja virtual |
| `health` | Standalone | Health check (DB + Storage latency) |
| `acesso` | Legado | Controle de acesso famílias |
| `boletos-list` | Legado | Integração mTLS Banco Inter |
| `calendar` | Legado | Agenda do responsável |
| `inter-webhook` | Legado | Webhook boletos Inter |
| `send-email` | Legado | Envio de emails |

### Shared Modules (`_shared/`)
| Módulo | Função |
|--------|--------|
| `router.ts` | Router com middleware chain (auth, rateLimit, validate, feature gate) |
| `auth.ts` | Hash PBKDF2, verify, tokens, sessões, upload |
| `validation.ts` | Schemas tipados, sanitização XSS |
| `errors.ts` | AppError com códigos (AUTH_INVALID, RATE_LIMITED, etc.) |
| `ratelimit.ts` | Rate limiting por IP/action (5/min login, 120/min API) |
| `logger.ts` | Logging JSON estruturado |
| `cache.ts` | Cache in-memory com TTL |
| `cors.ts` | CORS whitelist por domínio |
| `modulos.ts` | Feature gating por escola/plano |
| `webauthn.ts` | Verificação biométrica |

### Frontend Modules (`src/`)
| Módulo | Função |
|--------|--------|
| `shared/api-client.js` | Fetch wrapper com auto-auth, retry, cache |
| `shared/state.js` | Store reativo (subscribe, persist, online detection) |
| `shared/components/toast.js` | Notificações toast |
| `shared/components/modal.js` | Modal reutilizável |
| `shared/components/data-table.js` | Tabela sortable com formatters |

---

## 23 Módulos (Features)

### Tier Essencial
1. Notas / Boletim / Conceitos
2. Controle de Frequência / Chamada
3. Diário de Classe Digital
7. Documentos do Aluno
22. Pesquisas / Enquetes / Autorizações

### Tier Profissional (+ Essencial)
4. Agenda Digital / Diário do Aluno
5. Comunicação / Chat escola-família
6. Matrícula / Rematrícula Online
10. Relatórios Pedagógicos / BNCC
13. Portal do Aluno
19. Banco de Provas / Avaliações Online

### Tier Premium (+ Profissional)
8. Contratos Digitais + Assinatura Eletrônica
11. Régua de Cobrança Automática
12. PIX Integrado
15. Gestão de Biblioteca
18. BI / Analytics Avançado
20. Gestão de Cantina / Refeitório
21. Transporte Escolar

### Tier Enterprise (+ Premium)
9. App Nativo (iOS/Android)
14. EAD / Aulas Online
16. Integração Contábil
17. Gestão de RH / Folha
23. E-commerce / Loja Virtual

---

## Segurança

- **RLS** habilitado em 20+ tabelas com policies restritivas reais
- **Rate Limiting** em todas as 17 edge functions
- **Input Validation** com schemas + sanitização XSS
- **PBKDF2** 100k-120k iterações para senhas
- **WebAuthn/Face ID** nos portais principais
- **HSTS** + X-Frame DENY + Permissions-Policy + nosniff
- **LGPD**: tabelas de consentimento, export de dados (`lgpd_exportar_dados()`), anonimização (`lgpd_anonimizar()`)
- **Audit log**: `lgpd_audit_log` para rastrear acessos a dados pessoais

---

## Multi-tenancy

- `escola_id` em 30 tabelas de dados
- `plano_limites`: limites por recurso (max_alunos, max_storage_gb, etc.)
- `check_limite()`: função SQL para verificar limites
- `escola_uso`: cache de uso atual
- Subdomínios por escola (`escolas.subdominio`)
- Feature gating granular: admin toggle item a item por escola

---

## Temas Visuais (4)

| Tema | Público-alvo | Arquivo preview |
|------|-------------|-----------------|
| Lúdico | Infantil/Fundamental | `temas/ludico.html` |
| Sério | Ensino Médio | `temas/serio.html` |
| Interativo | Idiomas/Geral | `temas/interativo.html` |
| Corporativo | Padrão atual | `gerente.html` |

Selecionável no Admin Panel por escola. CSS em `themes.css`.

---

## Banco de Dados

- **78 migrations** (009-078)
- **Tabela `alunos`** centralizada (normalização)
- **80+ indexes** em FKs e colunas de query
- **Materialized views**: `mv_dashboard_stats`, `mv_frequencia_resumo`
- **Triggers**: `trigger_set_atualizado_em` em 16 tabelas
- **Funções**: `check_limite()`, `lgpd_exportar_dados()`, `lgpd_anonimizar()`, `cleanup_expired_sessions()`, `refresh_dashboard_stats()`

---

## Comandos

```bash
# Build frontend
node build.js

# Testes unitários
npm test
# ou: npx deno-bin test supabase/functions/__tests__/ --allow-net --allow-read --allow-env

# Testes e2e
npx playwright test

# Deploy Edge Functions
supabase functions deploy <nome> --no-verify-jwt

# Deploy todas as functions
for fn in admin api diplomas academico comunicacao cobranca operacional financeiro-ext rh loja health; do
  supabase functions deploy $fn --no-verify-jwt
done

# Push migrations
supabase db push

# Deploy frontend (Vercel)
npx vercel --yes --prod

# Health check
curl https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/health
```

---

## CI/CD

- `.github/workflows/ci.yml`: lint → test → deploy (on push to main)
- `.github/workflows/auto-merge-claude.yml`: auto-merge branches `claude/**`
- Claude só pode push para `claude/**` (proxy Git bloqueia main)

---

## Decisões Arquiteturais

### Router Pattern (v2)
Functions refatoradas usam `Router` + middleware chain:
```typescript
router.on("action_name", authGerente, rateLimit(), validateInput(schema), requireFeature("slug"), handler);
```
Functions legadas (`api`, `diplomas`) usam padrão híbrido com rate limit + sanitização integrados.

### Feature Gating
- Tabela `modulos` com 38 módulos (15 existentes + 23 novos)
- Tabela `plano_modulos` mapeia módulos por plano
- Tabela `escola_modulos` permite override granular
- Frontend: `data-modulo` attributes + `applyModuleGating()`

### Bottom Nav (Mobile)
- Padrão: 4-5 itens principais + botão "Mais" com grid expandível
- Pais: Início, Dia a Dia, Boletim, Boletos, ☰ Mais
- Professora: Fila, Chamada, Notas, Agenda, ☰ Mais

### Pickup Animado
- Portal pais: cenário com céu, estrada, carro animado + família + ETA
- Portal professora: mini-pista animada em cada card da fila

---

## Observabilidade (Sentry)

**Organização:** `lumied.sentry.io`
**Projeto:** `javascript`

### Frontend (`sentry-init.js`)
- SDK Sentry Browser v9.25.0 via CDN (bundle com tracing + replay)
- Incluído em todos os 5 portais principais via `<script src="/sentry-init.js">`
- Auto-detecção de ambiente (development/staging/production) por hostname
- Performance monitoring: `tracesSampleRate` 0.2 (prod), 1.0 (dev)
- Session Replay: 10% sessões (prod), 100% em erros
- `beforeSend`: scrub de dados sensíveis (password, token, CPF, cartão)
- Ignora erros não-acionáveis (ResizeObserver, AbortError, etc.)
- Helpers globais: `SentrySetUser()`, `SentryClearUser()`, `SentryCaptureException()`, `SentryCaptureMessage()`

### Edge Functions (`_shared/sentry.ts`)
- Reporter via HTTP envelope API (zero dependências externas)
- `captureException(error, extra)` — envia eventos de erro com stack trace
- `captureMessage(message, level, extra)` — envia mensagens
- DSN via env var `SENTRY_DSN`
- Integrado no `withErrorHandler` (`errors.ts`) — fire-and-forget

### Alertas Configurados
- **High Error Rate** — >10 erros/min
- **New Issues** — alerta em issues inéditas
- **P95 > 3s** — alerta de performance (warning 2s, critical 3s)

### CI (Sentry Release)
- Job `sentry-release` no CI: cria release, upload de source maps, marca deploy
- Secrets: `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`

---

## Edge Functions Adicionais (pós-merge)

| Function | Descrição |
|----------|-----------|
| `boletos-sync` | Sync de boletos do Banco Inter |
| `daily-digest` | Resumo diário por aluno (email + push) |

Total: **18 Edge Functions ativas** no Supabase.

---

## Deno Configuration

- `supabase/functions/deno.json` — Import map para Edge Functions:
  - `@std/testing/asserts` → `jsr:@std/assert`
  - `@supabase/supabase-js` → `https://esm.sh/@supabase/supabase-js@2`
- CI usa `--config supabase/functions/deno.json` para lint e testes

---

## GitHub Actions

### `ci.yml` — CI/CD Pipeline
1. **Lint & Type Check** — `deno lint --config deno.json` nos `_shared/` e `__tests__/`
2. **Unit Tests** — `deno test --config deno.json` com `--allow-net --allow-read --allow-env`
3. **Deploy Edge Functions** — `supabase functions deploy` (todas, exceto `_shared` e `__tests__`)
4. **Deploy Frontend (Vercel)** — `vercel --yes --prod`
5. **Sentry Release** — cria release, upload source maps, marca deploy

### `auto-merge-claude.yml` — Auto-merge
- Trigger: push em `claude/**`
- Merge automático em `main` com `--no-ff`
- Usa `actions/checkout@v5` (Node.js 24 compatível)

### Secrets Configurados
| Secret | Serviço |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | Supabase Management API |
| `VERCEL_TOKEN` | Vercel deploy |
| `VERCEL_ORG_ID` | Vercel org |
| `VERCEL_PROJECT_ID` | Vercel project |
| `SENTRY_AUTH_TOKEN` | Sentry releases |
| `SENTRY_DSN` | Sentry event ingestion |

---

## Permissões (`settings.json`)

```json
{
  "permissions": {
    "allow": ["Edit(src/**)", "Edit(app/**)", "Bash(npm run *)", "Bash(git add*)", "Bash(git commit*)"],
    "deny": ["Edit(.env*)", "Bash(rm -rf*)", "Bash(git push*)"]
  }
}
```
<<<<<<< HEAD
=======
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
| `site/index.html` | Landing page comercial "EduFlow" (vendas, planos, módulos, FAQ) |

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

---

## Site Comercial (Landing Page)

Landing page interativa em `site/index.html` — marca **"EduFlow"** (editável).

**URL**: `https://maplebearcaxias.lumied.com.br/site/` (ou domínio próprio para vendas)

### Seções
- **Hero**: título gradiente, mockup animado, stats (14 módulos, 4 portais, 6 integrações)
- **Portais**: 4 cards com hover (pais, professoras, secretaria, gerente)
- **Módulos**: 6 tabs interativas (almoxarifado, CRM, financeiro, pickup, emergência, manutenção) com features e visual
- **Diferenciais**: 6 cards animados (white-label, biometria, NF-e, WhatsApp, pickup GPS, setup 15min)
- **Números**: barra com métricas do sistema
- **Preços**: 3 planos (Essencial, Profissional, Completo) com badge "Mais popular", exemplos de valor
- **FAQ**: 6 perguntas colapsáveis
- **CTA**: botões WhatsApp + email
- **Footer**: links, contato, copyright

### Técnico
- HTML/CSS/JS puro (zero dependências)
- Google Fonts (Inter + Playfair Display)
- Scroll reveal animations (IntersectionObserver)
- 100% responsivo (mobile, tablet, desktop)
- CTAs apontam para WhatsApp (número editável no HTML)
- Marca "EduFlow" editável em ~10 ocorrências no arquivo
>>>>>>> 28bad58 (feat: migrar domínio para escola.lumied.com.br)
