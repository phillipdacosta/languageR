import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { FileUploadService } from '../../services/file-upload.service';
import { VideoCompressionService } from '../../services/video-compression.service';
import { SimpleVideoCompressionService } from '../../services/simple-video-compression.service';

export interface VideoUploadData {
  url: string;
  thumbnail: string;
  type: 'upload' | 'youtube' | 'vimeo';
}

@Component({
  selector: 'app-video-upload',
  templateUrl: './video-upload.component.html',
  styleUrls: ['./video-upload.component.scss'],
  standalone: false
})
export class VideoUploadComponent implements OnInit, OnDestroy {
  @Input() videoUrl: string = '';
  @Input() thumbnailUrl: string = '';
  @Input() videoType: 'upload' | 'youtube' | 'vimeo' = 'upload';
  @Output() videoUploaded = new EventEmitter<VideoUploadData>();
  @Output() videoRemoved = new EventEmitter<void>();
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('iframeElement') iframeElement?: ElementRef<HTMLIFrameElement>;

  isDragOver = false;
  isUploading = false;
  errorMessage = '';
  
  // Toggle between upload modes
  uploadMode: 'file' | 'link' = 'file';
  videoLinkInput = '';
  
  // Thumbnail management
  customThumbnail: File | null = null;
  thumbnailPreview: string = '';
  autoThumbnailGenerated = false;
  showThumbnailOverlay = true; // Controls whether to show thumbnail or play video

  constructor(
    private fileUploadService: FileUploadService,
    private videoCompressionService: VideoCompressionService,
    private simpleCompressionService: SimpleVideoCompressionService
  ) {}

  ngOnInit() {
    console.log('📹 VideoUploadComponent ngOnInit:', {
      videoUrl: this.videoUrl,
      thumbnailUrl: this.thumbnailUrl,
      videoType: this.videoType,
      hasVideo: !!this.videoUrl,
      hasThumbnail: !!this.thumbnailUrl
    });
    
    // Check if video is external (YouTube/Vimeo)
    if (this.videoUrl) {
      this.autoThumbnailGenerated = this.isExternalVideo(this.videoUrl);
      console.log('📹 Video is external:', this.autoThumbnailGenerated);
    }
    
    // If thumbnail exists, show it by default
    if (this.thumbnailUrl) {
      this.showThumbnailOverlay = true;
      this.thumbnailPreview = this.thumbnailUrl; // Set preview to match thumbnailUrl
      console.log('📹 Thumbnail loaded, showing overlay');
    } else {
      console.log('📹 No thumbnail found');
    }
  }
  
  ngOnDestroy() {
    console.log('📹 VideoUploadComponent ngOnDestroy called');
    this.stopVideo();
  }
  
  // Public method to stop video playback
  stopVideo() {
    console.log('📹 Stopping video playback');
    
    // Pause HTML5 video if it's playing
    if (this.videoElement?.nativeElement) {
      const video = this.videoElement.nativeElement;
      if (!video.paused) {
        video.pause();
        console.log('📹 HTML5 video paused');
      }
      video.currentTime = 0; // Reset to beginning
      video.src = ''; // Clear source
      video.load(); // Force unload
    }
    
    // Stop iframe videos by removing src (for YouTube/Vimeo)
    if (this.iframeElement?.nativeElement) {
      const iframe = this.iframeElement.nativeElement;
      iframe.src = 'about:blank'; // This stops the video immediately
      console.log('📹 Iframe video stopped');
    }
    
    // Reset thumbnail overlay state so it shows again when user returns
    if (this.thumbnailUrl) {
      this.showThumbnailOverlay = true;
    }
  }
  
  // Method to hide thumbnail and play video with autoplay
  playVideo() {
    this.showThumbnailOverlay = false;
    
    // For external videos (YouTube/Vimeo), add autoplay parameter to the URL
    if (this.isExternalVideo(this.videoUrl)) {
      const separator = this.videoUrl.includes('?') ? '&' : '?';
      this.videoUrl = this.videoUrl + separator + 'autoplay=1';
    } else {
      // For HTML5 video, play it after the view updates
      setTimeout(() => {
        if (this.videoElement?.nativeElement) {
          this.videoElement.nativeElement.play().catch(err => {
            console.error('Error playing video:', err);
          });
        }
      }, 100);
    }
  }

  // Toggle between upload modes
  toggleUploadMode(mode: 'file' | 'link') {
    this.uploadMode = mode;
    this.errorMessage = '';
    this.customThumbnail = null;
    this.thumbnailPreview = '';
    this.videoLinkInput = '';
  }

  // Handle thumbnail file selection
  onThumbnailSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      
      // Validate thumbnail
      const validation = this.validateThumbnail(file);
      if (!validation.valid) {
        this.errorMessage = validation.error || 'Invalid thumbnail';
        return;
      }
      
      this.customThumbnail = file;
      
      // Generate preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.thumbnailPreview = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  // Validate thumbnail
  private validateThumbnail(file: File): { valid: boolean; error?: string } {
    // Check file type
    if (!file.type.startsWith('image/')) {
      return { valid: false, error: 'Please select an image file' };
    }
    
    // Check file size (max 20MB as per Preply)
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      return { valid: false, error: 'Thumbnail must be less than 20MB' };
    }
    
