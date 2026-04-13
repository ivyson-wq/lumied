# CLAUDE.md — Lumied

## Visão Geral

Plataforma SaaS de gestão escolar completa com 23 módulos, multi-tenancy, feature gating por escola, 4 temas visuais, e LGPD compliance. Marca: **Lumied**.

**Domínios:**
- `lumied.com.br` — Landing page comercial (redirect para `/site/`)
- `admin.lumied.com.br` — Painel Central Lumied (redirect para `/admin-central.html`)
- `escola.lumied.com.br` — Padrão SaaS (ex: `maplebearcaxias.lumied.com.br`)
- `escola.lumied.com.br/admin.html` — Config da escola (só staff Lumied, sem link visível)
- DNS gerido pelo **Cloudflare** (nameservers: `aleena.ns.cloudflare.com`, `yichun.ns.cloudflare.com`)
- Subdomínios criados automaticamente via Vercel API no onboarding

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
| Pais | `index.html` | Famílias | Login split-screen. Google/Magic Link/biometria. Pickup, boletim, agenda, boletos, **acesso** (minha face, presença filhos, gerenciar autorizados para retirada com foto + validação qualidade, períodos 7/30/60 dias ou permanente) |
| Gerente | `gerente.html` | Direção | ~55 painéis: analytics, financeiro, CRM, almoxarifado, acadêmico, comunicação, **controle de acesso** (6 painéis: dashboard live, dispositivos, faces, RFID, permissões retirada, log eventos). Breadcrumbs, confirm() estilizado, SRI em CDN scripts |
| Professora | `professora.html` | Docentes | Dashboard com stats + alertas compliance + **alertas acesso real-time** (polling 10s — "Maria chegou para buscar João"). Chamada, notas, agenda, diplomas, PDI, materiais, atestados, manutenção, impressões, achados, diário. Feature-gated por módulos (carrega módulos antes dos dados). 14 páginas, bottom nav mobile |
| Equipe | `secretaria.html` | Secretaria + Comercial + Financeiro + Manutenção | Feature-gated com sidebar agrupada e colapsável. 7 grupos: Secretaria (atestados, diplomas, PDI, impressões), Comercial (dashboard, leads, kanban, matrículas, vagas, contratos, templates, metas), Financeiro (dashboard, mensalidades, lançamentos, boletos), Infraestrutura (chamados, achados, biblioteca, cantina, transporte), Compliance (painel, certificações, inspeções, políticas, calendário, incidentes, horários, importar ponto, hora extra, alertas, feriados, config ponto) |
| Admin Escola | `admin.html` | Staff Lumied + Admin Escola | Dashboard escola, meu plano, adicionais, módulos, tickets, LGPD, config, API, admins |
| Admin Central | `admin-central.html` | Staff Lumied | Dashboard SaaS, escolas, staff, audit log, tickets, onboarding |
| Aluno | `aluno.html` | Alunos | Notas, frequência, provas, calendário |
| Hub | `area-restrita.html` | Staff | Seletor de portais role-aware (detecta sessão, mostra só portais do usuário) |

---

## Edge Functions (22 ativas)

| Function | Padrão | Descrição |
|----------|--------|-----------|
| `admin` | **Router v2** | SaaS admin: escolas, planos, módulos, dashboard stats, tickets, LGPD, system health |
| `api` | **Hybrid** | Gerente: 160+ actions. Inclui indicações B2C/B2B, suporte FAQ, WhatsApp SaaS endpoints |
| `acesso` | **Router v2** | Controle de acesso: Face Control ID (iDFace) + RFID. Dispositivos, faces, permissões retirada, eventos, presença, alertas. Cadastro público de face com validação de qualidade. Protocolo Control iD API |
| `compliance` | **Router v2** | Compliance CLT: ponto com HE 50%/100%, hora noturna, banco de horas, feriados, config. Incidentes/bullying, certificações, inspeções, políticas, calendário regulatório, score |
| `ponto` | **Router v2** | Parser AFD (Portaria 671), espelho de ponto, dashboard, justificativas |
| `diplomas` | **Hybrid** | Professora/pais: 108 actions |
| `academico` | Legado | Notas, frequência, diário, documentos, relatórios BNCC, portal aluno, provas |
| `comunicacao` | **Router v2** | Agenda digital, chat escola-família |
| `cobranca` | **Router v2** | Régua de cobrança automática |
| `operacional` | **Router v2** | Biblioteca, cantina, transporte |
| `financeiro-ext` | **Router v2** | PIX integrado, integração contábil |
| `rh` | **Router v2** | RH, folha de pagamento, ponto, férias |
| `loja` | **Router v2** | E-commerce / loja virtual |
| `lumied-ai` | **Router v2** | IA nativa (Lumi): ask Claude, insights, ROI, **ai_perguntar_mcp** (tool use via MCP) |
| `mcp` | **JSON-RPC 2.0** | **Model Context Protocol server** — expõe tools staff/gerente/compliance/dev via JSON-RPC para qualquer cliente MCP (Claude Desktop, Code, Cursor) |
| `health` | Standalone | Health check (DB + Storage latency) |
| `ticket-resolver` | **MCP-powered** | Auto-resposta de tickets: FAQ rápido + Claude com tool use via MCP (pg_cron 1h) |
| `acesso` | Legado | Controle de acesso famílias |
| `boletos-list` | Legado | Integração mTLS Banco Inter |
| `boletos-sync` | Legado | Sync de boletos do Banco Inter |
| `calendar` | Legado | Agenda do responsável |
| `inter-webhook` | Legado | Webhook boletos Inter |
| `send-email` | Legado | Envio de emails (branding dinâmico) |
| `daily-digest` | Standalone | Resumo diário por aluno |

**Deploy:** `supabase functions deploy <nome> --no-verify-jwt --import-map supabase/functions/deno.json`

> Nota: `--project-ref` não é necessário quando o projeto está linkado (`supabase link`).

---

## MCP Server (Model Context Protocol)

Servidor MCP nativo expondo as capacidades do Lumied como **tools discobríveis** via JSON-RPC 2.0. Qualquer cliente MCP (Claude Desktop, Claude Code, Cursor, custom) pode conectar e chamar ferramentas baseado no **escopo do token** autenticado.

**Endpoint:** `POST https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/mcp`
**Transport:** Streamable HTTP (JSON-RPC 2.0)
**Auth:** `Authorization: Bearer <token>` — o token é validado contra as tabelas de sessão e o scope é auto-detectado.

### Arquitetura

```
supabase/functions/
├── _shared/
│   ├── mcp.ts              # Protocolo JSON-RPC + McpServer + auth
│   └── ai.ts               # askClaudeWithTools (agentic loop)
├── mcp/
│   ├── index.ts            # Edge function entry (serve)
│   ├── tools_staff.ts      # Tools scope=staff
│   ├── tools_gerente.ts    # Tools scope=gerente / professora
│   ├── tools_compliance.ts # Tools compliance/ponto
│   └── tools_dev.ts        # Tools scope=dev (MCP_DEV_KEY)
└── __tests__/mcp.test.ts   # 12 testes
```

### Escopos e hierarquia

| Scope | Access | Origem do token |
|-------|--------|-----------------|
| `public` | Só tools marcadas public | Qualquer um (initialize/ping) |
| `professora` | public + professora | `professora_sessoes` ou `sessoes` (papel professora) |
| `secretaria` | public + secretaria | `secretaria_sessoes` ou `sessoes` (papel secretaria/comercial) |
| `gerente` | public + professora + gerente + secretaria | `gerente_sessoes` ou `sessoes` (papel gerente/diretor) |
| `staff` | Tudo exceto dev | `lumied_staff_sessoes` |
| `dev` | Tudo | `MCP_DEV_KEY` env var |

### Tools registradas

**Staff (`tools_staff.ts`):** `tickets_list_open`, `ticket_get`, `ticket_respond`, `ticket_close`, `escolas_list`, `escola_status`, `sql_query` (read-only), `sentry_recent_errors`, `staff_audit_log`

**Gerente (`tools_gerente.ts`):** `kpis_resumo_dia`, `buscar_aluno`, `analise_inadimplencia`, `alunos_frequencia_critica`, `leads_parados`, `redigir_comunicado`, `analisar_turma` (professora), `modulos_ativos`

**Compliance (`tools_compliance.ts`):** `compliance_score`, `analisar_ponto_mes`, `certificacoes_vencendo`, `gerar_quiz_politica`, `alertas_compliance`

**Dev (`tools_dev.ts`):** `list_migrations`, `describe_table`, `health_check`, `invoke_edge_function`, `get_system_info`

### Exemplo de uso (curl)

```bash
# Listar tools disponíveis para o staff
curl -X POST https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/mcp \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Chamar uma tool
curl -X POST https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/mcp \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"tickets_list_open","arguments":{"limit":5}}}'
```

### Integração no Lumi (assistente IA)

- **Action:** `ai_perguntar_mcp` (em `lumied-ai`) — usa `askClaudeWithTools` para rodar um **loop agêntico** com as tools MCP filtradas por scope
- Portais **gerente** e **secretaria** usam `ai_perguntar_mcp` (dados reais via tool use)
- Portal **professora** continua usando `ai_perguntar_prof` (contexto pré-coletado) por simplicidade
- O assistente frontend (`lumi-assistant.js`) detecta o portal e escolhe a action automaticamente

### Integração no ticket-resolver

O ticket-resolver (v2, pg_cron 1h) agora:
1. Faz match rápido via FAQ (sem tokens)
2. Se não houver match, invoca Claude com tool use + MCP staff tools
3. Claude pode chamar `sentry_recent_errors`, `escola_status`, `sql_query` para diagnosticar
4. Se conseguir responder, chama `ticket_respond` (fecha o ticket e envia email)
5. Senão, escala com diagnóstico da IA no campo `tratamento`

**Substitui o Remote Trigger** (`trig_01PTaCsfDfdNrUGwfUeZJZ96`) que rodava Claude Code cego a cada 1h — agora o loop é auditável (cada tool call fica no histórico) e só consome tokens quando há tickets reais.

### Secrets necessários

Já configurados (ou opcionais):
- `ANTHROPIC_API_KEY` — askClaude + askClaudeWithTools
- `SUPABASE_ACCESS_TOKEN` — sql_query, list_migrations, describe_table (via Management API)
- `SUPABASE_PROJECT_REF` — default `brgorknbrjlfwvrrlwxj`
- `SENTRY_AUTH_TOKEN` — sentry_recent_errors (opcional)
- `MCP_DEV_KEY` — token para scope=dev (opcional, só dev local)

