#!/bin/bash
# ══════════════════════════════════════════════════════
#  build.sh — Gera config.js a partir de env vars do Vercel
#  Se as env vars não existirem, mantém o config.js atual
# ══════════════════════════════════════════════════════

if [ -n "$NEXT_PUBLIC_SUPABASE_URL" ] && [ -n "$NEXT_PUBLIC_SUPABASE_ANON" ]; then
  echo ">> Gerando config.js a partir das env vars..."
  cat > config.js << EOF
const CONFIG = {
  SUPABASE_URL:  '${NEXT_PUBLIC_SUPABASE_URL}',
  SUPABASE_ANON: '${NEXT_PUBLIC_SUPABASE_ANON}',
};
EOF
  echo ">> config.js gerado para: ${NEXT_PUBLIC_SUPABASE_URL}"
else
  echo ">> Env vars não definidas. Usando config.js existente."
fi
