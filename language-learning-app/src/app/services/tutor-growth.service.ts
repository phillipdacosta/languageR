import { Injectable, NgZone } from '@angular/core';

export interface GrowthInsight {
  id: string;
  icon: string;
  text: string;
  route: string;
  priority: number;
}

export interface GrowthContext {
  hasAvailability: boolean;
  hasUpcomingLessons: boolean;
  tutorName: string;

  lessonsThisWeek: number;
  lessonsToday: number;
  completedToday: number;
  totalStudents: number;
  freeHoursThisWeek: number;
  nextGapHours: number;
  scheduleHash: string;

  pendingFeedbackCount: number;
  unreadMessages: number;

  materialCount: number;
  lastMaterialCreatedAt: string | null;
  totalMaterialViews: number;
  totalQuizAttempts: number;
  totalPurchases: number;

  hasUpcomingGroupClass: boolean;
  lastGroupClassAt: string | null;

  officeHoursEnabled: boolean;

  recentForumPostCount: number;
  activeForumThreadsInLanguage: number;

  tutorRating: string;
}

interface GrowthState {
  materialSnapshot: { views: number; quizAttempts: number; purchases: number } | null;
  materialNagStage: number;
  materialNagDismissedAt: number;
  groupClassDismissedAt: number;
  officeHoursScheduleHash: string;
  officeHoursDismissedAt: number;
  shareProfileDismissedAt: number;
  forumLastSeenAt: number;
  morningPrepDay: string;
  eveningRecapDay: string;
  dismissed: Record<string, number>;
}

const STORAGE_KEY = 'growth_state';
const DAY_MS = 86400000;

function emptyState(): GrowthState {
  return {
    materialSnapshot: null,
    materialNagStage: 0,
    materialNagDismissedAt: 0,
    groupClassDismissedAt: 0,
    officeHoursScheduleHash: '',
    officeHoursDismissedAt: 0,
    shareProfileDismissedAt: 0,
    forumLastSeenAt: 0,
    morningPrepDay: '',
    eveningRecapDay: '',
    dismissed: {},
  };
}

@Injectable({
  providedIn: 'root'
})
export class TutorGrowthService {
  private insights: GrowthInsight[] = [];
  private _allRaw: GrowthInsight[] = [];
  private _activeIndex = 0;
  private _rotationTimer: any = null;
  private _paused = false;
  private readonly ROTATION_MS = 30000;
  private _onUpdate: (() => void) | null = null;
  private _state: GrowthState = emptyState();

  constructor(private ngZone: NgZone) {}

  get activeInsight(): GrowthInsight | null {
    return this.insights.length > 0 ? this.insights[this._activeIndex] : null;
  }

  get allInsights(): GrowthInsight[] {
    return this.insights;
  }

  get activeIndex(): number {
    return this._activeIndex;
  }

  get count(): number {
    return this.insights.length;
  }

  get paused(): boolean {
    return this._paused;
  }

  setUpdateCallback(cb: () => void): void {
    this._onUpdate = cb;
  }

  private notifyUpdate(): void {
    this.ngZone.run(() => this._onUpdate?.());
  }

  // ─── Main entry point ───

