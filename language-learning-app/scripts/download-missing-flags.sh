#!/bin/bash

# Script to download missing country flag SVGs from flagcdn.com
# Usage: ./scripts/download-missing-flags.sh

FLAGS_DIR="src/assets/flags"
BASE_URL="https://flagcdn.com"

# List of country codes that might be missing
# Add any country codes here that you need
MISSING_CODES=(
  "tt"  # Trinidad and Tobago
  "bb"  # Barbados
  "bs"  # Bahamas
  "bz"  # Belize
  "ht"  # Haiti
  "cy"  # Cyprus
  "mt"  # Malta
  "tz"  # Tanzania
  "ug"  # Uganda
  "rw"  # Rwanda
  "sn"  # Senegal
  "ci"  # Ivory Coast
  "cm"  # Cameroon
  "zw"  # Zimbabwe
  "zm"  # Zambia
  "bw"  # Botswana
  "na"  # Namibia
  "mz"  # Mozambique
  "mg"  # Madagascar
  "mu"  # Mauritius
  "sc"  # Seychelles
  "np"  # Nepal
  "mm"  # Myanmar
  "la"  # Laos
  "mn"  # Mongolia
  "sd"  # Sudan
)

# Create flags directory if it doesn't exist
mkdir -p "$FLAGS_DIR"

echo "Downloading missing flag SVGs..."

# Download each flag
for code in "${MISSING_CODES[@]}"; do
  FILE_PATH="$FLAGS_DIR/${code}.svg"
  
  # Only download if file doesn't exist
  if [ ! -f "$FILE_PATH" ]; then
    echo "Downloading ${code}.svg..."
    curl -s -o "$FILE_PATH" "${BASE_URL}/${code}.svg"
    
    if [ $? -eq 0 ]; then
      echo "✅ Downloaded ${code}.svg"
    else
      echo "❌ Failed to download ${code}.svg"
    fi
  else
    echo "⏭️  ${code}.svg already exists, skipping..."
  fi
done

echo ""
echo "Done! All missing flags have been downloaded to $FLAGS_DIR"