### Conectar cliente MCP externo (Claude Desktop)

Adicionar ao `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lumied": {
      "url": "https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/mcp",
      "headers": {
        "Authorization": "Bearer <SEU_STAFF_TOKEN>"
      }
    }
  }
}
```

---

## Arquitetura Admin (2 níveis)

### Painel Central Lumied (`admin-central.html`)
**URL:** `admin.lumied.com.br` — Gestão SaaS global, só staff Lumied.

| Seção | Descrição |
|-------|-----------|
| **Dashboard** | KPIs: MRR, ARR, escolas ativas, total alunos, tickets, staff |
| **Escolas** | Lista de clientes com links para admin/gerente de cada escola |
| **+ Nova Escola** | Onboarding automático: cria escola, config, gerente, módulos, séries |
| **Staff** | CRUD de superusuários Lumied (fundador, cto, suporte, comercial, cs) |
| **Audit Log** | Histórico de ações dos superusuários |
| **Tickets** | Tickets centralizados de todas as escolas |

**Onboarding automático (`staff_criar_escola`):**
- Formulário: nome, subdomínio, plano, CNPJ, gerente (nome/email/senha)
- Cria: escola + escola_config + gerente + usuarios + módulos do plano + séries padrão
- Retorna: URLs, módulos ativados, checklist de pendências manuais
- Módulos ativados automaticamente por plano (starter=6, gestão=19, automação=30, avançado=35, rede=40+)

### Superusuários (`lumied_staff`)
- Tabela separada de admins de escola
- Sessões próprias (`lumied_staff_sessoes`)
- Audit log (`lumied_staff_audit`)
- Cargos: `fundador`, `cto`, `suporte`, `comercial`, `cs`
- Acesso total a todos os portais de todos os clientes

### Painel Admin da Escola (`admin.html`)

**URL:** `escola.lumied.com.br/admin.html` — Painel por escola.
Acesso: staff Lumied (login com credenciais staff) ou admin da escola.
Sem link em nenhum portal — acesso apenas via URL direta.
Detecta escola automaticamente pelo subdomínio (`window.location.hostname`).

Painel de configuração da escola com 9 seções:

| Seção | Descrição |
|-------|-----------|
| **Dashboard** | KPIs da escola (plano atual, módulos ativos, tickets abertos, decisões pendentes), alertas (plano expirando, limites), barras de uso |
| **Meu Plano** | Plano atual com preço/expiração, uso vs limites, grid comparativo dos 5 tiers com botões Upgrade/Downgrade, decisões pendentes |
| **Adicionais** | Extras opcionais (WhatsApp msgs, storage, usuários) — contratar/cancelar |
| **Módulos** | Visão read-only dos módulos ativos desta escola (agrupados por categoria) |
| **Tickets** | Tickets de suporte filtrados por esta escola |
| **LGPD** | Solicitações LGPD filtradas por esta escola |
| **Configurações** | Edição das escola_config (nome, cores, URLs, etc.) agrupadas por categoria |
| **API & Integrações** | URLs do Supabase, Edge Functions, portais da escola (read-only com botão copiar) |
| **Admins** | CRUD de admins desta escola |

**Endpoints escola-scoped:** `escola_dashboard`, `escola_plano_info`, `escola_solicitar_upgrade`, `escola_solicitar_downgrade`, `escola_extras_list`, `escola_extra_contratar`, `escola_extra_cancelar`, `escola_config_list`, `escola_config_update`, `escola_api_info` + `escola_modulos_get`, `tickets_list`, `lgpd_solicitacoes_list`.

**Auth dual:** `authAdmin` aceita tanto `_token` (admin_sessoes/admins) quanto fallback para `_staff_token` (lumied_staff_sessoes/lumied_staff). `admin_login` tenta admins table primeiro, depois lumied_staff como fallback.

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

- **Multi-papéis**: cada usuário pode ter 1+ papéis (`papeis text[]` em `usuarios`)
  - Papéis: `gerente`, `diretor`, `financeiro`, `professora`, `professora_assistente`, `secretaria`, `comercial`, `manutencao`
  - Qualquer combinação de papéis é permitida (ex: gerente+professora, secretaria+comercial)
  - Hub (`area-restrita.html`) detecta sessão e mostra só portais do usuário
  - Papéis que usam Portal da Equipe: `secretaria`, `comercial`, `financeiro`, `diretor`, `manutencao`
  - Esses papéis mapeiam para tabela `secretarias` com feature gating (`features text[]`)
  - Features disponíveis: `atestados`, `crm`, `templates`, `metas`, `financeiro`, `manutencao`, `compliance`
  - Gerente configura papéis e features por membro no painel Equipe (checkboxes + modal ✏️)
- `escola_id` em 30+ tabelas de dados
- `plano_limites`: limites por recurso (max_alunos, max_storage_gb, etc.)
- `check_limite()`: função SQL para verificar limites
- `escola_uso` + `escola_uso_historico`: tracking de uso
- Subdomínios por escola (`escolas.subdominio` → `escola.lumied.com.br`)
- Feature gating granular: `plano_modulos` + `escola_modulos` override
- 4 temas visuais (Corporativo, Lúdico, Sério, Interativo)

---

## Unificação de Dados (Migrations 109-110)

### Alunos ↔ Famílias (Migration 109)
- Tabela `familias` é o ponto de entrada de dados (cadastro de famílias)
- Tabela `alunos` é a tabela normalizada central
- **Trigger `trg_sync_familia_aluno`**: INSERT/UPDATE em `familias` → sincroniza automaticamente para `alunos`
- **Trigger `trg_deactivate_aluno`**: DELETE em `familias` → desativa aluno
- Colunas denormalizadas em `alunos`: `responsavel_nome`, `resp_nome`, `cpf`, `serie`

### Usuários Unificados (Migration 110)
- Tabela `usuarios` é a fonte canônica (campos: `id, nome, email, senha_hash, papel, tipo, serie_id, series_monitoras, escola_id, ativo`)
- Tabelas legadas `gerentes`, `professoras`, `secretarias` mantidas para backwards compatibility
- **Trigger `trg_sync_usuario_legacy`**: INSERT/UPDATE em `usuarios` → sincroniza para tabela legada correspondente
- Tabela `sessoes` unificada (substitui `gerente_sessoes` + `professora_sessoes` + `secretaria_sessoes`)
- **Trigger `trg_sync_sessao_legacy`**: INSERT em `sessoes` → sincroniza para tabela de sessão legada
- 24 tabelas dependentes ganharam coluna `usuario_id` FK para `usuarios` (dados copiados das colunas legadas)
- Código legado continua funcionando com tabelas antigas via triggers bidirecionais

### Plano de Migração Gradual
- Fase atual: triggers bidirecionais mantêm tudo sincronizado
- Próximo passo: migrar edge functions para usar `usuarios`/`sessoes` diretamente
- Final: remover tabelas legadas e triggers de sincronização

---

## Branding

### Logo Lumied
- Arquivo: `/lumied-logo.png` (coruja dourada + texto "Lumied" em fundo roxo)
- Presente em todos os portais: sidebars, topbars, telas de login, footers "Powered by Lumied"
- Substitui emojis (🍁/🟣) usados anteriormente
- Escola pode ter logo própria via `escola_config` (chave `escola_logo_url`)

### Onboarding de Logo
- Campo de upload de logo no formulário de criação de escola (admin-central.html)
- Aceita URL direta ou upload de arquivo (max 2MB, converte para base64 data URL)
- Preview em tempo real no formulário
- Salvo como `escola_logo_url` no `escola_config`

---

## Portal da Equipe (`secretaria.html`)

Portal unificado para Secretaria, Comercial, Financeiro, Infraestrutura e Compliance. Sidebar agrupada e colapsável, com visibilidade por features do usuário.

**Features disponíveis** (configuráveis por usuário):

| Feature | Grupo na Sidebar | Painéis |
|---------|-----------------|---------|
| `atestados` | Secretaria | Atestados, Diplomas, Growth Plan, Impressões |
| `crm` | Comercial | Dashboard CRM, Leads, Funil Kanban (drag-drop), Matrículas (cards por turma), Vagas, Contratos, Templates, Metas |
| `financeiro` | Financeiro | Dashboard (gráfico receita/despesa), Mensalidades, Lançamentos, Boletos |
| `manutencao` | Infraestrutura | Chamados, Achados & Perdidos, Biblioteca, Cantina, Transporte |
| `compliance` | Compliance | Painel Geral, Certificações, Inspeções, Políticas, Calendário, Incidentes, Horários, Importar Ponto (upload CSV), Hora Extra, Alertas, Feriados, Config Ponto |

**Autenticação:** login unificado (`sessoes` table) ou legado (`secretaria_sessoes`). Chama `/diplomas` para actions de secretaria e `/api` para CRM/financeiro (token unificado aceito em ambos).

---

## Compliance — Ponto CLT

Sistema de controle de ponto com cálculos trabalhistas conforme legislação brasileira.

**Edge function:** `compliance` (Router v2) | **Tabelas:** `compliance_ponto_*`, `compliance_horarios`, `compliance_ocorrencias`, `compliance_alertas`, `compliance_banco_horas`, `compliance_feriados`, `compliance_config_ponto`

### Regras CLT implementadas

| Regra | Artigo | Implementação |
|-------|--------|---------------|
| Intervalo intrajornada | Art. 71 | 60min (>6h), 15min (>4h), auto-dedução |
| Hora extra 50% | Art. 59 + CF 7° XVI | Dias úteis e sábados |
| Hora extra 100% | Art. 59-A + Súmula 146 TST | Domingos e feriados |
| Limite 2h extras/dia | Art. 59 | Cap 120min |
| Jornada máxima 10h/dia | Art. 59 | Cap 600min |
| Tolerância 10min | Art. 58 §1° | Configurável |
| Hora noturna 22h-5h | Art. 73 | Hora reduzida 52:30 |
| Adicional noturno 20% | Art. 73 | Rastreado por registro |
| Banco de horas | Art. 59 §5° | 6 meses, saldo mensal |
| Proibição domingo prof. | Art. 319 | Alerta de compliance |
| Remuneração hora-aula | Art. 320 | Configurável |
| DSR 1/6 | Art. 320 §1° | No resumo mensal |
| Jornada professor | Art. 318 (Lei 13.415/17) | Parcial 4h/6h, integral 8h |

### Configuração (`compliance_config_ponto`)