  compute(ctx: GrowthContext): void {
    this._state = this.loadState();
    const now = Date.now();
    const hour = new Date().getHours();
    const today = this.dayKey();
    const raw: GrowthInsight[] = [];

    // ── Self-resolving: Set availability ──
    if (!ctx.hasAvailability) {
      raw.push({ id: 'set_availability', icon: '📅', text: 'Set your availability to start getting bookings', route: '/tabs/availability-setup', priority: 100 });
    }

    // ── Self-resolving: Pending feedback ──
    if (ctx.pendingFeedbackCount > 0) {
      const n = ctx.pendingFeedbackCount;
      raw.push({ id: 'pending_feedback', icon: '📝', text: `${n} pending feedback${n > 1 ? 's' : ''} — completing them boosts your ranking`, route: '/tabs/tab1', priority: 95 });
    }

    // ── Self-resolving: Unread messages ──
    if (ctx.unreadMessages > 0) {
      const n = ctx.unreadMessages;
      raw.push({ id: 'unread_messages', icon: '💬', text: `${n} unread message${n > 1 ? 's' : ''} — fast replies build student trust`, route: '/tabs/messages', priority: 90 });
    }

    // ── Delta-based: Forum activity ──
    if (ctx.activeForumThreadsInLanguage > 0) {
      const cooldown = now - this._state.forumLastSeenAt < 2 * DAY_MS;
      if (!cooldown) {
        const n = ctx.activeForumThreadsInLanguage;
        raw.push({ id: 'forum_active', icon: '💬', text: `${n} active thread${n > 1 ? 's' : ''} in your language — chime in to get noticed`, route: '/tabs/forum', priority: 72 });
      }
    }

    // ── Delta-based: Material stats (only when numbers increased) ──
    const snap = this._state.materialSnapshot;
    const dViews = ctx.totalMaterialViews - (snap?.views || 0);
    const dQuiz = ctx.totalQuizAttempts - (snap?.quizAttempts || 0);
    const dPurchases = ctx.totalPurchases - (snap?.purchases || 0);

    if (dViews > 0 || dQuiz > 0 || dPurchases > 0) {
      const parts: string[] = [];
      if (dViews > 0) parts.push(`${dViews} new view${dViews > 1 ? 's' : ''}`);
      if (dQuiz > 0) parts.push(`${dQuiz} new quiz attempt${dQuiz > 1 ? 's' : ''}`);
      if (dPurchases > 0) parts.push(`${dPurchases} new purchase${dPurchases > 1 ? 's' : ''}`);
      raw.push({ id: 'material_stats', icon: '📊', text: `Your materials: ${parts.join(', ')}`, route: '/tabs/tab1', priority: 55 });
    }

    // ── Escalating: Stale material / first material ──
    if (ctx.lastMaterialCreatedAt) {
      const daysSince = Math.floor((now - new Date(ctx.lastMaterialCreatedAt).getTime()) / DAY_MS);
      const stage = this._state.materialNagStage;
      const dismissedAt = this._state.materialNagDismissedAt;

      if (stage === 0 && daysSince >= 14) {
        raw.push({ id: 'create_material', icon: '📚', text: `It's been ${daysSince} days since your last material — new content drives profile views`, route: '/tabs/tab1', priority: 60 });
      } else if (stage === 1 && daysSince >= 30 && now - dismissedAt > 14 * DAY_MS) {
        raw.push({ id: 'create_material', icon: '📚', text: `${daysSince} days without new content — fresh material keeps students engaged`, route: '/tabs/tab1', priority: 58 });
      }
      // stage >= 2: permanently suppressed
    } else if (ctx.materialCount === 0 && ctx.totalStudents > 0) {
      const stage = this._state.materialNagStage;
      const dismissedAt = this._state.materialNagDismissedAt;

      if (stage === 0) {
        raw.push({ id: 'first_material', icon: '📚', text: 'Create your first material — students browse content before booking', route: '/tabs/tab1', priority: 62 });
      } else if (stage === 1 && now - dismissedAt > 14 * DAY_MS) {
        raw.push({ id: 'first_material', icon: '📚', text: 'Students look for content when choosing tutors — even one quiz helps', route: '/tabs/tab1', priority: 58 });
      }
    }

    // ── Schedule-aware: Office hours gap ──
    if (ctx.hasAvailability && !ctx.officeHoursEnabled) {
      const scheduleChanged = ctx.scheduleHash !== this._state.officeHoursScheduleHash;
      const cooldownOver = now - this._state.officeHoursDismissedAt > 7 * DAY_MS;

      if (scheduleChanged && cooldownOver && ctx.nextGapHours >= 2) {
        raw.push({ id: 'office_hours_gap', icon: '🕐', text: `${ctx.nextGapHours}h gap between your next lessons — office hours could fill it`, route: '/tabs/availability-setup', priority: 68 });
      } else if (cooldownOver && ctx.freeHoursThisWeek >= 6 && !this.isDismissedRecently('office_hours_free', 7)) {
        raw.push({ id: 'office_hours_free', icon: '🕐', text: `${ctx.freeHoursThisWeek} open hours this week — enable office hours for drop-in students`, route: '/tabs/availability-setup', priority: 65 });
      }
    }

    // ── Cooldown-based: Group class ──
    if (ctx.totalStudents >= 2 && !ctx.hasUpcomingGroupClass) {
      const cooldownOver = now - this._state.groupClassDismissedAt > 30 * DAY_MS;
      if (cooldownOver) {
        if (ctx.lastGroupClassAt) {
          const daysSince = Math.floor((now - new Date(ctx.lastGroupClassAt).getTime()) / DAY_MS);
          if (daysSince >= 30) {
            raw.push({ id: 'group_class', icon: '👥', text: `No group class in ${daysSince} days — your ${ctx.totalStudents} students could benefit from one`, route: '/tabs/tutor-calendar', priority: 50 });
          }
        } else {
          raw.push({ id: 'first_group_class', icon: '👥', text: `You have ${ctx.totalStudents} students — a group class is a great way to engage them`, route: '/tabs/tutor-calendar', priority: 48 });
        }
      }
    }

    // ── Day-scoped: Morning prep ──
    if (hour >= 5 && hour < 12 && ctx.lessonsToday > 0 && this._state.morningPrepDay !== today) {
      const n = ctx.lessonsToday;
      raw.push({ id: 'morning_prep', icon: '☀️', text: `${n} lesson${n > 1 ? 's' : ''} today — review your notes before they start`, route: '/tabs/tutor-calendar', priority: 42 });
    }

    // ── Day-scoped: Evening recap (skip if morning prep was already dismissed today) ──
    if (hour >= 17 && ctx.completedToday > 0 && this._state.eveningRecapDay !== today && this._state.morningPrepDay !== today) {
      const n = ctx.completedToday;
      raw.push({ id: 'evening_recap', icon: '✅', text: `${n} lesson${n > 1 ? 's' : ''} done today — great session${n > 1 ? 's' : ''}, ${ctx.tutorName}`, route: '/tabs/tutor-calendar', priority: 25 });
    }

    // ── Onboarding: Share profile (new tutors only) ──
    if (ctx.hasAvailability && !ctx.hasUpcomingLessons && ctx.totalStudents === 0) {
      const cooldownOver = now - this._state.shareProfileDismissedAt > 30 * DAY_MS;
      if (cooldownOver) {
        raw.push({ id: 'share_profile', icon: '🔗', text: 'Your profile is live — share the link to get your first booking', route: '/tabs/profile', priority: 54 });
      }
    }

    // ── Finalize ──

    this._allRaw = [...raw].sort((a, b) => b.priority - a.priority);

    const filtered = raw
      .filter(i => !this.isDismissedRecently(i.id, 5))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);

