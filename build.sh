#!/bin/bash
# build.sh — Gera config.js a partir de env vars do Vercel

if [ -n "$NEXT_PUBLIC_SUPABASE_URL" ] && [ -n "$NEXT_PUBLIC_SUPABASE_ANON" ]; then
  echo ">> Gerando config.js a partir das env vars..."
  echo "const CONFIG = { SUPABASE_URL: '${NEXT_PUBLIC_SUPABASE_URL}', SUPABASE_ANON: '${NEXT_PUBLIC_SUPABASE_ANON}' };" > config.js
  echo ">> config.js gerado para: ${NEXT_PUBLIC_SUPABASE_URL}"
else
  echo ">> Env vars nao definidas. Usando config.js existente."
fi

echo ">> Build concluido."
exit 0