16 parâmetros editáveis pelo gerente: tolerâncias, jornada, adicionais %, banco de horas, limites, hora noturna, hora-atividade (20% CCT), DSR.

### Fluxo de importação

1. Upload CSV (`professora_id;data;hora_entrada;hora_saida`)
2. Pré-visualização no frontend
3. `compliance_importar_ponto` → salva registros
4. `compliance_verificar_ponto` → processa CLT, detecta feriados, calcula HE/noturna/atraso
5. Cria ocorrências para HE não autorizada
6. Alerta por email + ciência com selfie (bloqueia portal da professora)

### Caxias do Sul

Excluída da CCT estadual SINPRO/RS. Tem sindicato próprio: **SINPRO Caxias** (`sinprocaxias.com.br`). Valores da CCT local devem ser configurados no painel "Config. Ponto".

---

## Controle de Acesso (Face Control ID + RFID)

**Edge function:** `acesso` | **Dispositivos:** 6 Control iD iDFace (2 em catracas) | **Migration:** 113 (8 tabelas) + 114 (tokens cadastro público)

### Fluxo Principal
```
Face Control ID reconhece face/RFID → HTTP POST callback → /acesso
  ├─ Aluno entrada → acesso_presenca.hora_entrada
  ├─ Aluno saída → acesso_presenca.hora_saida
  ├─ Responsável → verifica permissões → alerta recepção + professora da turma
  └─ Desconhecido → alerta recepção
```

### Tabelas
`acesso_dispositivos`, `acesso_faces`, `acesso_rfid`, `acesso_eventos`, `acesso_presenca`, `acesso_permissoes_retirada`, `acesso_alertas`, `acesso_config`, `acesso_cadastro_tokens`

### Protocolo Control iD API
- Auth: `POST /login.fcgi` → `{session}`
- Face: `POST /user_set_image.fcgi?session=S&user_id=N` (binary photo)
- Validação: `POST /user_test_image.fcgi` → scores qualidade (centralização, nitidez, pose)
- RFID: `POST /create_objects.fcgi` → `{object:"cards"}`
- Heartbeat: `GET /system_information.fcgi`

### Cadastro Público de Face (`cadastro-face.html`)
- Link único por pessoa (token 64 chars, 7 dias validade)
- Câmera do celular ou upload de foto
- Validação de qualidade em tempo real via Control iD
- Status "aguardando_aprovação" até gerente aprovar
- Aprovação sincroniza face para todos os 6 dispositivos

### Portal dos Pais — Tab "Acesso"
- Minha face (read-only após aprovação)
- Presença dos filhos hoje (entrada/saída em tempo real)
- Gerenciar autorizados (adicionar/cancelar): nome, parentesco, foto obrigatória com validação, período (7/30/60 dias ou permanente)

### Portal da Professora — Alertas Real-Time
- Polling 10s: banner flutuante com alertas de chegada de responsável

---

## Chrome Extension (Lumied CRM WhatsApp)

Extensão Manifest V3 para enviar templates CRM no WhatsApp Web. Pronta para publicação na Chrome Web Store.

**Arquivos:** `chrome-extension/` (manifest.json, content.js, content.css, popup.html, icons, privacy-policy.html)
**Pacote:** `lumied-crm-whatsapp.zip` (14KB)
**Guia de publicação:** `chrome-extension/STORE-LISTING.md`

---

## Segurança

- **RLS** habilitado em 20+ tabelas com policies restritivas
- **Rate Limiting** em todas as edge functions (Router v2 + legacy via `checkRateLimit`)
- **Input Validation** com schemas + sanitização XSS recursiva (`sanitizeBody`: nested objects/arrays)
- **CORS Whitelist** dinâmico por request — aceita `*.lumied.com.br` + whitelist + Vercel previews
- **PBKDF2** 100k-120k iterações para senhas — `_shared/auth.ts` com `verificarSenhaAuto()`
- **Password Recovery** staff: código 6 dígitos via email, SHA-256 hash, 15min expiry, 5 tentativas max, rate limited
- **WebAuthn/Face ID** nos portais principais
- **CSP** Content-Security-Policy header no Vercel (script-src, connect-src, frame-ancestors none)
- **SRI** (Subresource Integrity) sha384 em todos os scripts CDN (Supabase JS, SheetJS, jsPDF, html2canvas)
- **HSTS** + X-Frame DENY + Permissions-Policy + nosniff + Referrer-Policy
- **Webhook Auth**: inter-webhook verifica `RELAY_SECRET`; ticket-resolver/daily-digest verificam `service_role_key`
- **Role-based access**: ações financeiras sensíveis (aprovar decisão, alterar resp. financeiro) bloqueadas para secretaria/comercial — só gerente/diretor
- **Meta Webhook Signature** — HMAC-SHA256 (X-Hub-Signature-256) nos WhatsApp Workers
- **Sentry** padronizado: `sentry-init.js` em todos os portais (substituído CDN inline em aluno/hub)
- **PIX txid** gerado com `crypto.getRandomValues()` (não Math.random)
- **LGPD**: consentimento, export (`lgpd_exportar_dados()`), anonimização (`lgpd_anonimizar()`), audit log

### Acessibilidade (WCAG)
- **ARIA**: `role="navigation/dialog/main/banner/alert"`, `aria-label`, `aria-modal` em todos os portais
- **Focus trap**: Tab cycles dentro de modais abertos, Escape fecha
- **Contraste**: `--muted` aumentado para `#5a5249` (4.5:1 WCAG AA)
- **Touch targets**: mín 44×44px em mobile via `lumied-ux.js`
- **Offline detection**: banner global "Sem conexão" via `lumied-ux.js`

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

### Hardening 2026-04-10/11 — 4 rodadas, ~90 bugs fixados

**Rodada 1 — SRI + auth crítica + injections (14 tasks):**
- **SRI hash Supabase CDN quebrado** — era a causa raiz de `PAPEL_COLORS is undefined` no gerente.html. Pinado `@supabase/supabase-js@2.45.4` com hash verificado + guard defensivo em `sbClient` pra degradação graceful.
- **PIX CRC16** — `financeiro-ext/index.ts` retornava `"0000"` hardcoded; todos os QR codes eram rejeitados. Implementado CRC16-CCITT (poly 0x1021, init 0xFFFF).
- **Control iD admin/admin hardcoded** — removido; usa `acesso_dispositivos.api_login/api_password` ou env `CONTROLID_DEFAULT_PASSWORD`.
- **`config_escola_setup` privilege escalation** — ação bypassava auth se `gerentes` vazio, permitindo setar `superusuario_email` e escalar a superuser. Retorna 410 Gone.
- **Auth em ~30 endpoints** (acesso, chat/comunicacao, pesquisa, autorizacao, notif, achados, rh_ponto, regua_executar, compliance_verificar_ponto_auto, provas_*, aluno_*)
- **`.ilike('email', X)` → `.eq('email', X)`** em 20+ lugares (wildcard `%`/`_` enabling enumeration)
- **`.or()` PostgREST injection** fixado em `agenda_pais_get`, `minha_agenda`, `suporte_faq_list`, `academico` buscas, `operacional` biblioteca, `boletos-list`
- **3 XSS em index.html** (nome_crianca, child names, foto.url)
- **Mass assignment** em 7 actions `*_update` (planos, escolas, transporte, regua, pesquisa, produtos, rh_funcionarios)
- **9 console.log [Auth Debug]** removidos (LGPD — vazavam emails)
- **CI pipeline** — removido `|| true` do deno check e `|| echo "Failed"` do deploy; frontend agora depende de functions; `node build.js` adicionado antes do Vercel deploy

**Rodada 2 — HTML escape + race conditions + CORS race (8 tasks):**
- **Contract email code hashed** (SHA-256 + attempt counter de 5 + expiração 15min + timing-safe compare). Antes era plaintext em `dados_preenchidos._codigo_email`.
- **HTML escape em Resend emails** (magic link, contratos, ticket_create) via `escapeHtml()` + `sanitizeHeaderValue()` anti-CRLF injection no `from:`
- **Biblioteca race condition** — read-check-write substituído por RPC atômico `biblioteca_emprestar` (UPDATE ... WHERE disponivel > 0)
- **gerentes_delete race** — RPC `gerentes_safe_delete` com LOCK TABLE + count + delete atômico
- **`sanitizePgError()`** — ~70 substituições de `err(error.message)` que vazavam column/constraint names. Real error logado via `console.error`.
- **`escola_id` scoping** via middleware no router v2 (`auth()` agora carrega escola_id; novo `authGerenteOrSecretaria()` + `requireEscola`)
- **DB-backed rate limiter** — `rate_limit_check` RPC com bucket windowing (migration 218). Antes era in-memory `Map` que resetava em cold start.
- **CORS vercel preview regex** — `endsWith('.vercel.app') && includes('maple-bear')` trocado por `^https://maple-bear-rs(-[a-z0-9-]+)?\.vercel\.app$` (antes `maple-bear-attack.vercel.app` passava).
- **CORS data race** — `_currentCorsHeaders` module-level substituído por `AsyncLocalStorage<Record<string,string>>`. `runWithCors(req, fn)` helper usado por `withErrorHandler` e `Router.handle()`. Concurrent requests no mesmo isolate não racem mais.

**Rodada 3 — escola_id columns + Meta HMAC + cron (6 tasks):**
- **Migration 219**: `ADD COLUMN escola_id UUID REFERENCES escolas(id)` em 23 tabelas (compliance_*, rh_ponto/ferias/holerites/folha_pagamento, cantina_creditos/transacoes/restricoes, biblioteca_emprestimos/reservas, transporte_alunos/rastreio/notificacoes). Idempotent, backfill via parent FK, index criado.
- **Meta HMAC hardening** em `whatsapp-worker` e `whatsapp-gateway`: antes era **fail-open** se `META_APP_SECRET` ausente. Agora fail-closed, `sha256=` prefix check, constant-time XOR comparison. POST rejeita 403 (antes 401). `GET /webhook` usa `WHATSAPP_VERIFY_TOKEN` com fallback legacy.
- **Migration 220**: pg_cron `rate_limits_cleanup()` hourly
- **Remote Trigger token** movido de query `?token=X` para header `X-Trigger-Token` (lido de env `CLAUDE_TRIGGER_TOKEN`) — antes aparecia em logs/metrics.
- **Chaves protegidas em `config_escola_save`**: bloqueia `superusuario_email`, `meta_app_secret`, `whatsapp_token`, `inter_*`, `anthropic_api_key`, `resend_api_key`, etc. — gerentes não podem mais se auto-promover.
- **Migration 215**: colunas `api_login`/`api_password` em `acesso_dispositivos` pra credenciais Control iD por dispositivo.
- **Migrations 216/217**: RPCs atômicos `biblioteca_emprestar`/`biblioteca_devolver`/`gerentes_safe_delete`.

