import { Injectable } from '@angular/core';

/**
 * Pure-data derivation of student-facing badges.
 *
 * Single source of truth for the gamification system. Both the
 * Progress page (`tab3`) and the home journey widget consume this
 * service so that "20 badges across 4 types" is defined once.
 *
 * Inputs are intentionally simple (sorted-newest-first analyses +
 * pre-computed skill averages) so the service stays decoupled from
 * HTTP, transcription, or learning-plan code. Callers are responsible
 * for fetching/loading their own analyses.
 */

export type BadgeType = 'lesson' | 'level' | 'streak' | 'skill';

export interface Badge {
  id: string;
  name: string;
  description: string;
  /** Ionicon name (no suffix). */
  icon: string;
  type: BadgeType;
  requirement: number | string;
  earned: boolean;
  earnedDate?: Date;
  /** Hex string used for backgrounds / tinted icons. */
  color: string;
}

/** Inputs strictly needed to compute the badge set. */
export interface BadgeInputs {
  /** All non-trial, non-quick-office-hours analyses for the student. */
  analyses: BadgeAnalysisLike[];
  /** Per-skill averages on a 0-100 scale (matches tab3 calculations). */
  averages?: {
    grammar?: number;
    fluency?: number;
    vocabulary?: number;
    pronunciation?: number;
    listening?: number;
  };
  /** Optional override; otherwise derived from `analyses`. */
  streak?: number;
}

/** Loose shape; matches what `/api/transcription/my-analyses` returns. */
export interface BadgeAnalysisLike {
  proficiencyLevel?: string;
  lessonDate?: string | Date;
}

const LEVEL_HIERARCHY: Record<string, number> = {
  A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6
};

@Injectable({ providedIn: 'root' })
export class GamificationService {
  /** Public so tab3 can keep its "X / total" counter unchanged. */
  readonly totalBadgeCount = 20;

  computeBadges(inputs: BadgeInputs): Badge[] {
    const analyses = inputs.analyses || [];
    const lessonCount = analyses.length;
    const streak = inputs.streak ?? this.computeStreak(analyses);
    const highestLevelNum = this.highestLevelNumber(analyses);

    const a = inputs.averages || {};
    const g = a.grammar ?? 0;
    const f = a.fluency ?? 0;
    const v = a.vocabulary ?? 0;
    const p = a.pronunciation ?? 0;
    const l = a.listening ?? 0;

    return [
      // ── Lesson milestones ───────────────────────────────────────
      { id: 'lesson-5',   name: 'Getting Started',   description: 'Complete 5 lessons',   icon: 'rocket',  type: 'lesson', requirement: 5,   earned: lessonCount >= 5,   color: '#3b82f6' },
      { id: 'lesson-10',  name: 'Committed Learner', description: 'Complete 10 lessons',  icon: 'school',  type: 'lesson', requirement: 10,  earned: lessonCount >= 10,  color: '#8b5cf6' },
      { id: 'lesson-25',  name: 'Dedicated Student', description: 'Complete 25 lessons',  icon: 'book',    type: 'lesson', requirement: 25,  earned: lessonCount >= 25,  color: '#06b6d4' },
      { id: 'lesson-50',  name: 'Rising Star',       description: 'Complete 50 lessons',  icon: 'star',    type: 'lesson', requirement: 50,  earned: lessonCount >= 50,  color: '#f59e0b' },
      { id: 'lesson-100', name: 'Language Master',   description: 'Complete 100 lessons', icon: 'trophy',  type: 'lesson', requirement: 100, earned: lessonCount >= 100, color: '#fbbf24' },

      // ── Level achievements ──────────────────────────────────────
      { id: 'level-a2', name: 'Breaking Through',       description: 'Reach A2 level', icon: 'trending-up',     type: 'level', requirement: 'A2', earned: highestLevelNum >= 2, color: '#f59e0b' },
      { id: 'level-b1', name: 'Intermediate Achiever',  description: 'Reach B1 level', icon: 'ribbon',          type: 'level', requirement: 'B1', earned: highestLevelNum >= 3, color: '#8b5cf6' },
      { id: 'level-b2', name: 'Advanced Learner',       description: 'Reach B2 level', icon: 'medal',           type: 'level', requirement: 'B2', earned: highestLevelNum >= 4, color: '#3b82f6' },
      { id: 'level-c1', name: 'Proficiency Master',     description: 'Reach C1 level', icon: 'shield-checkmark', type: 'level', requirement: 'C1', earned: highestLevelNum >= 5, color: '#22c55e' },
      { id: 'level-c2', name: 'Native-Level Legend',    description: 'Reach C2 level', icon: 'sparkles',        type: 'level', requirement: 'C2', earned: highestLevelNum >= 6, color: '#10b981' },

      // ── Streak / consistency ────────────────────────────────────
      { id: 'streak-7',   name: 'Week Warrior',       description: 'Complete lessons 7 days in a row',   icon: 'flame',   type: 'streak', requirement: 7,   earned: streak >= 7,   color: '#f97316' },
      { id: 'streak-14',  name: 'Two-Week Champion',  description: 'Complete lessons 14 days in a row',  icon: 'flame',   type: 'streak', requirement: 14,  earned: streak >= 14,  color: '#fb923c' },
      { id: 'streak-30',  name: 'Monthly Master',     description: 'Complete lessons 30 days in a row',  icon: 'trophy',  type: 'streak', requirement: 30,  earned: streak >= 30,  color: '#fbbf24' },
      { id: 'streak-60',  name: 'Consistency King',   description: 'Complete lessons 60 days in a row',  icon: 'diamond', type: 'streak', requirement: 60,  earned: streak >= 60,  color: '#a855f7' },
      { id: 'streak-100', name: 'Dedication Legend',  description: 'Complete lessons 100 days in a row', icon: 'star',    type: 'streak', requirement: 100, earned: streak >= 100, color: '#ec4899' },

      // ── Skill-specific (gated at 5+ lessons) ────────────────────
      { id: 'skill-grammar',       name: 'Grammar Guru',        description: '90%+ grammar average',       icon: 'create',      type: 'skill', requirement: 90, earned: lessonCount >= 5 && g >= 90, color: '#06b6d4' },
      { id: 'skill-vocabulary',    name: 'Vocabulary Virtuoso', description: '90%+ vocabulary average',    icon: 'albums',      type: 'skill', requirement: 90, earned: lessonCount >= 5 && v >= 90, color: '#8b5cf6' },
      { id: 'skill-pronunciation', name: 'Pronunciation Pro',   description: '90%+ pronunciation average', icon: 'mic',         type: 'skill', requirement: 90, earned: lessonCount >= 5 && p >= 90, color: '#3b82f6' },
      { id: 'skill-fluency',       name: 'Fluency Master',      description: '90%+ fluency average',       icon: 'chatbubbles', type: 'skill', requirement: 90, earned: lessonCount >= 5 && f >= 90, color: '#10b981' },
      {
        id: 'skill-allrounder',
        name: 'All-Rounder',
        description: '80%+ in all skills',
        icon: 'star-half',
        type: 'skill',
        requirement: 80,
        earned: lessonCount >= 5 && g >= 80 && v >= 80 && p >= 80 && f >= 80 && l >= 80,
        color: '#fbbf24'
      }
    ];
  }

