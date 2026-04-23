import { api } from './api';
import { getClass, type MyClassRecord } from './classes';
import { buildMockCachedLessonDetail, isLessonMockId } from '../utils/lessonMockPreview';

export interface Lesson {
  _id: string;
  status: string;
  /** API returns startTime (same as web); scheduledTime kept for compatibility */
  startTime?: string;
  endTime?: string;
  scheduledTime?: string;
  duration: number;
  language?: string;
  subject?: string;
  studentId?: {
    _id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
    profilePicture?: string;
    email?: string;
    rating?: number;
    stats?: { lessonsCompleted?: number; averageRating?: number };
    onboardingData?: { bio?: string; summary?: string; languages?: any[]; experienceLevel?: string; goals?: string };
    nativeLanguage?: string;
    country?: string;
  };
  tutorId?: {
    _id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
    profilePicture?: string;
    email?: string;
    rating?: number;
    stats?: { lessonsCompleted?: number; averageRating?: number };
    onboardingData?: { bio?: string; summary?: string; languages?: any[]; hourlyRate?: number };
    nativeLanguage?: string;
    country?: string;
    linkedChannels?: any;
  };
  isClass?: boolean;
  className?: string;
  classData?: {
    thumbnail?: string;
    /** Long-form class copy (may contain simple HTML from the editor) */
    description?: string;
    name?: string;
  };
  attendees?: any[];
  capacity?: number;
  cancelReason?: string;
  cancelReasonText?: string;
  lastSessionContext?: {
    isFirstLesson: boolean;
    previousLessonId?: string;
    summary?: string | null;
    recommendedFocus?: string[];
    areasForImprovement?: string[];
  };
  rescheduleProposal?: {
    status?: string;
    proposedBy?: string;
  };
  isTrialLesson?: boolean;
  isTrial?: boolean;
  price?: number;
  /** Net to tutor after platform fee (from lesson / payment reconciliation) */
  tutorPayout?: number;
  tip?: { amount?: number };
  aiAnalysisEnabledAtTime?: boolean | null;
  actualDurationMinutes?: number;
  studentLessonIntent?: string;
  notes?: string;
  issueReported?: boolean;
  investigationResolvedAt?: string;
  requiresTutorFeedback?: boolean;
  aiAnalysis?: { status?: string; hasAnalysis?: boolean; overallAssessment?: { summary?: string }; studentSummary?: string; progressionMetrics?: { keyImprovements?: string[] } };
  tutorNote?: { text?: string };
  tutorFeedback?: { status?: string; overallNotes?: string; required?: boolean };
  isLateCancellation?: boolean;
  cancelledBy?: string;
  cancelledAt?: string;
  cancellationFeeCharged?: number;
  isOfficeHours?: boolean;
  description?: string;
  billingStatus?: string;
  actualPrice?: number;
  paymentMethod?: string;
  payoutPaused?: boolean;
  participants?: Record<string, any>;
}

interface MyLessonsResponse {
  success?: boolean;
  lessons?: Lesson[];
}

export interface PaymentData {
  status?: string;
  transferStatus?: string;
  amount?: number;
  refundAmount?: number;
  refundReason?: string;
  refundMethod?: string;
  refundedAt?: string;
  tutorPayout?: number;
  paymentMethod?: string;
}

export interface BillingData {
  estimatedPrice?: number;
  actualPrice?: number;
  estimatedDuration?: number;
  actualDuration?: number;
  status?: string;
  callStartTime?: string;
  callEndTime?: string;
  isOfficeHours?: boolean;
}

export interface LessonDetailResponse {
  success?: boolean;
  lesson?: Lesson;
  lessonsCompleted?: number;
  recentLessons?: { _id: string; subject?: string; startTime?: string; duration?: number }[];
  tutorStats?: { rating?: number; totalLessons?: number; students?: number };
}

/** Matches web `LessonJoinResponse` for Agora join. */
export interface LessonJoinResponse {
  success: boolean;
  agora: {
    appId: string;
    channelName: string;
    token: string;
    uid: number | string;
  };
  lesson?: {
    _id?: string;
    id?: string;
    startTime?: string;
    endTime?: string;
    tutor?: unknown;
    student?: unknown;
    subject?: string;
    aiAnalysisEnabledAtTime?: boolean | null;
  };
  class?: {
    _id?: string;
    id?: string;
    name?: string;
    startTime?: string;
    endTime?: string;
    tutor?: unknown;
    students?: unknown[];
  };
  userRole: 'tutor' | 'student';
  serverTime?: string;
}

