# bank-relay (Cloudflare Worker)

Proxy mTLS multi-banco do Lumied — Cloudflare Worker que recebe requests
das edge functions Supabase e repassa pros bancos (Inter, Sicredi, BB,
Itaú, Bradesco) usando o cert mTLS correto.

Substitui o `relay/` (Node.js, era pra Render/Fly mas nunca foi pra prod).

## Endpoints

- `POST /bank-proxy` — genérico, dispatch via `payload.banco`
- `POST /inter-proxy` — legacy, hardcoded Inter (backward-compat)
- `GET  /health` — versão + bancos com cert plugado

Auth: `Authorization: Bearer ${RELAY_SECRET}` em todo request.

## Setup inicial (1× por ambiente)

```bash
# 1. Setar RELAY_SECRET (mesmo valor que tá em Supabase secrets)
cd bank-relay
npx wrangler secret put RELAY_SECRET
# (paste o valor quando pedir)

# 2. Primeiro deploy (sem certs ainda — só os endpoints respondem 503 por banco)
npx wrangler deploy
```

URL do worker fica em `https://bank-relay.<seu-subdomain>.workers.dev`. Atualizar
`INTER_RELAY_URL` em Supabase secrets pra apontar pra essa URL.

## Adicionar cert mTLS pra um banco

```bash
# 1. Ter o .pem + .key do banco. Se for PFX, converter primeiro:
openssl pkcs12 -in inter.pfx -nocerts -nodes -out inter.key
openssl pkcs12 -in inter.pfx -clcerts -nokeys -out inter.pem

# 2. Upload pra Cloudflare
npx wrangler mtls-certificate upload --cert inter.pem --key inter.key --name inter

# 3. Copia o certificate_id retornado e descomenta o bloco em wrangler.toml:
#    [[mtls_certificates]]
#    binding = "INTER_MTLS"
#    certificate_id = "<cert_id_aqui>"

# 4. Redeploy
npx wrangler deploy
```

Repetir pra cada banco (binding name: `SICREDI_MTLS`, `BB_MTLS`, `ITAU_MTLS`, `BRADESCO_MTLS`).

## Health check

```bash
curl https://bank-relay.<subdomain>.workers.dev/health
# {"ok":true,"version":"v2-worker","sandbox":false,"bancos_carregados":["inter"]}
```

## Renovação de cert

Quando o cert do banco vencer:

```bash
npx wrangler mtls-certificate upload --cert inter-new.pem --key inter-new.key --name inter-2027
# Atualizar certificate_id em wrangler.toml
npx wrangler deploy
# Depois de validar: wrangler mtls-certificate delete --id <id_antigo>
```

## Sandbox

Setar `BANK_SANDBOX = "true"` em `[vars]` muda os hostnames pros endpoints
de homologação dos bancos (sandbox/UAT).
