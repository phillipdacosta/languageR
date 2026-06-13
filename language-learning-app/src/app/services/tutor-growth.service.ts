import { Injectable, NgZone } from '@angular/core';

/** 3D PNG icons for the welcome growth ticker (transparent background). */
export const GROWTH_TICKER_ICONS = {
  warning: 'assets/icons/growth/warning.png',
  hourglass: 'assets/icons/growth/hourglass.png',
  feedback: 'assets/icons/growth/more.png',
  message: 'assets/icons/growth/message-dark.png',
  forum: 'assets/icons/growth/message-light.png',
  material: 'assets/icons/growth/books.png',
  group: 'assets/icons/growth/group.png',
  sun: 'assets/icons/growth/sun.png',
  check: 'assets/icons/growth/check.png',
  availability: 'assets/icons/growth/more.png',
  share: 'assets/icons/growth/link.png',
  stats: 'assets/icons/growth/stats.png',
  calendarOpen: 'assets/icons/growth/calendar-open.png',
} as const;

/** Unique growth ticker icon paths — warm via ImagePreloadService so icons paint instantly. */
export const GROWTH_TICKER_ICON_URLS: readonly string[] = [
  ...new Set(Object.values(GROWTH_TICKER_ICONS)),
];

export interface GrowthInsight {
  id: string;
  /** @deprecated Use iconSrc; kept for legacy fallbacks. */
  icon?: string;
  /** PNG/WebP path for the ticker icon (preferred). */
  iconSrc?: string;
  messageKey: string;
  messageParams?: Record<string, string | number>;
  route: string;
  priority: number;
  /** Optional Lottie animation source; when set, the ticker renders it instead of `icon`. */
  lottieSrc?: string;
  /** When set, click triggers an in-page action instead of route navigation. */
  actionType?: 'reload_lessons';
  /** When true, ticker rotation is paused while this insight is active (and it pins to the top). */
  lockRotation?: boolean;
  /** When false, the ticker hides the dismiss (X) affordance. Defaults to true. */
  dismissable?: boolean;
}

export interface ProfileChecklistItem {
  id: string;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  done: boolean;
  /** Submitted by tutor but waiting on admin (or video) review — show orange, not green. */
  pendingReview?: boolean;
  route: string;
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

  /** Any past, non-cancelled session (ended before now) — 1:1 or class. */
  hasEverHadBooking: boolean;

