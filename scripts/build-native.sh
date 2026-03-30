#!/bin/bash
# Build script for Capacitor native app
# Usage: bash scripts/build-native.sh [android|ios]

set -e

echo "🔨 Building Lumied native app..."

# 1. Build frontend
echo "📦 Building frontend..."
node build.js

# 2. Sync Capacitor
echo "📱 Syncing Capacitor..."
npx cap sync

# 3. Build platform
PLATFORM=${1:-android}
echo "🏗️ Building for $PLATFORM..."

if [ "$PLATFORM" = "android" ]; then
  npx cap open android
  echo "✅ Android Studio opened. Build APK from there."
  echo "   Or run: cd android && ./gradlew assembleDebug"
elif [ "$PLATFORM" = "ios" ]; then
  npx cap open ios
  echo "✅ Xcode opened. Build from there."
fi

echo ""
echo "📋 App Config:"
echo "   App ID: com.lumied.app"
echo "   Name: Lumied"
echo "   Server: https://app.maplebearcaxiasdosul.com.br"
