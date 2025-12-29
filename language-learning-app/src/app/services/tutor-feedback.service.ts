import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface TutorFeedback {
  _id: string;
  lessonId: string;
  tutorId: string;
  studentId: string;
  strengths: string[];
  areasForImprovement: string[];
  homework: string;
  overallNotes: string;
  status: 'pending' | 'completed';
  providedAt?: Date;
  createdAt: Date;
  remindersSent: number;
  lastReminderAt?: Date;
}

export interface PendingFeedbackItem extends TutorFeedback {
  lesson?: {
    startTime: Date;
    endTime: Date;
    subject: string;
    duration: number;
  };
  studentName?: string;
  studentPicture?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TutorFeedbackService {
  private baseUrl = `${environment.backendUrl}/api/tutor-feedback`;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  /**
   * Get all pending feedback requests for the current tutor
   */
  getPendingFeedback(): Observable<{ success: boolean; pendingFeedback: PendingFeedbackItem[]; count: number }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; pendingFeedback: PendingFeedbackItem[]; count: number }>(
      `${this.baseUrl}/pending`,
      { headers }
    );
  }

  /**
   * Submit feedback for a lesson
   */
  submitFeedback(
    feedbackId: string,
    data: {
      strengths: string[];
      areasForImprovement: string[];
      homework: string;
      overallNotes: string;
    }
  ): Observable<{ success: boolean; message: string; feedback: TutorFeedback }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; message: string; feedback: TutorFeedback }>(
      `${this.baseUrl}/${feedbackId}/submit`,
      data,
      { headers }
    );
  }

  /**
   * Get feedback for a specific lesson
   */
  getFeedbackForLesson(lessonId: string): Observable<{ success: boolean; feedback?: TutorFeedback; hasFeedback: boolean }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; feedback?: TutorFeedback; hasFeedback: boolean }>(
      `${this.baseUrl}/lesson/${lessonId}`,
      { headers }
    );
  }
}