/** Start time from API (web uses startTime; legacy clients may use scheduledTime). */
export function getLessonStart(lesson: Lesson): Date {
  const raw = lesson.startTime || lesson.scheduledTime;
  return raw ? new Date(raw) : new Date(NaN);
}

export function getLessonEnd(lesson: Lesson): Date {
  if (lesson.endTime) return new Date(lesson.endTime);
  const start = getLessonStart(lesson);
  if (Number.isNaN(start.getTime())) return start;
  return new Date(start.getTime() + (lesson.duration || 30) * 60000);
}

/** Match web `LessonService.canJoinLesson` — earliest join this many minutes before start. */
export const JOIN_WINDOW_MINUTES_BEFORE_START = 15;
/** Match web `LessonService.canJoinLesson` — join allowed until this many minutes after end. */
export const JOIN_WINDOW_MINUTES_AFTER_END = 5;

/** Web tab1 `isLessonInProgress`: clock between start and end (inclusive of end instant). */
export function isLessonInProgressSlot(lesson: Lesson, now: Date = new Date()): boolean {
  const start = getLessonStart(lesson);
  const end = getLessonEnd(lesson);
  const t0 = start.getTime();
  const t1 = end.getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return false;
  const n = now.getTime();
  return n >= t0 && n <= t1;
}

/** Align with backend lesson availability (`scheduled` | `confirmed` | `in_progress`) and list feeds that still surface `pending_reschedule`. */
function joinStatusAllowsToken(lesson: Lesson): boolean {
  const s = String(lesson.status || 'scheduled').toLowerCase();
  return (
    s === 'scheduled' ||
    s === 'confirmed' ||
    s === 'in_progress' ||
    s === 'pending_reschedule'
  );
}

/** Same time window + status rules as web `LessonService.canJoinLesson`. */
export function canJoinLessonByPolicy(lesson: Lesson, now: Date = new Date()): boolean {
  const start = getLessonStart(lesson);
  const end = getLessonEnd(lesson);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const earliestJoin = new Date(start.getTime() - JOIN_WINDOW_MINUTES_BEFORE_START * 60000);
  const latestJoin = new Date(end.getTime() + JOIN_WINDOW_MINUTES_AFTER_END * 60000);
  return now >= earliestJoin && now <= latestJoin && joinStatusAllowsToken(lesson);
}

/** Web tab1 `joinStudentLesson` gate: in scheduled slot by clock, or within join policy window. */
export function canUserJoinLessonNow(lesson: Lesson, now: Date = new Date()): boolean {
  return isLessonInProgressSlot(lesson, now) || canJoinLessonByPolicy(lesson, now);
}

export type JoinGateState = {
  canJoin: boolean;
  /** Seconds until 15-min-before window; 0 if can join or session ended */
  waitSeconds: number;
  /** True when current time is past the join deadline (end + grace). */
  sessionEnded: boolean;
};

export function getJoinGateState(lesson: Lesson | null | undefined, now: Date = new Date()): JoinGateState {
  if (!lesson || (!lesson.startTime && !lesson.scheduledTime)) {
    return { canJoin: false, waitSeconds: 0, sessionEnded: true };
  }
  if (lesson.status === 'cancelled') {
    return { canJoin: false, waitSeconds: 0, sessionEnded: true };
  }
  if (canUserJoinLessonNow(lesson, now)) {
    return { canJoin: true, waitSeconds: 0, sessionEnded: false };
  }
  const start = getLessonStart(lesson);
  const end = getLessonEnd(lesson);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { canJoin: false, waitSeconds: 0, sessionEnded: true };
  }
  const latestJoin = new Date(end.getTime() + JOIN_WINDOW_MINUTES_AFTER_END * 60000);
  if (now > latestJoin) {
    return { canJoin: false, waitSeconds: 0, sessionEnded: true };
  }
  const earliestJoin = new Date(start.getTime() - JOIN_WINDOW_MINUTES_BEFORE_START * 60000);
  const waitSeconds = Math.max(0, Math.ceil((earliestJoin.getTime() - now.getTime()) / 1000));
  return { canJoin: false, waitSeconds, sessionEnded: false };
}

/** Web `LessonService.formatTimeUntil` — label for “Join in …”. */
export function formatJoinWaitDuration(seconds: number): string {
  if (seconds <= 0) return 'Now';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return 'Less than 1m';
}

