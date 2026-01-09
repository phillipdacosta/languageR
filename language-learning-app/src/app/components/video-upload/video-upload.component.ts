import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
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
export class VideoUploadComponent implements OnInit, OnChanges, OnDestroy {
  @Input() videoUrl: string = '';
  @Input() thumbnailUrl: string = '';
  @Input() videoType: 'upload' | 'youtube' | 'vimeo' = 'upload';
  @Input() enableModalPlayer: boolean = false; // New input to enable modal mode
  @Input() isVideoApproved: boolean = false; // New input to check if tutor's video is approved
  @Output() videoUploaded = new EventEmitter<VideoUploadData>();
  @Output() videoRemoved = new EventEmitter<void>();
  @Output() thumbnailClick = new EventEmitter<void>(); // New output for thumbnail clicks
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('iframeElement') iframeElement?: ElementRef<HTMLIFrameElement>;
  @ViewChild('videoPreview') videoPreviewElement?: ElementRef<HTMLVideoElement>;

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
  externalVideoThumbnail: string | null = null; // Cached thumbnail URL

  constructor(
    private fileUploadService: FileUploadService,
    private videoCompressionService: VideoCompressionService,
    private simpleCompressionService: SimpleVideoCompressionService,
    private alertController: AlertController,
    private http: HttpClient
  ) {}

