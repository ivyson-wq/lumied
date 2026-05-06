# Lumied Bridge

Daemon que roda na LAN da escola e conecta os iDFace (atrás de NAT) ao SaaS Lumied via WebSocket persistente com o gateway na Cloudflare.

```
Lumied SaaS ──HTTPS──> Gateway (Cloudflare) <──WSS── lumied-bridge (LAN escola) ──HTTPS──> iDFace
                                                       └─HTTP listener:8765 <─── iDFace eventos
```

## Pré-requisitos

- Node.js 20+ **ou** Docker
- Acesso outbound HTTPS/443 para `lumied-bridge-gateway.ivyson.workers.dev`
- Servidor/mini-PC na mesma LAN dos iDFace (ex.: NUC, Raspberry Pi 4+)

## Configuração

1. **Obter o `bridge_token` da escola** — no painel gerente: *Controle de Acesso > Lumied Bridge > Gerar/Mostrar token*. (Action `acesso_bridge_token_get` / `acesso_bridge_token_rotate`)
2. Copiar `.env.example` para `.env` e preencher:
   ```bash
   cp .env.example .env
   ```
   - `LUMIED_ESCOLA_ID` — UUID da escola
   - `LUMIED_BRIDGE_TOKEN` — `lbr_…` gerado no painel
   - `IDFACE_PASSWORD` — senha de admin dos iDFace (compartilhada)
   - `EVENT_LISTENER_PORT` — opcional, default `8765`

## Rodar via Docker (recomendado)

```bash
docker compose up -d --build
docker compose logs -f
```

Para atualizar:
```bash
git pull
docker compose up -d --build
```

## Rodar via Node direto

```bash
npm install
npm run build
npm start
```

Para desenvolvimento:
```bash
npm install
npm run dev
```

## Configurar callbacks dos iDFace

Cada iDFace precisa ser configurado para enviar eventos de reconhecimento HTTP para o daemon. No painel admin do iDFace:

```
URL Server Address: <IP_LAN_DO_DAEMON>
URL Server Port:    8765
URL Path:           /event
```

O daemon ao iniciar imprime a URL exata nos logs:
```
HTTP listener ouvindo em http://192.168.1.50:8765
→ configure os iDFace pra POST eventos em http://192.168.1.50:8765/event
```

## Verificar saúde

```bash
curl http://localhost:8765/health
# → {"ok":true,"ts":...}
```

No painel gerente Lumied: *Controle de Acesso > Lumied Bridge > Status* — mostra se o daemon está conectado e quando foi o último heartbeat.

## Logs

- `LOG_LEVEL=debug` para verbose
- Docker: `docker compose logs -f bridge`
- Direto: stdout do processo

## Tipos de comando suportados

| Tipo | Payload | Ação |
|------|---------|------|
| `enroll_user` | `{user}` ou `{users[]}` | `POST /create_objects.fcgi` (object: users) |
| `enroll_face` | `{user_id, photo_b64}` | `POST /user_set_image.fcgi` |
| `enroll_card` | `{card_value, user_id}` | `POST /create_objects.fcgi` (object: cards) |
| `delete_user` | `{user_id}` | `POST /destroy_objects.fcgi` |
| `ping` | `{}` | `GET /login.fcgi` (smoke test) |
| `http_proxy` | `{method, path, headers?, body_b64?}` | passthrough genérico |

Todos recebem `device: {id, ip, porta}` injetado pelo edge function.

## Troubleshooting

**`bridge offline`** no painel: container está rodando? `docker compose ps`. Logs: `docker compose logs --tail=50 bridge`.

**Comandos timeout (504):** o iDFace tá no IP correto? Da máquina do daemon: `curl -k https://<ip-idface>:443/login.fcgi`.

**`Sem senha configurada`:** preencha `IDFACE_PASSWORD` ou `IDFACE_PASSWORDS` (JSON por IP) no `.env` e reinicie.

**Conexão WS cai e não volta:** firewall outbound? Outbound 443 para `*.workers.dev` precisa estar aberto.