**Rodada 4 — loja/lumied-ai + Cloudflare Workers full audit (5 tasks):**
- **loja/index.ts** (20 fixes): produtos_* escola_id + .ilike sanitization, pedidos_list era COMPLETAMENTE PÚBLICO (PII leak), pedido_create race-safe estoque via `.gte()` filter + rollback
- **lumied-ai/index.ts** (25 fixes): `gerar_insights_diarios` + `roi_gerar_snapshot` eram unauth (abuso de custo AI), agora exigem `SUPABASE_SERVICE_ROLE_KEY` ou `CRON_INTERNAL_KEY`. **Prompt injection** em `ai_perguntar`, `ai_perguntar_mcp`, `ai_perguntar_prof`, `ai_redigir_comunicado`, `ai_parecer_bncc` — sanitizeForPrompt() + length caps. `coletarContexto` cross-tenant → scoped por escola_id. ROI mass assignment corrigido.
- **whatsapp-worker** (5 high): timing-safe verify_token, top-level try/catch em `fetch`, `ctx.waitUntil` em `scheduled`, `fetchWithTimeout` 10s + null-check em MetaAPI/SaasAPI (fail-closed)
- **whatsapp-gateway** (16 critical/high): **prompt injection** em faq-bot/relatorio/documento-intake (system prompt + XML-wrapped user data), **btoa stack overflow** em imagens >100KB (chunked base64 + 5MB cap), top-level try/catch em `handleWebhook`, timing-safe `/send` auth + UUID v4 regex, regex strict em `button_reply.id` pra prevenir DB filter injection, path traversal fix em `filename`, timeouts em todas as chamadas Claude/Meta/Storage
- **cloudflare-monitor** (3 critical/high): **`/run` endpoint era COMPLETAMENTE PÚBLICO** — qualquer um podia queimar quota Claude + enviar emails Resend. Agora requer `ADMIN_TOKEN` secret via timing-safe + POST-only (não GET pra prevenir CSRF). `/status` + `/status/html` + `/` também protegidos (antes leakavam service names, latencies, Sentry issues, Vercel URIs). Novo `/health` público pra uptime monitoring.
- **Testes validados**: 57/57 Deno unit + 61/62 Playwright E2E passando (atualizados pra v2 redesign).

**Resumo:** 15 commits de segurança, 7 migrations novas, ~10.000 LOC auditadas, 100% das edge functions ativas + 100% dos Cloudflare Workers hardenados.

### Post-deploy automation (executado 2026-04-11)

Workflow `.github/workflows/postdeploy.yml` + script `scripts/postdeploy.mjs` — automação idempotente que aplica todo o pós-deploy via Supabase Management API + Cloudflare API. Disparado via `workflow_dispatch` com inputs.

**Para disparar novamente** (Actions → Post-deploy → Run workflow):
- `rotate_staff_password` — rotaciona senha do `lumied_staff` (fundador) e imprime novo Lumied MCP token no log (mascarado via `::add-mask::`)
- `staff_new_password` — senha nova (mín 12 chars)
- `backfill_escola_id` — roda UPDATE `escola_id = <default>` em 24 tabelas tenant
- `skip_supabase_secrets` / `skip_cloudflare` — flags opcionais

**Ações executadas automaticamente** (estado atual em 2026-04-11):
- ✅ Migrations 215-220 verificadas (todas aplicadas via `apply-migrations.yml`)
- ✅ Senha do staff `ivyson@gmail.com` rotacionada (hash PBKDF2 hex:hex, 100k iterations)
- ✅ Lumied MCP token gerado via `staff_login` e inserido em `~/.claude.json` como `Bearer` header
- ✅ `CLAUDE_TRIGGER_TOKEN` setado (24 bytes aleatórios) via Management API `/v1/projects/{ref}/secrets`
- ✅ `CRON_INTERNAL_KEY` setado (24 bytes aleatórios) via Management API
- ✅ Backfill `escola_id` executado em 24 tabelas (compliance_*, rh_ponto/ferias/holerites/folha, biblioteca_emprestimos/reservas, cantina_creditos/transacoes/restricoes, transporte_alunos/rastreio) — todas FILL com UUID da escola padrão (Maple Bear Caxias) via `DO $$ BEGIN ... EXCEPTION WHEN others THEN NULL; END $$` per-table para robustez

**Pendências manuais** (concluídas 2026-04-13):
- ✅ `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` adicionados aos GitHub Secrets (2026-04-13)
- ✅ `ADMIN_TOKEN` setado no worker `lumied-monitor` via Cloudflare API. Token salvo em `~/lumied-monitor-admin-token.txt`. Acesso: `https://lumied-monitor.ivyson.workers.dev/status?token=<ADMIN_TOKEN>` ou header `Authorization: Bearer <token>`. Endpoint `/health` é público (sem token).
- ✅ `META_APP_SECRET` + `WHATSAPP_TOKEN` setados nos 2 workers WhatsApp via Cloudflare API (2026-04-13)
- ✅ `CONTROLID_DEFAULT_PASSWORD=admin` setado no Supabase Edge Functions (2026-04-13). ⚠️ Trocar a senha nos 6 iDFaces e atualizar este secret quando possível.

**Secrets configurados nos Cloudflare Workers WhatsApp** (2026-04-13):

| Secret | whatsapp-worker | whatsapp-gateway |
|--------|:-:|:-:|
| `WHATSAPP_VERIFY_TOKEN` | ✅ | ✅ |
| `META_PHONE_NUMBER_ID` | ✅ (`1056345077565103`) |  ✅ |
| `META_WHATSAPP_BUSINESS_ID` | ✅ (`802737572889384`) | ✅ |
| `APP_INTERNAL_SECRET` | ✅ (24 bytes random) | ✅ |
| `APP_BASE_URL` | ✅ (`https://brgorknbrjlfwvrrlwxj.supabase.co`) | ✅ |
| `META_APP_SECRET` | ✅ | ✅ |
| `WHATSAPP_TOKEN` | ✅ | ✅ |

**Webhook configurado no Meta Developers** (2026-04-13):
- URL: `https://whatsapp-gateway.ivyson.workers.dev/webhook`
- Verify Token: salvo em `~/whatsapp-verify-token.txt`
- Campo subscrito: `messages`

**⚠️ WHATSAPP_TOKEN é temporário** (~24h). Para token permanente: Meta Developers → Configurações do Sistema → System User → gerar token permanente com permissão `whatsapp_business_messaging`. Atualizar via `wrangler secret put WHATSAPP_TOKEN` nos 2 workers.

**Script local** (alternativa ao workflow — rodar via `node scripts/postdeploy.mjs`):
- Env vars obrigatórias: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (default `brgorknbrjlfwvrrlwxj`)
- Env vars opcionais: `STAFF_NEW_PASSWORD`, `BACKFILL_ESCOLA_ID=true`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Outputs mascarados: `LUMIED_MCP_TOKEN=***`, `MONITOR_ADMIN_TOKEN=***` via `::add-mask::`

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

- **222 migrations** (009-222) — ver "Banco de Dados — Migrations Recentes" abaixo para 202-222
- Migrations relevantes:
  - `048_planos_modulos.sql` — escolas, planos, modulos, admins
  - `075_multitenancy_limites.sql` — plano_limites, escola_uso
  - `078_lgpd.sql` — consentimentos, solicitações, audit log
  - `081_tickets.sql` — tabela tickets de suporte
  - `082_ticket_resolver_cron.sql` — pg_cron job para auto-resposta
  - `083_papel_comercial.sql` — features por secretária, metas comerciais, responsavel_id em leads
  - `084_multi_papeis.sql` — coluna papeis text[] em usuarios, suporte a múltiplos papéis por usuário
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
  - `104` — Lumied Staff (lumied_staff, sessões, audit log)
  - `105` — Seed Maple Bear Caxias do Sul (escola inicial)
  - `107` — Fix subdomínio + coluna `plano` (text) na tabela escolas
  - `109` — Sync familias → alunos (trigger automático `trg_sync_familia_aluno`)
  - `110` — Unificação de usuários: gerentes/professoras/secretarias → usuarios, sessões unificadas, triggers bidirecionais
  - `111` — Ponto CLT: cálculos trabalhistas completos (HE 50%/100%, hora noturna, banco de horas, feriados, config)
  - `112` — View unificada `vw_ponto_unificado` (consolida compliance_ponto + AFD/ponto_daily_summary)
  - `113` — Controle de acesso: 8 tabelas (dispositivos, faces, rfid, eventos, presença, permissões, alertas, config)
  - `114` — Cadastro público de face: tokens, qualidade_scores, status aguardando_aprovacao

---

## Observabilidade

### GitHub Actions Secrets
- `SUPABASE_ACCESS_TOKEN` — Supabase Management API
- `SENTRY_AUTH_TOKEN` — Sentry releases (`sntrys_eyJ...`) **Configurado**
- `SENTRY_DSN` — Sentry event ingestion
- `VERCEL_TOKEN` — Vercel deploy
- `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — Vercel project
- `BETTERUPTIME_API_KEY`, `BETTERUPTIME_HEARTBEAT_URL` — Monitoramento

### Sentry (`lumied.sentry.io`)
- Frontend: SDK Browser v9.25.0 via `sentry-init.js` em todos os portais
- Edge Functions: `_shared/sentry.ts` reporter HTTP
- Performance: tracesSampleRate 0.2 (prod), Session Replay 10%
- Alertas: High Error Rate, New Issues, P95 > 3s

### Better Stack
- Monitoramento via API REST (sem CLI)
- Integrado no painel admin (Status do Sistema)

### Google Analytics (G-QDFKQEVV4P)
- **Portais autenticados** carregam via `/analytics.js` (gerente, professora, secretaria, admin, admin-central, aluno, index, area-restrita)
- **Páginas públicas** (blog, site/sobre, assinar, verificar, indicar, parceiros, cadastro-face, setup, ajuda) têm snippet `gtag.js` inline direto no `<head>`
- **49 páginas HTML** cobertas no total (instalado 2026-04-11)
- Site landing (`site/index.html`) já tinha snippet inline pré-existente
- `/analytics.js` skipa `localhost`/`127.0.0.1` automaticamente + seta `user_properties.portal` baseado no path

---

## MCP Client Setup (Desenvolvimento)

Servidores MCP configurados no `.claude.json` do dev (Claude Code) para assistência de desenvolvimento e operação:

| MCP | Tipo | Auth | Uso |
|-----|------|------|-----|
| **lumied** | HTTP | Bearer token (staff_login) | Tools internas do Lumied — tickets, KPIs, alunos, compliance, SQL query |
| **supabase** | HTTP | OAuth via `/mcp` | Gerenciar projetos Supabase, SQL, migrations, logs |
| **vercel** | HTTP | OAuth via `/mcp` | Deploys, domínios, env vars, logs |
| **github** | HTTP | Bearer (PAT via env `GITHUB_PERSONAL_ACCESS_TOKEN`) | Repos, issues, PRs, workflows, releases |
| **meta** | stdio | Env vars (`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `META_APP_ID`, `META_APP_SECRET`) | Instagram Graph API + Threads — 60 tools (publish, comments, insights, DM, hashtag) |

