#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# Lumied Bridge — bootstrap one-liner pro Raspberry Pi / Linux
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/ivyson-wq/lumied/main/lumied-bridge/install/bootstrap.sh | sudo bash
# Ou (não-interativo, com env):
#   curl -fsSL ...bootstrap.sh | sudo \
#     LUMIED_ESCOLA_ID=xxx LUMIED_BRIDGE_TOKEN=lbr_yyy IDFACE_PASSWORD=zzz bash
# ════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="https://github.com/ivyson-wq/lumied.git"
REPO_DIR="/tmp/lumied-bridge-bootstrap"
INSTALL_DIR="/opt/lumied-bridge"
SERVICE_USER="lumied"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m✓\033[0m %s\n" "$*"; }
yellow() { printf "\033[33m⚠\033[0m %s\n" "$*"; }
red() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
ask() { local prompt="$1" default="${2:-}"; local val
  if [[ -n "$default" ]]; then read -p "$prompt [$default]: " val; else read -p "$prompt: " val; fi
  echo "${val:-$default}"
}

if [[ $EUID -ne 0 ]]; then
  red "Execute como root: sudo bash $0  (ou: curl ... | sudo bash)"
  exit 1
fi

bold "═══ Lumied Bridge — instalação ═══"
echo

# ─── 1. Detectar OS ──────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_LIKE="${ID_LIKE:-}"
else
  red "Não consegui detectar OS — só Debian/Ubuntu/Raspberry Pi OS suportado"
  exit 1
fi
echo "→ OS detectado: $PRETTY_NAME"

# ─── 2. Instalar Node.js 20+ ─────────────────────────────────────
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NV=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NV" -ge 20 ]]; then NODE_OK=1; green "Node $(node -v) já instalado"; fi
fi
if [[ $NODE_OK -eq 0 ]]; then
  bold "→ Instalando Node.js 20…"
  apt-get update -y -qq
  apt-get install -y -qq curl ca-certificates gnupg git
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  green "Node $(node -v) instalado"
fi

# ─── 3. Garantir git ─────────────────────────────────────────────
command -v git >/dev/null 2>&1 || apt-get install -y -qq git

# ─── 4. Clonar repo ──────────────────────────────────────────────
bold "→ Baixando código…"
rm -rf "$REPO_DIR"
git clone --depth 1 "$REPO_URL" "$REPO_DIR" 2>&1 | tail -3
green "Repo clonado em $REPO_DIR"

# ─── 5. Coletar config (interativo se faltar env) ────────────────
echo
bold "═══ Configuração ═══"
ESCOLA_ID="${LUMIED_ESCOLA_ID:-}"
BRIDGE_TOKEN="${LUMIED_BRIDGE_TOKEN:-}"
IDF_LOGIN="${IDFACE_LOGIN:-admin}"
IDF_PASSWORD="${IDFACE_PASSWORD:-}"
GATEWAY_URL="${LUMIED_GATEWAY_URL:-wss://lumied-bridge-gateway.ivyson.workers.dev}"

if [[ -z "$ESCOLA_ID" ]]; then
  echo "Pegue no painel gerente Lumied → Controle de Acesso → Setup Face ID."
  ESCOLA_ID=$(ask "ID da escola (UUID)")
fi
if [[ -z "$BRIDGE_TOKEN" ]]; then
  echo "Painel gerente → Controle de Acesso → Lumied Bridge → Mostrar/Rotacionar."
  BRIDGE_TOKEN=$(ask "Token bridge (lbr_…)")
fi
if [[ -z "$IDF_PASSWORD" ]]; then
  IDF_PASSWORD=$(ask "Senha admin dos iDFace")
fi

if [[ ! "$ESCOLA_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  red "ESCOLA_ID inválido (esperado UUID)"; exit 1
fi
if [[ ! "$BRIDGE_TOKEN" =~ ^lbr_[0-9a-f]{32,128}$ ]]; then
  red "BRIDGE_TOKEN inválido (esperado lbr_<hex>)"; exit 1
fi

# ─── 6. Usuário de serviço ───────────────────────────────────────
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  green "Usuário $SERVICE_USER criado"
fi

# ─── 7. Copiar + build ───────────────────────────────────────────
bold "→ Instalando em $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR"
cp -r "$REPO_DIR/lumied-bridge/package.json" "$REPO_DIR/lumied-bridge/tsconfig.json" "$REPO_DIR/lumied-bridge/src" "$INSTALL_DIR/"

cd "$INSTALL_DIR"
echo "→ npm install (pode levar 2-5 min no Pi)…"
npm install --no-audit --no-fund 2>&1 | tail -3
echo "→ Build TypeScript…"
npx tsc
green "Build ok"

# ─── 8. Escrever .env ────────────────────────────────────────────
cat > "$INSTALL_DIR/.env" <<EOF
LUMIED_ESCOLA_ID=$ESCOLA_ID
LUMIED_BRIDGE_TOKEN=$BRIDGE_TOKEN
LUMIED_GATEWAY_URL=$GATEWAY_URL
IDFACE_LOGIN=$IDF_LOGIN
IDFACE_PASSWORD=$IDF_PASSWORD
EVENT_LISTENER_PORT=8765
LOG_LEVEL=info
EOF
chmod 600 "$INSTALL_DIR/.env"
green ".env escrito"

# ─── 9. Permissões ───────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ─── 10. systemd unit ────────────────────────────────────────────
bold "→ Instalando systemd unit…"
cp "$REPO_DIR/lumied-bridge/install/lumied-bridge.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lumied-bridge
sleep 3
if systemctl is-active --quiet lumied-bridge; then
  green "lumied-bridge.service rodando"
else
  red "Serviço não subiu — checando logs:"
  journalctl -u lumied-bridge --no-pager -n 30
  exit 1
fi

# ─── 11. Cleanup + fim ───────────────────────────────────────────
rm -rf "$REPO_DIR"

LAN_IP=$(hostname -I | awk '{print $1}')
echo
bold "═══ ✅ Instalado e rodando ═══"
echo
echo "  Logs em tempo real:  journalctl -u lumied-bridge -f"
echo "  Healthcheck:         curl http://localhost:8765/health"
echo "  Status do serviço:   systemctl status lumied-bridge"
echo "  IP local da bridge:  $LAN_IP"
echo
echo "  Próximo passo: voltar pro painel gerente (Setup Face ID) — daemon"
echo "  deve aparecer 🟢 Online em ~30s. Se não aparecer, cola aqui o output:"
echo "      journalctl -u lumied-bridge -n 50"
echo
