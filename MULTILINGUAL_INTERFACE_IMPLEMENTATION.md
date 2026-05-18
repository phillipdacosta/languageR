# Multi-Language Interface Implementation

## Overview

This document describes the implementation of multi-language support (i18n) for the language learning app's user interface. The system allows users to view the app in their preferred language while maintaining all language learning functionality.

## Implementation Date
December 7, 2025

**Document updated:** May 14, 2026 — 29 interface languages, shared backend whitelist (`SUPPORTED_INTERFACE_LANGUAGES`), login / profile sync behavior (`setLanguage` source + `reconcileInterfaceLanguage`).

## Supported Languages

The interface language picker and backend accept **29** codes (see `language-learning-app/src/app/services/language.service.ts`: `SupportedLanguage` and `supportedLanguages`).

| Code | Code | Code | Code |
|------|------|------|------|
| en English (default) | es Spanish | fr French | pt Portuguese |
| de German | it Italian | ru Russian | zh Chinese |
| ja Japanese | ko Korean | ar Arabic | hi Hindi |
| nl Dutch | pl Polish | tr Turkish | sv Swedish |
| no Norwegian | da Danish | fi Finnish | el Greek |
| cs Czech | ro Romanian | uk Ukrainian | vi Vietnamese |
| th Thai | id Indonesian | ms Malay | he Hebrew |
| fa Persian | | | |

RTL document direction is applied for **ar**, **he**, and **fa** (`document.documentElement.dir`).

## Architecture

### 1. Frontend Setup

#### Packages Installed
```bash
npm install @ngx-translate/core @ngx-translate/http-loader
```

#### Translation Files
Location: `language-learning-app/src/assets/i18n/`

One JSON file per supported code (e.g. `en.json`, `de.json`, `fa.json`, …). `LanguageService` registers each file via `setupTranslations()`.

Each file contains structured translations organized by feature:
```json
{
  "COMMON": { ... },
  "HOME": { ... },
  "ONBOARDING": { ... },
  "PROFILE": { ... },
  "LESSONS": { ... },
  "TUTOR": { ... }
}
```

#### Core Configuration

**app.module.ts:**
- Configured `TranslateModule.forRoot()` with `HttpLoaderFactory`
- Loads translation files from `./assets/i18n/{lang}.json`

**shared.module.ts:**
- Exports `TranslateModule` for use across all feature modules
- Makes translation pipe available everywhere

### 2. Language Service

**File:** `language-learning-app/src/app/services/language.service.ts`

Central service managing all language-related functionality:

**Key Features:**
- Language resolution priority: explicit user pick (`USER_PICK_KEY`) → server profile → localStorage previous → browser detect → `en`.
- `setLanguage(..., { source: 'user' })` writes the **durable** `userLanguagePicked` localStorage key (the actual language code, not a boolean). `setLanguage(..., { source: 'auto' })` leaves that key alone — auto-applied values must not masquerade as user picks.
- `LanguageService.PRESERVE_THROUGH_CLEAR_KEYS` is preserved by `AuthService` across every `localStorage.clear()` (logout / `clearAuth0State` / force / nuclear) so a fresh pick survives a sign-out/sign-in round trip.
- Supports runtime language switching; sets `document.documentElement.lang` and `dir` (RTL for ar/he/fa).
- Provides both synchronous (`instant()`) and async (`get()`) translation methods.

**Public Methods (representative):**
```typescript
initializeLanguage(userProfileLanguage?: string): void
setLanguage(lang: SupportedLanguage, options?: { source?: 'user' | 'auto' }): void
getPendingPick(): SupportedLanguage | null
consumePendingPick(): void
getCurrentLanguage(): SupportedLanguage
isSupported(lang: string): boolean
getLanguageOption(code: string): LanguageOption | undefined
instant(key: string, params?: any): string
get(key: string, params?: any): Observable<string>
```

### 3. Application Integration

**app.component.ts:**
- Calls `initializeLanguage()` on startup.
- After auth, loads the user profile and runs `reconcileInterfaceLanguage()` in priority order:
  1. **Explicit pick** (`getPendingPick()` returns a code) wins. If it matches the server, `consumePendingPick()` clears the marker. If it differs, call `updateInterfaceLanguage` and clear the marker on success.
  2. **Browser-detect seed**. When the server still shows the schema default `'en'` and `localStorage.userLanguage` (set by `initializeLanguage`'s `navigator.languages` detection) is something else, push the local value up via `updateInterfaceLanguage`. Applies to **both** new accounts and existing accounts that pre-date the language-detect work — any record that never had an explicit preference gets seeded from the browser locale on first sign-in. After this seed lands the server holds a non-default value and branch 3 takes over.
  3. **Apply server**. Any non-default server value is treated as an explicit saved preference and applied via `setLanguage(..., { source: 'auto' })`. Opening the app from a different-locale browser doesn't overwrite it. (Edge case: a user who deliberately picks `'en'` won't be distinguishable from the schema default by this heuristic; one tap of the picker on the alternate device fixes it. A future `interfaceLanguageExplicit` flag on the User model would remove the heuristic.)
