# CLAUDE.md — Lumied

## Visão Geral

Plataforma SaaS de gestão escolar — 23 módulos, multi-tenancy, feature gating por escola, 4 temas visuais, LGPD compliance. Marca: **Lumied**.

**Domínios:** `lumied.com.br` (landing), `admin.lumied.com.br` (painel central), `escola.lumied.com.br` (SaaS), `escola.lumied.com.br/admin.html` (config escola, só staff)
**DNS:** Cloudflare (`aleena.ns.cloudflare.com`, `yichun.ns.cloudflare.com`). Subdomínios auto-criados via Vercel API no onboarding.

**Stack:** HTML/CSS/JS + ES Modules + esbuild → Vercel | Supabase (PostgreSQL + Edge Functions Deno/TS) | Relay mTLS Node.js no Render (Banco Inter) | Chrome Extension Manifest V3 (WhatsApp CRM) | CI/CD: GitHub Actions | Testes: Deno (unit) + Playwright (e2e) | Sentry + Better Stack | Git: `ivyson-wq/maple-bear-rs`

**Supabase:** `https://brgorknbrjlfwvrrlwxj.supabase.co`

---

## Portais (8 HTML files)

| Portal | Arquivo | Público | Resumo |
|--------|---------|---------|--------|
| Pais | `index.html` | Famílias | Magic Link/biometria. Pickup, boletim, agenda, boletos, controle de acesso (face, presença, autorizados retirada) |
| Gerente | `gerente.html` | Direção | ~55 painéis: analytics, financeiro, CRM, almoxarifado, acadêmico, comunicação, controle de acesso (6 painéis) |
| Professora | `professora.html` | Docentes | Dashboard + alertas acesso real-time (polling 10s). Chamada, notas, agenda, diplomas, PDI, materiais, diário. Feature-gated, 14 páginas |
| Equipe | `secretaria.html` | Sec+Com+Fin+Man | Feature-gated sidebar. 7 grupos: Secretaria, Comercial, Financeiro, Infraestrutura, Compliance |
| Admin Escola | `admin.html` | Staff+Admin | Dashboard, plano, módulos, tickets, LGPD, config, API |
| Admin Central | `admin-central.html` | Staff Lumied | Dashboard SaaS, escolas, staff, audit log, tickets, onboarding |
| Aluno | `aluno.html` | Alunos | Notas, frequência, provas, calendário |
| Hub | `area-restrita.html` | Staff | Seletor de portais role-aware |

---

## Edge Functions (22 ativas)

| Function | Descrição |
|----------|-----------|
| `admin` | SaaS admin: escolas, planos, módulos, tickets, LGPD, health |
| `api` | Gerente: 160+ actions. Indicações, FAQ, WhatsApp endpoints |
| `acesso` | Face Control ID (iDFace) + RFID. Dispositivos, faces, permissões, eventos, presença |
| `compliance` | CLT: ponto HE 50%/100%, hora noturna, banco horas, feriados. Incidentes, certificações, inspeções, políticas |
| `ponto` | Parser AFD (Portaria 671), espelho de ponto, justificativas |
| `diplomas` | Professora/pais: 108 actions (incl. almoxarifado) |
| `academico` | Notas, frequência, diário, relatórios BNCC, portal aluno |
| `comunicacao` | Agenda digital, chat escola-família |
| `cobranca` | Régua de cobrança automática |
| `operacional` | Biblioteca, cantina, transporte |
| `financeiro-ext` | PIX integrado, integração contábil |
| `rh` | RH, folha, ponto, férias |
| `loja` | E-commerce |
| `lumied-ai` | IA Lumi: Claude, insights, ROI, tool use via MCP |
| `mcp` | MCP server JSON-RPC 2.0 — tools por escopo (staff/gerente/compliance/dev) |
| `health` | Health check (DB + Storage latency) |
| `ticket-resolver` | Auto-resposta tickets: FAQ + Claude tool use via MCP (pg_cron 1h) |
| `send-email` | Emails via Resend (branding dinâmico) |
| `daily-digest` | Resumo diário por aluno |
| `boletos-list/sync` | Integração mTLS Banco Inter (legado) |
| `inter-webhook` | Webhook boletos Inter (legado) |

**Deploy:** `supabase functions deploy <nome> --no-verify-jwt --import-map supabase/functions/deno.json`
> `--project-ref` não necessário quando linkado (`supabase link`).