  hasCustomPhoto: boolean;
  hasVideo: boolean;
  videoApproved: boolean;
  /** Combined upload state — kept for legacy growth-insight rules. */
  credentialsComplete: boolean;
  /** Combined admin-approved state — kept for legacy growth-insight rules. */
  credentialsApproved: boolean;
  /** True when manual identity step applies (PayPal/manual/Stripe-disabled). */
  identityRequired: boolean;
  /** Government-ID document uploaded by tutor. */
  governmentIdUploaded: boolean;
  /** Government-ID admin-approved OR Stripe Identity verified. */
  identitySatisfied: boolean;
  /** Teaching certifications uploaded. */
  certificationsUploaded: boolean;
  /** At least one teaching certification admin-approved. */
  certificationsApproved: boolean;
  hasPayoutSetup: boolean;
  tosComplete: boolean;
  tutorApproved: boolean;
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

/**
 * Map checklist row id to tutor approval wizard `steps[].id`
 * (photo, video, stripe, identity, qualifications, tos).
 *
 * The wizard's `seekToApprovalStepById` handles the case where the target
 * step is hidden (e.g. Stripe-verified tutors don't see `identity`) by
 * sliding forward to the next visible step.
 */
export function mapProfileChecklistIdToApprovalWizardStepId(checklistId: string): string {
  if (checklistId === 'payout') return 'stripe';
  if (checklistId === 'credentials') return 'identity'; // legacy alias
  return checklistId; // photo, video, identity, qualifications, tos pass through directly
}

/** Shared tutor profile checklist rows (home + calendar).
 *
 * Steps mirror the approval wizard order:
 *   photo → video → payout → identity → qualifications → tos
 *
 * Rules per row:
 * - `done` = the user-side action is complete (uploaded / accepted / configured).
 * - `*_PENDING` label = action complete but admin has not yet approved.
 * - `identity` row is hidden entirely when Stripe Connect handles KYC.
 *
 * Each row is evaluated INDEPENDENTLY: identity does not depend on
 * qualifications and vice-versa.
 */
export function buildTutorProfileChecklist(
  ctx: Pick<
    GrowthContext,
    | 'hasCustomPhoto'
    | 'hasVideo'
    | 'videoApproved'
    | 'identityRequired'
    | 'governmentIdUploaded'
    | 'identitySatisfied'
    | 'certificationsUploaded'
    | 'certificationsApproved'
    | 'hasPayoutSetup'
    | 'tosComplete'
  >
): ProfileChecklistItem[] {
  const items: ProfileChecklistItem[] = [];

  items.push({
    id: 'photo',
    labelKey: 'HOME.GROWTH.CHECKLIST_PHOTO',
    done: ctx.hasCustomPhoto,
    pendingReview: false,
    route: '/tutor-approval',
  });

  const videoPendingReview = ctx.hasVideo && !ctx.videoApproved;
  items.push({
    id: 'video',
    labelKey: videoPendingReview
      ? 'HOME.GROWTH.CHECKLIST_VIDEO_PENDING'
      : 'HOME.GROWTH.CHECKLIST_VIDEO',
    done: ctx.hasVideo,
    pendingReview: videoPendingReview,
    route: '/tabs/profile',
  });

  items.push({
    id: 'payout',
    labelKey: 'HOME.GROWTH.CHECKLIST_PAYOUT',
    done: ctx.hasPayoutSetup,
    pendingReview: false,
    route: '/tutor-approval',
  });

  // Hide manual identity row when Stripe Connect owns KYC for this tutor.
  if (ctx.identityRequired) {
    const identityActionDone = ctx.governmentIdUploaded;
    const identityPendingReview = identityActionDone && !ctx.identitySatisfied;
    items.push({
      id: 'identity',
      labelKey: identityPendingReview
        ? 'HOME.GROWTH.CHECKLIST_IDENTITY_PENDING'
        : 'HOME.GROWTH.CHECKLIST_IDENTITY',
      done: identityActionDone,
      pendingReview: identityPendingReview,
      route: '/tutor-approval',
    });
  }

  const qualificationsPendingReview =
    ctx.certificationsUploaded && !ctx.certificationsApproved;
  items.push({
    id: 'qualifications',
    labelKey: qualificationsPendingReview
      ? 'HOME.GROWTH.CHECKLIST_QUALIFICATIONS_PENDING'
      : 'HOME.GROWTH.CHECKLIST_QUALIFICATIONS',
    done: ctx.certificationsUploaded,
    pendingReview: qualificationsPendingReview,
    route: '/tutor-approval',
  });

  items.push({
    id: 'tos',
    labelKey: 'HOME.GROWTH.CHECKLIST_TOS',
    done: ctx.tosComplete,
    pendingReview: false,
    route: '/tutor-approval',
  });

  return items;
}

/** Rows that still need tutor action or are awaiting admin review. */
export function getOutstandingProfileChecklistItems(
  items: ProfileChecklistItem[]
): ProfileChecklistItem[] {
  return items.filter((item) => !item.done || item.pendingReview);
}

@Injectable({
  providedIn: 'root',
})
export class TutorGrowthService {
  private insights: GrowthInsight[] = [];
  private _allRaw: GrowthInsight[] = [];
  private _activeIndex = 0;
  private _rotationTimer: ReturnType<typeof setTimeout> | null = null;
  private _paused = false;
  private readonly ROTATION_MS = 30000;
  private _onUpdate: (() => void) | null = null;
  private _state: GrowthState = emptyState();
  /** True when the active insights include profile-critical items (photo, video, creds, payout). */
  hasProfileCritical = false;
  /** All outstanding profile checklist items (for inline display). */
  profileChecklist: ProfileChecklistItem[] = [];
  /** Sticky live-update insight (e.g. "3 new lessons booked — reload"). Kept across recomputes. */
  private _pendingUpdatesInsight: GrowthInsight | null = null;

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