- For brand-new users, `UserService.initializeUser` also includes `localStorage.userLanguage` in the `POST /api/users` payload, so the browser-detected language is persisted on the user record at creation time (covers the case where the user completes sign-up in one round trip without re-entering the reconcile path).

### 4. Backend Support

#### User Model Updates
**File:** `backend/models/User.js`

Added field (enum must stay aligned with the Angular picker and `SUPPORTED_INTERFACE_LANGUAGES` in `users.js`):
```javascript
interfaceLanguage: {
  type: String,
  enum: [
    'en', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko',
    'ar', 'hi', 'nl', 'pl', 'tr', 'sv', 'no', 'da', 'fi', 'el',
    'cs', 'ro', 'uk', 'vi', 'th', 'id', 'ms', 'he', 'fa'
  ],
  default: 'en',
  trim: true,
  comment: 'Preferred language for app interface (UI text)'
}
```

#### API
**File:** `backend/routes/users.js`

A single module-level whitelist validates `interfaceLanguage` everywhere it is accepted from the client:

```javascript
const SUPPORTED_INTERFACE_LANGUAGES = Object.freeze([
  'en', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko',
  'ar', 'hi', 'nl', 'pl', 'tr', 'sv', 'no', 'da', 'fi', 'el',
  'cs', 'ro', 'uk', 'vi', 'th', 'id', 'ms', 'he', 'fa',
]);
```

Used for:

- **`POST /api/users`** — optional `interfaceLanguage` on create (e.g. first login payload from `initializeUser`)
- **`PUT /api/users/profile`** — profile updates
- **`PUT /api/users/onboarding`** — onboarding completion body

Each path checks `SUPPORTED_INTERFACE_LANGUAGES.includes(...)` before assigning.

#### User Service Updates
**File:** `language-learning-app/src/app/services/user.service.ts`

```typescript
updateInterfaceLanguage(language: SupportedLanguage): Observable<User>
```

(`SupportedLanguage` is imported from `LanguageService`.)

## User Experience Features

### 1. Profile Page Language Selector

**Location:** Profile Settings

Users can change their interface language via a dropdown in their profile:
- Shows flag emoji and native language name
- Saves to backend immediately
- Updates UI in real-time
- Shows success toast on save

**Implementation:**
```html
<ion-select 
  [(ngModel)]="selectedInterfaceLanguage" 
  (ionChange)="onInterfaceLanguageChange($event)">
  <ion-select-option *ngFor="let lang of availableLanguages" [value]="lang.code">
    {{ lang.flag }} {{ lang.nativeName }}
  </ion-select-option>
</ion-select>
```

### 2. Public Pages with Query Parameters

**Feature:** Shareable tutor profile links with language preference

**Example URL:**
```
https://yourapp.com/tutor/john123?lang=es
```

**Implementation:** `tutor.page.ts`
- Detects `lang` query parameter on page load
- Temporarily switches interface to that language
- Perfect for sharing profiles with non-English speakers

### 3. Smart Language Detection

**Priority Order:**
1. **Query Parameter** (for shareable links)
2. **User Profile** (authenticated users)
3. **localStorage** (previous selection)
4. **Browser Language** (first-time visitors)
5. **English** (fallback)

## Usage Examples

### In HTML Templates

**Simple Translation:**
```html
<h2>{{ 'HOME.TITLE' | translate }}</h2>
```

**With Parameters:**
```html
<p>{{ 'ONBOARDING.STEP_INDICATOR' | translate: {current: 2, total: 5} }}</p>
```

**In Placeholders:**
```html
<input [placeholder]="'HOME.SEARCH_PLACEHOLDER' | translate">
```

### In TypeScript

**Synchronous (instant):**
```typescript
const message = this.languageService.instant('HOME.WELCOME_MESSAGE');
```

**Asynchronous (observable):**
```typescript
this.languageService.get('ERRORS.GENERIC').subscribe(msg => {
  console.log(msg);
});
```

**Via TranslateService directly:**
```typescript
import { TranslateService } from '@ngx-translate/core';

constructor(private translate: TranslateService) {}

getMessage() {
  return this.translate.instant('HOME.WELCOME');
}
```

## Migration Strategy

### For Existing Pages

1. **Import SharedModule** (if not already)
```typescript
import { SharedModule } from '../shared/shared.module';
```

2. **Replace hardcoded strings** with translation keys
```html
<!-- Before -->
<h2>Class Invitations</h2>

<!-- After -->
<h2>{{ 'HOME.CLASS_INVITATIONS' | translate }}</h2>
```

3. **Add translations** to all language files
```json
{
  "HOME": {
    "CLASS_INVITATIONS": "Class Invitations"  // en.json
    "CLASS_INVITATIONS": "Invitaciones a Clases"  // es.json
  }
}
```

### Example Pages Updated

- **Home/Tab1** (`tab1.page.html`): Search bar, class invitations, preview button
- **Profile** (`profile.page.html`): Language selector with full functionality
- **Tutor Profile** (`tutor.page.ts`): Query parameter support for shareable links

