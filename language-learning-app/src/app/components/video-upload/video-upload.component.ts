import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { FileUploadService } from '../../services/file-upload.service';
import { VideoCompressionService } from '../../services/video-compression.service';
import { SimpleVideoCompressionService } from '../../services/simple-video-compression.service';

@Component({
  selector: 'app-video-upload',
  template: `
    <div class="video-upload-container">
      <div class="upload-section" *ngIf="!videoUrl">
        <div class="upload-area" 
             [class.dragover]="isDragOver"
             (dragover)="onDragOver($event)"
             (dragleave)="onDragLeave($event)"
             (drop)="onDrop($event)"
             (click)="fileInput.click()">
          
          <input #fileInput 
                 type="file" 
                 accept="video/*" 
                 (change)="onFileSelected($event)"
                 style="display: none;">
          
          <div class="upload-content">
            <ion-icon name="videocam-outline" class="upload-icon"></ion-icon>
            <h3>Upload Introduction Video</h3>
            <p>Click to browse or drag and drop a video file</p>
                    <p class="upload-hint">Max size: 1GB. Large videos will be automatically compressed for optimal performance.</p>
          </div>
        </div>
        
        <div class="upload-error" *ngIf="errorMessage">
          <ion-icon name="warning-outline"></ion-icon>
          <span>{{ errorMessage }}</span>
        </div>
      </div>
      
      <div class="video-preview" *ngIf="videoUrl">
        <div class="video-container">
          <video [src]="videoUrl" controls preload="metadata" class="preview-video">
            Your browser does not support the video tag.
          </video>
        </div>
        <div class="video-actions">
          <ion-button fill="outline" size="small" (click)="removeVideo()">
            <ion-icon name="trash-outline" slot="start"></ion-icon>
            Remove
          </ion-button>
          <ion-button fill="outline" size="small" (click)="changeVideo()">
            <ion-icon name="refresh-outline" slot="start"></ion-icon>
            Change
          </ion-button>
        </div>
      </div>
      
      <div class="upload-progress" *ngIf="isUploading">
        <ion-spinner></ion-spinner>
        <p>Uploading video...</p>
      </div>
    </div>
  `,
  styles: [`
    .video-upload-container {
      width: 100%;
      max-width: 500px;
      margin: 0 auto;
    }

    .upload-section {
      margin-bottom: 16px;
    }

    .upload-area {
      border: 2px dashed #ccc;
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      background: #fafafa;
    }

    .upload-area:hover {
      border-color: #007bff;
      background: #f0f8ff;
    }

    .upload-area.dragover {
      border-color: #007bff;
      background: #e6f3ff;
    }

    .upload-content {
      pointer-events: none;
    }

    .upload-icon {
      font-size: 48px;
      color: #007bff;
      margin-bottom: 16px;
    }

    .upload-content h3 {
      margin: 0 0 8px 0;
      color: #333;
      font-size: 18px;
    }

    .upload-content p {
      margin: 4px 0;
      color: #666;
      font-size: 14px;
    }

    .upload-hint {
      font-size: 12px !important;
      color: #999 !important;
    }

    .upload-error {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #dc3545;
      font-size: 14px;
      margin-top: 12px;
      padding: 8px 12px;
      background: #f8d7da;
      border-radius: 6px;
    }

    .video-preview {
      margin-top: 16px;
    }

    .video-container {
      position: relative;
      width: 100%;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .preview-video {
      width: 100%;
      height: auto;
      display: block;
    }

    .video-actions {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-top: 12px;
    }

    .upload-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 20px;
      color: #666;
    }

    @media (max-width: 768px) {
      .upload-area {
        padding: 30px 15px;
      }
      
      .upload-icon {
        font-size: 36px;
      }
      
      .upload-content h3 {
        font-size: 16px;
      }
    }
  `],
  standalone: false
})
export class VideoUploadComponent implements OnInit {
  @Input() videoUrl: string = '';
  @Output() videoUploaded = new EventEmitter<string>();
  @Output() videoRemoved = new EventEmitter<void>();

  isDragOver = false;
  isUploading = false;
  errorMessage = '';

  constructor(
    private fileUploadService: FileUploadService,
    private videoCompressionService: VideoCompressionService,
    private simpleCompressionService: SimpleVideoCompressionService
  ) {}

  ngOnInit() {}

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  private async handleFile(file: File) {
    this.errorMessage = '';
    
    // Validate file
    const validation = this.fileUploadService.validateVideo(file);
    if (!validation.valid) {
      this.errorMessage = validation.error || 'Invalid video file';
      return;
    }

    // Check if compression is needed
    const needsCompression = this.simpleCompressionService.needsCompression(file, 50);
    
    if (needsCompression) {
      this.isUploading = true;
      this.errorMessage = `File is ${this.simpleCompressionService.formatFileSize(file.size)}. Server will compress it automatically for faster upload and playback.`;
      
      console.log(`🎬 Large video file detected: ${this.simpleCompressionService.formatFileSize(file.size)}`);
      console.log(`⚡ Server will compress this automatically for optimal performance`);
      
      await this.uploadFile(file);
    } else {
      // Upload without compression
      await this.uploadFile(file);
    }
  }

  private async uploadFile(file: File) {
    this.isUploading = true;
    this.errorMessage = 'Uploading video...';
    
    this.fileUploadService.uploadVideo(file).subscribe({
      next: (result: any) => {
        this.isUploading = false;
        if (result.success) {
          this.videoUrl = result.videoUrl;
          this.videoUploaded.emit(result.videoUrl);
          this.errorMessage = '';
          
          // Show compression info if available
          if (result.compressionInfo) {
            console.log('📊 Compression completed:', result.compressionInfo);
            console.log(`💾 Size reduced by ${result.compressionInfo.timeSaved}`);
          }
          
          if (result.uploadStats) {
            console.log('📈 Upload stats:', result.uploadStats);
          }
        } else {
          this.errorMessage = 'Failed to upload video';
        }
      },
      error: (error: any) => {
        this.isUploading = false;
        this.errorMessage = 'Upload failed: ' + error.message;
        console.error('❌ Upload error:', error);
      }
    });
  }

  removeVideo() {
    this.videoUrl = '';
    this.videoRemoved.emit();
  }

  changeVideo() {
    this.videoUrl = '';
    this.errorMessage = '';
  }
}
