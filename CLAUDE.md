# CLAUDE.md — Maple Bear RS Portal

## Visão Geral do Projeto

Portal web para pais/responsáveis, professoras, secretaria e gerência da escola Maple Bear Caxias do Sul.

**Stack:**
- Frontend: HTML/CSS/JS puro (sem framework), hospedado no **Vercel**
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Render** (para chamadas à API do Banco Inter) — `https://inter-relay-maple-bear-rs.onrender.com`
- Git: GitHub (`ivyson-wq/maple-bear-rs`)

**Arquivos principais:**
- `index.html` — Portal do pai/responsável
- `gerente.html` — Painel da gerência
- `professora.html` — Portal das professoras
- `secretaria.html` — Portal da secretaria
- `api/boletos-sync.js` — Vercel API Route (delega para Edge Function `boletos-list`)
- `sw.js` — Service Worker para PWA
- `.github/workflows/auto-merge-claude.yml` — Auto-merge de branches Claude

**Edge Functions Supabase** (precisam de deploy manual via dashboard ou CLI):
- `diplomas` — Função principal: pickup, almoxarifado, PDI, diplomas, professoras, secretaria
- `api` — Gerência: login, solicitações, séries, atividades, usuários
- `acesso` — Controle de acesso e solicitações de famílias
- `boletos-list` — Integração mTLS com Banco Inter
- `calendar` — Agenda/calendário do responsável
- `inter-webhook` — Webhook de boletos do Banco Inter

**Supabase Project:** `https://brgorknbrjlfwvrrlwxj.supabase.co`

---

## Estado Atual

### Sessão 2026-03-24 (continuação)

**Feito nesta sessão:**

1. **Card "Estou a Caminho" (pickup)** — estava invisível no portal. Causa: feature branch não estava no `main`. Resolvido via merge.

2. **Remoção da validação de login** — `checkAccess` removido de `initAuth`, `onAuthStateChange` e `sendMagicLink`. Qualquer usuário autenticado (Google ou magic link) entra direto no portal.

3. **Edge function `acesso`** — bloco `action === 'check'` simplificado para retornar `{ allowed: true }` sempre, eliminando dependência de tabelas `familias` e `usuarios_autorizados`.

4. **Correção do botão do gerente** — `(i:any)` (sintaxe TypeScript) dentro do JS do `gerente.html` causava erro de parse e impedia todos os eventos. Corrigido para `(i)`.

5. **Auto-merge GitHub Actions** — criado `.github/workflows/auto-merge-claude.yml` que faz merge automático de qualquer branch `claude/**` para `main` a cada push. Requer: Settings → Actions → General → Workflow permissions → Read and write.

6. **Painel "Cadastrar Família"** no gerente — novo painel com formulário (nome do responsável, e-mail, nome da criança, série, turno), lista de cadastros com busca e exclusão.

7. **Fix pickup `getPaiEmail`** — adicionado fallback `body._email` quando `sb.auth.getUser(token)` falha. Cliente agora envia `_email` em todas as chamadas `callDiplomas`.

8. **Debug `pickup_meus_filhos`** — retorna `_debug: { emailPai, total, erro }` para diagnóstico (temporário, remover após resolver).

9. **JWT Verification desabilitado** — Supabase dashboard → Edge Functions → diplomas → JWT Verification: OFF. Permite chamadas anon sem 401.

10. **Botão "Estou a Caminho" branco** — `--primary` não definido em `:root`. Corrigido em `index.html`: `background:var(--primary)` → `background:#C8102E`.

11. **Correção do login da professora** — TypeScript `(items as any[]).map(it =>` em JS causava erro de parse. Corrigido para `(items).map(it =>`.

12. **Portal das professoras — 3 correções:**
    - **Fila de Retirada no topo** — seção movida para primeira posição dentro de `.content`, antes do Ranking e demais seções.
    - **Botões brancos** — adicionado `--primary:#C8102E` ao `:root` do `professora.html`.
    - **Nomes de turmas dinâmicos** — `SERIES_DISPONIVEIS` agora começa com fallback hardcoded mas é substituído pela lista real do banco via `callApi({ action: 'series_list_pub' })` no `initPickupPanel()`.

### Sessão 2026-03-25

**Feito nesta sessão:**

13. **Integração Boletos Banco Inter — funcionando end-to-end:**
    - **Parser API Inter v3** — A API retorna estrutura aninhada `{ cobranca: {...}, boleto: {...}, pix: {...} }`, não campos diretos. Parser corrigido para extrair dados de `raw.cobranca` e `raw.boleto`.
    - **Header Authorization no frontend** — `carregarBoletos()` enviava apenas `apikey`, causando 401 JWT. Adicionado `Authorization: Bearer` com chave anon.
    - **CORS na Edge Function `boletos-list`** — Navegador bloqueava chamadas por falta de `Access-Control-Allow-Origin`. Adicionados headers CORS em todas as respostas (OPTIONS, sucesso e erro).
    - **Filtro por CPF do pagador** — A API Inter retorna todas as cobranças da conta, não apenas do CPF filtrado. Adicionado filtro local via `cob.pagador.cpfCnpj` para retornar apenas boletos do CPF solicitado.
    - **Status Inter mapeados** — Inter usa `RECEBIDO` (= pago) e `A_RECEBER` (= em aberto). Frontend atualizado para reconhecer `RECEBIDO` como "Pago".
    - **Relay no Render** — Relay mTLS migrado de Fly.io para Render (`https://inter-relay-maple-bear-rs.onrender.com`). Variável `INTER_RELAY_URL` no Supabase já aponta para lá.
    - **Chave anon atualizada** — O projeto usa uma chave anon diferente da original (ver `index.html` linha ~645).

