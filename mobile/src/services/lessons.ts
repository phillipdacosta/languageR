import { api } from './api';
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
  actualDurationMinutes?: number;
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

export interface TimelineEvent {
  lesson: Lesson;
  name: string;
  avatar: string | null;
  date: string;
  time: string;
  duration: number;
  statusLabel: string;
  statusClass: string;
  isToday: boolean;
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
  const [detail, payment, billing] = await Promise.all([
    lessonService.getLessonDetail(id),
    lessonService.getPaymentForLesson(id),
    lessonService.getBillingSummary(id),
  ]);
  const fp = lessonFingerprint(detail?.lesson || listLesson);
  const entry: CachedLessonDetail = { detail, payment, billing, fingerprint: fp };
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

  return upcoming.slice(0, 5).map(lesson => {
    const start = getLessonStart(lesson);
    const end = getLessonEnd(lesson);
    const isToday = start.toDateString() === now.toDateString();

    const otherPerson = lesson.tutorId?._id === userId ? lesson.studentId : lesson.tutorId;
    const name = otherPerson?.firstName
      ? `${otherPerson.firstName} ${(otherPerson.lastName || '').charAt(0)}.`
      : otherPerson?.name || 'Student';

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
      avatar: otherPerson?.picture || null,
      date: start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      duration: lesson.duration || 30,
      statusLabel: lesson.isTrialLesson ? 'Trial' : 'Scheduled',
      statusClass: lesson.isTrialLesson ? 'status-trial' : 'status-scheduled',
      isToday,
      isTrialLesson: lesson.isTrialLesson || false,
      countdown,
      timeRange: `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      dateTag: isToday ? 'Today' : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      subject: lesson.subject || lesson.language || '',
    };
  });
}
