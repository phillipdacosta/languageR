import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface Struggle {
  issue: string;
  userFriendlyTitle?: string;
  description?: string;
  examples?: Array<{
    original: string;
    corrected: string;
    explanation?: string;
  }>;
  frequency: string;
  appearances: number;
  lessonsAnalyzed: number;
  impact: 'low' | 'medium' | 'high';
  percentage: number;
}

export interface StruggleResponse {
  success: boolean;
  hasEnoughData: boolean;
  message?: string;
  language?: string;
  lessonsAnalyzed?: number;
  struggles?: Struggle[];
  lessonsCompleted?: number;
  dateRange?: {
    from: Date;
    to: Date;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ProgressService {
  private apiUrl = `${environment.backendUrl}/api/progress`;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  /**
   * Get recurring struggles for a language (last 5 lessons)
   */
  getStruggles(language: string): Observable<StruggleResponse> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<StruggleResponse>(`${this.apiUrl}/struggles/${language}`, { headers });
  }

  /**
   * Check if student hit a milestone and trigger notification if needed
   */
  checkMilestone(language: string): Observable<any> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get(`${this.apiUrl}/check-milestone/${language}`, { headers });
  }
}
