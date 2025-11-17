import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-video-player-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ tutorName }}'s Introduction</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content class="video-modal-content">
      <div class="video-container">
        <!-- Loading thumbnail -->
        <div class="thumbnail-loader" *ngIf="showThumbnail && thumbnailUrl">
          <img [src]="thumbnailUrl" alt="Video thumbnail">
          <div class="loading-spinner">
            <ion-spinner name="crescent"></ion-spinner>
          </div>
        </div>
        
        <!-- External video (YouTube/Vimeo) -->
        <iframe 
          *ngIf="isExternalVideo() && !showThumbnail"
          #videoIframe
          [src]="getEmbedUrl() | safeUrl"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          (load)="onVideoLoad()">
        </iframe>
        
        <!-- Direct video file -->
        <video 
          *ngIf="!isExternalVideo() && !showThumbnail"
          #videoElement
          [src]="videoUrl"
          [poster]="thumbnailUrl"
          controls
          autoplay
          playsinline
          (loadeddata)="onVideoLoad()">
        </video>
      </div>
    </ion-content>
  `,
  styles: [`
    .video-modal-content {
      --background: #000;
    }
    
    .video-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      position: relative;
    }
    
    .thumbnail-loader {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      
      img {
        width: 100%;
        height: 100%;
        max-width: 1200px;
        max-height: 80vh;
        object-fit: contain;
      }
      
      .loading-spinner {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        
        ion-spinner {
          width: 48px;
          height: 48px;
          color: #fff;
        }
      }
    }
    
    iframe, video {
      width: 100%;
      height: 100%;
      max-width: 1200px;
      max-height: 80vh;
    }
    
    @media (max-width: 768px) {
      .thumbnail-loader img,
      iframe, 
      video {
        max-height: 60vh;
      }
    }
  `],
  standalone: false
})
export class VideoPlayerModalComponent implements AfterViewInit, OnDestroy {
  @Input() videoUrl: string = '';
  @Input() tutorName: string = 'Tutor';
  @Input() thumbnailUrl: string = '';
  
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('videoIframe') videoIframe?: ElementRef<HTMLIFrameElement>;
  
  showThumbnail = true;
  
  constructor(private modalController: ModalController) {}
  
  ngAfterViewInit() {
    // Hide thumbnail after a short delay to allow video to start loading
    setTimeout(() => {
      this.showThumbnail = false;
      
      // Autoplay HTML5 video after view initializes
      if (!this.isExternalVideo()) {
        setTimeout(() => {
          this.videoElement?.nativeElement?.play().catch(err => {
            console.error('Error autoplaying video:', err);
          });
        }, 100);
      }
    }, 800);
  }
  
  onVideoLoad() {
    // Hide thumbnail once video is loaded
    this.showThumbnail = false;
  }
  
  ngOnDestroy() {
    // Stop video playback when modal closes
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.pause();
      this.videoElement.nativeElement.src = '';
    }
    if (this.videoIframe?.nativeElement) {
      this.videoIframe.nativeElement.src = 'about:blank';
    }
  }
  
  isExternalVideo(): boolean {
    return this.videoUrl.includes('youtube.com') || 
           this.videoUrl.includes('youtu.be') || 
           this.videoUrl.includes('vimeo.com');
  }
  
  getEmbedUrl(): string {
    // Add autoplay parameter to external videos
    const separator = this.videoUrl.includes('?') ? '&' : '?';
    return `${this.videoUrl}${separator}autoplay=1`;
  }
  
  dismiss() {
    this.modalController.dismiss();
  }
}