  ngOnInit() {
    console.log('📹 VideoUploadComponent ngOnInit:', {
      videoUrl: this.videoUrl,
      thumbnailUrl: this.thumbnailUrl,
      videoType: this.videoType,
      hasVideo: !!this.videoUrl,
      hasThumbnail: !!this.thumbnailUrl
    });
    
    // Auto-detect and fix video type if incorrect
    if (this.videoUrl) {
      const detectedType = this.detectVideoType(this.videoUrl);
      if (detectedType && detectedType !== this.videoType) {
        console.log(`📹 ⚠️ Video type mismatch! Stored: ${this.videoType}, Detected: ${detectedType}. Using detected type.`);
        this.videoType = detectedType;
      }
    }
    
    // Check if video is external (YouTube/Vimeo)
    if (this.videoUrl) {
      this.autoThumbnailGenerated = this.isExternalVideo(this.videoUrl);
      console.log('📹 Video is external:', this.autoThumbnailGenerated);
      
      // Fetch external video thumbnail (async for Vimeo)
      this.fetchExternalVideoThumbnail();
      
      // If it's an uploaded video without thumbnail, load the first frame
      if (this.videoType === 'upload' && !this.thumbnailUrl) {
        console.log('📹 Will load first frame for uploaded video');
        setTimeout(() => this.loadVideoFirstFrame(), 500);
      }
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

  ngOnChanges(changes: SimpleChanges) {
    console.log('📹 VideoUploadComponent ngOnChanges:', changes);
    console.log('📹 Current state:', {
      videoUrl: this.videoUrl,
      thumbnailUrl: this.thumbnailUrl,
      thumbnailPreview: this.thumbnailPreview,
      showThumbnailOverlay: this.showThumbnailOverlay
    });
    
    // React to changes in thumbnailUrl
    if (changes['thumbnailUrl']) {
      const newValue = changes['thumbnailUrl'].currentValue;
      const previousValue = changes['thumbnailUrl'].previousValue;
      console.log('📹 Thumbnail URL changed from:', previousValue, 'to:', newValue);
      
      // If thumbnail URL is provided, make sure we show it
      if (newValue) {
        this.showThumbnailOverlay = true;
        this.thumbnailPreview = newValue;
        console.log('📹 ✅ Set thumbnailPreview to:', this.thumbnailPreview);
        console.log('📹 ✅ Set showThumbnailOverlay to TRUE');
      } else {
        this.showThumbnailOverlay = false;
        this.thumbnailPreview = '';
        console.log('📹 ❌ Cleared thumbnail (empty value)');
      }
      console.log('📹 After update - showThumbnailOverlay:', this.showThumbnailOverlay);
    }
    
    // React to changes in videoUrl
    if (changes['videoUrl'] && changes['videoUrl'].currentValue) {
      console.log('📹 Video URL changed to:', changes['videoUrl'].currentValue);
      this.autoThumbnailGenerated = this.isExternalVideo(changes['videoUrl'].currentValue);
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
    // If modal mode is enabled, emit event instead of playing inline
    if (this.enableModalPlayer) {
      this.thumbnailClick.emit();
      return;
    }
    
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
        this.clearPreviews();
        this.errorMessage = 'Failed to upload thumbnail. Please try again.';
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

  // Detect video type from URL
  detectVideoType(url: string): 'upload' | 'youtube' | 'vimeo' {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'youtube';
    }
    if (url.includes('vimeo.com')) {
      return 'vimeo';
    }
    return 'upload';
  }

  // Fetch external video thumbnail (async for Vimeo, sync for YouTube)
  async fetchExternalVideoThumbnail() {
    if (!this.videoUrl) {
      this.externalVideoThumbnail = null;
      return;
    }
    
    // YouTube thumbnail - direct URL
    if (this.videoType === 'youtube' || this.videoUrl.includes('youtube.com') || this.videoUrl.includes('youtu.be')) {
      const videoId = this.extractYouTubeId(this.videoUrl);
      if (videoId) {
        this.externalVideoThumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        console.log('📹 YouTube thumbnail:', this.externalVideoThumbnail);
      }
      return;
    }
    
    // Vimeo thumbnail - fetch from oEmbed API
    if (this.videoType === 'vimeo' || this.videoUrl.includes('vimeo.com')) {
      const vimeoId = this.extractVimeoId(this.videoUrl);
      if (vimeoId) {
        console.log('📹 Fetching Vimeo thumbnail for ID:', vimeoId);
        try {
          const oEmbedUrl = `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}`;
          const response: any = await this.http.get(oEmbedUrl).toPromise();
          
          if (response && response.thumbnail_url) {
            // Get the highest quality thumbnail
            this.externalVideoThumbnail = response.thumbnail_url.replace(/_\d+x\d+/, '_1280x720');
            console.log('📹 ✅ Vimeo thumbnail fetched:', this.externalVideoThumbnail);
          } else {
            console.log('📹 ⚠️ No thumbnail in Vimeo response');
            this.externalVideoThumbnail = null;
          }
        } catch (error) {
          console.error('📹 ❌ Error fetching Vimeo thumbnail:', error);
          this.externalVideoThumbnail = null;
        }
      }
      return;
    }
    
    this.externalVideoThumbnail = null;
  }

  // Extract Vimeo video ID from various URL formats
  private extractVimeoId(url: string): string | null {
    const patterns = [
      /vimeo\.com\/video\/(\d+)/,
      /vimeo\.com\/(\d+)/,
      /player\.vimeo\.com\/video\/(\d+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  // Extract YouTube video ID from various URL formats
  private extractYouTubeId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  // Load the first frame of an uploaded video
  private loadVideoFirstFrame() {
    if (!this.videoPreviewElement?.nativeElement) {
      console.log('📹 Video preview element not found, retrying...');
      setTimeout(() => this.loadVideoFirstFrame(), 200);
      return;
    }

    const video = this.videoPreviewElement.nativeElement;
    
    video.addEventListener('loadeddata', () => {
      console.log('📹 Video metadata loaded, seeking to first frame');
      video.currentTime = 0.1; // Seek to 0.1 seconds to get first frame
    });

    video.addEventListener('error', (e) => {
      console.error('📹 Error loading video preview:', e);
    });

    // Load the video
    video.load();
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
          // Upload failed - clear previews
          this.clearPreviews();
          this.errorMessage = 'Failed to upload video. Please try again.';
          this.isUploading = false;
        }
      },
      error: (error: any) => {
        // Upload failed - clear previews
        this.clearPreviews();
        this.isUploading = false;
        this.errorMessage = 'Upload failed: ' + (error?.error?.error || error.message || 'Unknown error');
        console.error('❌ Upload error:', error);
      }
    });
  }

  // Clear all previews on upload failure
  private clearPreviews() {
    this.videoUrl = '';
    this.thumbnailUrl = '';
    this.thumbnailPreview = '';
    this.customThumbnail = null;
    this.autoThumbnailGenerated = false;
    this.showThumbnailOverlay = true;
  }

  removeVideo() {
    this.clearPreviews();
    this.videoRemoved.emit();
  }

  removeThumbnail() {
    this.thumbnailUrl = '';
    this.thumbnailPreview = '';
    this.customThumbnail = null;
    this.autoThumbnailGenerated = false;
    this.showThumbnailOverlay = true;
  }

  async changeVideo() {
    // If video is approved, show warning before allowing change
    if (this.isVideoApproved) {
      const alert = await this.alertController.create({
        header: '⚠️ Change Introduction Video',
        message: 'Your new video will be sent for admin review. Your profile will remain visible to students while the review is in progress.\n\nAre you sure you want to change your video?',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            cssClass: 'secondary'
          },
          {
            text: 'Continue',
            cssClass: 'primary',
            handler: () => {
              this.proceedWithVideoChange();
            }
          }
        ]
      });
      
      await alert.present();
    } else {
      // Not approved yet, allow change without warning
      this.proceedWithVideoChange();
    }
  }

  private proceedWithVideoChange() {
    this.videoUrl = '';
    this.thumbnailUrl = '';
    this.thumbnailPreview = '';
    this.customThumbnail = null;
    this.errorMessage = '';
    this.autoThumbnailGenerated = false;
    this.showThumbnailOverlay = true;
  }
}
