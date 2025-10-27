import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';

export type PlatformType = 'ios' | 'android' | 'web' | 'unknown';

@Injectable({
  providedIn: 'root'
})
export class PlatformService {
  
  constructor(private platform: Platform) {}

  /**
   * Get the current platform type
   */
  getPlatform(): PlatformType {
    if (this.platform.is('ios')) {
      return 'ios';
    } else if (this.platform.is('android')) {
      return 'android';
    } else if (this.platform.is('desktop') || this.platform.is('pwa')) {
      return 'web';
    } else {
      return 'unknown';
    }
  }

  /**
   * Check if running on iOS
   */
  isIOS(): boolean {
    return this.platform.is('ios');
  }

  /**
   * Check if running on Android
   */
  isAndroid(): boolean {
    return this.platform.is('android');
  }

  /**
   * Check if running on web (desktop or PWA)
   */
  isWeb(): boolean {
    return this.platform.is('desktop') || this.platform.is('pwa');
  }

  /**
   * Check if running on mobile (iOS or Android)
   */
  isMobile(): boolean {
    return this.isIOS() || this.isAndroid();
  }

  /**
   * Check if running on desktop
   */
  isDesktop(): boolean {
    return this.platform.is('desktop');
  }

  /**
   * Check if running as PWA
   */
  isPWA(): boolean {
    return this.platform.is('pwa');
  }

  /**
   * Check if running on tablet
   */
  isTablet(): boolean {
    return this.platform.is('tablet');
  }

  /**
   * Check if running on phone
   */
  isPhone(): boolean {
    return this.platform.is('mobile') && !this.isTablet();
  }

  /**
   * Get platform-specific CSS class
   */
  getPlatformClass(): string {
    const platform = this.getPlatform();
    return `platform-${platform}`;
  }

  /**
   * Get platform-specific configuration
   */
  getPlatformConfig() {
    const platform = this.getPlatform();
    
    switch (platform) {
      case 'ios':
        return {
          showTabs: true,
          tabPosition: 'bottom',
          headerStyle: 'ios',
          showBackButton: false,
          useNativeTransitions: true,
          statusBarStyle: 'light-content'
        };
      
      case 'android':
        return {
          showTabs: true,
          tabPosition: 'bottom',
          headerStyle: 'android',
          showBackButton: true,
          useNativeTransitions: true,
          statusBarStyle: 'dark-content'
        };
      
      case 'web':
        return {
          showTabs: false, // Hide tabs on web, use sidebar or top nav instead
          tabPosition: 'top',
          headerStyle: 'web',
          showBackButton: false,
          useNativeTransitions: false,
          statusBarStyle: 'default'
        };
      
      default:
        return {
          showTabs: true,
          tabPosition: 'bottom',
          headerStyle: 'default',
          showBackButton: false,
          useNativeTransitions: false,
          statusBarStyle: 'default'
        };
    }
  }

  /**
   * Get screen size category
   */
  getScreenSize(): 'small' | 'medium' | 'large' | 'xlarge' {
    const width = window.innerWidth;
    
    if (width < 576) return 'small';
    if (width < 768) return 'medium';
    if (width < 992) return 'large';
    return 'xlarge';
  }

  /**
   * Check if screen is small (mobile)
   */
  isSmallScreen(): boolean {
    return this.getScreenSize() === 'small';
  }

  /**
   * Check if screen is large (desktop/tablet)
   */
  isLargeScreen(): boolean {
    const size = this.getScreenSize();
    return size === 'large' || size === 'xlarge';
  }

  /**
   * Get user agent string
   */
  getUserAgent(): string {
    return this.platform.is('hybrid') ? 'hybrid' : navigator.userAgent;
  }

  /**
   * Check if device has touch capability
   */
  isTouchDevice(): boolean {
    return this.platform.is('mobile') || this.platform.is('tablet') || 
           ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  /**
   * Get platform-specific theme
   */
  getTheme(): 'light' | 'dark' | 'auto' {
    const platform = this.getPlatform();
    
    // You can customize this based on your app's theme logic
    if (platform === 'ios') {
      return 'auto'; // iOS follows system theme
    } else if (platform === 'android') {
      return 'auto'; // Android follows system theme
    } else {
      return 'light'; // Default to light theme on web
    }
  }
}