    // ── Profile completion (non-dismissable, highest priority) ──
    if (!ctx.hasCustomPhoto) {
      raw.push({
        id: 'profile_photo',
        iconSrc: GROWTH_TICKER_ICONS.warning,
        messageKey: 'HOME.GROWTH.INSIGHT_PROFILE_PHOTO',
        route: '/tutor-approval',
        priority: 200,
      });
    }
    if (!ctx.hasVideo) {
      raw.push({
        id: 'profile_video',
        iconSrc: GROWTH_TICKER_ICONS.warning,
        messageKey: 'HOME.GROWTH.INSIGHT_PROFILE_VIDEO',
        route: '/tabs/profile',
        priority: 198,
      });
    } else if (!ctx.videoApproved) {
      raw.push({
        id: 'profile_video_pending',
        iconSrc: GROWTH_TICKER_ICONS.hourglass,
        messageKey: 'HOME.GROWTH.INSIGHT_VIDEO_PENDING',
        route: '/tabs/profile',
        priority: 110,
      });
    }
    if (!ctx.credentialsComplete) {
      raw.push({
        id: 'profile_credentials',
        iconSrc: GROWTH_TICKER_ICONS.warning,
        messageKey: 'HOME.GROWTH.INSIGHT_UPLOAD_CREDENTIALS',
        route: '/tutor-approval',
        priority: 196,
      });
    } else if (!ctx.credentialsApproved) {
      raw.push({
        id: 'profile_credentials_pending',
        iconSrc: GROWTH_TICKER_ICONS.hourglass,
        messageKey: 'HOME.GROWTH.INSIGHT_CREDENTIALS_PENDING',
        route: '/tutor-approval',
        priority: 108,
      });
    }
    if (!ctx.hasPayoutSetup) {
      raw.push({
        id: 'profile_payout',
        iconSrc: GROWTH_TICKER_ICONS.warning,
        messageKey: 'HOME.GROWTH.INSIGHT_CONNECT_PAYOUT',
        route: '/tutor-approval',
        priority: 194,
      });
    }

    this.profileChecklist = buildTutorProfileChecklist(ctx);

    // ── Self-resolving: Set availability (only if profile requirements are met) ──
    const hasProfileItems = !ctx.hasCustomPhoto || !ctx.hasVideo || !ctx.credentialsComplete || !ctx.hasPayoutSetup;
    if (!ctx.hasAvailability && !hasProfileItems) {
      raw.push({
        id: 'set_availability',
        iconSrc: GROWTH_TICKER_ICONS.availability,
        messageKey: 'HOME.GROWTH.INSIGHT_SET_AVAILABILITY',
        route: '/tabs/availability-setup',
        priority: 100,
      });
    }

    // ── Self-resolving: Pending feedback ──
    if (ctx.pendingFeedbackCount > 0) {
      const n = ctx.pendingFeedbackCount;
      raw.push({
        id: 'pending_feedback',
        iconSrc: GROWTH_TICKER_ICONS.feedback,
        messageKey:
          n === 1 ? 'HOME.GROWTH.INSIGHT_PENDING_FEEDBACK_ONE' : 'HOME.GROWTH.INSIGHT_PENDING_FEEDBACK_MANY',
        messageParams: n === 1 ? undefined : { count: n },
        route: '/tabs/tab1',
        priority: 95,
      });
    }

    // ── Self-resolving: Unread messages ──
    if (ctx.unreadMessages > 0) {
      const n = ctx.unreadMessages;
      raw.push({
        id: 'unread_messages',
        iconSrc: GROWTH_TICKER_ICONS.message,
        messageKey: n === 1 ? 'HOME.GROWTH.INSIGHT_UNREAD_ONE' : 'HOME.GROWTH.INSIGHT_UNREAD_MANY',
        messageParams: n === 1 ? undefined : { count: n },
        route: '/tabs/messages',
        priority: 90,
      });
    }

    // ── Delta-based: Forum activity ──
    if (ctx.activeForumThreadsInLanguage > 0) {
      const cooldown = now - this._state.forumLastSeenAt < 2 * DAY_MS;
      if (!cooldown) {
        const n = ctx.activeForumThreadsInLanguage;
        raw.push({
          id: 'forum_active',
          iconSrc: GROWTH_TICKER_ICONS.forum,
          messageKey: n === 1 ? 'HOME.GROWTH.INSIGHT_FORUM_ONE' : 'HOME.GROWTH.INSIGHT_FORUM_MANY',
          messageParams: n === 1 ? undefined : { count: n },
          route: '/tabs/forum',
          priority: 72,
        });
      }
    }

