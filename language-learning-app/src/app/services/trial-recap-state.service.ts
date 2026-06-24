import { Injectable } from '@angular/core';

export type TrialLessonRating = 'great' | 'okay' | 'not_so_good';
export type TrialRecapStep = 'rating' | 'sorry' | 'book';

export interface TrialRecapState {
  rating: TrialLessonRating | null;
  steps: TrialRecapStep[];
  stepIndex: number;
  showFullAvailability: boolean;
  updatedAt: number;
}

/** Emitted when recap UI layout should update (subheader, centering). */
export interface TrialRecapLayoutState {
  step: TrialRecapStep;
  rating: TrialLessonRating | null;
  useAvailabilityPreview: boolean;
  showFullAvailabilityViewer: boolean;
  canGoBack: boolean;
}

const STORAGE_PREFIX = 'll-trial-recap:';

@Injectable({ providedIn: 'root' })
export class TrialRecapStateService {
  get(lessonId: string): TrialRecapState | null {
    if (!lessonId) return null;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + lessonId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as TrialRecapState;
      if (!parsed || !Array.isArray(parsed.steps)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save(lessonId: string, patch: Partial<TrialRecapState>): TrialRecapState {
    const prev = this.get(lessonId);
    const next: TrialRecapState = {
      rating: patch.rating !== undefined ? patch.rating : (prev?.rating ?? null),
      steps: patch.steps ?? prev?.steps ?? ['rating'],
      stepIndex: patch.stepIndex ?? prev?.stepIndex ?? 0,
      showFullAvailability: patch.showFullAvailability ?? prev?.showFullAvailability ?? false,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(STORAGE_PREFIX + lessonId, JSON.stringify(next));
    } catch {
      // Quota / private mode — non-fatal
    }
    return next;
  }

  clear(lessonId: string): void {
    try {
      localStorage.removeItem(STORAGE_PREFIX + lessonId);
    } catch {
      // ignore
    }
  }
}
