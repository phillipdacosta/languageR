import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Lesson {
  _id: string;
  title: string;
  description: string;
  language: string;
  level: string;
  category: string;
  content: any;
  exercises: Array<{
    type: string;
    question: string;
    options?: string[];
    correctAnswer: any;
    explanation?: string;
    points: number;
  }>;
  estimatedTime: number;
  difficulty: number;
  prerequisites: string[];
  tags: string[];
  isActive: boolean;
  createdBy: {
    _id: string;
    username: string;
    firstName: string;
    lastName: string;
  };
  progress?: {
    status: string;
    score: number;
    timeSpent: number;
    attempts: number;
    completedAt?: Date;
    xpEarned: number;
  };
}

export interface LessonsResponse {
  lessons: Lesson[];
  totalPages: number;
  currentPage: number;
  total: number;
}

export interface LessonResponse {
  lesson: Lesson;
}

export interface StartLessonResponse {
  message: string;
  progress: any;
}

export interface SubmitLessonResponse {
  message: string;
  score: number;
  correctAnswers: number;
  totalQuestions: number;
  xpEarned: number;
  isCompleted: boolean;
  progress: any;
}

@Injectable({
  providedIn: 'root'
})
export class LessonService {
  private apiUrl = 'http://localhost:3000/api';

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  getLessons(params?: {
    language?: string;
    level?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Observable<LessonsResponse> {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key as keyof typeof params] !== undefined) {
          httpParams = httpParams.set(key, params[key as keyof typeof params]!.toString());
        }
      });
    }

    const headers = this.authService.isAuthenticated() 
      ? this.authService.getAuthHeaders() 
      : undefined;

    return this.http.get<LessonsResponse>(`${this.apiUrl}/lessons`, {
      params: httpParams,
      headers
    });
  }

  getLesson(id: string): Observable<LessonResponse> {
    const headers = this.authService.isAuthenticated() 
      ? this.authService.getAuthHeaders() 
      : undefined;

    return this.http.get<LessonResponse>(`${this.apiUrl}/lessons/${id}`, {
      headers
    });
  }

  createLesson(lessonData: Partial<Lesson>): Observable<LessonResponse> {
    return this.http.post<LessonResponse>(
      `${this.apiUrl}/lessons`,
      lessonData,
      { headers: this.authService.getAuthHeaders() }
    );
  }

  updateLesson(id: string, lessonData: Partial<Lesson>): Observable<LessonResponse> {
    return this.http.put<LessonResponse>(
      `${this.apiUrl}/lessons/${id}`,
      lessonData,
      { headers: this.authService.getAuthHeaders() }
    );
  }

  deleteLesson(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/lessons/${id}`,
      { headers: this.authService.getAuthHeaders() }
    );
  }

  startLesson(id: string): Observable<StartLessonResponse> {
    return this.http.post<StartLessonResponse>(
      `${this.apiUrl}/lessons/${id}/start`,
      {},
      { headers: this.authService.getAuthHeaders() }
    );
  }

  submitLesson(id: string, answers: any[]): Observable<SubmitLessonResponse> {
    return this.http.post<SubmitLessonResponse>(
      `${this.apiUrl}/lessons/${id}/submit`,
      { answers },
      { headers: this.authService.getAuthHeaders() }
    );
  }
}