    // ── Delta-based: Material stats (only when numbers increased) ──
    const snap = this._state.materialSnapshot;
    const dViews = ctx.totalMaterialViews - (snap?.views || 0);
    const dQuiz = ctx.totalQuizAttempts - (snap?.quizAttempts || 0);
    const dPurchases = ctx.totalPurchases - (snap?.purchases || 0);

    if (dViews > 0 || dQuiz > 0 || dPurchases > 0) {
      raw.push(this.materialStatsInsight(dViews, dQuiz, dPurchases));
    }

    // ── Escalating: Stale material / first material ──
    if (ctx.lastMaterialCreatedAt) {
      const daysSince = Math.floor((now - new Date(ctx.lastMaterialCreatedAt).getTime()) / DAY_MS);
      const stage = this._state.materialNagStage;
      const dismissedAt = this._state.materialNagDismissedAt;

      if (stage === 0 && daysSince >= 14) {
        raw.push({
          id: 'create_material',
          iconSrc: GROWTH_TICKER_ICONS.material,
          messageKey: 'HOME.GROWTH.INSIGHT_CREATE_MATERIAL',
          messageParams: { days: daysSince },
          route: '/tabs/tab1',
          priority: 60,
        });
      } else if (stage === 1 && daysSince >= 30 && now - dismissedAt > 14 * DAY_MS) {
        raw.push({
          id: 'create_material',
          iconSrc: GROWTH_TICKER_ICONS.material,
          messageKey: 'HOME.GROWTH.INSIGHT_CREATE_MATERIAL_STALE',
          messageParams: { days: daysSince },
          route: '/tabs/tab1',
          priority: 58,
        });
      }
    } else if (ctx.materialCount === 0 && ctx.totalStudents > 0) {
      const stage = this._state.materialNagStage;
      const dismissedAt = this._state.materialNagDismissedAt;

      if (stage === 0) {
        raw.push({
          id: 'first_material',
          iconSrc: GROWTH_TICKER_ICONS.material,
          messageKey: 'HOME.GROWTH.INSIGHT_FIRST_MATERIAL',
          route: '/tabs/tab1',
          priority: 62,
        });
      } else if (stage === 1 && now - dismissedAt > 14 * DAY_MS) {
        raw.push({
          id: 'first_material',
          iconSrc: GROWTH_TICKER_ICONS.material,
          messageKey: 'HOME.GROWTH.INSIGHT_FIRST_MATERIAL_NUDGE',
          route: '/tabs/tab1',
          priority: 58,
        });
      }
    }

    // ── Schedule-aware: Office hours gap ──
    if (ctx.hasAvailability && !ctx.officeHoursEnabled) {
      const scheduleChanged = ctx.scheduleHash !== this._state.officeHoursScheduleHash;
      const cooldownOver = now - this._state.officeHoursDismissedAt > 7 * DAY_MS;

      if (scheduleChanged && cooldownOver && ctx.nextGapHours >= 2) {
        raw.push({
          id: 'office_hours_gap',
          iconSrc: GROWTH_TICKER_ICONS.hourglass,
          messageKey: 'HOME.GROWTH.INSIGHT_OFFICE_GAP',
          messageParams: { hours: ctx.nextGapHours },
          route: '/tabs/availability-setup',
          priority: 68,
        });
      } else if (cooldownOver && ctx.freeHoursThisWeek >= 6 && !this.isDismissedRecently('office_hours_free', 7)) {
        raw.push({
          id: 'office_hours_free',
          iconSrc: GROWTH_TICKER_ICONS.hourglass,
          messageKey: 'HOME.GROWTH.INSIGHT_OFFICE_FREE',
          messageParams: { hours: ctx.freeHoursThisWeek },
          route: '/tabs/availability-setup',
          priority: 65,
        });
      }
    }

