import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Progress {
  _id: string;
  user: string;
  lesson: {
    _id: string;
    title: string;
    description: string;
    language: string;
    level: string;
    category: string;
    estimatedTime: number;
  };
  status: string;
  score: number;
  timeSpent: number;
  attempts: number;
  completedAt?: Date;
  exerciseResults: Array<{
    exerciseIndex: number;
    userAnswer: any;
    isCorrect: boolean;
    timeSpent: number;
    attempts: number;
  }>;
  xpEarned: number;
  streakBonus: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgressResponse {
  progress: Progress[];
  totalPages: number;
  currentPage: number;
  total: number;
}

export interface ProgressStats {
  overall: {
    totalLessons: number;
    completedLessons: number;
    inProgressLessons: number;
    totalXP: number;
    totalTimeSpent: number;
    averageScore: number;
    totalAttempts: number;
  };
  byLanguage: Array<{
    _id: string;
    totalLessons: number;
    completedLessons: number;
    totalXP: number;
    averageScore: number;
  }>;
  recentActivity: Progress[];
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  totalXP: number;
  recentCompletions: number;
}

@Injectable({
  providedIn: 'root'
})
export class ProgressService {
  private apiUrl = 'http://localhost:3000/api';

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  getProgress(params?: {
    status?: string;
    language?: string;
    page?: number;
    limit?: number;
  }): Observable<ProgressResponse> {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key as keyof typeof params] !== undefined) {
          httpParams = httpParams.set(key, params[key as keyof typeof params]!.toString());
        }
      });
    }

    return this.http.get<ProgressResponse>(`${this.apiUrl}/progress`, {
      params: httpParams,
      headers: this.authService.getAuthHeaders()
    });
  }

  getLessonProgress(lessonId: string): Observable<{ progress: Progress }> {
    return this.http.get<{ progress: Progress }>(
      `${this.apiUrl}/progress/lesson/${lessonId}`,
      { headers: this.authService.getAuthHeaders() }
    );
  }

  getProgressStats(params?: {
    language?: string;
    timeRange?: string;
  }): Observable<{ stats: ProgressStats }> {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key as keyof typeof params] !== undefined) {
          httpParams = httpParams.set(key, params[key as keyof typeof params]!.toString());
        }
      });
    }

    return this.http.get<{ stats: ProgressStats }>(`${this.apiUrl}/progress/stats`, {
      params: httpParams,
      headers: this.authService.getAuthHeaders()
    });
  }

  getStreakInfo(): Observable<StreakInfo> {
    return this.http.get<StreakInfo>(
      `${this.apiUrl}/progress/streak`,
      { headers: this.authService.getAuthHeaders() }
    );
  }

  resetLessonProgress(lessonId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/progress/lesson/${lessonId}`,
      { headers: this.authService.getAuthHeaders() }
    );
  }
}
