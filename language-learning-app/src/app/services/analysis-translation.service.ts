import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, Subject } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';
import { LessonService } from './lesson.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface CachedTranslation {
  translation: any;
  showTranslated: boolean;
}

@Injectable({ providedIn: 'root' })
export class AnalysisTranslationService {
  private static readonly MAX_CACHE_SIZE = 10;
  private cache = new Map<string, CachedTranslation>();
  private translationChanged$ = new Subject<string>();

  onTranslationChanged(): Observable<string> {
    return this.translationChanged$.asObservable();
  }

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private lessonService: LessonService,
    private sanitizer: DomSanitizer
  ) {}

  private get targetLanguage(): string {
    return this.lessonService.getProseTranslationTarget() || 'en';
  }

  hasTranslation(analysisId: string): boolean {
    return this.cache.has(analysisId);
  }

  isShowingTranslated(analysisId: string): boolean {
    return this.cache.get(analysisId)?.showTranslated ?? false;
  }

  getTranslation(analysisId: string): any | null {
    return this.cache.get(analysisId)?.translation ?? null;
  }

  /**
   * Seed the cache from a translation already present in an API response
   * (e.g. `analysis.translations[lang]`). No API call needed.
   */
  seedFromResponse(analysisId: string, translation: any) {
    if (!analysisId || !translation) return;
    if (!this.cache.has(analysisId)) {
      this.evictIfNeeded();
      this.cache.set(analysisId, { translation, showTranslated: true });
    }
  }

  private evictIfNeeded() {
    if (this.cache.size < AnalysisTranslationService.MAX_CACHE_SIZE) return;
    const oldest = this.cache.keys().next().value;
    if (oldest) this.cache.delete(oldest);
  }

  /**
   * Request translation from the API (or return cached). Returns the translation object.
   */
  translate(analysisId: string): Observable<any> {
    const cached = this.cache.get(analysisId);
    if (cached) {
      cached.showTranslated = true;
      this.translationChanged$.next(analysisId);
      return of(cached.translation);
    }

    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; translation: any; cached: boolean }>(
      `${environment.backendUrl}/api/transcription/analysis/${analysisId}/translate`,
      { targetLanguage: this.targetLanguage },
      { headers }
    ).pipe(
      map(res => {
        if (res.success && res.translation) {
          this.evictIfNeeded();
          this.cache.set(analysisId, { translation: res.translation, showTranslated: true });
          this.translationChanged$.next(analysisId);
          return res.translation;
        }
        throw new Error('Translation failed');
      }),
      catchError(err => {
        console.error('Translation error:', err);
        throw err;
      })
    );
  }

  toggleOriginal(analysisId: string) {
    const cached = this.cache.get(analysisId);
    if (cached) {
      cached.showTranslated = !cached.showTranslated;
      this.translationChanged$.next(analysisId);
    }
  }

  showOriginal(analysisId: string) {
    const cached = this.cache.get(analysisId);
    if (cached) {
      cached.showTranslated = false;
      this.translationChanged$.next(analysisId);
    }
  }

  showTranslated(analysisId: string) {
    const cached = this.cache.get(analysisId);
    if (cached) {
      cached.showTranslated = true;
      this.translationChanged$.next(analysisId);
    }
  }

  /**
   * Apply a cached translation to an analysis object, returning a new object
   * with translated prose fields merged in. Original numeric/structural data is preserved.
   */
  applyTranslation(original: any, translation: any): any {
    if (!original || !translation) return original;

    return {
      ...original,
      overallAssessment: original.overallAssessment ? {
        ...original.overallAssessment,
        summary: translation.summary || original.overallAssessment.summary,
        progressFromLastLesson: translation.progressFromLastLesson || original.overallAssessment.progressFromLastLesson
      } : original.overallAssessment,
      studentSummary: translation.studentSummary || original.studentSummary,
      tutorNote: original.tutorNote ? {
        ...original.tutorNote,
        text: translation.tutorNoteText || original.tutorNote.text,
        quickImpression: translation.tutorNoteQuickImpression || original.tutorNote.quickImpression,
        homework: translation.tutorNoteHomework || original.tutorNote.homework
      } : original.tutorNote,
      strengths: translation.strengths?.length ? translation.strengths : original.strengths,
      areasForImprovement: translation.areasForImprovement?.length ? translation.areasForImprovement : original.areasForImprovement,
      recommendedFocus: translation.recommendedFocus?.length ? translation.recommendedFocus : original.recommendedFocus,
      suggestedExercises: translation.suggestedExercises?.length ? translation.suggestedExercises : original.suggestedExercises,
      homeworkSuggestions: translation.homeworkSuggestions?.length ? translation.homeworkSuggestions : original.homeworkSuggestions,
      topicsDiscussed: translation.topicsDiscussed?.length ? translation.topicsDiscussed : original.topicsDiscussed,
      topErrors: translation.topErrors?.length ? original.topErrors?.map((e: any, i: number) => ({
        ...e,
        issue: translation.topErrors[i]?.issue || e.issue,
        teachingPriority: translation.topErrors[i]?.teachingPriority || e.teachingPriority
      })) : original.topErrors,
      correctedExcerpts: translation.correctedExcerpts?.length ? original.correctedExcerpts?.map((e: any, i: number) => ({
        ...e,
        context: translation.correctedExcerpts[i]?.context || e.context,
        keyCorrections: translation.correctedExcerpts[i]?.keyCorrections || e.keyCorrections
      })) : original.correctedExcerpts,
      progressionMetrics: original.progressionMetrics ? {
        ...original.progressionMetrics,
        persistentChallenges: translation.persistentChallenges?.length ? translation.persistentChallenges : original.progressionMetrics.persistentChallenges,
        keyImprovements: translation.keyImprovements?.length ? translation.keyImprovements : original.progressionMetrics.keyImprovements
      } : original.progressionMetrics
    };
  }

  sanitizeHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