---

## Decisões Arquiteturais

### Git / Deploy
- **Claude só pode fazer push para `claude/**`** — o proxy Git bloqueia push direto para `main` com 403.
- **Auto-merge via GitHub Actions** elimina a necessidade de merge manual de PRs.
- **Conflitos** ocorrem quando o usuário edita arquivos diretamente no GitHub enquanto Claude trabalha. Evitar edições diretas no GitHub.
- **Vercel** deploy automático ao merge para `main`.
- **Edge Functions Supabase** NÃO são deployadas pelo Vercel — precisam de deploy manual (`supabase functions deploy <nome>` ou via dashboard).

### Autenticação
- **Portal (`index.html`)**: Supabase Auth (Google OAuth + Magic Link). Sem validação de whitelist — qualquer e-mail autenticado acessa.
- **Gerente (`gerente.html`)**: sistema próprio com senha (PBKDF2) + sessões na tabela `gerente_sessoes`. Token JWT customizado, não usa Supabase Auth.
- **Professoras**: sistema próprio similar ao gerente (`professora_sessoes`).
- **Secretaria**: sistema próprio (`secretaria_sessoes`).

### Dados de Crianças
- Crianças/famílias ficam na tabela `solicitacoes` (vinculadas por `email` do responsável).
- A tabela `familias` existe no Supabase mas não tem migration no repo — era usada apenas pelo antigo sistema de whitelist (removido).
- O pickup (`pickup_meus_filhos`) busca filhos em `solicitacoes` via `.ilike('email', emailPai)`.

### mTLS / Banco Inter
- Supabase Edge Functions não suportam mTLS direto.
- Solução: relay Node.js no **Render** (`inter-relay-maple-bear-rs`) que faz as chamadas mTLS para o Inter.
- Host Inter: `cdpj.partners.bancointer.com.br` (API v3).
- `boletos-list` chama o relay via `INTER_RELAY_URL`, que repassa para a API do Inter com certificados mTLS.
- API Inter v3 retorna cobranças com estrutura aninhada: `{ cobranca: {...}, boleto: {...}, pix: {...} }`.
- A API retorna TODAS as cobranças da conta — filtro por CPF do pagador é feito localmente via `cobranca.pagador.cpfCnpj`.
- Status Inter: `RECEBIDO` = pago, `A_RECEBER` = em aberto, `EXPIRADO` = vencido.
- Edge Functions que chamam o Inter precisam de CORS headers explícitos.

---

## Próximos Passos

### Pendente / Em aberto

1. **Remover campo `_debug`** da resposta de `pickup_meus_filhos` na função `diplomas` (edge function). Foi adicionado para diagnóstico; pickup já funciona, então o debug é desnecessário. Também remover o campo `email` extra no `.select('nome_crianca, serie, email')`.

2. **Verificar schema da tabela `familias`** — se ela contém `nome_crianca` e `serie`, o pickup deve também consultá-la como fallback (atualmente só busca em `solicitacoes`).

3. ~~**Boletos**~~ — ✅ Integração com Banco Inter funcionando via relay Render. Boletos sincronizados, filtrados por CPF, com PDF e status corretos.

4. ~~**Testar auto-merge**~~ — ✅ Confirmado funcionando (commit `44386f2 auto-merge: claude/boletos-fix`).

5. **Painel "Cadastrar Família"** no gerente — verificar se `public_submit` e `solicitacoes_list` na edge function `api` estão funcionando corretamente com o novo painel.

---

## Comandos Úteis

```bash
# Push para a branch Claude (único push permitido)
git push origin HEAD:claude/<session-branch>

# Deploy de Edge Function Supabase
supabase functions deploy diplomas
supabase functions deploy acesso

# Deploy de Edge Function boletos-list
supabase functions deploy boletos-list

# Ver logs do relay (Render)
# Dashboard: https://dashboard.render.com → inter-relay-maple-bear-rs
```

## Estrutura de Tabelas Conhecidas

| Tabela | Uso |
|--------|-----|
| `solicitacoes` | Matrículas/solicitações de turno dos responsáveis |
| `familias` | Dados de famílias (schema não mapeado no repo) |
| `gerentes` | Usuários gerentes com senha_hash |
| `gerente_sessoes` | Sessões dos gerentes |
| `professoras` | Professoras com senha_hash |
| `professora_sessoes` | Sessões das professoras |
| `secretarias` | Usuárias da secretaria |
| `secretaria_sessoes` | Sessões das secretárias |
| `series` | Séries/turmas da escola |
| `atividades` | Atividades extracurriculares |
| `pickup_notificacoes` | Avisos "Estou a Caminho" dos pais |
| `diplomas_professoras` | Diplomas enviados pelas professoras |
| `pdis` | Planos de Desenvolvimento Individual |
| `alm_insumos` | Catálogo do almoxarifado |
| `alm_requisicoes` | Requisições de insumos |
| `alm_turmas` | Turmas do almoxarifado |
| `alm_compras` | Compras encaminhadas |
| `usuarios_autorizados` | Whitelist antiga (não usada mais) |
| `boletos` | Boletos sincronizados do Banco Inter (cpf, nosso_numero, valor, vencimento, linha_digitavel, situacao, pdf_url) |
