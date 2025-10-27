import { Injectable } from '@angular/core';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

@Injectable({
  providedIn: 'root'
})
export class VideoCompressionService {
  private ffmpeg: FFmpeg | null = null;
  private isLoaded = false;

  constructor() {}

  async initializeFFmpeg(): Promise<void> {
    if (this.isLoaded) return;

    this.ffmpeg = new FFmpeg();
    
    try {
      // Load FFmpeg
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      this.isLoaded = true;
      console.log('✅ FFmpeg loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load FFmpeg:', error);
      throw new Error('Failed to initialize video compression');
    }
  }

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
      quality = 28
    } = options;

    if (!this.ffmpeg || !this.isLoaded) {
      await this.initializeFFmpeg();
    }

    if (!this.ffmpeg) {
      throw new Error('FFmpeg not initialized');
    }

    try {
      console.log('🎬 Starting video compression...');
      console.log(`📊 Original file: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

      // Write input file
      await this.ffmpeg.writeFile('input.mp4', await fetchFile(file));

      // Compress video with multiple passes to achieve target size
      const outputFileName = 'output.mp4';
      
      // First pass: compress with quality settings
      await this.ffmpeg.exec([
        '-i', 'input.mp4',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', quality.toString(),
        '-vf', `scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease`,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputFileName
      ]);

      // Read the compressed file
      const compressedData = await this.ffmpeg.readFile(outputFileName);
      const compressedBlob = new Blob([compressedData], { type: 'video/mp4' });
      
      console.log(`📊 Compressed file: ${(compressedBlob.size / 1024 / 1024).toFixed(2)}MB`);
      
      // If still too large, try more aggressive compression
      if (compressedBlob.size > maxSizeMB * 1024 * 1024) {
        console.log('🔄 File still too large, applying more aggressive compression...');
        
        await this.ffmpeg.writeFile('input2.mp4', compressedData);
        await this.ffmpeg.exec([
          '-i', 'input2.mp4',
          '-c:v', 'libx264',
          '-preset', 'slow',
          '-crf', '32',
          '-vf', `scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease`,
          '-c:a', 'aac',
          '-b:a', '96k',
          '-movflags', '+faststart',
          'output2.mp4'
        ]);

        const finalData = await this.ffmpeg.readFile('output2.mp4');
        const finalBlob = new Blob([finalData], { type: 'video/mp4' });
        
        console.log(`📊 Final compressed file: ${(finalBlob.size / 1024 / 1024).toFixed(2)}MB`);
        
        // Create new file with compressed data
        const compressedFile = new File([finalBlob], file.name, {
          type: 'video/mp4',
          lastModified: Date.now()
        });

        // Clean up
        await this.ffmpeg.deleteFile('input.mp4');
        await this.ffmpeg.deleteFile('input2.mp4');
        await this.ffmpeg.deleteFile(outputFileName);
        await this.ffmpeg.deleteFile('output2.mp4');

        return compressedFile;
      }

      // Create new file with compressed data
      const compressedFile = new File([compressedBlob], file.name, {
        type: 'video/mp4',
        lastModified: Date.now()
      });

      // Clean up
      await this.ffmpeg.deleteFile('input.mp4');
      await this.ffmpeg.deleteFile(outputFileName);

      return compressedFile;

    } catch (error) {
      console.error('❌ Video compression failed:', error);
      throw new Error('Video compression failed');
    }
  }

  async compressVideoSimple(file: File): Promise<File> {
    // Fallback: simple canvas-based compression for smaller files
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
        const maxWidth = 1280;
        const maxHeight = 720;
        let { videoWidth, videoHeight } = video;
        
        if (videoWidth > maxWidth || videoHeight > maxHeight) {
          const ratio = Math.min(maxWidth / videoWidth, maxHeight / videoHeight);
          videoWidth *= ratio;
          videoHeight *= ratio;
        }
        
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        
        video.currentTime = 0;
      };

      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: 'video/mp4',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            reject(new Error('Failed to compress video'));
          }
        }, 'video/mp4', 0.7);
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

  // Get compression progress (placeholder for future implementation)
  getCompressionProgress(): number {
    // This would need to be implemented with FFmpeg progress callbacks
    return 0;
  }
}

