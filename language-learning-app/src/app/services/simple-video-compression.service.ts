import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SimpleVideoCompressionService {

  constructor() {}

  async compressVideo(file: File, options: {
    maxSizeMB?: number;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  } = {}): Promise<File> {
    const {
      maxSizeMB = 50,
      maxWidth = 1280,
      maxHeight = 720,
      quality = 0.7
    } = options;

    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      video.onloadedmetadata = () => {
        // Calculate new dimensions
        let { videoWidth, videoHeight } = video;
        
        if (videoWidth > maxWidth || videoHeight > maxHeight) {
          const ratio = Math.min(maxWidth / videoWidth, maxHeight / videoHeight);
          videoWidth *= ratio;
          videoHeight *= ratio;
        }
        
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        
        // Seek to middle of video for thumbnail
        video.currentTime = Math.min(video.duration / 2, 10);
      };

      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            reject(new Error('Failed to compress video'));
          }
        }, 'image/jpeg', quality);
      };

      video.onerror = () => {
        reject(new Error('Video loading failed'));
      };

      video.src = URL.createObjectURL(file);
      video.load();
    });
  }

  // Check if file needs compression
  needsCompression(file: File, maxSizeMB: number = 50): boolean {
    return file.size > maxSizeMB * 1024 * 1024;
  }

  // Get file size in MB
  getFileSizeMB(file: File): number {
    return file.size / 1024 / 1024;
  }

  // Format file size for display
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

