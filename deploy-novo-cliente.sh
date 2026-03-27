#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  deploy-novo-cliente.sh
#  Automatiza setup de um novo cliente: migrations + edge functions
#
#  Uso:
#    bash deploy-novo-cliente.sh <PROJECT_REF> [SUPABASE_ACCESS_TOKEN]
#
#  Exemplo:
#    bash deploy-novo-cliente.sh abcdefghijklmnop sbp_xxxx...
#
#  Se o token não for passado, usa a env var SUPABASE_ACCESS_TOKEN
# ══════════════════════════════════════════════════════════════

set -e

PROJECT_REF="${1}"
TOKEN="${2:-$SUPABASE_ACCESS_TOKEN}"

if [ -z "$PROJECT_REF" ]; then
  echo "❌ Uso: bash deploy-novo-cliente.sh <PROJECT_REF> [SUPABASE_ACCESS_TOKEN]"
  echo ""
  echo "   PROJECT_REF: encontre em Supabase > Settings > General > Reference ID"
  echo "   TOKEN: gere em https://supabase.com/dashboard/account/tokens"
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Token não fornecido. Passe como 2º argumento ou defina SUPABASE_ACCESS_TOKEN"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/supabase/migrations"
API_URL="https://api.supabase.com/v1/projects/$PROJECT_REF/database/query"

echo "══════════════════════════════════════════════════════"
echo "  Deploy Novo Cliente"
echo "  Projeto: $PROJECT_REF"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Testar conexão ─────────────────────────────────────
echo "🔌 Testando conexão com o Supabase..."
TEST=$(curl --ssl-no-revoke -s -X POST "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1 as ok"}' 2>&1)

if echo "$TEST" | grep -q '"ok":1'; then
  echo "   ✅ Conexão OK"
else
  echo "   ❌ Falha na conexão: $TEST"
  exit 1
fi
echo ""

# ── Rodar migrations ──────────────────────────────────
echo "📦 Executando migrations..."
echo ""

MIGRATIONS=(
  009_diplomas.sql
  010_atestados.sql
  011_pdi.sql
  012_pickup.sql
  013_almoxarifado.sql
  014_alm_compras.sql
  015_acesso.sql
  016_acesso_fix_status.sql
  017_acesso_rls_fix.sql
  018_boletos.sql
  018_manutencoes.sql
  019_professoras_tipo.sql
  020_calendar.sql
  021_usuarios_unificados.sql
  022_familias_serie.sql
  023_notificacoes.sql
  024_alm_usar_series.sql
  025_manut_equipes.sql
  026_alm_categorias.sql
  027_webauthn.sql
  028_webauthn_pais.sql
  029_webauthn_text_id.sql
  030_cron_precos.sql
  031_achados_perdidos.sql
  032_ml_oauth.sql
  033_ml_refresh_nullable.sql
  034_insumo_referencia.sql
  035_insumo_fracionamento.sql
  036_insumo_historico.sql
  037_calendario_analytics.sql
  038_emergencia_idioma.sql
  039_impressoes.sql
  040_financeiro.sql
  041_contabilidade.sql
  042_boletos_emissao.sql
  043_crm.sql
  044_crm_nascimento.sql
  045_crm_vagas.sql
  046_matriculas_dados_completos.sql
  047_matriculas_turma.sql
  048_escola_config.sql
)