### Gerar token do Lumied MCP
```bash
# Via staff_login (requer lumied_staff row + senha)
curl -X POST https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/admin \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -d '{"action":"staff_login","email":"ivyson@gmail.com","senha":"<SENHA>"}'
# Retorna { token, nome, cargo } — inserir token como Bearer em .claude.json
```

Token inserido como `headers.Authorization: "Bearer <token>"` no bloco `mcpServers.lumied`. Expira em 7 dias.

### Lista de tools por scope (Lumied MCP)
- **Staff**: tickets_list_open, ticket_get/respond/close, escolas_list, escola_status, sql_query (read-only), sentry_recent_errors, staff_audit_log
- **Gerente** (herdado em staff): kpis_resumo_dia, buscar_aluno, analise_inadimplencia, alunos_frequencia_critica, leads_parados, redigir_comunicado, analisar_turma, modulos_ativos
- **Compliance**: compliance_score, analisar_ponto_mes, certificacoes_vencendo, gerar_quiz_politica, alertas_compliance
- **Dev** (se `MCP_DEV_KEY` env): list_migrations, describe_table, health_check, invoke_edge_function, get_system_info

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

### Novo Cliente — Onboarding Automático (~2 min)

**Via Painel Central (`admin.lumied.com.br` → Escolas → + Nova Escola):**

O formulário pede: nome, subdomínio, plano, CNPJ, telefone, endereço, cor primária, ícone, tipo de séries, logo (URL ou upload), gerente (nome/email/senha).

O sistema cria automaticamente:
1. Registro na tabela `escolas` com `plano_id` (UUID FK) + `plano` (text) + expiração 1 ano
2. 9+ configs em `escola_config` (nome, cor, URL, email, ícone, logo_url, superusuário)
3. Primeiro gerente em `gerentes` + `usuarios` (ambos com `escola_id`)
4. Módulos do plano ativados em `escola_modulos` (via `plano_modulos` do banco, não hardcoded)
5. Séries padrão configuráveis: Maple Bear, Ed. Infantil, Fundamental ou Completa
6. **Subdomínio no Vercel** via API (SSL automático em ~1 min)
7. Audit log completo (módulos, séries, status Vercel)

**Detalhes técnicos (action `staff_criar_escola` em `admin/index.ts`):**
- `escola_modulos` usa `modulo_id` (UUID) + `habilitado` (boolean) — resolve IDs via `plano_modulos` join
- `escola_config` não tem coluna `escola_id` — é single-tenant por chave PK
- Contato da escola preenchido automaticamente com dados do gerente
- Séries configuráveis por `series_tipo`: `maple_bear`, `educacao_infantil`, `fundamental`, `completa`

**Retorna:** URLs (site, admin, gerente) + contagem de módulos/séries + checklist de pendências

**Pendências manuais pós-criação:**
- Verificar SSL em `https://escola.lumied.com.br` (~1 min)
- Testar login do gerente
- WhatsApp (se no plano) — `META_APP_SECRET`, `WHATSAPP_TOKEN`
- Banco Inter (se usar boletos) — `INTER_CLIENT_ID/SECRET`

> Guia detalhado legado: `NOVO-CLIENTE.md`

---

## Credenciais e Secrets

### Supabase Edge Functions Secrets
- `ANTHROPIC_API_KEY` — API Anthropic para Lumi (Claude Haiku). **Configurado**
- `VERCEL_API_TOKEN` — Vercel API para criar subdomínios no onboarding. **Configurado**
- `RESEND_API_KEY` — API do Resend para envio de emails
- `APP_URL` — URL pública do portal (ex: `https://maplebearcaxias.lumied.com.br`)
- `ML_CLIENT_ID`, `ML_CLIENT_SECRET` — Mercado Livre OAuth
- `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`, `INTER_CONTA` — Banco Inter
- `INTER_RELAY_URL`, `RELAY_SECRET` — Relay mTLS no Render
- `GOOGLE_MAPS_KEY`, `GOOGLE_SERVICE_ACCOUNT` — Google Maps/Calendar
- `SENTRY_DSN` — Sentry event ingestion

### Google OAuth
- Client ID: configurado no Supabase Auth (Google Cloud Console)
- Client Secret: configurado no Supabase Auth (atualizado 2026-04-06)
- Authorized JS origins: `https://maplebearcaxias.lumied.com.br`
- Redirect URI: `https://brgorknbrjlfwvrrlwxj.supabase.co/auth/v1/callback`
- URI Allow List (Supabase Auth): `https://maple-bear-rs.vercel.app`, `https://maplebearcaxias.lumied.com.br`, `https://*.lumied.com.br`
- **Flow**: Supabase JS v2 sem `flowType` explícito → server retorna `#access_token` no hash (implicit). **NÃO usar `flowType: 'implicit'` ou `'pkce'` no `createClient()`** — causa TDZ error ao processar hash na inicialização. `getSession()` detecta tokens automaticamente.
- **IMPORTANTE**: `createClient()` em `index.html` DEVE ser chamado sem opções de `auth` — qualquer opção custom causa crash quando há `#access_token` ou `?code=` na URL de retorno do OAuth.

### Cloudflare Workers
- Account ID: stored in env `CLOUDFLARE_ACCOUNT_ID` (do NOT commit)
- API Token: stored in env `CLOUDFLARE_API_TOKEN` (do NOT commit)

| Worker | URL | Cron | Descrição |
|--------|-----|------|-----------|
| `lumied-monitor` | `https://lumied-monitor.ivyson.workers.dev` | `*/15 * * * *` | Monitoramento Sentry/Vercel/Supabase |
| `whatsapp-worker` | `https://whatsapp-worker.ivyson.workers.dev` | `*/30 * * * *` | Atendimento departamental + push comercial (Maple Bear BG) |
| `whatsapp-gateway` | `https://whatsapp-gateway.ivyson.workers.dev` | `0 9 * * 6` | Comunicação escola→família: confirmações, FAQ bot (Claude), relatório semanal (Claude), estou-a-caminho |

**Deploy Workers:**
```bash
cd whatsapp-gateway  # ou whatsapp-worker
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID npx wrangler deploy
```

### Vercel
- Project ID: `prj_6uDL0URPHd5DiMj5ahaZcEltRfSL`
- Team ID: `team_k3kAHF00rep1GFrBRA53OmGg`
- API Token: `VERCEL_API_TOKEN` (secret no Supabase — usado pelo onboarding para criar subdomínios)
- Domínios gerenciados via API: `POST /v10/projects/{id}/domains`
- SSL: automático ao adicionar domínio (CNAME wildcard `*` → `cname.vercel-dns.com`)

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
| `admin-central.html` | Painel Central Lumied — gestão SaaS global (`admin.lumied.com.br`) |
| `admin.html` | Painel Admin por escola — config, módulos, keys (só staff Lumied) |
| `assinar.html` | Página pública de assinatura eletrônica de contratos |
| `verificar.html` | Verificação de autenticidade de documentos por código |
| `site/certificacao.html` | Página de certificação Escola Digital (3 níveis: Bronze/Prata/Ouro) |
| `site/blog/` | Blog com 26 artigos (compliance, LGPD, WhatsApp, inadimplência, IA, etc.) |
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

## Planos Comerciais (3 tiers — atualizado 2026-04-13)

| Tier | Preço/mês | Anual (20% off) | Alunos | Módulos | WhatsApp | Implantação |
|------|-----------|-----------------|--------|---------|----------|-------------|
| **Start** | R$ 1.200 | R$ 960 | 300 | 15 | — | R$ 1.990 |
| **Evolução** | R$ 1.800 | R$ 1.440 | 800 | 23 | 500 msgs/mês | R$ 2.990 |
| **Prestige** | R$ 3.300 | R$ 2.640 | Ilimitado | Todos | 2.000 msgs/mês | R$ 4.990 |

### Módulos por plano

**Start (15):** dashboard, alunos, turmas, notas, frequência, comunicação, CRM, financeiro, almoxarifado, diplomas, atestados, analytics, equipe, famílias, config

**Evolução (23):** tudo do Start + turnos, atividades, compliance, biblioteca, cantina, transporte, whatsapp, histórico_aluno

**Prestige (todos):** tudo do Evolução + rh, loja, controle de acesso biométrico, multi-escola, API dedicada, SLA 99.9%

### Planos antigos (desativados, mantidos por FK)
Starter (R$ 259), Gestão (R$ 649), Automação (R$ 1.249), Avançado (R$ 2.079), Rede (R$ 2.939) — `ativo = false` na tabela `planos`. Escolas existentes nesses planos continuam funcionando até migração manual.

### Pacotes Extras (aprovação do resp financeiro)

| Extra | Preço |
|-------|-------|
| 500 msgs WhatsApp | R$ 299,90/mês |
| 1.000 msgs WhatsApp | R$ 549,90/mês |
| Excedente avulso | R$ 0,75/msg |
| 50 GB storage | R$ 79,90/mês |
| 20 usuários | R$ 89,90/mês |

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

## Contratos Digitais & Assinatura Eletrônica

### Fluxo
1. Gerente cria template HTML com variáveis `{{familia_nome}}`, `{{aluno_nome}}`, etc.
2. Gera contrato preenchido a partir de matrícula
3. Envia para família (status: `rascunho` → `enviado`)
4. Família acessa `/assinar.html?id=<uuid>`, lê contrato
5. **Verificação por email**: clica "Enviar Código" → recebe 6 dígitos → digita → verificado ✅
6. Seção de assinatura desbloqueada → aceita termos (checkbox) + desenha assinatura (canvas)
7. Backend valida código de email + gera hash SHA-256 + código de verificação `LUM-XXXXXXXX`
8. Registra evidências: IP, user-agent, geolocalização, aceite, verificação email, timestamp
9. Status: `assinado` com selo probatório

