# CLAUDE.md — Maple Bear RS Portal

## Visão Geral do Projeto

Portal web para pais/responsáveis, professoras, secretaria e gerência da escola Maple Bear Caxias do Sul.

**Stack:**
- Frontend: HTML/CSS/JS puro (sem framework), hospedado no **Vercel** (deploy via `npx vercel --yes --prod`)
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Render** (para chamadas à API do Banco Inter) — `https://inter-relay-maple-bear-rs.onrender.com`
- Git: GitHub (`ivyson-wq/maple-bear-rs`)

**Arquivos principais:**
- `index.html` — Portal do pai/responsável
- `gerente.html` — Painel da gerência
- `professora.html` — Portal das professoras
- `secretaria.html` — Portal da secretaria
- `webauthn-client.js` — Helper WebAuthn/Passkeys para biometria
- `ml-conectado.html` — Página de sucesso OAuth do Mercado Livre
- `api/boletos-sync.js` — Vercel API Route (delega para Edge Function `boletos-list`)
- `sw.js` — Service Worker para PWA
- `.github/workflows/auto-merge-claude.yml` — Auto-merge de branches Claude

**Edge Functions Supabase** (deploy via `supabase functions deploy <nome> --no-verify-jwt`):
- `diplomas` — Função principal: pickup, almoxarifado, PDI (Annual Growth Plan), diplomas, professoras, secretaria, achados e perdidos, WebAuthn, Mercado Livre OAuth, busca de preços
- `api` — Gerência: login, solicitações, séries, atividades, usuários, equipes manutenção, categorias insumos, notificações, WebAuthn
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
- **Vercel** NÃO faz auto-deploy — precisa rodar `npx vercel --yes --prod` manualmente (fora do sandbox Claude Code).
- **Edge Functions Supabase** NÃO são deployadas pelo Vercel — precisam de deploy manual (`supabase functions deploy <nome> --no-verify-jwt`).

### Autenticação
- **Portal (`index.html`)**: Supabase Auth (Google OAuth + Magic Link). Sem validação de whitelist.
- **Gerente (`gerente.html`)**: sistema próprio com senha (PBKDF2) + sessões na tabela `gerente_sessoes`.
- **Professoras**: sistema próprio (`professora_sessoes`).
- **Secretaria**: sistema próprio (`secretaria_sessoes`).
- **WebAuthn/Passkeys**: login biométrico (Face ID, fingerprint) em todos os portais. Tabelas: `webauthn_credentials`, `webauthn_challenges`. Módulo: `_shared/webauthn.ts`.

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

---

## Funcionalidades Implementadas (Sessão 2026-03-25)

### Portal dos Pais (`index.html`)
- Tabs: Início, Mudança de Turno, Atividades Extracurriculares, Boletos, Achados & Perdidos
- Pickup "Estou a Caminho" com fallback para tabela `familias`
- Boletos lazy-load (só carrega ao clicar na aba)
- WebAuthn/biometria (Face ID) com refresh token do Supabase Auth
- Banner biometria aparece 1x por sessão (sessionStorage)
- Reuniões removidas; banner "alterações de turno" removido

### Portal das Professoras (`professora.html`)
- Páginas via bottom nav: Fila, Diplomas, Growth Plan, Materiais, Atestados, Manutenção, Achados & Perdidos
- Saudação "Olá, [nome]" + data
- Notificações (sino) para diplomas, atestados, PDI
- Almoxarifado: navegador mês/ano, requisição com layout 2 colunas + itens não cadastrados
- Requisições para mês diferente do atual
- Achados & Perdidos: formulário com foto
- WebAuthn/biometria

### Portal da Secretaria (`secretaria.html`)
- Saudação + notificações
- WebAuthn/biometria

### Painel do Gerente (`gerente.html`)
- Sidebar reorganizada com seções: Turnos, Atividades, Professoras, Almoxarifado, Infraestrutura, Configurações
- Almoxarifado em páginas separadas: Dashboard, Pendentes, Requisições, Insumos, Turmas, Orçamentos, Relatório, Compras
- Navegador mês/ano com setas separadas (< 2026 > < Março >)
- Orçamento padrão: aplicar a todas as turmas + ano inteiro
- Insumos: importação Excel, categorias configuráveis, fracionamento (embalagem vs consumo)
- Busca de preços: Zoom, ML (scraping), Shopee, Reval, Amazon
- Atualização automática de preços com detecção de embalagem e histórico
- ML OAuth integrado (botão conectar + status)
- Review de requisições com seleção de fornecedor (radio buttons)
- Equipe: atribuição de turma/série para professoras
- Famílias: tabela com edição de série
- Manutenção: equipes configuráveis, relatório por equipe com WhatsApp
- Achados & Perdidos: publicar, devolver, excluir
- Configuração de almoço no painel de Atividades
- Notificações unificadas
- WebAuthn/biometria
- Annual Growth Plan (antigo PDI)

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

---

## Comandos Úteis

```bash
# Deploy de Edge Functions
supabase functions deploy diplomas --no-verify-jwt
supabase functions deploy api --no-verify-jwt

# Push migrations
supabase db push

# Deploy Vercel (FORA do sandbox Claude Code)
npx vercel --yes --prod

# Push para branch Claude (auto-merge)
git push origin HEAD:claude/<nome>

# Push direto para main
git push origin main
```
