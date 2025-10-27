import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-upload-progress',
  template: `
    <div class="upload-progress-container" *ngIf="isUploading">
      <div class="progress-header">
        <ion-icon name="cloud-upload-outline"></ion-icon>
        <h4>{{ statusMessage }}</h4>
      </div>
      
      <div class="progress-details" *ngIf="fileSize">
        <div class="file-info">
          <span class="file-size">{{ fileSize }}</span>
          <span class="compression-note" *ngIf="needsCompression">
            (will be compressed)
          </span>
        </div>
      </div>
      
      <div class="progress-bar">
        <div class="progress-fill" [style.width.%]="progress"></div>
      </div>
      
      <div class="progress-text">
        <span *ngIf="progress < 100">{{ progress }}% complete</span>
        <span *ngIf="progress >= 100">Processing...</span>
      </div>
      
      <div class="compression-info" *ngIf="compressionInfo">
        <ion-icon name="checkmark-circle-outline"></ion-icon>
        <span>Compressed from {{ compressionInfo.originalSizeMB }}MB to {{ compressionInfo.compressedSizeMB }}MB</span>
        <span class="savings">({{ compressionInfo.timeSaved }} smaller)</span>
      </div>
    </div>
  `,
  styles: [`
    .upload-progress-container {
      padding: 20px;
      background: var(--ion-color-light);
      border-radius: 12px;
      margin: 16px 0;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    
    .progress-header {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      
      ion-icon {
        font-size: 24px;
        color: var(--ion-color-primary);
        margin-right: 8px;
      }
      
      h4 {
        margin: 0;
        color: var(--ion-color-dark);
        font-size: 16px;
      }
    }
    
    .progress-details {
      margin-bottom: 12px;
      
      .file-info {
        display: flex;
        align-items: center;
        gap: 8px;
        
        .file-size {
          font-weight: 500;
          color: var(--ion-color-dark);
        }
        
        .compression-note {
          font-size: 12px;
          color: var(--ion-color-medium);
          font-style: italic;
        }
      }
    }
    
    .progress-bar {
      width: 100%;
      height: 8px;
      background: var(--ion-color-light-shade);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
      
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--ion-color-primary), var(--ion-color-secondary));
        border-radius: 4px;
        transition: width 0.3s ease;
      }
    }
    
    .progress-text {
      text-align: center;
      font-size: 14px;
      color: var(--ion-color-medium);
      margin-bottom: 8px;
    }
    
    .compression-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--ion-color-success-tint);
      border-radius: 8px;
      font-size: 14px;
      
      ion-icon {
        color: var(--ion-color-success);
        font-size: 16px;
      }
      
      .savings {
        font-weight: 500;
        color: var(--ion-color-success);
      }
    }
    
    @media (prefers-color-scheme: dark) {
      .upload-progress-container {
        background: var(--ion-color-dark);
        box-shadow: none;
      }
      
      .progress-header h4 {
        color: var(--ion-color-light);
      }
      
      .file-info .file-size {
        color: var(--ion-color-light);
      }
    }
  `],
  standalone: false,
})
export class UploadProgressComponent {
  @Input() isUploading = false;
  @Input() progress = 0;
  @Input() statusMessage = 'Uploading...';
  @Input() fileSize = '';
  @Input() needsCompression = false;
  @Input() compressionInfo: any = null;
}

