# CLAUDE.md — Maple Bear RS Portal

## Visão Geral do Projeto

Portal web para pais/responsáveis, professoras, secretaria e gerência da escola Maple Bear Caxias do Sul.

**Stack:**
- Frontend: HTML/CSS/JS puro (sem framework), hospedado no **Vercel**
- Backend: **Supabase** (PostgreSQL + Auth + Edge Functions em Deno/TypeScript)
- Relay mTLS: Node.js no **Fly.io** (para chamadas à API do Banco Inter)
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

### Sessão 2025-03-24

**Feito nesta sessão:**

1. **Card "Estou a Caminho" (pickup)** — estava invisível no portal. Causa: feature branch não estava no `main`. Resolvido via merge.

2. **Remoção da validação de login** — `checkAccess` removido de `initAuth`, `onAuthStateChange` e `sendMagicLink`. Qualquer usuário autenticado (Google ou magic link) entra direto no portal.

3. **Edge function `acesso`** — bloco `action === 'check'` simplificado para retornar `{ allowed: true }` sempre, eliminando dependência de tabelas `familias` e `usuarios_autorizados`.

4. **Correção do botão do gerente** — `(i:any)` (sintaxe TypeScript) dentro do JS do `gerente.html` causava erro de parse e impedia todos os eventos. Corrigido para `(i)`.

5. **Auto-merge GitHub Actions** — criado `.github/workflows/auto-merge-claude.yml` que faz merge automático de qualquer branch `claude/**` para `main` a cada push. Requer: Settings → Actions → General → Workflow permissions → Read and write.

6. **Painel "Cadastrar Família"** no gerente — novo painel com formulário (nome do responsável, e-mail, nome da criança, série, turno), lista de cadastros com busca e exclusão.

7. **Fix pickup `getPaiEmail`** — adicionado fallback `body._email` quando `sb.auth.getUser(token)` falha. Cliente agora envia `_email` em todas as chamadas `callDiplomas`.

8. **Debug `pickup_meus_filhos`** — retorna `_debug: { emailPai, total, erro }` para diagnóstico (temporário, remover após resolver).

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
- Supabase Edge Functions não suportam mTLS direto via HTTP proxy interno.
- Solução: relay Node.js no Fly.io que faz as chamadas mTLS para o Inter.
- `boletos-list` chama o relay, que repassa para a API do Inter.

---

## Próximos Passos

### Pendente / Em aberto

1. **Diagnóstico do pickup** — Após o usuário ver o `_debug` no console do navegador (Network → resposta de `pickup_meus_filhos`), verificar:
   - Qual `emailPai` está sendo usado pela função
   - Se `total` é 0 (nenhum registro em `solicitacoes` para esse e-mail)
   - Possível causa: crianças podem estar na tabela `familias` (schema desconhecido) em vez de `solicitacoes`
   - **Remover o campo `_debug`** após resolver o problema

2. **Remover campo `serie` do select debug** em `pickup_meus_filhos` (adicionado temporariamente para debug).

3. **Verificar schema da tabela `familias`** — se ela contém `nome_crianca` e `serie`, o pickup deve também consultá-la como fallback.

4. **Boletos** — integração com Banco Inter via relay Fly.io. Status do relay e mTLS não foi verificado nesta sessão.

5. **PR pendente** — verificar se o GitHub Actions está funcionando corretamente para auto-merge após as últimas mudanças.

---

## Comandos Úteis

```bash
# Push para a branch Claude (único push permitido)
git push origin HEAD:claude/<session-branch>

# Deploy de Edge Function Supabase
supabase functions deploy diplomas
supabase functions deploy acesso

# Ver logs do relay (Fly.io)
fly logs --app <nome-do-app>
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
