#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "========================================"
echo "  Build & Open in Xcode"
echo "========================================"
echo ""

echo "[1/3] Building Angular app (staging)..."
npx ng build --configuration=staging
echo "  ✓ Angular build complete"
echo ""

echo "[2/3] Syncing with Capacitor iOS..."
npx cap sync ios
echo "  ✓ Capacitor sync complete"
echo ""

echo "[3/3] Opening Xcode..."
npx cap open ios
echo "  ✓ Xcode opened"
echo ""

echo "========================================"
echo "  Done! Build & run from Xcode."
echo "========================================"