    // Check format (JPG or PNG)
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      return { valid: false, error: 'Thumbnail must be JPG or PNG format' };
    }
    
    return { valid: true };
  }

  // Handle pasted video link (YouTube/Vimeo)
  async onPasteLink() {
    this.errorMessage = '';
    const url = this.videoLinkInput.trim();
    
    if (!url) {
      this.errorMessage = 'Please enter a video URL';
      return;
    }

    const validation = this.validateVideoLink(url);
    if (!validation.valid) {
      this.errorMessage = validation.error || 'Invalid video URL';
      return;
    }

    // For YouTube, auto-generate thumbnail
    let thumbnailUrl = '';
    
    if (validation.platform === 'youtube' && validation.videoId) {
      // Auto-generate YouTube thumbnail
      thumbnailUrl = `https://img.youtube.com/vi/${validation.videoId}/maxresdefault.jpg`;
      this.autoThumbnailGenerated = true;
    } else if (validation.platform === 'vimeo') {
      // For Vimeo, require custom thumbnail or leave blank
      this.autoThumbnailGenerated = false;
    }
    
    // If custom thumbnail provided, upload it first
    if (this.customThumbnail) {
      try {
        this.isUploading = true;
        this.errorMessage = 'Uploading thumbnail...';
        const uploadResult = await this.uploadThumbnail(this.customThumbnail);
        thumbnailUrl = uploadResult.url;
        this.autoThumbnailGenerated = false;
      } catch (error) {
        this.errorMessage = 'Failed to upload thumbnail';
        this.isUploading = false;
        return;
      }
    }

    // Emit the video with thumbnail
    this.videoUrl = validation.embedUrl || url;
    this.thumbnailUrl = thumbnailUrl;
    this.videoType = validation.platform as any;
    this.showThumbnailOverlay = !!thumbnailUrl; // Show overlay if thumbnail exists
    this.videoUploaded.emit({
      url: this.videoUrl,
      thumbnail: thumbnailUrl,
      type: validation.platform as any
    });
    this.videoLinkInput = '';
    this.isUploading = false;
    this.errorMessage = '';
  }

  // Validate and convert YouTube/Vimeo URLs
  private validateVideoLink(url: string): { 
    valid: boolean; 
    error?: string; 
    embedUrl?: string;
    platform?: string;
    videoId?: string;
  } {
    try {
      const urlObj = new URL(url);
      
      // YouTube validation
      if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
        let videoId = '';
        
        if (urlObj.hostname === 'youtu.be') {
          videoId = urlObj.pathname.slice(1);
        } else if (urlObj.searchParams.has('v')) {
          videoId = urlObj.searchParams.get('v') || '';
        }
        
        if (!videoId) {
          return { valid: false, error: 'Invalid YouTube URL format' };
        }
        
        return { 
          valid: true, 
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          platform: 'youtube',
          videoId
        };
      }
      
      // Vimeo validation
      if (urlObj.hostname.includes('vimeo.com')) {
        const videoId = urlObj.pathname.split('/').filter(Boolean)[0];
        
        if (!videoId || isNaN(Number(videoId))) {
          return { valid: false, error: 'Invalid Vimeo URL format' };
        }
        
        return { 
          valid: true, 
          embedUrl: `https://player.vimeo.com/video/${videoId}`,
          platform: 'vimeo',
          videoId
        };
      }
      
      return { valid: false, error: 'Only YouTube and Vimeo URLs are supported' };
    } catch (e) {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  // Check if URL is an external video
  isExternalVideo(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com');
  }

  // Upload thumbnail to GCP
  private async uploadThumbnail(file: File): Promise<{url: string}> {
    return new Promise((resolve, reject) => {
      this.fileUploadService.uploadImage(file).subscribe({
        next: (result: any) => {
          if (result.success) {
            resolve({ url: result.imageUrl });
          } else {
            reject(new Error('Failed to upload thumbnail'));
          }
        },
        error: (error: any) => {
          reject(error);
        }
      });
    });
  }

  // Existing drag and drop methods
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
      next: async (result: any) => {
        if (result.success) {
          // Upload thumbnail if provided
          let thumbnailUrl = '';
          
          if (this.customThumbnail) {
            try {
              this.errorMessage = 'Uploading thumbnail...';
              const thumbResult = await this.uploadThumbnail(this.customThumbnail);
              thumbnailUrl = thumbResult.url;
            } catch (error) {
              console.error('Failed to upload thumbnail:', error);
            }
          }
          
          this.videoUrl = result.videoUrl;
          this.thumbnailUrl = thumbnailUrl;
          this.videoType = 'upload';
          this.showThumbnailOverlay = !!thumbnailUrl; // Show overlay if thumbnail exists
          this.videoUploaded.emit({
            url: result.videoUrl,
            thumbnail: thumbnailUrl,
            type: 'upload'
          });
          this.errorMessage = '';
          this.isUploading = false;
          
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
          this.isUploading = false;
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
    this.thumbnailUrl = '';
    this.thumbnailPreview = '';
    this.customThumbnail = null;
    this.autoThumbnailGenerated = false;
    this.showThumbnailOverlay = true;
    this.videoRemoved.emit();
  }

  removeThumbnail() {
    this.thumbnailUrl = '';
    this.thumbnailPreview = '';
    this.customThumbnail = null;
    this.autoThumbnailGenerated = false;
    this.showThumbnailOverlay = true;
  }

  changeVideo() {
    this.videoUrl = '';
    this.thumbnailUrl = '';
    this.thumbnailPreview = '';
    this.customThumbnail = null;
    this.errorMessage = '';
    this.autoThumbnailGenerated = false;
    this.showThumbnailOverlay = true;
  }
}