/** Web tab1 `getTimeUntilLesson` (future branch) — `time` in JOIN_NOT_READY_MSG. */
export function formatTimeUntilLessonStart(lesson: Lesson, now: Date = new Date()): string {
  const start = getLessonStart(lesson);
  const diffMs = start.getTime() - now.getTime();
  if (diffMs < 0) return 'soon';
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes <= 0) return 'NOW';
  const totalHours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    if (remainingHours > 0) return `${days}d ${remainingHours}h`;
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  if (totalHours > 0) {
    if (minutes > 0) return `${totalHours}h ${minutes}m`;
    return `${totalHours}h`;
  }
  return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
}

/** Faces for stacked avatars on timeline rows (e.g. group class attendees). */
export interface TimelineAvatarFace {
  picture: string | null;
  initials: string;
}

/** Max faces shown before a “+N” overflow ring (see `avatarStackOverflow`). */
export const TIMELINE_AVATAR_STACK_MAX = 6;

export interface TimelineEvent {
  lesson: Lesson;
  name: string;
  avatar: string | null;
  /** When set (e.g. group class with enrollments), list rows show overlapping avatars. */
  avatarStack?: TimelineAvatarFace[];
  /** When total attendees exceed `TIMELINE_AVATAR_STACK_MAX`, remaining count (shown as +N). */
  avatarStackOverflow?: number;
  date: string;
  time: string;
  duration: number;
  statusLabel: string;
  statusClass: string;
  isToday: boolean;
  isTomorrow: boolean;
  isTrialLesson: boolean;
  countdown: string;
  timeRange: string;
  dateTag: string;
  subject: string;
}

export interface CachedLessonDetail {
  detail: LessonDetailResponse | null;
  payment: PaymentData | null;
  billing: BillingData | null;
  fingerprint: string;
}

function lessonFingerprint(l: Lesson | undefined | null): string {
  if (!l) return '';
  return `${l.status}|${(l as any).tutorFeedback?.status}|${l.tip?.amount}|${l.cancelledAt}|${l.actualDurationMinutes}|${l.billingStatus}|${(l as any).rescheduleProposal?.status}|${l.issueReported}`;
}

const detailCache = new Map<string, CachedLessonDetail>();

export function getCachedLessonDetail(id: string, listLesson?: Lesson): CachedLessonDetail | null {
  const entry = detailCache.get(id);
  if (!entry) return null;
  if (listLesson && !isLessonMockId(id) && lessonFingerprint(listLesson) !== entry.fingerprint) return null;
  return entry;
}

export async function fetchAndCacheLessonDetail(
  id: string,
  listLesson?: Lesson,
  currentUserId?: string,
): Promise<CachedLessonDetail> {
  if (isLessonMockId(id)) {
    const entry = buildMockCachedLessonDetail(id, listLesson, currentUserId);
    detailCache.set(id, entry);
    return entry;
  }
  const isClass = !!(listLesson as { isClass?: boolean })?.isClass;
  const [detail, payment, billing, classRecord] = await Promise.all([
    lessonService.getLessonDetail(id),
    lessonService.getPaymentForLesson(id),
    lessonService.getBillingSummary(id),
    isClass ? getClass(id).catch((): null => null) : Promise.resolve(null as MyClassRecord | null),
  ]);
  /**
   * Group classes use the **Class** document id as `_id` (see HomeScreen / LessonsScreen
   * `classRecordToLesson`). `GET /lessons/:id` only resolves **Lesson** documents, so
   * it 404s for that id and `detail` is always null. Web event-details uses
   * `GET /classes/:id` for the same id — we do the same here and merge the full
   * `classData.description` (and other fields) into a synthetic `LessonDetailResponse`
   * so the overlay can show “About this class” like the screenshot.
   */
  let mergedDetail: LessonDetailResponse | null = detail;
  if (isClass && classRecord) {
    const list = (listLesson || {}) as Lesson;
    const fromList = (list as { classData?: { thumbnail?: string; description?: string; name?: string } }).classData;
    const classData: { thumbnail?: string; description?: string; name?: string } = {
      ...fromList,
    };
    if (classRecord.thumbnail || fromList?.thumbnail) {
      classData.thumbnail = (classRecord.thumbnail || fromList?.thumbnail) as string;
    }
    if (classRecord.description != null && String(classRecord.description).length > 0) {
      classData.description = String(classRecord.description);
    } else if (fromList?.description) {
      classData.description = fromList.description;
    }
    if (classRecord.name) {
      classData.name = classRecord.name;
    }
    const mergedLesson: Lesson = {
      ...list,
      ...(detail?.lesson || {}),
      isClass: true,
      className: classRecord.name || (list as { className?: string }).className,
      classData: Object.keys(classData).length > 0 ? classData : list.classData,
      startTime: classRecord.startTime || list.startTime,
      endTime: classRecord.endTime || list.endTime,
      duration: classRecord.duration ?? list.duration,
      price: classRecord.price ?? list.price,
      subject: classRecord.name || list.subject,
      capacity: classRecord.capacity ?? (list as { capacity?: number }).capacity,
      attendees: (classRecord as { confirmedStudents?: unknown[] }).confirmedStudents ?? (list as { attendees?: unknown[] }).attendees,
      tutorId: (classRecord.tutorId as Lesson['tutorId']) || list.tutorId,
    };
    mergedDetail = {
      success: true,
      lesson: mergedLesson,
      lessonsCompleted: detail?.lessonsCompleted,
      recentLessons: detail?.recentLessons,
      tutorStats: detail?.tutorStats,
    };
  } else if (isClass && !mergedDetail && listLesson) {
    mergedDetail = { success: true, lesson: listLesson as Lesson };
  }
  const fp = lessonFingerprint(mergedDetail?.lesson || listLesson);
  const entry: CachedLessonDetail = { detail: mergedDetail, payment, billing, fingerprint: fp };
  detailCache.set(id, entry);
  return entry;
}

