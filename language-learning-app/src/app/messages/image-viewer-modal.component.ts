import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-image-viewer-modal',
  standalone: false,
  template: `
    <div class="image-viewer-container" (click)="dismiss()">
      <div class="image-viewer-header">
        <h3 *ngIf="imageName">{{ imageName }}</h3>
        <ion-button fill="clear" (click)="dismiss()" class="close-button">
          <ion-icon name="close" slot="icon-only"></ion-icon>
        </ion-button>
      </div>
      
      <div class="image-wrapper" (click)="$event.stopPropagation()">
        <img 
          [src]="imageUrl" 
          [alt]="imageName || 'Image'"
          (click)="toggleZoom()"
          [class.zoomed]="isZoomed"
        />
      </div>
      
      <div class="image-viewer-footer">
        <ion-button fill="outline" (click)="downloadImage()" class="download-button">
          <ion-icon name="download-outline" slot="start"></ion-icon>
          Download
        </ion-button>
      </div>
    </div>
  `,
  styles: [`
    .image-viewer-container {
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      flex-direction: column;
      position: relative;
    }
    
    .image-viewer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10;
    }
    
    .image-viewer-header h3 {
      color: white;
      margin: 0;
      font-size: 16px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      padding-right: 16px;
    }
    
    .close-button {
      --color: white;
      --padding-start: 8px;
      --padding-end: 8px;
    }
    
    .image-wrapper {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding: 80px 16px;
    }
    
    .image-wrapper img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      cursor: zoom-in;
      transition: transform 0.3s ease;
    }
    
    .image-wrapper img.zoomed {
      cursor: zoom-out;
      max-width: none;
      max-height: none;
      width: auto;
      height: auto;
    }
    
    .image-viewer-footer {
      display: flex;
      justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 10;
    }
    
    .download-button {
      --color: white;
      --border-color: rgba(255, 255, 255, 0.3);
    }
    
    @media (max-width: 768px) {
      .image-wrapper {
        padding: 70px 8px 70px 8px;
      }
      
      .image-viewer-header h3 {
        font-size: 14px;
      }
    }
  `]
})
export class ImageViewerModal {
  @Input() imageUrl!: string;
  @Input() imageName?: string;
  
  isZoomed = false;

  constructor(private modalController: ModalController) {}

  dismiss() {
    this.modalController.dismiss();
  }

  toggleZoom() {
    this.isZoomed = !this.isZoomed;
  }

  downloadImage() {
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = this.imageUrl;
    link.download = this.imageName || 'image';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

