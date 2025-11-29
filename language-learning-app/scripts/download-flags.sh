#!/bin/bash

# Script to download flag SVGs from flagcdn.com
# Usage: ./scripts/download-flags.sh

FLAGS_DIR="src/assets/flags"

# Create flags directory if it doesn't exist
mkdir -p "$FLAGS_DIR"

# Array of country codes needed (from FlagService and tutor-onboarding countries)
declare -a codes=(
  # Language flags
  "es" "gb" "fr" "de" "it" "pt" "ru" "cn" "jp" "kr" "sa" "in" "nl" "se" "no" "dk" "fi" "pl" "cz" "hu" "tr" "gr" "il" "th" "vn" "id" "my" "ph" "ke"
  # Additional country flags for tutor-onboarding
  "af" "al" "dz" "ar" "am" "au" "at" "az" "bh" "bd" "by" "be" "bo" "ba" "br" "bg" "kh" "ca" "cl" "co" "cr" "hr" "cu" 
  "do" "ec" "eg" "sv" "ee" "et" "ge" "gh" "gt" "hn" "hk" "is" "ir" "iq" "ie" "jm" "jo" "kz" "kw" "lv" "lb" "ly" "lt" 
  "lu" "mx" "ma" "nz" "ni" "ng" "kp" "om" "pk" "ps" "pa" "py" "pe" "pr" "qa" "ro" "rs" "sg" "sk" "si" "za" "lk" "ch" 
  "sy" "tw" "tn" "ua" "ae" "us" "uy" "uz" "ve" "ye"
)

echo "Downloading flag SVGs..."

for code in "${codes[@]}"; do
  # Skip if file already exists
  if [ -f "${FLAGS_DIR}/${code}.svg" ]; then
    echo "Skipping ${code}.svg (already exists)"
    continue
  fi
  
  echo "Downloading ${code}.svg..."
  curl -s -o "${FLAGS_DIR}/${code}.svg" "https://flagcdn.com/${code}.svg" || echo "Failed to download ${code}.svg"
  
  # Add a small delay to avoid overwhelming the server
  sleep 0.1
done

echo "Download complete!"
echo "Next step: Optimize flags with SVGO: npx svgo -f ${FLAGS_DIR} --multipass"