---

## MCP Server

**Endpoint:** `POST https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/mcp`
**Transport:** Streamable HTTP (JSON-RPC 2.0) | **Auth:** `Bearer <token>` (scope auto-detectado)

**Escopos:** `public` < `professora` < `secretaria` < `gerente` < `staff` < `dev` (MCP_DEV_KEY)

**Tools por scope:**
- **Staff:** tickets_list_open, ticket_get/respond/close, escolas_list, escola_status, sql_query (read-only), sentry_recent_errors, staff_audit_log
- **Gerente:** kpis_resumo_dia, buscar_aluno, analise_inadimplencia, alunos_frequencia_critica, leads_parados, redigir_comunicado, analisar_turma, modulos_ativos
- **Compliance:** compliance_score, analisar_ponto_mes, certificacoes_vencendo, gerar_quiz_politica, alertas_compliance
- **Dev:** list_migrations, describe_table, health_check, invoke_edge_function, get_system_info

**Lumi IA:** `ai_perguntar_mcp` (gerente/secretaria) usa `askClaudeWithTools` com loop agêntico. Professora usa `ai_perguntar_prof` (contexto pré-coletado).

**Secrets:** `ANTHROPIC_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (brgorknbrjlfwvrrlwxj), `SENTRY_AUTH_TOKEN` (opt), `MCP_DEV_KEY` (opt)

---

## Multi-tenancy

- **Multi-papéis**: `papeis text[]` em `usuarios` — gerente, diretor, financeiro, professora, professora_assistente, secretaria, comercial, manutencao
- `escola_id` em 30+ tabelas | `plano_limites` + `check_limite()` + `escola_uso`
- Feature gating: `plano_modulos` + `escola_modulos` override | 4 temas visuais
- Hub detecta sessão e mostra só portais do usuário

### Unificação de Dados
- **Alunos ↔ Famílias** (Mig 109): trigger `trg_sync_familia_aluno` sincroniza `familias` → `alunos`
- **Usuários unificados** (Mig 110): `usuarios` é fonte canônica, triggers bidirecionais para tabelas legadas (`gerentes`, `professoras`, `secretarias`). Sessão unificada `sessoes`.

---

## Admin (2 níveis)

**Central** (`admin-central.html`): Dashboard MRR/ARR, escolas, staff CRUD, audit log, tickets, onboarding automático.
**Escola** (`admin.html`): Dashboard, plano, adicionais, módulos, tickets, LGPD, config, API, admins. Auth dual (admin + staff fallback).

**Onboarding** (`staff_criar_escola`): cria escola + config + gerente + usuarios + módulos do plano + séries + subdomínio Vercel. ~2 min.

**Superusuários** (`lumied_staff`): tabela/sessões/audit separados. Cargos: fundador, cto, suporte, comercial, cs.

---

## Tickets de Suporte

3 camadas: email imediato (Resend), FAQ auto-resposta (pg_cron 15min), Claude AI Agent (MCP-powered 1h).
Widget flutuante "?" em todos os portais. Número sequencial #1001+.

---

## Compliance — Ponto CLT

Regras CLT: intervalo intrajornada, HE 50%/100%, limite 2h/dia, jornada 10h max, tolerância 10min, hora noturna (52:30, +20%), banco de horas, DSR, jornada professor. 16 params configuráveis.

**Fluxo:** Upload CSV → pré-visualização → `compliance_importar_ponto` → `compliance_verificar_ponto` (processa CLT) → ocorrências → alerta email + ciência com selfie.

**Ciência com selfie:** bloqueia portal da professora até confirmar. Selfie + hash SHA-256 + metadata.
**Quiz compliance:** Claude Haiku gera perguntas, nota mín 70%, cron expira vencidos.

---

## Controle de Acesso (Face + RFID)

**Dispositivos:** 6 Control iD iDFace | **Protocolo:** HTTP callbacks
**Fluxo:** Face/RFID reconhecido → evento → presença (entrada/saída) → alerta responsável → professora (polling 10s)
**Cadastro público:** link único 7 dias, câmera celular, validação qualidade Control iD, aprovação gerente → sync 6 dispositivos.

---

## Contratos Digitais & Assinatura Eletrônica

Templates HTML com variáveis → contrato preenchido → envio família → verificação email (6 dígitos) → assinatura canvas → hash SHA-256 + código `LUM-XXXXXXXX`. Verificação pública: `/verificar.html`.
**Validade:** Art. 4º, Lei 14.063/2020 (assinatura eletrônica simples com 2FA).

---

## Almoxarifado

**Professora:** catálogo, minha turma (orçamento/gasto/pendente/disponível por turma), requisições, notificações. Multi-turma. Excel import com matching por word-overlap. Novos itens com preço estimado. Projeção orçamento em tempo real no carrinho.
**Gerente:** painel (pendentes + turma budgets incl. pendentes), aprovar/rejeitar com qty override, busca preços (Zoom/ML/Shopee/Reval), encaminhar compra, catálogo CRUD, orçamentos por turma/mês, relatório.
**Budget:** requisições pendentes JÁ reduzem orçamento. `gasto = aprovado + pendente`. Display: "Comprometido (aprovado + pendente) | Disponível | Orçamento".

---

## Permissões (RBAC)

7 papéis × 25 módulos. `permissoes_papel` (defaults) + `permissoes_usuario` (overrides). Gerente configura via modal checkboxes (ver/editar).

---

## WhatsApp

- **Worker** (`whatsapp-worker`): atendimento departamental, urgências, push comercial
- **Gateway** (`whatsapp-gateway`): comunicação escola→família, confirmações, FAQ bot Claude, relatório semanal, document intake (13 categorias via Claude Haiku)

---

## Planos Comerciais (3 tiers)

| Tier | Preço/mês | Alunos | Módulos | WhatsApp |
|------|-----------|--------|---------|----------|
| Start | R$ 1.200 | 300 | 15 | — |
| Evolução | R$ 1.800 | 800 | 23 | 500 msgs/mês |
| Prestige | R$ 3.300 | Ilimitado | Todos | 2.000 msgs/mês |

WhatsApp travas: 80% alerta, 95% urgente, 100% bloqueio. Resp financeiro imutável (só staff altera).

---

## Blog Automation

2 Remote Triggers publicam 1 artigo SEO/dia automaticamente:
- **`lumied-daily-blog`** (`trig_016b85mG9n2bhfnKYRkR9YgX`): 08:00 BRT, publica de `scripts/seo-topics.json`, Sonnet 4.6
- **`lumied-weekly-topic-refill`** (`trig_01MwQDjREyasfxp71bQUAiSv`): dom 07:00 BRT, gera +30 tópicos se pending < 30
- Playbooks: `scripts/daily-blog-agent.md`, `scripts/weekly-topic-refill-agent.md`
- IndexNow: `scripts/indexnow-submit.sh` | Key: `507a0a2834397332e34d6e9c94480acd`
- Google Search Console verificado, sitemap submetido

---

## Segurança (resumo)

RLS 20+ tabelas | Rate limiting DB-backed (migration 218) | Input validation + sanitização XSS recursiva | CORS whitelist dinâmico `*.lumied.com.br` | PBKDF2 100-120k iterations | WebAuthn/Face ID | CSP + SRI + HSTS + X-Frame DENY | LGPD (consentimento, export, anonimização) | Meta HMAC-SHA256 fail-closed | Sentry padronizado | PIX CRC16-CCITT

4 rodadas hardening (2026-04-10/11): ~90 bugs fixados, 7 migrations, 100% edge functions + workers auditados. Ver `git log` para detalhes.

---

## Observabilidade

**Sentry** (`lumied.sentry.io`): SDK Browser v9.25.0 + `_shared/sentry.ts`. Traces 0.2, Replay 10%.
**Better Stack**: API REST, integrado no admin.
**Google Analytics** (G-QDFKQEVV4P): `/analytics.js` em portais autenticados, inline em páginas públicas. 49 páginas cobertas.

---

## Credenciais e Secrets

### Supabase Edge Functions
`ANTHROPIC_API_KEY`, `VERCEL_API_TOKEN`, `RESEND_API_KEY`, `APP_URL`, `ML_CLIENT_ID/SECRET`, `INTER_CLIENT_ID/SECRET/CONTA`, `INTER_RELAY_URL`, `RELAY_SECRET`, `GOOGLE_MAPS_KEY`, `SENTRY_DSN`, `CLAUDE_TRIGGER_TOKEN`, `CRON_INTERNAL_KEY`, `CONTROLID_DEFAULT_PASSWORD`

### Google OAuth
Client configurado no Supabase Auth. **NÃO usar `flowType` no `createClient()`** — causa TDZ error com `#access_token`. `getSession()` detecta tokens automaticamente.

