import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface LearningPlanPhase {
  title: string;
  description: string;
  focusAreas: string[];
  suggestedTopics: string[];
  exitCriteria: string;
  estimatedLessons: number;
  lessonsCompleted: number;
  status: 'locked' | 'active' | 'completed';
  completedAt?: string;
}

export interface LearningPlanGoal {
  type: 'conversational' | 'exam_prep' | 'professional' | 'travel' | 'relocation' | 'other';
  description: string;
  targetLevel: string;
  timeline: string;
  timelinePressure: 'specific_date' | 'few_months' | 'no_rush';
  targetDate?: string;
}

export interface TutorOverride {
  tutorId: string;
  tutorName: string;
  date: string;
  action: 'extend_phase' | 'advance_phase' | 'skip_phase' | 'adjust_focus' | 'add_note';
  note: string;
}

export interface LearningPlan {
  _id: string;
  studentId: string;
  language: string;
  goal: LearningPlanGoal;
  selfAssessedLevel: string;
  currentPhaseIndex: number;
  phases: LearningPlanPhase[];
  weeklyRecommendations: {
    lessonFrequency: string;
    selfStudyMinutes: number;
    focusBetweenLessons: string;
  };
  studentSummary: string;
  nextLessonFocus: string;
  history: Array<{
    date: string;
    lessonId?: string;
    changeDescription: string;
    phaseIndexBefore: number | null;
    phaseIndexAfter: number | null;
  }>;
  tutorOverrides: TutorOverride[];
  lastUpdatedAt: string;
  lastGoalChangedAt: string;
  status: 'draft' | 'active' | 'completed' | 'paused';
}

export interface LearningPlanSummary {
  _id: string;
  language: string;
  status: string;
  goal: LearningPlanGoal;
  currentPhaseIndex: number;
  totalPhases: number;
  currentPhase: LearningPlanPhase | null;
  studentSummary: string;
  nextLessonFocus: string;
  tutorOverrides: TutorOverride[];
  selfAssessedLevel: string;
}

export const GOAL_TYPE_LABELS: Record<string, string> = {
  conversational: 'Become conversational',
  exam_prep: 'Prepare for an exam',
  professional: 'Use it for work',
  travel: 'Travel and get by',
  relocation: 'Moving to a new country',
  other: 'Custom goal'
};

export const LEVEL_LABELS: Record<string, string> = {
  complete_beginner: 'Complete beginner',
  some_basics: 'I know some basics',
  simple_conversations: 'I can hold simple conversations',
  intermediate: "I'm intermediate, want to improve",
  advanced: "I'm advanced, refining skills"
};

@Injectable({
  providedIn: 'root'
})
export class LearningPlanService {
  private apiUrl = `${environment.backendUrl}/api/learning-plan`;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  getPlan(language: string): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/${encodeURIComponent(language)}`,
          { headers }
        );
      })
    );
  }

  getStudentPlan(studentId: string, language: string): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/student/${studentId}/${encodeURIComponent(language)}`,
          { headers }
        );
      })
    );
  }

  getStudentPlanSummary(studentId: string): Observable<{ success: boolean; summaries: LearningPlanSummary[] }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; summaries: LearningPlanSummary[] }>(
          `${this.apiUrl}/student/${studentId}/summary`,
          { headers }
        );
      })
    );
  }

  updateGoal(language: string, goal: Partial<LearningPlanGoal>): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/goal`,
          { language, goal },
          { headers }
        );
      })
    );
  }

  submitTutorOverride(override: {
    studentId: string;
    language: string;
    action: string;
    note?: string;
  }): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/tutor-override`,
          override,
          { headers }
        );
      })
    );
  }
}
