import { api } from './api';

/**
 * Spaced-repetition review deck. Mirrors the web's
 * `language-learning-app/src/app/services/review-deck.service.ts`.
 *
 * Cards are auto-populated server-side from `LessonAnalysis.correctedExcerpts`
 * after every analyzed lesson, and from any corrections a tutor explicitly
 * captures in the post-lesson note modal.
 */

export type ReviewDeckErrorType =
  | 'grammar'
  | 'vocabulary'
  | 'pronunciation'
  | 'tense'
  | 'preposition'
  | 'agreement'
  | 'spelling'
  | 'word_choice'
  | 'other';

export type ReviewDeckItem = {
  _id: string;
  userId: string;
  language: string;
  original: string;
  corrected: string;
  explanation?: string;
  context?: string;
  errorType: ReviewDeckErrorType;
  savedAt: string;
  mastered: boolean;
  reviewCount: number;
  lastReviewedAt?: string;
  lessonId?: string;
  analysisId?: string;
  // Virtuals from the backend (when toJSON virtuals are enabled).
  needsReview?: boolean;
  nextReviewAt?: string | null;
};

export type ReviewQuality = 'again' | 'good' | 'easy';

export async function getDueItems(
  options: { limit?: number; language?: string } = {},
): Promise<{ items: ReviewDeckItem[] }> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.language) params.set('language', options.language);
  const qs = params.toString();
  return api.get(`/review-deck/needs-review${qs ? `?${qs}` : ''}`);
}

export async function getDueCount(language?: string): Promise<{ count: number }> {
  const qs = language ? `?language=${encodeURIComponent(language)}` : '';
  return api.get(`/review-deck/needs-review/count${qs}`);
}

export async function getStats(): Promise<{
  total: number;
  mastered: number;
  notMastered: number;
  needsReview: number;
  byErrorType: Record<string, number>;
}> {
  return api.get('/review-deck/stats');
}

export async function markReviewed(
  id: string,
  quality: ReviewQuality = 'good',
): Promise<{ message: string; item: ReviewDeckItem }> {
  return api.put(`/review-deck/${encodeURIComponent(id)}/review`, { quality });
}

export async function toggleMastered(
  id: string,
): Promise<{ message: string; item: ReviewDeckItem }> {
  return api.put(`/review-deck/${encodeURIComponent(id)}/mastered`, {});
}

export async function deleteItem(id: string): Promise<{ message: string }> {
  return api.delete(`/review-deck/${encodeURIComponent(id)}`);
}