### Cloudflare Workers
Account ID e API Token em env (não commitar).

| Worker | URL | Cron |
|--------|-----|------|
| `lumied-monitor` | `lumied-monitor.ivyson.workers.dev` | `*/15 * * * *` |
| `whatsapp-worker` | `whatsapp-worker.ivyson.workers.dev` | `*/30 * * * *` |
| `whatsapp-gateway` | `whatsapp-gateway.ivyson.workers.dev` | `0 9 * * 6` |

Secrets Workers: `WHATSAPP_VERIFY_TOKEN`, `META_PHONE_NUMBER_ID` (1056345077565103), `META_WHATSAPP_BUSINESS_ID` (802737572889384), `APP_INTERNAL_SECRET`, `APP_BASE_URL`, `META_APP_SECRET`, `WHATSAPP_TOKEN` (temporário ~24h, trocar por permanente via System User).

### Vercel
Project: `prj_6uDL0URPHd5DiMj5ahaZcEltRfSL` | Team: `team_k3kAHF00rep1GFrBRA53OmGg`

### DNS (Cloudflare)
Zone `lumied.com.br` (ID: `8b2c34bf85fc32f734de3facd380956d`). A `@` → 76.76.21.21 (Vercel). CNAME `*` e `www` → `cname.vercel-dns.com`. Proxy OFF.

