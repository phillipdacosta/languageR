import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap, take, filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface VocabEntry {
  _id?: string;
  word: string;
  translation: string;
  example: string;
  addedBy: 'tutor' | 'student';
}

export interface GoalEntry {
  _id?: string;
  text: string;
  completed: boolean;
  addedBy: 'tutor' | 'student';
}

export interface LessonVocabulary {
  _id?: string;
  lessonId: string;
  tutorId: string;
  studentId: string;
  vocabulary: VocabEntry[];
  goals: GoalEntry[];
  language: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LessonVocabularyWithDetails extends LessonVocabulary {
  lessonId: any;
  tutorId: any;
}

export interface VocabularyCard {
  _id: string;
  studentId: string;
  language: string;
  term: string;
  translation: string;
  context: string;
  source: { type: string; lessonAnalysisId?: string; materialId?: string };
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewDate: string;
  lastReviewedAt?: string;
  totalReviews: number;
  correctReviews: number;
  status: 'new' | 'learning' | 'review' | 'mastered';
}

export interface SrsStats {
  total: number;
  new: number;
  learning: number;
  review: number;
  mastered: number;
  dueNow: number;
}

export interface SrsLanguage {
  language: string;
  total: number;
  dueNow: number;
}

@Injectable({
  providedIn: 'root'
})
export class VocabularyService {
  private apiUrl = `${environment.backendUrl}/api/vocabulary`;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  saveVocabulary(
    lessonId: string,
    vocabulary: VocabEntry[],
    goals: GoalEntry[],
    language?: string
  ): Observable<{ success: boolean; data: LessonVocabulary }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; data: LessonVocabulary }>(
          `${this.apiUrl}/${lessonId}`,
          { vocabulary, goals, language },
          { headers }
        );
      })
    );
  }

  getVocabulary(lessonId: string): Observable<{ success: boolean; data: LessonVocabulary }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; data: LessonVocabulary }>(
          `${this.apiUrl}/${lessonId}`,
          { headers }
        );
      })
    );
  }

  getAllStudentVocabulary(
    limit = 50,
    skip = 0
  ): Observable<{ success: boolean; data: LessonVocabularyWithDetails[]; total: number; hasMore: boolean }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; data: LessonVocabularyWithDetails[]; total: number; hasMore: boolean }>(
          `${this.apiUrl}/student/all`,
          { headers, params: { limit: limit.toString(), skip: skip.toString() } }
        );
      })
    );
  }

  // ── SRS Flashcard Methods ──────────────────────────────

  getSrsLanguages(): Observable<{ success: boolean; languages: SrsLanguage[] }> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; languages: SrsLanguage[] }>(
          `${this.apiUrl}/srs/languages`,
          { headers }
        );
      })
    );
  }

  getDueCards(language: string, limit = 20): Observable<{ success: boolean; cards: VocabularyCard[] }> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; cards: VocabularyCard[] }>(
          `${this.apiUrl}/srs/${encodeURIComponent(language)}/due`,
          { headers, params: { limit: limit.toString() } }
        );
      })
    );
  }

  getSrsStats(language: string): Observable<{ success: boolean } & SrsStats> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean } & SrsStats>(
          `${this.apiUrl}/srs/${encodeURIComponent(language)}/stats`,
          { headers }
        );
      })
    );
  }

  reviewCard(cardId: string, quality: number): Observable<{ success: boolean; card: VocabularyCard }> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; card: VocabularyCard }>(
          `${this.apiUrl}/srs/review`,
          { cardId, quality },
          { headers }
        );
      })
    );
  }

  addCard(term: string, language: string, translation?: string, context?: string): Observable<{ success: boolean; card: VocabularyCard; alreadyExists?: boolean }> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; card: VocabularyCard; alreadyExists?: boolean }>(
          `${this.apiUrl}/srs/add`,
          { term, language, translation, context },
          { headers }
        );
      })
    );
  }

  updateCard(cardId: string, updates: { translation?: string; context?: string }): Observable<{ success: boolean; card: VocabularyCard }> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; card: VocabularyCard }>(
          `${this.apiUrl}/srs/${cardId}`,
          updates,
          { headers }
        );
      })
    );
  }

  deleteCard(cardId: string): Observable<{ success: boolean; message: string }> {
    return this.userService.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.delete<{ success: boolean; message: string }>(
          `${this.apiUrl}/srs/${cardId}`,
          { headers }
        );
      })
    );
  }
}