TOTAL=${#MIGRATIONS[@]}
OK=0
ERROS=0

for i in "${!MIGRATIONS[@]}"; do
  FILE="${MIGRATIONS[$i]}"
  NUM=$((i + 1))
  FILEPATH="$MIGRATIONS_DIR/$FILE"

  if [ ! -f "$FILEPATH" ]; then
    echo "   ⚠️  [$NUM/$TOTAL] $FILE — arquivo não encontrado, pulando"
    continue
  fi

  # Converte SQL para JSON válido usando awk
  TMPFILE=$(mktemp)
  awk 'BEGIN { printf "{\"query\":\"" } { gsub(/"/, "\\\""); gsub(/\t/, " "); if (NR > 1) printf "\\n"; printf "%s", $0 } END { printf "\"}" }' "$FILEPATH" > "$TMPFILE"

  RESULT=$(curl --ssl-no-revoke -s -X POST "$API_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @"$TMPFILE" 2>&1)

  rm -f "$TMPFILE"

  if echo "$RESULT" | grep -q '"message"'; then
    # Tem erro — mas pode ser "already exists" que é OK
    if echo "$RESULT" | grep -qi "already exists"; then
      echo "   ⏭️  [$NUM/$TOTAL] $FILE — já existe, OK"
      OK=$((OK + 1))
    else
      MSG=$(echo "$RESULT" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
      echo "   ❌ [$NUM/$TOTAL] $FILE — ERRO: $MSG"
      ERROS=$((ERROS + 1))
    fi
  else
    echo "   ✅ [$NUM/$TOTAL] $FILE"
    OK=$((OK + 1))
  fi
done

echo ""
echo "   Resultado: $OK/$TOTAL OK, $ERROS erro(s)"
echo ""

# ── Deploy Edge Functions ─────────────────────────────
echo "🚀 Fazendo deploy das Edge Functions..."
echo ""

# Detecta supabase CLI
SUPABASE_CLI=""
if command -v supabase &> /dev/null; then
  SUPABASE_CLI="supabase"
elif [ -f "/tmp/supabase.exe" ]; then
  SUPABASE_CLI="/tmp/supabase.exe"
elif [ -f "/tmp/supabase" ]; then
  SUPABASE_CLI="/tmp/supabase"
else
  echo "   ⚠️  Supabase CLI não encontrado."
  echo "   Instale com: npm install -g supabase"
  echo "   Ou baixe de: https://github.com/supabase/cli/releases"
  echo ""
  echo "   Após instalar, rode manualmente:"
  echo "   export SUPABASE_ACCESS_TOKEN=$TOKEN"
  for FN in api diplomas acesso send-email boletos-list calendar inter-webhook; do
    echo "   supabase functions deploy $FN --no-verify-jwt --project-ref $PROJECT_REF"
  done
  echo ""
  echo "══════════════════════════════════════════════════════"
  echo "  Migrations: ✅ concluídas"
  echo "  Edge Functions: ⚠️ pendentes (CLI não encontrado)"
  echo "══════════════════════════════════════════════════════"
  exit 0
fi

export SUPABASE_ACCESS_TOKEN="$TOKEN"
FUNCTIONS=(api diplomas acesso send-email boletos-list calendar inter-webhook)
FN_OK=0
FN_ERR=0

for FN in "${FUNCTIONS[@]}"; do
  echo -n "   Deploying $FN... "
  RESULT=$($SUPABASE_CLI functions deploy "$FN" --no-verify-jwt --project-ref "$PROJECT_REF" 2>&1)
  if echo "$RESULT" | grep -q "Deployed"; then
    echo "✅"
    FN_OK=$((FN_OK + 1))
  else
    echo "❌"
    echo "      $RESULT" | head -3
    FN_ERR=$((FN_ERR + 1))
  fi
done

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✅ Deploy concluído!"
echo ""
echo "  Migrations:      $OK/$TOTAL OK"
echo "  Edge Functions:   $FN_OK/${#FUNCTIONS[@]} OK"
echo ""
echo "  Próximos passos:"
echo "  1. Vercel: criar projeto → import ivyson-wq/maple-bear-rs"
echo "     Env vars: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON"
echo "  2. Domínio: configurar DNS (CNAME app → cname.vercel-dns.com)"
echo "  3. Supabase Auth: Site URL + Redirect URLs"
echo "  4. Google OAuth: adicionar redirect URI"
echo "  5. Acessar setup.html → configurar escola"
echo "  6. Acessar admin.html → configurar APIs e secrets"
echo "══════════════════════════════════════════════════════"
