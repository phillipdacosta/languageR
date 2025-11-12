# Flag Icons Implementation

This document describes the flag icon system implemented for displaying country flags alongside languages throughout the app.

## Overview

The flag icon system allows you to display country flags next to language names using SVG icons. Flags are mapped to languages via ISO 3166-1 alpha-2 country codes.

## Components

### 1. FlagService (`src/app/services/flag.service.ts`)

A service that maps language names to country codes and provides flag paths.

**Methods:**
- `getCountryCode(languageName: string): string | null` - Get ISO country code for a language
- `getFlagPath(languageName: string): string | null` - Get the path to the flag SVG
- `hasFlag(languageName: string): boolean` - Check if a flag exists for a language

### 2. FlagIconComponent (`src/app/components/flag-icon/flag-icon.component.ts`)

A reusable Angular component for rendering flag icons.

**Usage:**
```html
<app-flag-icon 
  [language]="'Spanish'" 
  [size]="20" 
  cssClass="my-flag-class">
</app-flag-icon>
```

**Inputs:**
- `language` (string) - The language name (e.g., "Spanish", "French")
- `size` (number) - Size in pixels (default: 20)
- `cssClass` (string) - Additional CSS classes
- `altText` (string) - Alt text for accessibility

### 3. Flag Assets (`src/assets/flags/`)

Directory containing SVG flag files named by ISO country code (e.g., `es.svg`, `fr.svg`).

## Setup Instructions

### Step 1: Download Flag SVGs

You have three options:

#### Option A: Use the provided script
```bash
cd language-learning-app
./scripts/download-flags.sh
```

#### Option B: Download manually from flagcdn.com
Visit https://flagcdn.com/ and download the SVGs you need, or use curl:
```bash
curl -o src/assets/flags/es.svg https://flagcdn.com/es.svg
curl -o src/assets/flags/fr.svg https://flagcdn.com/fr.svg
# ... etc
```

#### Option C: Use flag-icons npm package
```bash
npm install flag-icons
cp node_modules/flag-icons/flags/4x3/es.svg src/assets/flags/es.svg
# ... etc
```

### Step 2: Optimize Flags (Optional but Recommended)

Install SVGO and optimize all flags:
```bash
npm install -g svgo
svgo -f src/assets/flags --multipass --pretty
```

### Step 3: Required Flags

Based on the languages in the app, you need flags for these country codes:
- es, gb, fr, de, it, pt, ru, cn, jp, kr, sa, in, nl, se, no, dk, fi, pl, cz, hu, tr, gr, il, th, vn, id, my, ph, ke

See `src/assets/flags/README.md` for the complete list.

## Integration

Flags are already integrated into:

1. **Tutor Search Page** (`tutor-search-content.page.html`)
   - Language filter dropdown
   - Selected language display

2. **Profile Page** (`profile.page.html`)
   - Tutor languages section
   - Student learning languages section

3. **Messages Page** (`messages.page.html`)
   - User details panel (Subject section for tutors)

## Adding Flags to New Locations

1. Import `SharedModule` in your module (if not already imported)
2. Use the `FlagIconComponent`:
```html
<app-flag-icon [language]="languageName" [size]="20"></app-flag-icon>
```

## Service Worker Caching (Future Enhancement)

To cache flag SVGs via service worker, you'll need to:
1. Register flag paths in your service worker configuration
2. Add flag SVGs to the precache list
3. Ensure flags are cached on first load

Example service worker configuration:
```javascript
const FLAG_PATHS = [
  '/assets/flags/es.svg',
  '/assets/flags/fr.svg',
  // ... etc
];
```

## Language to Country Code Mapping

The mapping is defined in `FlagService.languageToCountryCode`. To add new languages:

```typescript
['NewLanguage', 'country-code']
```

Note: Some languages may be associated with multiple countries. The service uses the primary/most common country for each language.

## Troubleshooting

- **Flag not showing**: Check that the SVG file exists in `src/assets/flags/` with the correct ISO code
- **Wrong flag**: Verify the language name matches exactly (case-sensitive)
- **Placeholder showing**: The component shows a placeholder if the flag file is missing or fails to load

