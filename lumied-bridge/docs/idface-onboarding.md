# Onboarding de iDFace (Control iD) — escola nova

Validado na Maple Bear Caxias em 2026-05-15 após reverter três bugs distintos (rede, parser HTTP, parser AFD). Aplica pra qualquer escola que use Control iD iDFace (família REP-P, layout AFD-MR / Portaria 671).

## 1. Provisão no Supabase

```sql
INSERT INTO ponto_rep_devices (
  escola_id, nome, marca, modelo, ip, porta, protocolo,
  auth_modo, usuario, senha, url_afd_template, ativo
) VALUES (
  '<escola_id>', 'Recepção', 'controlid', 'iDFace',
  '<ip_idface>', 443, 'https',          -- HTTPS:443 obrigatório (não http:80)
  'controlid_session', 'admin', 'admin', -- padrão de fábrica — trocar quando der
  '/get_afd.fcgi', true                  -- único endpoint AFD que funciona
);
```

Erros comuns em UIs antigas que precisam ser corrigidos antes do primeiro pull: `porta=80`, `protocolo=http`. O iDFace não responde HTTP plain.

## 2. Setup do Beelink local

Pré-requisitos: `C:\lumied-bridge\` com build atual, serviço Windows `LumiedBridge` (NSSM), Tailscale + RDP pra acesso remoto, Wi-Fi do Beelink conectado à mesma LAN física do iDFace.

`.env` mínimo:

```
LUMIED_ESCOLA_ID=<uuid da escola>
LUMIED_BRIDGE_TOKEN=lbr_<token gerado pela escola>
LUMIED_GATEWAY_URL=wss://lumied-bridge-gateway.ivyson.workers.dev
IDFACE_LOGIN=admin
IDFACE_PASSWORD=admin
EVENT_LISTENER_HOST=<IP do Beelink na LAN do iDFace>
EVENT_LISTENER_PORT=8765
DISABLE_AUTOCONFIG=true
LOG_LEVEL=info
```

### Wi-Fi watchdog (recomendado)

A Wi-Fi do Windows às vezes cai e não volta sozinha. O DHCP da Ethernet do Beelink pode injetar uma rota fantasma `192.168.0.30/32 via 192.168.0.254` que rouba tráfego do iDFace. Resolve-se com Scheduled Task `LumiedWifiWatchdog` rodando como SYSTEM a cada 2 min (script de exemplo em `wifi-watchdog.ps1` da escola Caxias):

- Limpa rotas host `/32` pro IP do iDFace que não saiam pela Wi-Fi
- Recria rota on-link `<LAN>/24` na Wi-Fi com métrica 1 (Active + Persistent)
- Reconecta via `netsh wlan connect name="<perfil>"` se ping falhar
- Opcionalmente reinicia o serviço `LumiedBridge` quando flag `.restart-pending` aparece (one-shot pra aplicar mudanças sem precisar UAC)

Criar a task (uma vez, requer PS Admin):

```
schtasks /Create /TN "LumiedWifiWatchdog" /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\lumied-bridge\wifi-watchdog.ps1" /SC MINUTE /MO 2 /RU SYSTEM /RL HIGHEST /F
```

## 3. Validações antes de declarar pronto

```powershell
Test-NetConnection <IP_iDFace> -Port 443
curl.exe -sk -X POST "https://<IP_iDFace>/login.fcgi" -d '{"login":"admin","password":"admin"}' -H "Content-Type: application/json"
# tail -f C:\lumied-bridge\logs\bridge.log → "✓ conectado ao gateway"
# Pull manual pela UI Lumied → status:concluido, total_eventos > 0
```

Se `erro_download: fetch failed` aparece mas `curl` funciona, é o quirk do firmware iDFace (headers HTTP fora do RFC). Confirme que o bridge está usando `tolerantFetch` (helper `src/http-tolerant.ts`), não `undici`. O parser HTTP do Node/undici rejeita com `HPE_INVALID_HEADER_TOKEN`; só `https.request` com `insecureHTTPParser: true` aceita.

## 4. Cadastro de funcionários

`pis_nao_encontrados > 0` no resultado do pull = espelho de ponto vazio. Cada funcionário do iDFace precisa estar em `ponto_employees` com **PIS EXATO** (12 dígitos zero-padded) como aparece no AFD.

Extrair lista de PIS pra batch-cadastrar:

```sql
SELECT DISTINCT pis FROM afd_events WHERE import_id = '<id>';
-- ou direto do AFD parseado:
SELECT DISTINCT pis FROM afd_events WHERE escola_id = '<escola_id>';
```

## 5. Gotchas do AFD do iDFace (já tratados no edge `ponto`)

Anotar pra debug em outros fabricantes/firmwares:

| Quirk | Como o parser trata |
|-------|---------------------|
| **Layout MR/REP-P** (NSR(9) **antes** do tipo) | Detecção `/^\d{9}[0-9T]/`, offsets shiftados em 9 |
| Header tipo 1 vem na **penúltima linha** | Independe de posição — varre todas |
| 3 datas DDMMAAAA seguidas no fim do tipo 1, posição varia (CRC hex de tamanho variável depois) | Busca a **última tripla** onde os 3 grupos são datas válidas (NÃO regex com `$`) |
| Trailer com NSR=`999999999` + tipo `0` + contadores proprietários | Reconhece e deriva `totalEvents` de `events.length` |
| Tipo 3 hora em HHMM (4 chars), não HHMMSS | Ramo MR usa offset diferente |
| Tipo 5 PIS em [23..35], nome em [35..87] | Ramo MR offset MR |
| Linha final solta `AFDxxx.txt` (nome do arquivo) | Filtrada por `trim().length > 0` + heurística HTML |
| Headers HTTP com chars fora do RFC | Bridge usa `tolerantFetch` (https.request + insecureHTTPParser) |

## 6. Pós-deploy: rotacionar credenciais

Senha padrão `admin/admin` permite qualquer dispositivo na LAN administrar o iDFace. **Trocar logo após o setup.** O bridge suporta senha por IP via `IDFACE_PASSWORDS={"192.168.0.30":"nova_senha"}` no `.env`.
