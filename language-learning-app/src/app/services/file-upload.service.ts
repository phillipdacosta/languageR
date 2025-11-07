import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { take, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FileUploadService {
  private apiUrl = `${environment.backendUrl}/api`;

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  /**
   * Upload video file to Google Cloud Storage with compression
   */
  uploadVideo(file: File): Observable<{ 
    success: boolean; 
    videoUrl: string; 
    compressionInfo?: any;
    uploadStats?: any;
  }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        const formData = new FormData();
        formData.append('video', file);
        
                return this.http.post<{ 
                  success: boolean; 
                  videoUrl: string; 
                  compressionInfo?: any;
                  uploadStats?: any;
                }>(
          `${this.apiUrl}/users/tutor-video-upload`,
          formData,
          { 
            headers: this.getAuthHeaders(userEmail),
            reportProgress: true
          }
        );
      })
    );
  }

  private getAuthHeaders(userEmail: string): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer dev-token-${userEmail.replace('@', '-').replace('.', '-')}`,
      // Don't set Content-Type for FormData - let browser set it with boundary
    });
  }

  /**
   * Validate video file
   */
  validateVideo(file: File): { valid: boolean; error?: string } {
    // Check file type
    if (!file.type.startsWith('video/')) {
      return { valid: false, error: 'Please select a video file' };
    }

    // Check file size (max 1GB - will be compressed)
    const maxSize = 1000 * 1024 * 1024; // 1GB
    if (file.size > maxSize) {
      return { valid: false, error: 'Video file is too large. Maximum size is 1GB' };
    }

    return { valid: true };
  }

  /**
   * Upload image file to Google Cloud Storage
   */
  uploadImage(file: File): Observable<{ 
    success: boolean; 
    imageUrl: string; 
  }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        const formData = new FormData();
        formData.append('image', file);
        
        return this.http.post<{ 
          success: boolean; 
          imageUrl: string; 
        }>(
          `${this.apiUrl}/users/profile-picture-upload`,
          formData,
          { 
            headers: this.getAuthHeaders(userEmail),
            reportProgress: true
          }
        );
      })
    );
  }

  /**
   * Validate image file
   */
  validateImage(file: File): { valid: boolean; error?: string } {
    // Check file type
    if (!file.type.startsWith('image/')) {
      return { valid: false, error: 'Please select an image file' };
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return { valid: false, error: 'Image file is too large. Maximum size is 10MB' };
    }

    return { valid: true };
  }
}
