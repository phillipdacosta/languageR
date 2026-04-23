import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
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
  estimatedCefrLevel?: string;
  status: 'pending' | 'completed';
  required?: boolean;
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
  lastCefrLevel?: string;
  lastCefrDate?: Date;
}

interface PendingFeedbackResponse {
  success: boolean;
  pendingFeedback: PendingFeedbackItem[];
  count: number;
}

@Injectable({
  providedIn: 'root'
})
export class TutorFeedbackService {
  private baseUrl = `${environment.backendUrl}/api/tutor-feedback`;

  // ── Cached pending-feedback state ──
  private pendingFeedbackSubject = new BehaviorSubject<PendingFeedbackResponse>({
    success: true,
    pendingFeedback: [],
    count: 0
  });

  /** Observable that components subscribe to for instant data. */
  pendingFeedback$ = this.pendingFeedbackSubject.asObservable();

  /** Whether the cache has been loaded at least once. */
  private cacheLoaded = false;

  /** Flag: reopen the Outstanding Feedback modal after the next cache refresh. */
  private _reopenModalAfterSubmit = false;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  // ── Public helpers ──

  /** Synchronously check if the cache has been populated at least once. */
  get isCacheLoaded(): boolean {
    return this.cacheLoaded;
  }

  /** Synchronous snapshot of the current cached value. */
  getCachedPendingFeedback(): PendingFeedbackResponse {
    return this.pendingFeedbackSubject.getValue();
  }

  /**
   * Returns true (once) if the modal should be reopened after a feedback submission.
   * Consuming the flag resets it so it only fires once.
   */
  consumeReopenFlag(): boolean {
    const val = this._reopenModalAfterSubmit;
    this._reopenModalAfterSubmit = false;
    return val;
  }

  // ── API calls ──

  /**
   * Fetch pending feedback from the server.
   * Updates the internal cache and returns the observable.
   */
  getPendingFeedback(): Observable<PendingFeedbackResponse> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<PendingFeedbackResponse>(
      `${this.baseUrl}/pending`,
      { headers }
    ).pipe(
      tap(response => {
        this.pendingFeedbackSubject.next(response);
        this.cacheLoaded = true;
        console.log(`📝 [FeedbackService] Cache updated — ${response.count} pending`);
      })
    );
  }

  /**
   * Fire-and-forget refresh — updates the cache in the background.
   * Returns immediately; subscribers to pendingFeedback$ will be notified.
   */
  refreshPendingFeedback(): void {
    this.getPendingFeedback().subscribe({
      error: (err) => console.error('❌ [FeedbackService] Background refresh failed:', err)
    });
  }

  /**
   * Submit feedback for a lesson.
   * After success, refreshes the pending-feedback cache automatically.
   */
  submitFeedback(
    feedbackId: string,
    data: {
      strengths: string[];
      areasForImprovement: string[];
      homework: string;
      overallNotes: string;
      estimatedCefrLevel: string;
    }
  ): Observable<{ success: boolean; message: string; feedback: TutorFeedback }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; message: string; feedback: TutorFeedback }>(
      `${this.baseUrl}/${feedbackId}/submit`,
      data,
      { headers }
    ).pipe(
      tap(() => {
        // Signal pages to reopen the modal for remaining items
        this._reopenModalAfterSubmit = true;
        // After submitting, refresh the cache so counts update everywhere
        this.refreshPendingFeedback();
      })
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

  /** Reset cache (e.g. on logout). */
  clearCache(): void {
    this.pendingFeedbackSubject.next({ success: true, pendingFeedback: [], count: 0 });
    this.cacheLoaded = false;
  }
}
