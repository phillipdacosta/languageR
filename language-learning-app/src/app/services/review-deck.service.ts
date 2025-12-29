import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface ReviewDeckItem {
  _id: string;
  userId: string;
  original: string;
  corrected: string;
  explanation: string;
  context: string;
  language: string;
  errorType: 'grammar' | 'vocabulary' | 'pronunciation' | 'tense' | 'preposition' | 'agreement' | 'spelling' | 'word_choice' | 'other';
  savedAt: Date;
  mastered: boolean;
  reviewCount: number;
  lastReviewedAt?: Date;
  lessonId?: string;
  analysisId?: string;
}

export interface ReviewDeckStats {
  total: number;
  mastered: number;
  notMastered: number;
  needsReview: number;
  byErrorType: { [key: string]: number };
}

export interface ReviewDeckResponse {
  items: ReviewDeckItem[];
  total: number;
  hasMore: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ReviewDeckService {
  private apiUrl = `${environment.backendUrl}/api/review-deck`;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  /**
   * Save a correction to the review deck
   */
  saveItem(item: {
    original: string;
    corrected: string;
    explanation?: string;
    context?: string;
    language?: string;
    errorType?: string;
    lessonId?: string;
    analysisId?: string;
  }): Observable<{ message: string; item: ReviewDeckItem }> {
    // Wait for user to be authenticated before making request
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ message: string; item: ReviewDeckItem }>(this.apiUrl, item, { headers });
      })
    );
  }

  /**
   * Get all review deck items
   */
  getItems(filters?: {
    mastered?: boolean;
    language?: string;
    errorType?: string;
    limit?: number;
    skip?: number;
  }): Observable<ReviewDeckResponse> {
    // Wait for user to be authenticated before making request
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap((user) => {
        console.log('🔍 ReviewDeckService: User loaded for getItems:', user?.email);
        let params = new HttpParams();
        
        if (filters) {
          if (filters.mastered !== undefined) {
            params = params.set('mastered', filters.mastered.toString());
          }
          if (filters.language) {
            params = params.set('language', filters.language);
          }
          if (filters.errorType) {
            params = params.set('errorType', filters.errorType);
          }
          if (filters.limit) {
            params = params.set('limit', filters.limit.toString());
          }
          if (filters.skip) {
            params = params.set('skip', filters.skip.toString());
          }
        }
        
        const headers = this.userService.getAuthHeadersSync();
        const authHeader = headers.get('Authorization');
        console.log('🔍 ReviewDeckService: Auth header:', authHeader?.substring(0, 30) + '...');
        return this.http.get<ReviewDeckResponse>(this.apiUrl, { params, headers });
      })
    );
  }

  /**
   * Get items that need review (spaced repetition)
   */
  getItemsNeedingReview(limit = 10): Observable<{ items: ReviewDeckItem[] }> {
    const params = new HttpParams().set('limit', limit.toString());
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ items: ReviewDeckItem[] }>(`${this.apiUrl}/needs-review`, { params, headers });
  }

  /**
   * Get review deck statistics
   */
  getStats(): Observable<ReviewDeckStats> {
    // Wait for user to be authenticated before making request
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<ReviewDeckStats>(`${this.apiUrl}/stats`, { headers });
      })
    );
  }

  /**
   * Mark an item as reviewed
   */
  markAsReviewed(itemId: string): Observable<{ message: string; item: ReviewDeckItem }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.put<{ message: string; item: ReviewDeckItem }>(`${this.apiUrl}/${itemId}/review`, {}, { headers });
  }

  /**
   * Toggle mastered status
   */
  toggleMastered(itemId: string): Observable<{ message: string; item: ReviewDeckItem }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.put<{ message: string; item: ReviewDeckItem }>(`${this.apiUrl}/${itemId}/mastered`, {}, { headers });
  }

  /**
   * Delete an item from review deck
   */
  deleteItem(itemId: string): Observable<{ message: string }> {
    // Wait for user to be authenticated before making request
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.delete<{ message: string }>(`${this.apiUrl}/${itemId}`, { headers });
      })
    );
  }

  /**
   * Save multiple items at once
   */
  saveMultiple(items: Array<{
    original: string;
    corrected: string;
    explanation?: string;
    context?: string;
    language?: string;
    errorType?: string;
    lessonId?: string;
    analysisId?: string;
  }>): Observable<{ message: string; count: number }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ message: string; count: number }>(`${this.apiUrl}/batch`, { items }, { headers });
  }

  /**
   * Check if an item is already saved (local check for UI)
   */
  isItemSaved(original: string, corrected: string, items: ReviewDeckItem[]): boolean {
    return items.some(item => 
      item.original.trim().toLowerCase() === original.trim().toLowerCase() &&
      item.corrected.trim().toLowerCase() === corrected.trim().toLowerCase()
    );
  }
}

