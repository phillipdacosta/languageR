import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';

// Early theme application - apply dark mode class if saved in localStorage
// This prevents flash of light theme before Angular loads
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  const savedTheme = localStorage.getItem('darkMode');
  if (savedTheme === 'true') {
    console.log('🎨 main.ts: Applying dark mode early to prevent flash');
    document.documentElement.classList.add('ion-palette-dark');
  }
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.log(err));
