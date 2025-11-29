# Flag Display Fix for Windows Chrome

## Problem

Country flags were not displaying in the tutor-onboarding "Where are you from?" modal on Windows Chrome, while working fine on Mac. This was due to the use of Unicode emoji flags (🇺🇸, 🇬🇧, etc.), which have inconsistent rendering across operating systems and browsers.

**Root Cause:** Windows Chrome does not properly render Unicode country flag emojis, displaying either broken characters or no flags at all.

## Solution

Replaced Unicode emoji flags with SVG flag images from https://flagcdn.com/, ensuring consistent cross-platform and cross-browser display.

## Changes Made

### 1. Enhanced FlagService (`src/app/services/flag.service.ts`)

Added country-name-to-country-code mapping to support country selection:

- Added `countryNameToCode` Map with 100+ countries
- Added `getCountryCodeFromCountryName()` method
- Added `getFlagPathFromCountryName()` method
- Added `hasFlagForCountry()` method
- Added `getAllCountryMappings()` method

### 2. Enhanced FlagIconComponent (`src/app/components/flag-icon/flag-icon.component.ts`)

Extended to support both language names and country names:

- Added `@Input() country: string` property
- Updated `updateFlag()` to prioritize country input over language input
- Now supports both use cases:
  - `<app-flag-icon [language]="Spanish"></app-flag-icon>`
  - `<app-flag-icon [country]="United States"></app-flag-icon>`

### 3. Updated Country Select Modal (`src/app/tutor-onboarding/country-select-modal.component.ts`)

Replaced emoji flags with SVG flag icons:

**Before:**
```html
<h2>{{ country.flag }} {{ country.name }}</h2>
```

**After:**
```html
<app-flag-icon [country]="country.name" [size]="24" slot="start"></app-flag-icon>
<h2>{{ country.name }}</h2>
```

### 4. Updated Tutor Onboarding Page (`src/app/tutor-onboarding/tutor-onboarding.page.html`)

Replaced emoji flag rendering with SVG flag component:

**Before:**
```html
<span>{{ getCountryFlag(country) }} {{ country }}</span>
```

**After:**
```html
<span style="display: flex; align-items: center; gap: 8px;">
  <app-flag-icon [country]="country" [size]="20"></app-flag-icon>
  <span>{{ country }}</span>
</span>
```

### 5. Updated Tutor Onboarding TypeScript (`src/app/tutor-onboarding/tutor-onboarding.page.ts`)

- Removed obsolete `getCountryFlag()` method (no longer needed)

### 6. Updated Tutor Onboarding Module (`src/app/tutor-onboarding/tutor-onboarding.module.ts`)

- Added `SharedModule` import to provide access to `FlagIconComponent`

### 7. Downloaded Flag Assets

- Updated `scripts/download-flags.sh` to download all required country flags
- Downloaded 70+ additional country flag SVG files from https://flagcdn.com/
- All flags now stored in `src/assets/flags/` directory

## Flag Coverage

The system now supports 100+ countries with SVG flags, including:

- All major English-speaking countries (US, UK, Canada, Australia, etc.)
- All European countries
- All Asian countries
- All South American countries
- All Middle Eastern countries
- All African countries with teaching presence

**Total flags available:** 100+ country SVG files

## Testing Recommendations

To verify the fix works on Windows Chrome:

1. Open the app in Windows Chrome
2. Navigate to tutor onboarding (sign up as a tutor)
3. Go to Step 1: "Where are you from?"
4. Click "Select your country" button
5. Verify that all country flags display correctly as SVG images
6. Search for a country and verify the flag displays correctly
7. Select a country and verify the flag displays in both:
   - The button after selection
   - The "selected-country" display below the button

## Benefits

1. **Cross-platform consistency:** Flags display identically on Windows, Mac, Linux, iOS, and Android
2. **Browser compatibility:** Works in all modern browsers (Chrome, Firefox, Safari, Edge)
3. **Scalability:** SVG flags scale perfectly at any size without pixelation
4. **Performance:** Flags are cached by the browser and load quickly
5. **Professional appearance:** Clean, crisp flag images improve the user experience
6. **Maintainability:** Centralized FlagService makes it easy to add new countries

## Technical Details

- **Flag source:** https://flagcdn.com/ (free, high-quality SVG flags)
- **Flag format:** SVG (Scalable Vector Graphics)
- **Flag dimensions:** Dynamic (set via `[size]` input property)
- **Fallback:** Displays country code initials if flag fails to load
- **Caching:** Flags are automatically cached by the browser

## Future Enhancements

Consider these optional improvements:

1. **Service Worker Caching:** Pre-cache flag SVGs for offline access
2. **Lazy Loading:** Implement virtual scrolling for the country list
3. **Flag Animations:** Add subtle hover effects on flag icons
4. **RTL Support:** Ensure flags display correctly in right-to-left languages

## Files Modified

- `src/app/services/flag.service.ts`
- `src/app/components/flag-icon/flag-icon.component.ts`
- `src/app/tutor-onboarding/country-select-modal.component.ts`
- `src/app/tutor-onboarding/tutor-onboarding.page.html`
- `src/app/tutor-onboarding/tutor-onboarding.page.ts`
- `src/app/tutor-onboarding/tutor-onboarding.module.ts`
- `scripts/download-flags.sh`

## Files Added

- 70+ new SVG flag files in `src/assets/flags/`

## No Breaking Changes

This change is backward compatible. The existing `FlagIconComponent` continues to work with language names, and now also supports country names.

