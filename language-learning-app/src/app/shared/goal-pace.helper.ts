/**
 * Lightweight pace helper for goal + timeline UI surfaces.
 *
 * Mirrors the deterministic pieces of `backend/services/paceService.js` that
 * the frontend needs to decide whether to *recommend* the structured roadmap
 * or the unframed single-lessons path at goal pick time.
 *
 * Kept minimal on purpose — the AI-prompt / weeklyRecommendations / phaseCount
 * decisions stay on the backend. Here we only need:
 *   - weeksToTarget(goal)
 *   - recommendedMode(goal)
 *
 * Originated from the Saturday May 9 2026 discussion: an exam-prep student
 * with a fixed deadline ≤ 12 weeks out is often better served by focused
 * single lessons than by a chapter roadmap. Same logic applies to a
 * professional student with a presentation ≤ 4 weeks away.
 */

export type GoalType =
  | 'conversational'
  | 'exam_prep'
  | 'professional'
  | 'travel'
  | 'relocation'
  | 'other';

export type Timeline = 'specific_date' | 'few_months' | 'no_rush';

export interface PaceGoalInput {
  type?: GoalType | string | null;
  timeline?: Timeline | string | null;
  targetDate?: string | null;
}

export type RecommendedMode = 'plan' | 'single_lessons';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const EXAM_PREP_TIGHT_WEEKS = 12;
const PROFESSIONAL_TIGHT_WEEKS = 4;

/**
 * Coerce ion-datetime / API values to `YYYY-MM-DD` so pace math stays stable.
 * Ionic can emit ISO strings, date-only strings, or (less often) structured values.
 */
export function normalizeGoalTargetDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    const datePart = s.includes('T') ? (s.split('T')[0] as string) : s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  if (Array.isArray(raw) && raw.length >= 3) {
    const y = Number(raw[0]);
    const m = Number(raw[1]);
    const day = Number(raw[2]);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  if (typeof raw === 'object' && raw !== null && 'year' in raw && 'month' in raw && 'day' in raw) {
    const o = raw as { year: number; month: number; day: number };
    const y = Number(o.year);
    const m = Number(o.month);
    const day = Number(o.day);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

export function weeksToTarget(goal: PaceGoalInput | null | undefined): number | null {
  const nd = normalizeGoalTargetDate(goal?.targetDate as unknown);
  if (!nd) return null;
  const [yy, mm, dd] = nd.split('-').map(Number);
  const endOfDayUtc = Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999);
  const diff = endOfDayUtc - Date.now();
  if (diff <= 0) return 0;
  // Full weeks remaining (conservative vs round) so we do not drop the exam nudge at ~12.5 weeks.
  return Math.max(0, Math.floor(diff / MS_PER_WEEK));
}

export function recommendedMode(goal: PaceGoalInput | null | undefined): RecommendedMode {
  if (!goal?.type || !goal?.timeline) return 'plan';
  if (goal.timeline !== 'specific_date') return 'plan';
  const wk = weeksToTarget(goal);
  if (wk === null) return 'plan';
  // exam_prep + specific_date: always surface the nudge once the student has
  // committed to a date — the chapter roadmap is rarely the right shape for
  // an exam regardless of how far out the date is. Copy adapts to `weeks`.
  if (goal.type === 'exam_prep') return 'single_lessons';
  if (goal.type === 'professional' && wk <= PROFESSIONAL_TIGHT_WEEKS) return 'single_lessons';
  return 'plan';
}
