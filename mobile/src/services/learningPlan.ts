import { api } from './api';

export type LessonPrepCorrectedExcerpt = {
  context?: string;
  original: string;
  corrected: string;
  keyCorrections?: string[];
};

export type LessonPrepTopError = {
  rank?: number;
  issue: string;
  impact?: 'low' | 'medium' | 'high';
  occurrences?: number;
  teachingPriority?: string;
};

export type LessonPrep = {
  plan: {
    _id: string;
    language: string;
    status: string;
    studentSummary: string;
    nextLessonFocus: string;
    currentPhaseIndex: number;
    totalPhases: number;
    currentPhase: {
      title: string;
      description: string;
      focusAreas: string[];
      suggestedTopics: string[];
      lessonsCompleted: number;
      estimatedLessons: number;
      masteryAverage: number | null;
      /** Set the first time a student edits any field on this phase. */
      studentEditedAt?: string | null;
    } | null;
  } | null;
  latestAnalysis: {
    lessonId: string | null;
    lessonDate: string | null;
    proficiencyLevel: string;
    summary: string;
    topErrors: LessonPrepTopError[];
    persistentChallenges: string[];
    proficiencyChange: 'improved' | 'maintained' | 'declined' | 'first_lesson' | null;
    correctedExcerpts: LessonPrepCorrectedExcerpt[];
  } | null;
  agenda: string[];
  /** 0 = first time the requesting tutor has taught this student in this language. */
  priorLessonCount?: number;
  firstTimePairing?: boolean;
  /** Anonymized first-name only — what other tutors have been working on. */
  otherTutorNotes?: Array<{ tutorFirstName: string; text: string; setAt: string }>;
};

export async function getLessonPrep(
  studentId: string,
  language: string,
): Promise<{ success: boolean; prep: LessonPrep | null }> {
  return api.get(
    `/learning-plan/student/${encodeURIComponent(studentId)}/${encodeURIComponent(language)}/lesson-prep`,
  );
}

// ── Edit-mode endpoints (student-driven plan ownership) ───────────────

export type AiRegenStatus = {
  used: number;
  remaining: number;
  limit: number;
  nextAvailableAt: string | null;
};

export type EditPermissions = {
  canEditPhases: boolean;
  canReorderLockedPhases: boolean;
  canRegenWithAi: boolean;
  isPremium: boolean;
  regen: AiRegenStatus;
};

export type PhaseEditUpdates = {
  title?: string;
  description?: string;
  focusAreas?: string[];
  suggestedTopics?: string[];
};

export async function getEditPermissions(
  language: string,
): Promise<{ success: boolean; permissions: EditPermissions }> {
  return api.get(`/learning-plan/${encodeURIComponent(language)}/edit-permissions`);
}

export async function editPhase(
  language: string,
  phaseIndex: number,
  updates: PhaseEditUpdates,
): Promise<{ success: boolean; plan: any }> {
  return api.put(
    `/learning-plan/${encodeURIComponent(language)}/phase/${phaseIndex}`,
    updates,
  );
}

export async function reorderPhases(
  language: string,
  fromIndex: number,
  toIndex: number,
): Promise<{ success: boolean; plan: any }> {
  return api.post(
    `/learning-plan/${encodeURIComponent(language)}/reorder-phases`,
    { fromIndex, toIndex },
  );
}

export async function regenerateWithAi(
  language: string,
  reason?: string,
): Promise<{ success: boolean; plan: any; regen: AiRegenStatus }> {
  return api.post(
    `/learning-plan/${encodeURIComponent(language)}/regenerate-ai`,
    { reason: reason || '' },
  );
}
