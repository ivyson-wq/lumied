# Guia: Configurar Novo Cliente

Tempo estimado: ~15 minutos

---

## 1. Criar projeto Supabase

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard)
2. Clique **New Project**
3. Preencha:
   - **Name**: nome da escola (ex: "Escola Nova BG")
   - **Database Password**: gere uma senha forte (guarde-a)
   - **Region**: South America (Sao Paulo)
4. Aguarde a criacao (~1 min)
5. Anote dois valores:
   - **Reference ID**: Settings > General > Reference ID (ex: `abcdefghijklmnop`)
   - **Anon Key**: Settings > API > Project API Keys > `anon` `public` (comeca com `eyJ...`)
   - **Project URL**: Settings > API > Project URL (ex: `https://abcdefghijklmnop.supabase.co`)

---

## 2. Rodar script de deploy

No terminal (PowerShell ou Bash), na pasta do projeto:

```bash
cd maple-bear-rs
bash deploy-novo-cliente.sh REFERENCE_ID SEU_SUPABASE_ACCESS_TOKEN
```

Exemplo:
```bash
bash deploy-novo-cliente.sh abcdefghijklmnop sbp_e50942a4dcdd77c801bf6a56cdfb2f10e0038158
```

> **Token**: gere em [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
> O mesmo token funciona para todos os projetos da sua conta.

O script executa automaticamente:
- 41 migrations do banco de dados
- Deploy de 7 Edge Functions

Aguarde a mensagem "Deploy concluido!".

---

## 3. Configurar Supabase Auth

No dashboard do **novo projeto** Supabase:

### 3a. Site URL

1. Va em **Authentication > URL Configuration**
2. **Site URL**: `https://app.dominiodocliente.com.br`
3. **Redirect URLs**: adicione `https://app.dominiodocliente.com.br/**`

### 3b. Google OAuth Provider

1. Va em **Authentication > Providers > Google**
2. Ative o toggle
3. Preencha:
   - **Client ID**: (do Google Cloud Console — veja passo 5)
   - **Client Secret**: (do Google Cloud Console)

---

## 4. Criar projeto no Vercel

1. Acesse [vercel.com](https://vercel.com) > **Add New Project**
2. Clique **Import** no repositorio `ivyson-wq/maple-bear-rs`
3. Em **Environment Variables**, adicione:

| Nome | Valor |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://abcdefghijklmnop.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON` | `eyJ...` (anon key do passo 1) |

4. Clique **Deploy**
5. Aguarde o build (~30 segundos)

---

## 5. Configurar dominio

### 5a. Vercel

1. No projeto Vercel: **Settings > Domains > Add**
2. Digite: `app.dominiodocliente.com.br`
3. Anote o valor do CNAME que o Vercel mostrar

### 5b. DNS (no provedor do cliente: GoDaddy, Registro.br, Cloudflare, etc.)

Adicione o registro:

| Tipo | Nome | Valor |
|------|------|-------|
| **CNAME** | `app` | `cname.vercel-dns.com` (ou o valor que o Vercel mostrou) |

Propagacao: 5-30 minutos.

---

## 6. Google Cloud Console (OAuth)

> Se ja tem um OAuth Client configurado para outras escolas, pode reutiliza-lo.
> So precisa adicionar o redirect URI do novo projeto Supabase.

### Novo OAuth Client (primeira vez)

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. **APIs & Services > Credentials > Create Credentials > OAuth Client ID**
3. Application type: **Web application**
4. Authorized redirect URIs: adicione
   ```
   https://abcdefghijklmnop.supabase.co/auth/v1/callback
   ```
5. Copie o **Client ID** e **Client Secret** para o Supabase (passo 3b)

### OAuth Client existente (escolas adicionais)

1. Va em **APIs & Services > Credentials**
2. Clique no OAuth Client existente
3. Em **Authorized redirect URIs**, adicione:
   ```
   https://abcdefghijklmnop.supabase.co/auth/v1/callback
   ```
4. Use o mesmo Client ID/Secret no Supabase (passo 3b)

---

## 7. Setup da escola (wizard)

1. Acesse `https://app.dominiodocliente.com.br/setup.html`
2. Preencha os 4 passos:
   - **Dados da Escola**: nome, cidade, CNPJ, dominio de email, coordenadas
   - **Cores e Branding**: cor primaria, cor escura, logotipo
   - **Modulos**: selecione quais funcionalidades ativar
   - **Primeiro Gerente**: nome, email e senha do administrador da escola
3. Clique **Finalizar Setup**

---

## 8. Configurar APIs (admin)

1. Acesse `https://app.dominiodocliente.com.br/admin.html`
2. Faca login com Google (ivyson@gmail.com)
3. Revise todas as configuracoes da escola
4. Para cada integracao, configure os secrets no **Supabase > Edge Functions > Secrets**:

### Email (obrigatorio)

| Secret | Valor | Como obter |
|--------|-------|------------|
| `RESEND_API_KEY` | `re_xxxx...` | [resend.com](https://resend.com) > API Keys |

Tambem verificar o dominio de email no Resend (DNS do cliente).

### Mercado Livre (opcional — almoxarifado)

| Secret | Valor | Como obter |
|--------|-------|------------|
| `ML_CLIENT_ID` | `1358...` | [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br) |
| `ML_CLIENT_SECRET` | `jTYG...` | Mesmo app do ML |

### Banco Inter (opcional — boletos)

| Secret | Valor | Como obter |
|--------|-------|------------|
| `INTER_CLIENT_ID` | Client ID | Internet Banking API do Inter |
| `INTER_CLIENT_SECRET` | Client Secret | Internet Banking API do Inter |
| `INTER_CONTA` | Conta corrente | Numero da conta |
| `INTER_RELAY_URL` | `https://xxx.onrender.com` | URL do relay mTLS (ver seção Relay) |
| `RELAY_SECRET` | Segredo compartilhado | Criar uma string aleatoria |

> **Relay mTLS (Render)**: necessario para comunicacao com o Banco Inter.
> Criar um novo servico no [render.com](https://render.com) usando a pasta `relay/` do repo.
> Env vars no Render: `RELAY_SECRET`, `INTER_CERT` (PEM), `INTER_KEY` (PEM).

### Google (opcional — maps + calendar)

| Secret | Valor | Como obter |
|--------|-------|------------|
| `GOOGLE_MAPS_KEY` | `AIza...` | Google Cloud Console > APIs & Services |
| `GOOGLE_SERVICE_ACCOUNT` | JSON completo | Google Cloud Console > Service Accounts |

### Geral

| Secret | Valor |
|--------|-------|
| `APP_URL` | `https://app.dominiodocliente.com.br` |

---

## 9. Testar

Acesse cada portal e verifique:

- [ ] `https://app.dominiodocliente.com.br` — Portal dos pais (login Google/Magic Link)
- [ ] `https://app.dominiodocliente.com.br/gerente.html` — Painel do gerente (login com credenciais do passo 7)
- [ ] `https://app.dominiodocliente.com.br/professora.html` — Portal professoras
- [ ] `https://app.dominiodocliente.com.br/secretaria.html` — Portal secretaria
- [ ] `https://app.dominiodocliente.com.br/admin.html` — Admin (seu Google)
- [ ] Nome e cores da escola aparecem corretamente
- [ ] Envio de email funciona (testar solicitacao de acesso)

---

## Resumo visual

```
                    ┌─────────────────┐
                    │   GitHub Repo   │
                    │  (codigo unico) │
                    └────────┬────────┘
                             │ push main
                    ┌────────┴────────┐
              ┌─────┴─────┐    ┌─────┴─────┐
              │  Vercel A  │    │  Vercel B  │    ...
              │ env: URL_A │    │ env: URL_B │
              │ dominio-a  │    │ dominio-b  │
              └─────┬──────┘    └─────┬──────┘
                    │                  │
              ┌─────┴──────┐    ┌─────┴──────┐
              │ Supabase A │    │ Supabase B │    ...
              │ escola A   │    │ escola B   │
              │ dados A    │    │ dados B    │
              └────────────┘    └────────────┘
```

---

## Atualizar todos os clientes

Para aplicar uma atualizacao de codigo a todos os clientes simultaneamente:

```bash
git push origin main
```

Todos os projetos Vercel conectados ao repo fazem auto-deploy.

> **Edge Functions** precisam de deploy separado se foram alteradas:
> ```bash
> bash deploy-novo-cliente.sh PROJECT_REF_A TOKEN
> bash deploy-novo-cliente.sh PROJECT_REF_B TOKEN
> ```

---

## Checklist rapido (copiar/colar)

```
[ ] 1. Supabase: criar projeto, anotar REF + ANON
[ ] 2. Terminal: bash deploy-novo-cliente.sh REF TOKEN
[ ] 3. Supabase Auth: Site URL + Redirect + Google Provider
[ ] 4. Vercel: import repo + env vars + deploy
[ ] 5. DNS: CNAME app → cname.vercel-dns.com
[ ] 6. Google: redirect URI do novo Supabase
[ ] 7. setup.html: wizard (nome, cores, modulos, gerente)
[ ] 8. admin.html: secrets (RESEND obrigatorio, demais opcional)
[ ] 9. Testar todos os portais
```
