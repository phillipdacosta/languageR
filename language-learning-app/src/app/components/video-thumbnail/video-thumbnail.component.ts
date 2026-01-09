import { Component, Input, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-video-thumbnail',
  templateUrl: './video-thumbnail.component.html',
  styleUrls: ['./video-thumbnail.component.scss'],
  standalone: false
})
export class VideoThumbnailComponent implements OnInit {
  @Input() videoUrl: string = '';
  @Input() thumbnailUrl: string = '';
  @Input() videoType: 'upload' | 'youtube' | 'vimeo' = 'upload';
  @Input() showPlayButton: boolean = true;
  @Input() cssClass: string = '';

  externalVideoThumbnail: string | null = null;
  detectedVideoType: 'upload' | 'youtube' | 'vimeo' = 'upload';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    // Auto-detect video type if not provided or incorrect
    if (this.videoUrl) {
      this.detectedVideoType = this.detectVideoType(this.videoUrl);
      if (this.detectedVideoType !== this.videoType) {
        console.log(`📹 [VideoThumbnail] Type mismatch. Stored: ${this.videoType}, Detected: ${this.detectedVideoType}`);
        this.videoType = this.detectedVideoType;
      }
    }

    // Fetch external thumbnails
    if (this.videoUrl && !this.thumbnailUrl) {
      this.fetchExternalVideoThumbnail();
    }
  }

  detectVideoType(url: string): 'upload' | 'youtube' | 'vimeo' {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'youtube';
    }
    if (url.includes('vimeo.com')) {
      return 'vimeo';
    }
    return 'upload';
  }

  async fetchExternalVideoThumbnail() {
    if (!this.videoUrl || this.thumbnailUrl) {
      return;
    }

    // YouTube thumbnail
    if (this.videoType === 'youtube') {
      const videoId = this.extractYouTubeId(this.videoUrl);
      if (videoId) {
        this.externalVideoThumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
      return;
    }

    // Vimeo thumbnail
    if (this.videoType === 'vimeo') {
      const vimeoId = this.extractVimeoId(this.videoUrl);
      if (vimeoId) {
        try {
          const oEmbedUrl = `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}`;
          const response: any = await this.http.get(oEmbedUrl).toPromise();
          
          if (response && response.thumbnail_url) {
            this.externalVideoThumbnail = response.thumbnail_url.replace(/_\d+x\d+/, '_1280x720');
          }
        } catch (error) {
          console.error('📹 Error fetching Vimeo thumbnail:', error);
        }
      }
    }
  }

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
}