export function clearDetailCache(id?: string) {
  if (id) detailCache.delete(id);
  else detailCache.clear();
}

export const lessonService = {
  async getMyLessons(): Promise<Lesson[]> {
    try {
      const data = await api.get<MyLessonsResponse>('/lessons/my-lessons');
      return data.lessons || [];
    } catch {
      return [];
    }
  },

  async getLesson(lessonId: string): Promise<Lesson | null> {
    try {
      const data = await api.get<LessonDetailResponse>(`/lessons/${lessonId}`);
      return data.lesson || null;
    } catch {
      return null;
    }
  },

  async getLessonDetail(lessonId: string): Promise<LessonDetailResponse | null> {
    try {
      const data = await api.get<LessonDetailResponse>(`/lessons/${lessonId}`);
      return data.success ? data : null;
    } catch {
      return null;
    }
  },

  async getPaymentForLesson(lessonId: string): Promise<PaymentData | null> {
    try {
      const data = await api.get<{ success: boolean; payment?: PaymentData }>(`/payments/lesson/${lessonId}`);
      return data.success && data.payment ? data.payment : null;
    } catch {
      return null;
    }
  },

  async getBillingSummary(lessonId: string): Promise<BillingData | null> {
    try {
      const data = await api.get<{ success: boolean; billing?: BillingData }>(`/lessons/${lessonId}/billing`);
      return data.success && data.billing ? data.billing : null;
    } catch {
      return null;
    }
  },

  async joinLesson(
    lessonId: string,
    role: 'tutor' | 'student',
    userId?: string,
  ): Promise<LessonJoinResponse | null> {
    try {
      const data = await api.post<LessonJoinResponse>(`/lessons/${lessonId}/join`, { role, userId });
      return data.success ? data : null;
    } catch {
      return null;
    }
  },

  async joinClass(
    classId: string,
    role: 'tutor' | 'student',
    userId?: string,
  ): Promise<LessonJoinResponse | null> {
    try {
      const data = await api.post<LessonJoinResponse>(`/classes/${classId}/join`, { role, userId });
      return data.success ? data : null;
    } catch {
      return null;
    }
  },

  async cancelLesson(
    lessonId: string,
    params?: { reasonId?: string; reasonText?: string },
  ): Promise<{ success: boolean; message?: string }> {
    const q = new URLSearchParams();
    if (params?.reasonId) q.set('reasonId', params.reasonId);
    if (params?.reasonText) q.set('reasonText', params.reasonText);
    const qs = q.toString();
    return api.delete(`/lessons/${encodeURIComponent(lessonId)}/cancel${qs ? `?${qs}` : ''}`);
  },

  /** Future lessons for a student (conflict detection for reschedule), aligned with web `getLessonsByStudent`. */
  async getLessonsByStudent(studentId: string, all = false): Promise<Lesson[]> {
    try {
      const qs = all ? '?all=true' : '';
      const data = await api.get<{ success?: boolean; lessons?: Lesson[] }>(
        `/lessons/student/${encodeURIComponent(studentId)}${qs}`,
      );
      return data.lessons || [];
    } catch {
      return [];
    }
  },

  async proposeReschedule(
    lessonId: string,
    proposedStartTime: string,
    proposedEndTime: string,
  ): Promise<{ success: boolean; message?: string; lesson?: Lesson }> {
    return api.post(`/lessons/${encodeURIComponent(lessonId)}/propose-reschedule`, {
      proposedStartTime,
      proposedEndTime,
    });
  },

  async leaveLesson(lessonId: string): Promise<void> {
    try {
      await api.post(`/lessons/${lessonId}/leave`, {});
    } catch {
      // non-fatal
    }
  },

  async leaveClass(classId: string): Promise<void> {
    try {
      await api.post(`/classes/${classId}/leave`, {});
    } catch {
      // non-fatal
    }
  },

  async updateLesson(lessonId: string, data: Record<string, unknown>): Promise<Lesson | null> {
    try {
      const res = await api.patch<{ success: boolean; lesson: Lesson }>(`/lessons/${lessonId}`, data);
      return res.lesson || null;
    } catch {
      return null;
    }
  },

  async getUpcomingLessons(): Promise<Lesson[]> {
    try {
      const all = await this.getMyLessons();
      const now = new Date();
      return all
        .filter(l => {
          if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') {
            return false;
          }
          const start = getLessonStart(l);
          const end = getLessonEnd(l);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
          if (start <= now && now < end) return true;
          return start > now;
        })
        .sort((a, b) => getLessonStart(a).getTime() - getLessonStart(b).getTime());
    } catch {
      return [];
    }
  },
};

