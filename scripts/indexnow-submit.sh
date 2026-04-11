#!/usr/bin/env bash
# IndexNow submission for Bing/Yandex/Naver/Seznam/Yep/DuckDuckGo
# Usage: ./scripts/indexnow-submit.sh [url1 url2 ...]
# Without args, submits all URLs in sitemap.xml

set -euo pipefail

KEY="507a0a2834397332e34d6e9c94480acd"
HOST="lumied.com.br"
KEY_LOCATION="https://${HOST}/${KEY}.txt"
ENDPOINT="https://api.indexnow.org/IndexNow"

if [ $# -gt 0 ]; then
  URLS=("$@")
else
  # Extract URLs from sitemap.xml
  SITEMAP="$(dirname "$0")/../sitemap.xml"
  mapfile -t URLS < <(grep -oE '<loc>[^<]+</loc>' "$SITEMAP" | sed -E 's|<loc>(.*)</loc>|\1|')
fi

if [ ${#URLS[@]} -eq 0 ]; then
  echo "No URLs to submit."
  exit 1
fi

# Build JSON payload
URL_JSON=""
for u in "${URLS[@]}"; do
  URL_JSON+="\"${u}\","
done
URL_JSON="[${URL_JSON%,}]"

PAYLOAD=$(cat <<EOF
{"host":"${HOST}","key":"${KEY}","keyLocation":"${KEY_LOCATION}","urlList":${URL_JSON}}
EOF
)

echo "Submitting ${#URLS[@]} URLs to IndexNow..."
HTTP_CODE=$(curl -s --ssl-no-revoke -o /tmp/indexnow_resp.txt -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Host: api.indexnow.org" \
  -d "$PAYLOAD")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "202" ]; then
  echo "✓ IndexNow accepted ${#URLS[@]} URLs (HTTP $HTTP_CODE)"
  echo "  Bing, Yandex, Naver, Seznam, Yep, DuckDuckGo will crawl within hours."
else
  echo "✗ IndexNow returned HTTP $HTTP_CODE"
  cat /tmp/indexnow_resp.txt
  exit 1
fi