  /**
   * Take the earned badges most worth surfacing in the journey widget's
   * compact disc stack. Order: streak first (proudest), then level, then
   * skill, then lesson count. Within a group, highest-tier first.
   */
  pickShowcaseBadges(badges: Badge[], limit = 5): Badge[] {
    const typeRank: Record<BadgeType, number> = {
      streak: 0,
      level: 1,
      skill: 2,
      lesson: 3
    };
    const idTier = (b: Badge) => {
      const n = parseInt(String(b.requirement), 10);
      return isFinite(n) ? -n : 0;
    };
    return badges
      .filter(b => b.earned)
      .sort((a, b) => {
        const t = typeRank[a.type] - typeRank[b.type];
        return t !== 0 ? t : idTier(a) - idTier(b);
      })
      .slice(0, limit);
  }

  computeStreak(analysesNewestFirst: BadgeAnalysisLike[]): number {
    if (!analysesNewestFirst || analysesNewestFirst.length === 0) return 0;
    const sorted = [...analysesNewestFirst]
      .filter(a => a.lessonDate)
      .sort((x, y) => new Date(y.lessonDate as any).getTime() - new Date(x.lessonDate as any).getTime());
    if (sorted.length === 0) return 0;

    let streak = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = new Date(sorted[i].lessonDate as any);
      cur.setHours(0, 0, 0, 0);
      const next = new Date(sorted[i + 1].lessonDate as any);
      next.setHours(0, 0, 0, 0);
      const diff = Math.floor((cur.getTime() - next.getTime()) / 86_400_000);
      if (diff === 1) streak++;
      else if (diff > 1) break;
    }
    return streak;
  }

  highestLevelNumber(analyses: BadgeAnalysisLike[]): number {
    let max = 0;
    for (const a of analyses || []) {
      const n = LEVEL_HIERARCHY[(a.proficiencyLevel || '').toUpperCase()] || 0;
      if (n > max) max = n;
    }
    return max;
  }
}