    this.insights = filtered;
    this._activeIndex = 0;
    this.startRotation();
  }

  // ── Interaction ──

  pause(): void {
    this._paused = true;
    this.stopRotation();
  }

  resume(): void {
    this._paused = false;
    this.startRotation();
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.insights.length) return;
    this._activeIndex = index;
    this.notifyUpdate();
    this.restartRotation();
  }

  next(): void {
    if (this.insights.length <= 1) return;
    this._activeIndex = (this._activeIndex + 1) % this.insights.length;
    this.notifyUpdate();
    this.restartRotation();
  }

  dismiss(insight: GrowthInsight): void {
    const now = Date.now();
    const today = this.dayKey();

    // Update state based on insight type
    switch (insight.id) {
      case 'material_stats':
        this._state.materialSnapshot = null;
        break;
      case 'create_material':
      case 'first_material':
        this._state.materialNagStage = Math.min(this._state.materialNagStage + 1, 2);
        this._state.materialNagDismissedAt = now;
        break;
      case 'group_class':
      case 'first_group_class':
        this._state.groupClassDismissedAt = now;
        break;
      case 'office_hours_gap':
      case 'office_hours_free':
        this._state.officeHoursDismissedAt = now;
        break;
      case 'share_profile':
        this._state.shareProfileDismissedAt = now;
        break;
      case 'forum_active':
        this._state.forumLastSeenAt = now;
        break;
      case 'morning_prep':
        this._state.morningPrepDay = today;
        break;
      case 'evening_recap':
        this._state.eveningRecapDay = today;
        break;
    }

    this._state.dismissed[insight.id] = now;
    this.saveState();

    this.insights = this.insights.filter(i => i.id !== insight.id);
    if (this._activeIndex >= this.insights.length) {
      this._activeIndex = 0;
    }
    this.notifyUpdate();
    if (this.insights.length <= 1) this.stopRotation();
  }

  /** Called when material_stats insight is shown — saves current totals as baseline */
  snapshotMaterialStats(views: number, quizAttempts: number, purchases: number): void {
    this._state.materialSnapshot = { views, quizAttempts, purchases };
    this.saveState();
  }

  /** Called when office_hours_gap insight is shown — saves schedule hash */
  snapshotScheduleHash(hash: string): void {
    this._state.officeHoursScheduleHash = hash;
    this.saveState();
  }

  getAllWithStatus(): { insight: GrowthInsight; dismissed: boolean; active: boolean }[] {
    const activeIds = new Set(this.insights.map(i => i.id));
    return this._allRaw.map(i => ({
      insight: i,
      dismissed: this.isDismissedRecently(i.id, 5),
      active: activeIds.has(i.id)
    }));
  }

  undismiss(insight: GrowthInsight): void {
    delete this._state.dismissed[insight.id];

    switch (insight.id) {
      case 'create_material':
      case 'first_material':
        this._state.materialNagStage = Math.max(this._state.materialNagStage - 1, 0);
        this._state.materialNagDismissedAt = 0;
        break;
      case 'group_class':
      case 'first_group_class':
        this._state.groupClassDismissedAt = 0;
        break;
      case 'office_hours_gap':
      case 'office_hours_free':
        this._state.officeHoursDismissedAt = 0;
        break;
      case 'share_profile':
        this._state.shareProfileDismissedAt = 0;
        break;
      case 'forum_active':
        this._state.forumLastSeenAt = 0;
        break;
      case 'morning_prep':
        this._state.morningPrepDay = '';
        break;
      case 'evening_recap':
        this._state.eveningRecapDay = '';
        break;
    }

    this.saveState();

    const activeIds = new Set(this.insights.map(i => i.id));
    if (!activeIds.has(insight.id)) {
      this.insights.push(insight);
      this.insights.sort((a, b) => b.priority - a.priority);
      if (this.insights.length > 1) this.restartRotation();
    }
    this.notifyUpdate();
  }

  destroy(): void {
    this.stopRotation();
    this._onUpdate = null;
  }

  // ── Private helpers ──

  private dayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;
  }

  private isDismissedRecently(id: string, days: number): boolean {
    const at = this._state.dismissed[id];
    if (!at) return false;
    return (Date.now() - at) < days * DAY_MS;
  }

  private loadState(): GrowthState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  private saveState(): void {
    try {
      // Prune dismissed entries older than 60 days
      const now = Date.now();
      for (const key of Object.keys(this._state.dismissed)) {
        if (now - this._state.dismissed[key] > 60 * DAY_MS) {
          delete this._state.dismissed[key];
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch { /* storage full */ }
  }

  private startRotation(): void {
    this.stopRotation();
    if (this.insights.length <= 1 || this._paused) return;

    this.ngZone.runOutsideAngular(() => {
      this._rotationTimer = setTimeout(() => {
        this._activeIndex = (this._activeIndex + 1) % this.insights.length;
        this.notifyUpdate();
        this.startRotation();
      }, this.ROTATION_MS);
    });
  }

  private stopRotation(): void {
    if (this._rotationTimer) {
      clearTimeout(this._rotationTimer);
      this._rotationTimer = null;
    }
  }

  private restartRotation(): void {
    this.stopRotation();
    this.startRotation();
  }
}
