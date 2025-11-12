#!/bin/bash

# Script to download flag SVGs from flagcdn.com
# Usage: ./scripts/download-flags.sh

FLAGS_DIR="src/assets/flags"

# Create flags directory if it doesn't exist
mkdir -p "$FLAGS_DIR"

# Array of country codes needed (from FlagService)
declare -a codes=("es" "gb" "fr" "de" "it" "pt" "ru" "cn" "jp" "kr" "sa" "in" "nl" "se" "no" "dk" "fi" "pl" "cz" "hu" "tr" "gr" "il" "th" "vn" "id" "my" "ph" "ke")

echo "Downloading flag SVGs..."

for code in "${codes[@]}"; do
  echo "Downloading ${code}.svg..."
  curl -s -o "${FLAGS_DIR}/${code}.svg" "https://flagcdn.com/${code}.svg" || echo "Failed to download ${code}.svg"
done

echo "Download complete!"
echo "Next step: Optimize flags with SVGO: npx svgo -f ${FLAGS_DIR} --multipass"

