#!/usr/bin/env bash
# Lumied Bridge — install nativo (sem Docker) em Linux
# Uso: sudo ./install.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Execute como root: sudo $0"
  exit 1
fi

INSTALL_DIR="/opt/lumied-bridge"
SERVICE_USER="lumied"
NODE_REQUIRED="20"

echo "→ Verificando Node.js…"
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js não encontrado. Instale Node ${NODE_REQUIRED}+ antes."
  echo "  curl -fsSL https://deb.nodesource.com/setup_${NODE_REQUIRED}.x | bash -"
  echo "  apt-get install -y nodejs"
  exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VER" -lt "$NODE_REQUIRED" ]]; then
  echo "✗ Node $NODE_VER detectado — precisa ser ≥ $NODE_REQUIRED."
  exit 1
fi
echo "✓ Node $(node -v)"

echo "→ Criando usuário $SERVICE_USER…"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "→ Instalando em $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cp -r "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/tsconfig.json" "$SCRIPT_DIR/src" "$INSTALL_DIR/"

echo "→ Instalando dependências…"
cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund

echo "→ Build TypeScript…"
npm install --no-audit --no-fund tsx typescript >/dev/null 2>&1 || true
npx tsc

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "→ Copiando .env.example → .env (precisa editar manualmente!)"
  cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "→ Instalando systemd unit…"
cp "$SCRIPT_DIR/install/lumied-bridge.service" /etc/systemd/system/
systemctl daemon-reload

echo ""
echo "✅ Instalado em $INSTALL_DIR"
echo ""
echo "Próximos passos:"
echo "  1. Editar $INSTALL_DIR/.env (LUMIED_ESCOLA_ID, LUMIED_BRIDGE_TOKEN, IDFACE_PASSWORD)"
echo "  2. systemctl enable --now lumied-bridge"
echo "  3. journalctl -u lumied-bridge -f   # acompanhar logs"