### Validade Legal
- **Assinatura eletrônica simples com 2FA** (Art. 4º, Lei 14.063/2020)
- Válida para contratos privados (matrícula escolar)
- **Evidências probatórias:**
  - Hash SHA-256 do documento (integridade)
  - Código de verificação único `LUM-XXXXXXXX` (autenticidade)
  - Verificação de email com código 6 dígitos (identidade)
  - Aceite explícito dos termos (checkbox)
  - Assinatura manuscrita digital (canvas)
  - IP + User-Agent + Geolocalização + Timestamp
- Verificação pública: `/verificar.html?c=LUM-XXXXXXXX`

### Tabelas
- `contrato_templates` — Templates HTML com variáveis
- `contratos` — Contratos gerados (status, hash, código, dados)
- `contrato_assinaturas` — Assinaturas com evidências probatórias

### Endpoints
- `contrato_templates_list/create/update` — CRUD templates
- `contrato_gerar` — Gera contrato com variáveis substituídas
- `contrato_enviar` — Marca como enviado
- `contratos_list` — Lista todos os contratos
- `contrato_publico_get` — Público: busca contrato para assinar
- `contrato_enviar_codigo` — Público: envia código 6 dígitos por email (expira 15 min)
- `contrato_validar_codigo` — Público: valida código de email
- `contrato_assinar` — Público: registra assinatura com evidências (exige código email)
- `contrato_verificar` — Público: verifica autenticidade por código LUM-XXXXXXXX

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

---

## Performance & Cache (2026-04-06)

### Edge Function Invocations — Otimizações
- **Realtime WebSocket** substituiu polling no gerente (dashboard) e pais (pickup)
  - Tabelas com Realtime habilitado: `solicitacoes`, `inscricoes_atividades`, `pickup_notificacoes`
  - Zero invocations para atualização de dados em tempo real
- **ticket-resolver**: cron 15min → 1h, só executa se houver tickets abertos (`ticket_resolver_if_needed()`)
- **lumied-monitor**: cron 15min → 30min

### Egress — Otimizações
- `pickup_meus_hoje`: `select('*')` → colunas específicas
- `solicitacoes_list`: `select('*')` sem LIMIT → colunas específicas + paginação (LIMIT 100)
- `frequencia_registros_list`: `select('*')` → colunas específicas

### Service Worker (v4)
- **Network-first** para HTML e JS (sempre busca do servidor, cache só offline)
- **Cache-first** apenas para CSS, imagens e fontes
- Versão incrementada `lumied-v3` → `lumied-v4` para forçar atualização
- Script inline de auto-update em todos os portais (`reg.update()` + `controllerchange` → reload)
- Push notifications mantidas

### Vercel CDN
- `Cache-Control: no-cache, no-store, must-revalidate` para HTML
- `CDN-Cache-Control: no-store` e `Vercel-CDN-Cache-Control: no-store` para HTML e JS
- `Service-Worker-Allowed: /` no sw.js

---

## Magic Link Customizado (2026-04-06)

- **Action**: `send_magic_link` (api/index.ts, seção pública)
- **Fluxo**: gera link via `admin.auth.admin.generateLink({ type: 'magiclink' })` → envia email via Resend
- **Template**: logo da escola (`escola_logo_url`), nome, cor primária, "by Lumied" no rodapé
- **Fallback**: se não há logo, usa ícone emoji
- **Rate limiting**: preset "login"
- **Frontend**: `index.html` usa `fetch('/functions/v1/api', { action: 'send_magic_link' })` em vez de `sb.auth.signInWithOtp()`
- **Onboarding**: logo obrigatória no formulário de criação de escola

---

## Portal dos Pais — Perfil (2026-04-06)

- **Tab "Meu Perfil"**: edição de nome, telefone + alteração de senha
- Botão "Perfil" na barra do usuário (ao lado de "Sair")
- Senha: `sb.auth.updateUser({ password })` — mínimo 6 chars, confirmação
- Dados: `sb.auth.updateUser({ data: { full_name, telefone } })`
- Email: read-only (não editável)
- Login Google removido — apenas Magic Link + email/senha + biometria

---

## Área Restrita — Gating por Escola (2026-04-06)

- Acesso aos portais baseado em **módulos da escola** (não mais por papel do usuário)
- `modulos_habilitados` (público) determina quais portais ficam habilitados
- Portais sem módulo requerido: disabled com "(não contratado)"
- Admin removido da lista (acesso apenas via URL direta)
- Saudação "Olá, nome" se houver sessão ativa

---

## Correções (2026-04-06)

### Secretaria — Tela Branca
- **Causa raiz**: 3 funções (`loadAcessoDashSec`, `loadAcessoEventosSec`, `loadAcessoPresencaSec`) referenciadas no `NAV_GROUPS` mas nunca definidas → `ReferenceError` quebrava todo o script
- **Fix**: funções criadas + `NAV_GROUPS` movido antes de `showApp()` (TDZ)
- **Fallback**: se `loadProfile` falha, mostra todas as features (não apenas `atestados`)

### Manutenção
- `professora_id` agora nullable na tabela `manutencoes` (chamados da secretaria/gerente)
- `manutencao_create` salva `usuario_id` do gerente logado
- Modal com formulário (substituiu `prompt()`) — urgência sem valor padrão, obrigatória
- Dashboard: alerta visual de integrações desconectadas (Mercado Livre, Banco Inter)

### Impressões
- Colunas `professora_nome` e `turma_nome` adicionadas à tabela `impressoes` (migration 205)

### Achados e Perdidos
- Botão "Devolvido" no portal da professora para marcar item como devolvido
- Pergunta nome de quem retirou (opcional)
- Auth: aceita professora ou gerente

### Diplomas
- `getProfessora()` auto-cria registro na tabela `professoras` se usuário tem papel `professora` mas não tem registro (resolve FK violation)

### Equipe (Gerente)
- Toast "Turma atualizada!" ao salvar turma de um membro
- Layout: badges de papel abaixo do nome (não ao lado), evita sobreposição com múltiplos papéis
- Página "Módulos" removida do portal da professora (só no admin)

### Manutenção — Professora (2026-04-07)
- `manutencao_submit` agora busca `usuario_id` pelo `_email` enviado (antes ficava `null`)
- Nova action pública `manutencao_minhas`: retorna chamados filtrados por `usuario_id` do email
- `professora.html` usa `manutencao_minhas` em vez de `manutencao_list` (que era gerente-only)
- `callManutApi` agora envia token para actions autenticadas

### Sessão 2026-04-07 — Correções e Features

