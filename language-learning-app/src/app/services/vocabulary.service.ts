import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
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
  lessonId: any; // populated with lesson details
  tutorId: any;  // populated with tutor details
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

  /**
   * Save/update vocabulary and goals for a lesson (upsert)
   */
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

  /**
   * Get vocabulary and goals for a specific lesson
   */
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

  /**
   * Get all vocabulary from all lessons for the current student
   */
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
}

