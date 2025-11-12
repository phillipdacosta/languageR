# Flag Icons

This directory contains SVG flag icons for countries, used to represent languages in the app.

## Getting Flag Icons

### Option 1: Using flag-icons library (Recommended)

1. Install the flag-icons package:
```bash
npm install flag-icons
```

2. Copy the SVGs you need from `node_modules/flag-icons/flags/4x3/` to this directory:
```bash
# Example: Copy Spanish flag
cp node_modules/flag-icons/flags/4x3/es.svg src/assets/flags/es.svg
```

3. Optimize with SVGO:
```bash
# Install SVGO globally or use npx
npx svgo -f src/assets/flags --multipass
```

### Option 2: Download from flag-icons CDN

Visit https://flagicons.lipis.dev/ and download the SVGs you need.

### Option 3: Use a script to download all needed flags

Create a script that downloads flags based on the languages in `FlagService`:

```bash
# Languages that need flags (from FlagService)
languages=("es" "gb" "fr" "de" "it" "pt" "ru" "cn" "jp" "kr" "sa" "in" "nl" "se" "no" "dk" "fi" "pl" "cz" "hu" "tr" "gr" "il" "th" "vn" "id" "my" "ph" "ke")

for code in "${languages[@]}"; do
  curl -o "src/assets/flags/${code}.svg" "https://flagcdn.com/${code}.svg"
done
```

## Optimizing Flags

After downloading, optimize all flags with SVGO:

```bash
npx svgo -f src/assets/flags --multipass --pretty
```

## Required Flags

Based on the languages in the app, you need flags for these country codes:
- es (Spanish)
- gb (English)
- fr (French)
- de (German)
- it (Italian)
- pt (Portuguese)
- ru (Russian)
- cn (Chinese)
- jp (Japanese)
- kr (Korean)
- sa (Arabic - Saudi Arabia)
- in (Hindi - India)
- nl (Dutch)
- se (Swedish)
- no (Norwegian)
- dk (Danish)
- fi (Finnish)
- pl (Polish)
- cz (Czech)
- hu (Hungarian)
- tr (Turkish)
- gr (Greek)
- il (Hebrew - Israel)
- th (Thai)
- vn (Vietnamese)
- id (Indonesian)
- my (Malay - Malaysia)
- ph (Tagalog - Philippines)
- ke (Swahili - Kenya)

## File Naming

Flags should be named using lowercase ISO 3166-1 alpha-2 country codes (e.g., `es.svg`, `fr.svg`).