## Best Practices

### 1. Translation Key Structure

Use hierarchical keys organized by feature:
```
FEATURE.SECTION.ELEMENT
```

Examples:
- `HOME.SEARCH_PLACEHOLDER`
- `PROFILE.SETTINGS`
- `LESSONS.NO_LESSONS`

### 2. Common vs Feature-Specific

**COMMON** keys for reused text:
```json
{
  "COMMON": {
    "SAVE": "Save",
    "CANCEL": "Cancel",
    "LOADING": "Loading..."
  }
}
```

### 3. Parameters for Dynamic Content

Use parameters for dynamic values:
```json
{
  "LESSONS.DURATION": "Duration: {{minutes}} minutes"
}
```

Usage:
```html
{{ 'LESSONS.DURATION' | translate: {minutes: 45} }}
```

### 4. Consistency Across Languages

- Keep the same key structure in all language files
- Maintain similar tone and formality
- Consider cultural nuances (e.g., "você" vs "tu" in Portuguese)

## Testing

### Manual Testing Steps

1. **Navigate to Profile**
2. **Change interface language** from dropdown
3. **Verify:**
   - UI updates immediately
   - Toast confirmation appears
   - Preference persists after refresh
4. **Test shareable link:** `/tutor/123?lang=es`
5. **Verify browser language detection** (clear localStorage and user profile)

### What to Check

✅ All visible text translates  
✅ Placeholder text translates  
✅ Error messages translate  
✅ Date/time formats respect locale  
✅ RTL languages display correctly (if added)  
✅ Loading states show translated text  
✅ Modals and alerts translate  

## Maintenance

### Adding New Languages

1. Create new translation file: `src/assets/i18n/xx.json`
2. Add language to `LanguageService`:
```typescript
public readonly supportedLanguages: LanguageOption[] = [
  // ...existing
  { code: 'xx', name: 'NewLang', nativeName: 'NativeName', flag: '🏳️' }
];
```
3. Update User model enum in `backend/models/User.js`
4. Update validation in `backend/routes/users.js`

### Adding New Translation Keys

1. Add key to **all** language files (not just English)
2. Use consistent structure
3. Update this documentation if it's a new section

### Translation Updates

- Keep translations in sync across all files
- Consider using translation management tools for larger teams
- Get native speakers to review translations

## Future Enhancements

### Potential Improvements

1. **Admin Translation Panel**
   - Web interface for managing translations
   - No code deployment needed for text changes

2. **Crowdsourced Translations**
   - Let community contribute translations
   - Voting system for best translations

3. **Auto-Translation Fallback**
   - Use translation API for missing keys
   - Flag for human review

4. **Language Analytics**
   - Track which languages are most used
   - Identify missing translations

5. **RTL Support**
   - Add Arabic, Hebrew support
   - Automatic layout flipping

6. **Locale-Specific Formatting**
   - Date/time formats per locale
   - Number/currency formatting
   - Pluralization rules

## Troubleshooting

### Issue: Translations not loading

**Check:**
- Translation files exist in `src/assets/i18n/`
- Files are valid JSON
- Language code matches file name
- SharedModule is imported in feature module

### Issue: Translation shows key instead of text

**Check:**
- Key exists in translation file
- Correct language file is loaded
- No typos in key name
- TranslateModule is imported

### Issue: Language doesn't persist

**Check:**
- Backend endpoint is being called
- User model has `interfaceLanguage` field
- localStorage fallback is working
- No console errors

### Issue: Query parameter not working

**Check:**
- Language code is one of the supported interface codes (see `SupportedLanguage` / `SUPPORTED_INTERFACE_LANGUAGES` above)
- LanguageService is injected
- ngOnInit checks query params
- URL format: `/tutor/123?lang=es`

## Technical Decisions

### Why @ngx-translate?

✅ **Pros:**
- Runtime language switching
- Easy integration with Angular/Ionic
- Large community support
- Simple pipe syntax
- Works on mobile (Capacitor)

❌ **Alternatives Considered:**
- Angular i18n: Requires separate builds per language
- Custom solution: Too much maintenance overhead

### Why Query Parameters for Public Pages?

✅ **Better than URL segments** (`/es/tutor/123`):
- No routing refactor needed
- Optional (defaults to user preference)
- Doesn't break existing links
- Works with Capacitor

### Why Dropdown in Profile vs Onboarding?

- Users rarely change interface language
- Keeps onboarding flow shorter
- Profile is expected location for settings
- Can add to onboarding later if needed

## Related Documentation

- See `NATIVE_LANGUAGE_ONBOARDING.md` for native language feature (for AI feedback)
- See `AI_ANALYSIS_ENHANCEMENTS.md` for multilingual analysis feedback

## Support

For questions or issues with the translation system:
1. Check this documentation
2. Review `LanguageService` implementation
3. Check browser console for errors
4. Verify translation files are valid JSON

---

**Note:** This implementation provides the foundation for a fully multilingual app. The example translations demonstrate the pattern - you'll need to systematically translate all pages for production use.

















