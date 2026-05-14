#!/bin/bash
# Empacota a extensao para upload na Chrome Web Store
# Uso: bash pack.sh

DIST="lumied-crm-whatsapp.zip"

# Remove zip anterior se existir
rm -f "$DIST"

# Cria o zip apenas com os arquivos necessarios
zip -j "$DIST" \
  manifest.json \
  popup.html \
  popup.js \
  background.js \
  content.js \
  content.css \
  page-phone.js \
  privacy-policy.html \
  lumied-icon.png \
  icon16.png \
  icon48.png \
  icon128.png

echo ""
echo "Pacote criado: $DIST"
echo "Tamanho: $(du -h "$DIST" | cut -f1)"
echo ""
echo "Proximos passos:"
echo "1. Acesse https://chrome.google.com/webstore/devconsole"
echo "2. Clique em 'Novo item' e faca upload de $DIST"
echo "3. Preencha os dados conforme STORE-LISTING.md"
echo "4. Adicione screenshots (1280x800)"
echo "5. Cole a URL da politica de privacidade"
echo "6. Submeta para revisao"