### GitHub Actions Secrets
`SUPABASE_ACCESS_TOKEN`, `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `BETTERUPTIME_API_KEY`, `BETTERUPTIME_HEARTBEAT_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

---

## MCP Client Setup (Dev)

| MCP | Auth | Uso |
|-----|------|-----|
| **lumied** | Bearer (staff_login) | Tools internas Lumied |
| **supabase** | OAuth | Gerenciar projetos, SQL, migrations |
| **github** | Bearer PAT | Repos, issues, PRs |
| **meta** | Env vars | Instagram + Threads (60 tools) |

Token Lumied: `staff_login` → Bearer em `.claude.json`. Expira 7 dias.

---

## Comandos

```bash
# Deploy edge function
supabase functions deploy <nome> --no-verify-jwt --import-map supabase/functions/deno.json

# Deploy todas
for fn in admin api diplomas academico comunicacao cobranca operacional financeiro-ext rh loja health ticket-resolver; do
  supabase functions deploy $fn --no-verify-jwt --import-map supabase/functions/deno.json
done

# SQL remoto
curl --ssl-no-revoke -s -X POST "https://api.supabase.com/v1/projects/brgorknbrjlfwvrrlwxj/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1"}'

# Build + test + deploy frontend
node build.js && npm test && git push origin main

# Deploy Cloudflare Workers
cd whatsapp-gateway && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID npx wrangler deploy
```

---

## Banco de Dados

222 migrations (009-222). Consultar via `supabase migrations list` ou `SELECT * FROM supabase_migrations.schema_migrations`.

**Migrations-chave:** 048 (planos/modulos), 075 (multitenancy), 078 (LGPD), 081-082 (tickets), 084 (multi_papeis), 085-088 (compliance), 091 (ponto AFD), 093 (5 tiers comerciais), 099-100 (IA+ROI), 103 (RBAC), 104-105 (staff+seed), 109-110 (unificação), 111-114 (ponto CLT + acesso), 215-222 (hardening + escola_id + rate limits)

---

## Performance

- Realtime WebSocket em `solicitacoes`, `inscricoes_atividades`, `pickup_notificacoes`
- Service Worker v5: network-first HTML/JS, cache-first CSS/img/fonts
- Vercel CDN: `no-cache, no-store` para HTML/JS
- Select otimizados (colunas específicas + paginação)

---

## Post-deploy Automation

Workflow `.github/workflows/postdeploy.yml` + `scripts/postdeploy.mjs`. Inputs: `rotate_staff_password`, `backfill_escola_id`, `skip_supabase_secrets`, `skip_cloudflare`.

**Status (2026-04-13):** Migrations 215-220 aplicadas, senha staff rotacionada, MCP token gerado, `CLAUDE_TRIGGER_TOKEN` + `CRON_INTERNAL_KEY` setados, backfill escola_id em 24 tabelas, `ADMIN_TOKEN` monitor setado, Meta secrets configurados nos 2 workers, webhook Meta configurado.
