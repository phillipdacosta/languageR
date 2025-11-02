import { Component, OnInit } from '@angular/core';
import { LoadingService } from './services/loading.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(
    private loadingService: LoadingService,
    private themeService: ThemeService
  ) {}

  ngOnInit() {
    console.log('🚀 AppComponent: Starting app initialization');
    
    // Ensure theme is applied immediately when app initializes
    // This ensures dark mode works across all pages, not just the profile page
    const isDark = this.themeService.isDarkMode();
    console.log('🎨 AppComponent: Current theme state:', isDark);
    
    // Force apply theme to ensure it's active globally
    this.themeService.forceApplyTheme();
    
    // Subscribe to theme changes to log them and ensure they apply globally
    this.themeService.darkMode$.subscribe(darkMode => {
      console.log('🌓 AppComponent: Theme changed to:', darkMode ? 'dark' : 'light');
      // Force apply whenever theme changes
      setTimeout(() => this.themeService.forceApplyTheme(), 10);
    });
    
    // Apply theme after a short delay to ensure DOM is fully ready
    setTimeout(() => {
      console.log('🎨 AppComponent: Delayed theme application');
      this.themeService.forceApplyTheme();
    }, 100);
    
    // Show loading immediately when app starts to prevent any flash
    console.log('🚀 AppComponent: Starting app, showing loading');
    this.loadingService.show();
    
    // Add a timeout to hide loading after 10 seconds as a safety net
    setTimeout(() => {
      if (this.loadingService.isLoading()) {
        console.log('🚀 AppComponent: Timeout reached, hiding loading as safety net');
        this.loadingService.hide();
      }
    }, 10000);
  }
}