function timelineAttendeeInitials(a: { name?: string; firstName?: string; lastName?: string }): string {
  const raw = `${a.firstName || ''} ${a.lastName || ''}`.trim() || (a.name || '').trim();
  if (!raw) return '?';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  return parts[0].charAt(0).toUpperCase();
}

/** Map a single lesson to a timeline row (same labels as “Coming Up” on Home). */
export function mapLessonToTimelineEvent(lesson: Lesson, userId: string, now: Date = new Date()): TimelineEvent {
  const start = getLessonStart(lesson);
  const end = getLessonEnd(lesson);
  const isToday = start.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = start.toDateString() === tomorrow.toDateString();
  const isClass = !!(lesson as any).isClass;

  let name: string;
  let avatar: string | null;
  let subject: string;
  let avatarStack: TimelineAvatarFace[] | undefined;
  let avatarStackOverflow: number | undefined;

  if (isClass) {
    name = (lesson as any).className || lesson.subject || 'Group Class';
    const thumb = (lesson as any).classData?.thumbnail || null;
    subject = 'Group Class';
    // Timeline / This Week rows use the class cover for visuals — not attendee avatars.
    avatar = thumb;
    avatarStack = undefined;
    avatarStackOverflow = undefined;
  } else {
    const otherPerson = lesson.tutorId?._id === userId ? lesson.studentId : lesson.tutorId;
    name = otherPerson?.firstName
      ? `${otherPerson.firstName} ${(otherPerson.lastName || '').charAt(0)}.`
      : otherPerson?.name || 'Student';
    avatar = otherPerson?.picture || null;
    subject = lesson.subject || lesson.language || '';
  }

  const diffMs = start.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  let countdown = '';
  if (diffMs > 0) {
    if (diffH > 24) countdown = `${Math.floor(diffH / 24)}d`;
    else if (diffH > 0) countdown = `${diffH}h ${diffM}m`;
    else countdown = `${diffM}m`;
  }

  return {
    lesson,
    name,
    avatar,
    avatarStack,
    avatarStackOverflow,
    date: start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    duration: lesson.duration || 30,
    statusLabel: lesson.isTrialLesson ? 'Trial' : 'Scheduled',
    statusClass: lesson.isTrialLesson ? 'status-trial' : 'status-scheduled',
    isToday,
    isTomorrow,
    isTrialLesson: lesson.isTrialLesson || false,
    countdown,
    timeRange: `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
    dateTag: isToday
      ? 'Today'
      : isTomorrow
        ? 'Tomorrow'
        : start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    subject,
  };
}

/** Build timeline rows for an arbitrary ordered list (e.g. “This week” lessons). */
export function buildTimelineEventsForLessons(lessons: Lesson[], userId: string): TimelineEvent[] {
  const now = new Date();
  return [...lessons]
    .sort((a, b) => getLessonStart(a).getTime() - getLessonStart(b).getTime())
    .map(lesson => mapLessonToTimelineEvent(lesson, userId, now));
}

export function buildTimelineEvents(lessons: Lesson[], userId: string): TimelineEvent[] {
  const now = new Date();

  const upcoming = lessons
    .filter(l => {
      if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') {
        return false;
      }
      const start = getLessonStart(l);
      const end = getLessonEnd(l);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
      if (start <= now && now < end) return true;
      return start > now;
    })
    .sort((a, b) => getLessonStart(a).getTime() - getLessonStart(b).getTime());

  return upcoming.slice(0, 5).map(lesson => mapLessonToTimelineEvent(lesson, userId, now));
}