    // ── Cooldown-based: Group class ──
    if (ctx.totalStudents >= 2 && !ctx.hasUpcomingGroupClass) {
      const cooldownOver = now - this._state.groupClassDismissedAt > 30 * DAY_MS;
      if (cooldownOver) {
        if (ctx.lastGroupClassAt) {
          const daysSince = Math.floor((now - new Date(ctx.lastGroupClassAt).getTime()) / DAY_MS);
          if (daysSince >= 30) {
            raw.push({
              id: 'group_class',
              iconSrc: GROWTH_TICKER_ICONS.group,
              messageKey: 'HOME.GROWTH.INSIGHT_GROUP_CLASS',
              messageParams: { days: daysSince, students: ctx.totalStudents },
              route: '/tabs/tutor-calendar',
              priority: 50,
            });
          }
        } else {
          raw.push({
            id: 'first_group_class',
            iconSrc: GROWTH_TICKER_ICONS.group,
            messageKey: 'HOME.GROWTH.INSIGHT_FIRST_GROUP_CLASS',
            messageParams: { students: ctx.totalStudents },
            route: '/tabs/tutor-calendar',
            priority: 48,
          });
        }
      }
    }

    // ── Day-scoped: Morning prep ──
    if (hour >= 5 && hour < 12 && ctx.lessonsToday > 0 && this._state.morningPrepDay !== today) {
      const n = ctx.lessonsToday;
      raw.push({
        id: 'morning_prep',
        iconSrc: GROWTH_TICKER_ICONS.sun,
        messageKey: n === 1 ? 'HOME.GROWTH.INSIGHT_MORNING_PREP_ONE' : 'HOME.GROWTH.INSIGHT_MORNING_PREP_MANY',
        messageParams: n === 1 ? undefined : { count: n },
        route: '/tabs/tutor-calendar',
        priority: 42,
      });
    }

    // ── Day-scoped: Evening recap (skip if morning prep was already dismissed today) ──
    if (hour >= 17 && ctx.completedToday > 0 && this._state.eveningRecapDay !== today && this._state.morningPrepDay !== today) {
      const n = ctx.completedToday;
      raw.push({
        id: 'evening_recap',
        iconSrc: GROWTH_TICKER_ICONS.check,
        messageKey: n === 1 ? 'HOME.GROWTH.INSIGHT_EVENING_RECAP_ONE' : 'HOME.GROWTH.INSIGHT_EVENING_RECAP_MANY',
        messageParams: n === 1 ? { name: ctx.tutorName } : { count: n, name: ctx.tutorName },
        route: '/tabs/tutor-calendar',
        priority: 25,
      });
    }

    // ── Onboarding: Share profile (tutors who have never had a completed/past session) ──
    if (ctx.hasAvailability && !ctx.hasUpcomingLessons && !ctx.hasEverHadBooking) {
      const cooldownOver = now - this._state.shareProfileDismissedAt > 30 * DAY_MS;
      if (cooldownOver) {
        raw.push({
          id: 'share_profile',
          iconSrc: GROWTH_TICKER_ICONS.hourglass,
          messageKey: 'HOME.GROWTH.INSIGHT_SHARE_PROFILE',
          route: '/tabs/profile',
          priority: 54,
        });
      }
    }

    // ── Finalize ──

    this._allRaw = [...raw].sort((a, b) => b.priority - a.priority);

    const profileInsightIds = new Set([
      'profile_photo',
      'profile_video',
      'profile_video_pending',
      'profile_credentials',
      'profile_credentials_pending',
      'profile_payout',
    ]);
    const filtered = raw
      .filter((i) => profileInsightIds.has(i.id) || !this.isDismissedRecently(i.id, 5))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);

