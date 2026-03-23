# Maple Bear RS — Manifest de Desenvolvimento

**Projeto:** Sistema web para gestão escolar da Maple Bear Bento Gonçalves / Caxias do Sul
**Stack:** HTML/CSS/JS (vanilla) · Supabase (Postgres + Auth + Edge Functions + Storage) · Vercel · Resend

---

## Arquivos Principais

| Arquivo | Linhas | Descrição |
|---|---|---|
| `index.html` | 1985 | Portal das famílias — autenticação, formulários, solicitação de acesso |
| `gerente.html` | 3865 | Painel interno — todas as funcionalidades administrativas |
| `professora.html` | 1726 | Portal da professora — diplomas, atestados, PDI |
| `secretaria.html` | 356 | Portal da secretaria — aprovação de atestados |
| `setup.html` | 112 | Configuração inicial do projeto |

---

## Edge Functions (Supabase)

| Função | Descrição |
|---|---|
| `acesso` | Controle de acesso — check de e-mail autorizado, solicitação de acesso, aprovação/rejeição por gerentes |
| `diplomas` | Ranking de diplomas de professoras |
| `inter-webhook` | Webhook do banco Inter — recebe boletos e envia por e-mail via Resend |

---

## Migrations (Banco de Dados)

| Arquivo | Descrição |
|---|---|
| `009_diplomas.sql` | Tabela `diplomas` — upload e ranking de diplomas de professoras |
| `010_atestados.sql` | Tabela `atestados` — upload de atestados médicos com fluxo de aprovação |
| `011_pdi.sql` | Tabela `pdi` — Plano de Desenvolvimento Individual de professoras |
| `012_pickup.sql` | Tabela `pickup_notifications` — sistema "Estou a Caminho" para busca de alunos |
| `013_almoxarifado.sql` | Tabelas de almoxarifado — requisições de suprimentos |
| `014_alm_compras.sql` | Carrinho de compras do almoxarifado — rastreamento e encaminhamento automático |
| `015_acesso.sql` | Tabelas `solicitacoes_acesso` e `usuarios_autorizados` — controle de acesso |
| `016_acesso_fix_status.sql` | Correção: valor padrão `status = 'pendente'` em `solicitacoes_acesso` |
| `017_acesso_rls_fix.sql` | Correção: desabilitar RLS nas tabelas de acesso (previne insert silencioso) |

---

## Funcionalidades Implementadas

### 1. Autenticação e Controle de Acesso
- Login via Magic Link (e-mail) e Google OAuth
- Verificação de e-mail autorizado antes de enviar magic link
- Formulário de solicitação de acesso para famílias não cadastradas
- Painel do gerente para aprovar/rejeitar solicitações
- Notificação por e-mail ao responsável após aprovação ou rejeição
- Tabelas: `usuarios_autorizados`, `solicitacoes_acesso`, `gerente_sessoes`

### 2. Diplomas de Professoras
- Upload de imagem/PDF do diploma
- Ranking automático por nível de formação
- Visualização no painel do gerente
- Edge function `diplomas` para processamento

### 3. Atestados Médicos
- Upload de atestado pelo portal da professora
- Fila de aprovação na secretaria
- Histórico de atestados por professora

### 4. PDI — Plano de Desenvolvimento Individual
- Professora preenche PDI online
- Visualização e acompanhamento pelo gerente

### 5. Estou a Caminho (Pickup)
- Responsável notifica chegada pelo app
- Escola recebe alerta em tempo real
- Histórico de notificações por aluno

### 6. Almoxarifado
- Requisições de suprimentos com categorias e quantidades
- Fluxo de aprovação pelo gerente
- Busca de preços integrada (Mercado Livre, Shopee, Amazon) na tela de aprovação
- Carrinho de compras — encaminhamento automático ao aprovar
- Importação via Excel (template disponível para download)

### 7. Boletos (Webhook Inter)
- Webhook recebe eventos do banco Inter
- Boleto enviado automaticamente por e-mail ao responsável via Resend
- Histórico de boletos no painel do gerente

### 8. App Instalável (PWA)
- Banner de instalação no iOS e Android
- Ícones e manifest configurados
- Favicon desktop

---

## Correções e Fixes Aplicados

| Commit | Fix |
|---|---|
| `fix(migration)` | Remove `DATE()` de índices na migration 012 (erro IMMUTABLE no Postgres) |
| `fix(auth)` | `redirectTo` limpo no login Google + e-mail pré-preenchido ao solicitar acesso |
| `fix(acesso)` | Race condition no login + error handling melhorado |
| `fix(acesso)` | Status `pendente` no insert — registros não apareciam para o gerente |
| `fix(acesso)` | Detectar erro "Function not found" do Supabase corretamente |
| `fix(acesso)` | RLS bloqueando inserts silenciosamente — `.select()` pós-insert para detectar falha |
| `fix(acesso)` | Migration 017: desabilitar RLS em `solicitacoes_acesso` e `usuarios_autorizados` |
| `fix(acesso)` | `sendEmail` com `AbortSignal.timeout(8000)` + try/catch — evita hang quando Resend não responde |

---

## Configurações Necessárias (Variáveis de Ambiente)

### Supabase Edge Functions
| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase (auto-injetada) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role (auto-injetada) |
| `RESEND_API_KEY` | API key do Resend para envio de e-mails |

### Frontend (index.html / gerente.html / professora.html)
| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL pública do projeto |
| `SUPABASE_ANON` | Chave anon pública |

---

## Deploy

- **Frontend:** Vercel (deploy automático via `git push`)
- **Edge Functions:** Supabase dashboard — deploy manual ao atualizar código
- **Migrations:** Supabase SQL Editor — executar manualmente em ordem numérica