**Tickets de Suporte:**
- Número sequencial (#1001+) — mostrado ao usuário no widget e no email
- Modal de detalhes no admin-central: tratamento, próximos passos, resposta, URL de origem
- `ticket_create` movido para seção pública (antes do auth check)
- Widget hardcoda URL Supabase (CONFIG não carregado nos portais)
- Email via Resend (temporariamente `onboarding@resend.dev` — domínio `lumied.com.br` precisa verificar no Resend)
- Remote Trigger Claude AI (`trig_01PTaCsfDfdNrUGwfUeZJZ96`): 1x/dia + poke ao criar ticket
- Actions: `staff_tickets_list`, `staff_ticket_respond`, `staff_ticket_close`, `staff_ticket_update`, `staff_ticket_get`

**Lumi (Assistente IA):**
- `ANTHROPIC_API_KEY` configurada
- `lumi-assistant.js` corrigido: `addMsg` usava `body` inexistente, `loading.remove()` crashava
- `lumied-ai/index.ts`: auth flexível aceita gerente, professora, secretaria e sessão unificada

**Almoxarifado:**
- Catálogo do gerente usa `alm_insumos_list` (não `alm_catalogo` que era de professora)
- Botão "Criar Requisição" no Dashboard e Pendentes
- Professora: formulário estruturado para material não cadastrado (nome, unidade, categoria, qty)
- Turmas: professoras mostradas inline nos cards + select para editar associação
- Importação em massa de equipe via XLSX (modelo + upload + preview)
- 146 insumos no catálogo (62 novos extraídos de PDFs de listas de materiais)

**Feature Gating:**
- Secretaria: adicionado gating por módulos da escola (duplo filtro: features do usuário + módulos da escola)
- Portal dos pais: pickup card respeita `data-modulo="pickup"`
- SRI hash do Supabase JS CDN atualizado em todos os portais

**Onboarding (Reescrito):**
- `escola_modulos`: usa `modulo_id` (UUID) + `habilitado` via `plano_modulos` do banco
- `escolas`: seta `plano_id` (UUID FK) + `plano` (text)
- `gerentes`/`usuarios`: incluem `escola_id`
- `escola_config`: respeita schema real (chave PK, sem escola_id)
- Séries configuráveis: Maple Bear, Ed. Infantil, Fundamental, Completa

**Portal dos Pais:**
- Auto-preencher nome responsável e filhos nos formulários de turno/atividades
- Reset senha família: usa `generateLink` para obter user ID (contorna bug GoTrue listUsers)
- Busca famílias: `oninput` chama `renderFamiliasLista()` direto
- Coluna `turno` adicionada à tabela `familias` (migration 207)

**Service Worker:** bumped v4 → v5 para forçar cache bust

---

## Portal da Professora — Turnos & Atividades Extras (2026-04-09)

### Dashboards espelho do gerente (read-only)
- **Turnos**: stats (total, integral, semi, tarde, diária), crianças por dia da semana, tabela com filtros e busca
- **Atividades Extras**: stats (inscrições, ativas, lotadas, vagas), crianças por dia subagrupadas por atividade/turma, ocupação por atividade com barras de progresso, tabela de inscrições
- Navegação: sidebar + bottom nav "Mais" com `data-modulo="turno"` e `data-modulo="atividades"`
- Fonte de dados: `alunos_list` (tabela `alunos`, 202 alunos ativos) — mesma do gerente
- **NÃO usa mais** `solicitacoes` (tabela legada com 3 registros de teste)

### Auth ampliado no `api/index.ts`
- `validarSessao` agora aceita papéis: `gerente`, `diretor`, `financeiro`, `secretaria`, `comercial`, **`professora`**, **`professora_assistente`**
- Fallback para `professora_sessoes` (legado) se não encontrar em `sessoes` unificada
- Permite professoras acessarem `alunos_list`, `solicitacoes_list`, `inscricoes_atividades_list`, `atividades_list_all`

### `solicitacoes_list` corrigido
- Select agora inclui `nome_resp`, `serie`, `dias_semana`, `mes_vigencia` (antes faltavam)

---

## Impressão — Contagem de Páginas (2026-04-09)

### Cota baseada em folhas (cópias × páginas)
- **Migration 212**: coluna `num_paginas integer NOT NULL DEFAULT 1` na tabela `impressoes`
- Backend (`impressao_enviar`): extrai páginas do PDF via regex (`/Type /Page[^s]`), fallback `/Count N`
- Cota: `totalUsado = SUM(copias × num_paginas)` — um doc de 25 páginas × 2 cópias = 50 folhas
- `impressao_minhas` e `impressoes_orcamento_list` também usam `copias × num_paginas`
- Display: "2 cop × 25 pag = 50 folhas" na lista da professora
- Notificação ao gerente inclui páginas: "3 copias × 10 pag = 30 folhas"

### Data de entrega: mínimo 2 dias úteis
- Date picker (`impDia`) tem `min` setado automaticamente para 2 dias úteis à frente
- Pula sábados e domingos (não considera feriados)

---

## Almoxarifado — Melhorias (2026-04-09)

### Múltiplas professoras por turma
- UI do gerente: dropdown trocado por **checkboxes** (cada professora pode marcar várias turmas)
- Backend `alm_prof_set_turma`: aceita `turma_ids` (array) além de `turma_id` (retrocompat)
- Salva `serie_id` = primeira turma, `series_monitoras` = array completo
- Display de turmas: filtra por `serie_id` OU `alm_turma_id` OU `series_monitoras.includes()`

### Campo de preço no formulário de material novo
- Professora agora informa preço estimado ao solicitar material não cadastrado
- Campo "Preço unit. R$" no formulário "Novo Item"
- Antes enviava `preco_unit: 0`, agora envia o valor informado

### Preços — proteção de edição manual
- Insumos com `referencia_fonte = 'manual'` são **pulados** por `alm_atualizar_precos` (automático)
- `alm_insumo_save`: marca `referencia_fonte = 'manual'` quando gerente edita preço
- Busca de preços (`alm_buscar_precos` e `alm_atualizar_precos`): inclui `descricao` do insumo na query para melhor precisão (ex: "Tinta Guache 250ml")
- Display do catálogo mostra descrição/especificação ao lado do nome

### Requisições multi-turma (professora)
- `alm_minha_turma` retorna **todas** as turmas da professora (`serie_id` + `series_monitoras`)
- Dropdown de turma no budget card (era texto fixo com a primeira turma)
- `alm_criar_req` aceita `turma_id` do frontend — orçamento debita da turma selecionada
- Cada turma mostra seu orçamento individual (gasto, pendente, barra)

### Projeção de orçamento em tempo real
- Barra de orçamento atualiza conforme professora adiciona itens ao carrinho (antes de enviar)
- Mostra "(+R$ X no carrinho)" ao lado do gasto
- Novos itens (não cadastrados) com preço também projetam no orçamento
- Ao remover item ou enviar requisição, barra recalcula

---

## Atividades Extras — Contas a Receber (2026-04-09)

### Repasse à escola por aluno
- Nova coluna `valor_repasse_aluno` na tabela `atividades`
- Campo "Repasse à escola (R$/aluno/mês)" no formulário de criar/editar atividade
- Display no catálogo: "Repasse: R$ X,XX/aluno"

### Tabela `atividades_contas_receber` (Migration 213)
- `atividade_id`, `atividade_nome`, `mes_apuracao`, `qtd_alunos`, `valor_por_aluno`, `valor_total`
- `data_vencimento` = dia 05 do mês seguinte à apuração
- `status`: pendente, pago, cancelado, atrasado
- UNIQUE(atividade_id, mes_apuracao)

### Apuração mensal
- Botão "Apurar Mês" no painel de Atividades do gerente
- Conta alunos por atividade via `alunos.atividades_ids` (mesma criança conta em cada atividade)
- Gera conta por atividade: `qtd_alunos × valor_repasse_aluno`
- Upsert (re-apurar atualiza valores sem duplicar)

### Endpoints
- `atividades_apurar_mes` — apura mês e gera contas (vencimento dia 05 mês seguinte)
- `atividades_contas_list` — lista contas (filtro por mês)
- `atividades_conta_pagar` — marca como pago
- `atividades_conta_cancelar` — cancela conta

### Painel no gerente
- Cards: Total a Receber, Quantidade de Atividades, Vencimento
- Tabela: atividade, alunos, valor/aluno, total, status, ações (pagar/cancelar)

---

## Portal da Professora — Perfil & Senha (2026-04-09)

- Botão **"👤 Perfil"** na topbar (ao lado de "Sair")
- Página de perfil: nome (read-only), email (read-only), formulário de alteração de senha
- Validação: senha atual obrigatória, nova senha mín 6 chars, confirmação
- Backend `prof_alterar_senha` (diplomas): verifica senha atual, atualiza hash em `professoras` e `usuarios`

---

## Banco de Dados — Migrations Recentes

| Migration | Descrição |
|-----------|-----------|
| `202` | ticket-resolver otimizado (1h + verificação de tickets abertos) |
| `203` | Realtime habilitado em solicitacoes, inscricoes_atividades, pickup_notificacoes |
| `204` | manutencoes.professora_id nullable |
| `205` | impressoes: colunas professora_nome e turma_nome |
| `206` | RPC `get_auth_uid_by_email` (SECURITY DEFINER) — não mais usada, substituída por `generateLink` |
| `207` | familias: coluna `turno` (text) |
| `208` | tickets: coluna `numero` (serial #1001+), `tratamento`, `proximos_passos` |
| `209` | insumos: fracionamento (unidade_compra, qtd_por_embalagem) |
| `210` | alunos: coluna `turno` (text) + `dias_semana` (text[]) |
| `211` | alunos: colunas `atividades_ids`, `turmas_selecionadas`, `almoco_dias` |
| `212` | impressoes: coluna `num_paginas` (integer, default 1) para contagem de folhas |
| `213` | atividades: `valor_repasse_aluno` + tabela `atividades_contas_receber` |
| `214` | RBAC: papel `impressao` com acesso só ao módulo de impressões (INSERT em permissoes_papel) |
| `215` | `acesso_dispositivos`: colunas `api_login`/`api_password` (substitui admin/admin hardcoded) |
| `216` | RPCs atômicos `biblioteca_emprestar` / `biblioteca_devolver` (race-free loan) |
| `217` | RPC `gerentes_safe_delete` (LOCK TABLE + count check em uma transação) |
| `218` | Tabela `rate_limits` + RPC `rate_limit_check` (bucket windowing) + `rate_limits_cleanup()` |
| `219` | `escola_id` UUID REFERENCES escolas(id) em 23 tabelas tenant (compliance_*, rh_ponto/ferias/holerites, cantina_*, biblioteca_emprestimos/reservas, transporte_alunos/rastreio/notificacoes). Idempotent + backfill via parent FK + index |
| `220` | pg_cron `rate-limits-cleanup-hourly` (chama `rate_limits_cleanup()` no minuto 0) |
| `221` | Fix sync triggers all roles |
| `222` | `lumied_staff`: colunas `reset_codigo_hash`, `reset_expira_em`, `reset_tentativas` para recuperação de senha |

---

## Staff — Alterar e Recuperar Senha (2026-04-13)

### Alterar Senha (logado)
- Botão "Senha" no sidebar footer do `admin-central.html`
- Modal: senha atual + nova senha + confirmação
- Backend `staff_alterar_senha`: verifica senha atual via `verificarSenhaAuto()`, gera novo hash PBKDF2

### Recuperar Senha (tela de login)
- Link "Esqueci minha senha" na tela de login
- **Fluxo em 2 etapas:**
  1. Informa email → `staff_recuperar_senha` gera código 6 dígitos, salva SHA-256 hash no banco, envia via Resend
  2. Digita código + nova senha → `staff_resetar_senha` valida e reseta
- **Segurança:**
  - Código expira em 15 minutos
  - Máximo 5 tentativas (depois invalida o código)
  - Hash SHA-256 do código (não plaintext no banco)
  - Timing-safe via comparação de hashes
  - Rate limit: 3 requests/5min (recuperar), 5 requests/5min (resetar)
  - Resposta sempre `success: true` no envio (previne enumeração de emails)
  - Invalida todas as sessões ativas ao resetar
- **Endpoints:** `staff_alterar_senha` (auth), `staff_recuperar_senha` (public), `staff_resetar_senha` (public)

---

## Blog Automation — Publicação Diária Autônoma (2026-04-11)

Sistema de 2 Remote Triggers do Claude Code que, juntos, publicam **1 artigo SEO por dia no blog Lumied sem intervenção humana, para sempre**.

### Arquitetura

```
┌─────────────────────────────────┐    pending--
│  lumied-daily-blog              │ ────────────┐
│  cron: 0 11 * * * (08:00 BRT)   │             │
│  model: claude-sonnet-4-6       │             ▼
└─────────────────────────────────┘    ┌────────────────────────┐
                                       │ scripts/seo-topics.json│
┌─────────────────────────────────┐    │ (fila de tópicos SEO)  │
│  lumied-weekly-topic-refill     │    └────────────────────────┘
│  cron: 0 10 * * 0 (dom 07 BRT)  │             ▲
│  model: claude-sonnet-4-6       │ ────────────┘
└─────────────────────────────────┘    pending++ (se < 30)
```

### Trigger 1 — `lumied-daily-blog` (publicação diária)

- **ID**: `trig_016b85mG9n2bhfnKYRkR9YgX`
- **Gerenciar**: https://claude.ai/code/scheduled/trig_016b85mG9n2bhfnKYRkR9YgX
- **Schedule**: `0 11 * * *` — todo dia às 11:00 UTC (08:00 BRT)
- **Environment**: `env_01VRivLXW46quvnd3xTJ9WDc` (Anthropic Cloud / Padrão)
- **Modelo**: `claude-sonnet-4-6` (Sonnet 4.6, 1M context)
- **Sources**: clone fresco de `ivyson-wq/maple-bear-rs` branch main a cada execução
- **Tools**: Bash, Read, Write, Edit, Glob, Grep
- **Fonte da verdade**: `scripts/daily-blog-agent.md` (10 passos operacionais detalhados)

**Fluxo por execução:**
1. `git pull --rebase origin main`
2. Lê `scripts/seo-topics.json`, filtra `status: "pending"`, ordena por `priority` desc, pega o primeiro
3. Verifica que `site/blog/<slug>/` não existe (se existir, marca published e pula para o próximo)
4. Gera `site/blog/<slug>/index.html` usando `site/blog/compliance-escolar/index.html` como TEMPLATE base
   - ~2000-2500 palavras (mínimo `target_words × 0.8`)
   - 3 schemas JSON-LD: `Article`, `BreadcrumbList`, `FAQPage`
   - Meta tags completas (description, keywords, OG, Twitter Card, canonical, robots max-image-preview:large)
   - TOC navegável com anchor links
   - Mínimo 2 `<table class="data-table">`, 3 `<div class="highlight-box">`, 1 `<blockquote>`, 1 `<div class="scenario-box">`
   - Links internos para 2-3 artigos relacionados + links externos autoritativos (gov.br, ANPD, MEC)
   - Seção FAQ matching exato com o schema FAQPage
   - GA4 com `content_group: "Blog - <categoria>"`
5. Adiciona novo `<article class="blog-card">` no topo de `site/blog/index.html`
6. Adiciona `<url>` em `sitemap.xml` com `<lastmod>` e `<priority>0.9</priority>`
7. Muda status do tópico no JSON de `pending` → `published` + adiciona `published_at`
8. Commit + push (`feat(blog): <title> [daily agent]`)
9. Submete ao IndexNow via `scripts/indexnow-submit.sh` (Bing/Yandex/Naver/Seznam/DuckDuckGo)
10. Imprime resumo no session log

**Regras críticas** (forçadas no prompt do trigger):
- NUNCA menos que 80% do `target_words`
- NUNCA duplicar slugs ou primary_keywords em posts adjacentes
- NUNCA inventar testimonials com nomes fictícios (usar "coordenação pedagógica", "gestão escolar")
- NUNCA `git push --force` ou `--no-verify`
- SEMPRE `git pull --rebase` antes de editar
- Keyword primária em: title, meta description, primeiro parágrafo, pelo menos 1 H2, URL
- Densidade keyword ~1.5% (natural)
- Se case Maple Bear Caxias for citado, usar dados consistentes (180 alunos, RS, inadimplência 14%→8.3% em 90 dias, 12h economizadas/semana)

**Contingências:**
- Fila vazia → commita `scripts/blog-queue-empty.flag` + abre issue `[daily-blog-agent] Fila vazia em YYYY-MM-DD`
- Erro catastrófico → `git reset --hard origin/main` + abre issue com traceback
- Conflito no push → resolve com rebase, nunca force

### Trigger 2 — `lumied-weekly-topic-refill` (auto-refill da fila)

- **ID**: `trig_01MwQDjREyasfxp71bQUAiSv`
- **Gerenciar**: https://claude.ai/code/scheduled/trig_01MwQDjREyasfxp71bQUAiSv
- **Schedule**: `0 10 * * 0` — todo domingo às 10:00 UTC (07:00 BRT)
- **Environment**: `env_01VRivLXW46quvnd3xTJ9WDc` (Anthropic Cloud / Padrão)
- **Modelo**: `claude-sonnet-4-6`
- **Sources**: clone fresco de `ivyson-wq/maple-bear-rs` branch main
- **Fonte da verdade**: `scripts/weekly-topic-refill-agent.md`

**Fluxo por execução:**
1. `git pull --rebase origin main`
2. Conta tópicos com `status: "pending"` no `scripts/seo-topics.json`
3. **Se `pending >= 30`**: PARA (fila saudável, não faz nada, exit 0, sem commit)
4. **Se `pending < 30`**: gera 30 novos tópicos via Claude Sonnet 4.6
   - Lê todos os slugs existentes (published + pending) + pastas em `site/blog/` para evitar duplicação
   - Mix de prioridades: ~10 priority 9-10, ~15 priority 7-8, ~5 priority 6
   - Distribui pelas 13 categorias (Pedagogia, Gestão, Financeiro, Compliance, Comercial, Operacional, Comunicação, EdTech, Segurança, Legal, Marketing, RH)
   - Prioriza lacunas — categorias com menos pending recebem mais novos
5. Valida via script Node inline:
   - Rejeita slugs duplicados
   - Rejeita primary_keywords duplicadas (case-insensitive)
   - Verifica que internal_links apontam para slugs reais
6. Append ao JSON + atualiza `_meta.total_topics`, `_meta.last_refill_at`, `_meta.last_refill_count`
7. Commit (`chore(blog-agent): refill semanal fila SEO (+30 tópicos)`) + push

**Validação pré-commit** (roda em Node antes de qualquer git add):
```javascript
const j = require('./scripts/seo-topics.json');
const slugs = j.topics.map(t => t.slug);
const dups = slugs.filter((s, i) => slugs.indexOf(s) !== i);
if (dups.length) { console.error('Slugs duplicados:', dups); process.exit(1); }
// ... idem para primary_keywords
```

### Arquivos do sistema

| Arquivo | Tipo | Descrição |
|---|---|---|
| `scripts/seo-topics.json` | Fila | 105 tópicos iniciais com slug, title, primary_keyword, secondary_keywords, category, priority, status, target_words, internal_links, external_links, faq_count |
| `scripts/daily-blog-agent.md` | Playbook | Instruções operacionais do agente diário (10 passos, regras críticas, estrutura HTML obrigatória) |
| `scripts/weekly-topic-refill-agent.md` | Playbook | Instruções do agente semanal de refill (ideias de lacunas, validações, formato JSON) |
| `scripts/indexnow-submit.sh` | Helper | Submete URLs ao Bing/Yandex/Naver/Seznam/Yep/DuckDuckGo (usado pelo daily agent) |
| `507a0a2834397332e34d6e9c94480acd.txt` | IndexNow key | Key file na raiz do site (hospedado em `https://lumied.com.br/507a0a2834397332e34d6e9c94480acd.txt`) |

### Estado inicial da fila (2026-04-11)

- **105 tópicos** `pending` (cobre ~3.5 meses de publicação diária)
- **Distribuição**: Pedagogia 16, Gestão 14, Financeiro 12, Operacional 11, Compliance 10, EdTech 8, Comercial 8, Comunicação 7, Segurança 5, Legal 5, Marketing 4, RH 4, Legal e Compliance 1
- **Roadmap primeiros 10 dias** (priority 10 primeiro):
  1. Currículo Bilíngue: Montessori vs Waldorf
  2. Folha de Pagamento CLT Professores
  3. Reforma Tributária para Escolas
  4. Como Escolher Sistema de Gestão Escolar
  5. Censo Escolar INEP
  6. Marketing Digital para Escolas
  7. Evasão Escolar: 9 Causas Reais
  8. Ponto Eletrônico Professor REP-C
  9. Como Definir Preço da Mensalidade
  10. DRE Escolar: Como Ler

### Ciclo auto-sustentável

```
[dia N]   daily-blog publica artigo → pending--
[dia N+1] daily-blog publica artigo → pending--
...
[dia 76]  pending = 30
[dia 77]  pending = 29
[próximo domingo] weekly-refill detecta pending < 30 → gera +30 → pending = 59
[dia 78]  daily-blog publica artigo → pending = 58
```

O sistema publica **1 artigo por dia para sempre**, sem intervenção humana. A fila nunca esgota. O blog Lumied cresce sozinho em ~30 artigos SEO de alta qualidade por mês.

### IndexNow key

- **Key**: `507a0a2834397332e34d6e9c94480acd`
- **Key file hospedado**: `https://lumied.com.br/507a0a2834397332e34d6e9c94480acd.txt`
- **Endpoint**: `https://api.indexnow.org/IndexNow`
- **Cobertura**: Bing, Yandex, Naver, Seznam, Yep, DuckDuckGo (Google NÃO — Google não adotou IndexNow)
- **Helper**: `scripts/indexnow-submit.sh "url1" "url2" ...` ou sem args usa todas as URLs do `sitemap.xml`

### Google Search Console

- **Verificado em 2026-04-11** pelo Ivyson (método DNS TXT no Cloudflare)
- **Propriedade**: `lumied.com.br` (Domain property)
- **Sitemap submetido**: `https://lumied.com.br/sitemap.xml`
- Para novos artigos: **não precisa resubmeter**. O Googlebot descobre pelo sitemap.xml que é atualizado automaticamente a cada publicação (com novo `<lastmod>`)
- Verificar cobertura de indexação em: https://search.google.com/search-console/coverage

### Como gerenciar os triggers

```bash
# Listar todos
RemoteTrigger action: "list"

# Pausar daily (ex: para um hotfix urgente)
RemoteTrigger action: "update" trigger_id: "trig_016b85mG9n2bhfnKYRkR9YgX" body: {"enabled": false}

# Forçar execução agora (fora do cron)
RemoteTrigger action: "run" trigger_id: "trig_016b85mG9n2bhfnKYRkR9YgX"

# Mudar horário
RemoteTrigger action: "update" trigger_id: "trig_016b85mG9n2bhfnKYRkR9YgX" body: {"cron_expression": "0 14 * * *"}
```

**Deletar triggers**: só pela web em https://claude.ai/code/scheduled (API não permite).

### SEO landing — schemas e trust indicators (2026-04-11)

Em `site/index.html`, além dos schemas já existentes (`SoftwareApplication` com `aggregateRating`), foram adicionados nesta mesma sessão:
- `Organization` com `contactPoint`, `areaServed`, `foundingDate`
- `WebSite` com `SearchAction` (habilita sitelinks de busca interna)
- `FAQPage` com 8 Q&A matching a FAQ visual

**Novas seções na landing** inspiradas no framework tryholo.ai:
- Segurança & Confiança (6 trust cards + 6 badges)
- Case study Maple Bear Caxias (4 stats reais: -40% inadimplência, 12h/sem, R$31k/mês, 8min resposta)
- Team bio "Quem está por trás" (Ivyson + parceria Maple Bear)
- Objection removal bar após pricing (sem fidelidade, 30 dias suporte, migração gratuita, preço transparente)
- Trust indicator numérico no hero (★★★★★ 4.9/5 · 47 avaliações · 200+ alunos ativos)

### Bug crítico corrigido (2026-04-11)

**CSP bloqueava Google Analytics**: `vercel.json` não incluía `googletagmanager.com`, `google-analytics.com` nem `images.unsplash.com` nas allowlists. Isso significa que **o GA4 estava silenciosamente falhando em todas as páginas** — nenhum evento chegava ao dashboard. Corrigido em `vercel.json` → `script-src`, `img-src`, `connect-src`, `frame-src`.
