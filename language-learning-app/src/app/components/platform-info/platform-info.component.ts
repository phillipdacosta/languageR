import { Component, OnInit } from '@angular/core';
import { PlatformService } from '../../services/platform.service';

@Component({
  selector: 'app-platform-info',
  template: `
    <div class="platform-info" *ngIf="showDebugInfo">
      <h4>Platform Information</h4>
      <div class="info-grid">
        <div class="info-item">
          <strong>Platform:</strong> {{ currentPlatform }}
        </div>
        <div class="info-item">
          <strong>Screen Size:</strong> {{ screenSize }}
        </div>
        <div class="info-item">
          <strong>Touch Device:</strong> {{ isTouchDevice ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>Mobile:</strong> {{ isMobile ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>Web:</strong> {{ isWeb ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>iOS:</strong> {{ isIOS ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>Android:</strong> {{ isAndroid ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>Tablet:</strong> {{ isTablet ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>Phone:</strong> {{ isPhone ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>PWA:</strong> {{ isPWA ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>Desktop:</strong> {{ isDesktop ? 'Yes' : 'No' }}
        </div>
        <div class="info-item">
          <strong>User Agent:</strong> {{ userAgent }}
        </div>
      </div>
      
      <div class="platform-config">
        <h5>Platform Configuration</h5>
        <pre>{{ platformConfig | json }}</pre>
      </div>
    </div>
  `,
  styles: [`
    .platform-info {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 16px;
      margin: 16px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    
    .platform-info h4 {
      margin: 0 0 16px 0;
      color: #495057;
      font-size: 18px;
    }
    
    .platform-info h5 {
      margin: 16px 0 8px 0;
      color: #495057;
      font-size: 14px;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }
    
    .info-item {
      padding: 8px;
      background: white;
      border-radius: 4px;
      border: 1px solid #e9ecef;
      font-size: 14px;
    }
    
    .info-item strong {
      color: #495057;
    }
    
    .platform-config {
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 4px;
      padding: 12px;
    }
    
    .platform-config pre {
      margin: 0;
      font-size: 12px;
      color: #495057;
      white-space: pre-wrap;
      word-break: break-all;
    }
    
    @media (max-width: 768px) {
      .info-grid {
        grid-template-columns: 1fr;
      }
      
      .platform-info {
        margin: 8px;
        padding: 12px;
      }
    }
  `]
})
export class PlatformInfoComponent implements OnInit {
  
  // Platform detection properties
  currentPlatform = 'unknown';
  screenSize = 'unknown';
  isTouchDevice = false;
  isMobile = false;
  isWeb = false;
  isIOS = false;
  isAndroid = false;
  isTablet = false;
  isPhone = false;
  isPWA = false;
  isDesktop = false;
  userAgent = '';
  platformConfig: any = {};
  
  // Show debug info only in development or when explicitly enabled
  showDebugInfo = false;

  constructor(private platformService: PlatformService) {}

  ngOnInit() {
    // Get all platform information
    this.currentPlatform = this.platformService.getPlatform();
    this.screenSize = this.platformService.getScreenSize();
    this.isTouchDevice = this.platformService.isTouchDevice();
    this.isMobile = this.platformService.isMobile();
    this.isWeb = this.platformService.isWeb();
    this.isIOS = this.platformService.isIOS();
    this.isAndroid = this.platformService.isAndroid();
    this.isTablet = this.platformService.isTablet();
    this.isPhone = this.platformService.isPhone();
    this.isPWA = this.platformService.isPWA();
    this.isDesktop = this.platformService.isDesktop();
    this.userAgent = this.platformService.getUserAgent();
    this.platformConfig = this.platformService.getPlatformConfig();
    
    // Show debug info only on web platform (for development)
    this.showDebugInfo = this.isWeb;
    
    console.log('Platform Info Component initialized:', {
      platform: this.currentPlatform,
      config: this.platformConfig
    });
  }

  // Method to toggle debug info visibility
  toggleDebugInfo() {
    this.showDebugInfo = !this.showDebugInfo;
  }
}