    this.insights = filtered;
    this._activeIndex = 0;
    this.hasProfileCritical = filtered.some((i) => profileInsightIds.has(i.id));
    this.applyPendingUpdatesInsight();
    this.startRotation();
  }

  /**
   * Push a sticky "N new lessons booked — reload" insight to the top of the
   * ticker. While present, rotation is locked so the user can act on it.
   */
  setPendingUpdates(count: number): void {
    if (!count || count < 1) {
      this.clearPendingUpdates();
      return;
    }
    this._pendingUpdatesInsight = {
      id: 'pending_updates',
      icon: '',
      lottieSrc: '/assets/lottie/pending-updates.json',
      messageKey:
        count === 1
          ? 'HOME.GROWTH.INSIGHT_PENDING_UPDATES_ONE'
          : 'HOME.GROWTH.INSIGHT_PENDING_UPDATES_MANY',
      messageParams: count === 1 ? undefined : { count },
      route: '',
      priority: 10000,
      actionType: 'reload_lessons',
      lockRotation: true,
      dismissable: false,
    };
    this.applyPendingUpdatesInsight();
    this.stopRotation();
    this.notifyUpdate();
  }

  clearPendingUpdates(): void {
    if (!this._pendingUpdatesInsight) return;
    this._pendingUpdatesInsight = null;
    this.insights = this.insights.filter((i) => i.id !== 'pending_updates');
    if (this._activeIndex >= this.insights.length) this._activeIndex = 0;
    this.notifyUpdate();
    this.startRotation();
  }

  private applyPendingUpdatesInsight(): void {
    if (!this._pendingUpdatesInsight) return;
    this.insights = this.insights.filter((i) => i.id !== 'pending_updates');
    this.insights.unshift(this._pendingUpdatesInsight);
    this._activeIndex = 0;
  }

  private materialStatsInsight(dv: number, dq: number, dp: number): GrowthInsight {
    const bits = `${dv > 0 ? 'V' : ''}${dq > 0 ? 'Q' : ''}${dp > 0 ? 'P' : ''}`;
    const params: Record<string, number> = {};
    if (dv > 0) params['v'] = dv;
    if (dq > 0) params['q'] = dq;
    if (dp > 0) params['p'] = dp;
    return {
      id: 'material_stats',
      iconSrc: GROWTH_TICKER_ICONS.stats,
      messageKey: `HOME.GROWTH.MAT_STATS_${bits}`,
      messageParams: params,
      route: '/tabs/tab1',
      priority: 55,
    };
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
    // Lock the carousel onto the pending-updates insight while it's active.
    if (this.activeInsight?.lockRotation) return;
    this._activeIndex = index;
    this.notifyUpdate();
    this.restartRotation();
  }

  next(): void {
    if (this.insights.length <= 1) return;
    if (this.activeInsight?.lockRotation) return;
    this._activeIndex = (this._activeIndex + 1) % this.insights.length;
    this.notifyUpdate();
    this.restartRotation();
  }

  dismiss(insight: GrowthInsight): void {
    const now = Date.now();
    const today = this.dayKey();

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

    this.insights = this.insights.filter((i) => i.id !== insight.id);
    if (this._activeIndex >= this.insights.length) {
      this._activeIndex = 0;
    }
    this.notifyUpdate();
    if (this.insights.length <= 1) this.stopRotation();
  }

  snapshotMaterialStats(views: number, quizAttempts: number, purchases: number): void {
    this._state.materialSnapshot = { views, quizAttempts, purchases };
    this.saveState();
  }

  snapshotScheduleHash(hash: string): void {
    this._state.officeHoursScheduleHash = hash;
    this.saveState();
  }

  getAllWithStatus(): { insight: GrowthInsight; dismissed: boolean; active: boolean }[] {
    const activeIds = new Set(this.insights.map((i) => i.id));
    return this._allRaw.map((i) => ({
      insight: i,
      dismissed: this.isDismissedRecently(i.id, 5),
      active: activeIds.has(i.id),
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

    const activeIds = new Set(this.insights.map((i) => i.id));
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

  private dayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;
  }

  private isDismissedRecently(id: string, days: number): boolean {
    const at = this._state.dismissed[id];
    if (!at) return false;
    return Date.now() - at < days * DAY_MS;
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
      const now = Date.now();
      for (const key of Object.keys(this._state.dismissed)) {
        if (now - this._state.dismissed[key] > 60 * DAY_MS) {
          delete this._state.dismissed[key];
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch {
      /* storage full */
    }
  }

  private startRotation(): void {
    this.stopRotation();
    if (this.insights.length <= 1 || this._paused) return;
    // While a locked insight is active (e.g. pending lesson updates) we never rotate
    // — that surface is the highest-signal item the user has on the page.
    if (this.insights.some((i) => i.lockRotation)) return;

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
