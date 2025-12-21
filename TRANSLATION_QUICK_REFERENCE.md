# Quick Reference: Using Translations in Your App

## Basic Usage

### In HTML Templates

```html
<!-- Simple text -->
<h1>{{ 'HOME.TITLE' | translate }}</h1>

<!-- With parameters -->
<p>{{ 'LESSONS.DURATION' | translate: {minutes: 45} }}</p>

<!-- In attributes -->
<input [placeholder]="'HOME.SEARCH_PLACEHOLDER' | translate">

<!-- In ionic components -->
<ion-button>{{ 'COMMON.SAVE' | translate }}</ion-button>
```

### In TypeScript

```typescript
import { LanguageService } from './services/language.service';

constructor(private languageService: LanguageService) {}

// Instant translation (synchronous)
const message = this.languageService.instant('HOME.WELCOME');

// Observable translation (reactive)
this.languageService.get('ERRORS.GENERIC').subscribe(msg => {
  console.log(msg);
});

// Change language
this.languageService.setLanguage('es');

// Get current language
const currentLang = this.languageService.getCurrentLanguage();
```

## Adding Translations to New Pages

### Step 1: Import SharedModule

In your page's module (e.g., `my-page.module.ts`):

```typescript
import { SharedModule } from '../shared/shared.module';

@NgModule({
  imports: [
    // ... other imports
    SharedModule  // This includes TranslateModule
  ]
})
```

### Step 2: Add Translation Keys

Add your keys to ALL language files:

`src/assets/i18n/en.json`:
```json
{
  "MY_PAGE": {
    "TITLE": "My Page Title",
    "BUTTON": "Click Me"
  }
}
```

`src/assets/i18n/es.json`:
```json
{
  "MY_PAGE": {
    "TITLE": "Título de Mi Página",
    "BUTTON": "Haz Clic"
  }
}
```

### Step 3: Use in Template

```html
<h1>{{ 'MY_PAGE.TITLE' | translate }}</h1>
<ion-button>{{ 'MY_PAGE.BUTTON' | translate }}</ion-button>
```

## Common Translation Keys

Use these pre-defined keys for common UI elements:

```typescript
'COMMON.SAVE'           // Save
'COMMON.CANCEL'         // Cancel
'COMMON.CONTINUE'       // Continue
'COMMON.BACK'           // Back
'COMMON.NEXT'           // Next
'COMMON.LOGOUT'         // Logout
'COMMON.CLOSE'          // Close
'COMMON.SEARCH'         // Search
'COMMON.EDIT'           // Edit
'COMMON.DELETE'         // Delete
'COMMON.SEND'           // Send
'COMMON.YES'            // Yes
'COMMON.NO'             // No
'COMMON.OK'             // OK
'COMMON.LOADING'        // Loading...
```

## Language Selector Component

Add to any page:

```html
<ion-item>
  <ion-label>Language</ion-label>
  <ion-select [(ngModel)]="selectedLanguage" (ionChange)="changeLanguage($event)">
    <ion-select-option value="en">🇬🇧 English</ion-select-option>
    <ion-select-option value="es">🇪🇸 Español</ion-select-option>
    <ion-select-option value="fr">🇫🇷 Français</ion-select-option>
    <ion-select-option value="pt">🇧🇷 Português</ion-select-option>
    <ion-select-option value="de">🇩🇪 Deutsch</ion-select-option>
  </ion-select>
</ion-item>
```

```typescript
selectedLanguage = 'en';

changeLanguage(event: any) {
  const lang = event.detail.value;
  this.languageService.setLanguage(lang);
  
  // Optional: Save to backend
  this.userService.updateInterfaceLanguage(lang).subscribe();
}
```

## Testing Translations

### Quick Test

1. Open browser console
2. Run: `localStorage.setItem('userLanguage', 'es')`
3. Refresh page
4. UI should show Spanish

### Reset Language

```javascript
localStorage.removeItem('userLanguage');
```

## Naming Conventions

### Key Structure
```
FEATURE.SECTION.ELEMENT
```

### Examples
```
HOME.SEARCH_PLACEHOLDER
PROFILE.EDIT_BUTTON
LESSONS.NO_RESULTS
MESSAGES.SEND_BUTTON
ERRORS.NETWORK_ERROR
```

### Best Practices
- Use UPPER_SNAKE_CASE for keys
- Group by feature/page
- Keep keys descriptive
- Use consistent naming patterns

## Parameters in Translations

### Single Parameter

Translation:
```json
{
  "WELCOME.MESSAGE": "Hello, {{name}}!"
}
```

Usage:
```html
{{ 'WELCOME.MESSAGE' | translate: {name: 'John'} }}
```

### Multiple Parameters

Translation:
```json
{
  "BOOKING.CONFIRMATION": "Class with {{tutor}} on {{date}} at {{time}}"
}
```

Usage:
```html
{{ 'BOOKING.CONFIRMATION' | translate: {
  tutor: tutorName,
  date: classDate,
  time: classTime
} }}
```

## Common Pitfalls

### ❌ DON'T: Mix languages in code
```typescript
// Bad
const message = isStudent ? 'Student' : 'Tutor';
```

### ✅ DO: Always use translation keys
```typescript
// Good
const message = this.languageService.instant(
  isStudent ? 'USER.STUDENT' : 'USER.TUTOR'
);
```

### ❌ DON'T: Hardcode text in TypeScript
```typescript
// Bad
this.showToast('Profile updated successfully');
```

### ✅ DO: Translate messages
```typescript
// Good
const message = this.languageService.instant('PROFILE.UPDATE_SUCCESS');
this.showToast(message);
```

### ❌ DON'T: Forget to add key to all languages
```json
// en.json - Added
"NEW_FEATURE.TITLE": "New Feature"

// es.json - MISSING! Will show key instead of translation
```

### ✅ DO: Add to all language files
```json
// en.json
"NEW_FEATURE.TITLE": "New Feature"

// es.json
"NEW_FEATURE.TITLE": "Nueva Función"
```

## Checking Current Language

```typescript
// In component
const currentLang = this.languageService.getCurrentLanguage();

if (currentLang === 'es') {
  // Do something specific for Spanish
}

// Or subscribe to changes
this.languageService.currentLanguage$.subscribe(lang => {
  console.log('Language changed to:', lang);
});
```

## Shareable Links with Language

Create a shareable link in Spanish:
```typescript
const tutorUrl = `/tutor/${tutorId}?lang=es`;
```

User opens link → Page displays in Spanish

## Advanced: Custom Pipes

Create a pipe for common patterns:

```typescript
@Pipe({ name: 'userRole' })
export class UserRolePipe implements PipeTransform {
  constructor(private languageService: LanguageService) {}
  
  transform(userType: string): string {
    return this.languageService.instant(`USER.TYPE.${userType.toUpperCase()}`);
  }
}
```

Usage:
```html
<p>{{ user.userType | userRole }}</p>
```

## Need Help?

1. Check `MULTILINGUAL_INTERFACE_IMPLEMENTATION.md` for full documentation
2. Look at `language.service.ts` for available methods
3. Check browser console for translation errors
4. Verify JSON syntax in translation files

## Quick Commands

```bash
# Check if translations are valid JSON
cat src/assets/i18n/en.json | jq

# Find all translation keys in use
grep -r "translate" src/app --include="*.html"

# Find hardcoded text (potential translations)
grep -r ">" src/app --include="*.html" | grep -v "{{"
```




