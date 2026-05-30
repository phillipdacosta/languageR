import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

/**
 * Cached snapshot for a single lesson/class detail page.
 * Populated incrementally by the detail view as async pieces resolve, so the
 * next navigation to the same id can render instantly (no skeleton) while a
 * background revalidation runs.
 */
export interface CachedLessonDetailBundle {
  lesson: any | null;
  classData?: any | null;
  isClass: boolean;
  lessonsCompleted?: number;
  tutorStats?: { rating?: any; totalLessons?: number; students?: number };
  recentLessons?: { _id: string; subject: string; dateLabel: string; durationLabel: string }[];
  analysis?: any;
  analysisUnavailable?: boolean;
  feedback?: any;
  billing?: any;
  payment?: any;
  previousNotes?: any;
  paymentMethod?: { label: string; icon: string } | null;
  recommendedMaterials?: any[];
  recommendedStruggles?: string[];
  tutorMaterials?: any[];
  fingerprint: string;
  cachedAt: number;
}

const LESSON_DETAIL_TTL_MS = 10 * 60 * 1000;
const LESSON_DETAIL_MAX_ENTRIES = 50;

function lessonFingerprint(l: any): string {
  if (!l) return '';
  return [
    l.status,
    l?.tutorFeedback?.status,
    l?.tip?.amount,
    l?.cancelledAt,
    l?.actualDurationMinutes,
    l?.billingStatus,
    l?.rescheduleProposal?.status,
    l?.issueReported,
    l?.aiAnalysis?.status,
    l?.updatedAt,
  ].join('|');
}

export interface Lesson {
  _id: string;
  tutorId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
    nativeLanguage?: string;
    interfaceLanguage?: string;
  };
  studentId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
    nativeLanguage?: string;
    interfaceLanguage?: string;
  };
  startTime: string;
  endTime: string;
  channelName: string;
  status: 'scheduled' | 'confirmed' | 'in_progress' | 'ended_early' | 'completed' | 'cancelled' | 'pending_reschedule';
  subject: string;
  notes?: string;
  price: number;
  duration: number;
  isTrialLesson?: boolean;
  isOfficeHours?: boolean;
  officeHoursType?: 'quick' | 'scheduled' | null;
  bookingType?: 'scheduled' | 'instant' | 'office_hours';
  bookingData?: {
    selectedDate: string;
    selectedTime: string;
    timeRange: string;
  };
  participants?: {
    [userId: string]: {
      joinedAt?: Date | string;
      leftAt?: Date | string;
      joinCount?: number;
    };
  };
  createdAt: string;
  updatedAt: string;
  
  // Reschedule proposal tracking
  rescheduleProposal?: {
    proposedBy: string;
    proposedStartTime: string;
    proposedEndTime: string;
    proposedAt: string;
    status: 'pending' | 'accepted' | 'rejected';
  };
  
  // Class-specific properties (when lesson is actually a group class)
  isClass?: boolean;
  className?: string;
  attendees?: any[]; // Confirmed students attending the class
  capacity?: number;
  invitationStats?: {
    total: number;
    accepted: number;
    pending: number;
    declined: number;
  };
  classData?: any; // Full class data from backend
  cancelReason?: string;
  cancelReasonText?: string;
  cancelledBy?: 'tutor' | 'student' | 'system' | 'admin' | null;
  cancelledAt?: string;
  isLateCancellation?: boolean;
  cancellationFeeCharged?: number;

  requiresTutorFeedback?: boolean;
  aiAnalysisEnabledAtTime?: boolean | null;
  aiAnalysis?: {
    status?: string;
    hasAnalysis?: boolean;
    source?: string | null;
    overallAssessment?: { summary?: string };
    studentSummary?: string;
    progressionMetrics?: { keyImprovements?: string[] };
  };
  tutorNote?: { text?: string };
  tutorFeedback?: {
    status?: string;
    providedAt?: string;
    required?: boolean;
    overallNotes?: string;
  };

  /** Backend-enriched context for scheduled lessons — previous session summary. */
  lastSessionContext?: {
    isFirstLesson: boolean;
    previousLessonId?: string;
    summary?: string | null;
    recommendedFocus?: string[];
    areasForImprovement?: string[];
    summaryLanguage?: string;
    summaryTranslatable?: boolean;
  };
  
  // Issue Reporting & Investigation
  issueReported?: boolean;
  issueType?: 'tutor_no_show' | 'student_no_show' | 'ended_early' | 'poor_quality' | 'inappropriate' | 'technical' | 'other';
  issueDetails?: string;
  issueReportedAt?: string;
  underInvestigation?: boolean;
  investigationResolvedAt?: string;
  investigationResolution?: string;
  payoutPaused?: boolean;
  
  // Per-minute billing tracking (for office hours)
  actualCallStartTime?: string;
  actualCallEndTime?: string;
  actualDurationMinutes?: number;
  actualPrice?: number;
  billingStatus?: 'pending' | 'authorized' | 'charged' | 'refunded' | null;
  studentLessonIntent?: string;
  /** Net to tutor after platform fee */
  tutorPayout?: number;
}

export interface LessonCreateRequest {
  tutorId: string;
  studentId: string;
  startTime: string;
  endTime: string;
  subject?: string;
  price: number;
  duration?: number;
  /** Cover image URL when scheduling from the class flow (optional for API compatibility). */
  thumbnail?: string;
  bookingData?: {
    selectedDate: string;
    selectedTime: string;
    timeRange: string;
  };
}

export interface LessonJoinResponse {
  success: boolean;
  agora: {
    appId: string;
    channelName: string;
    token: string;
    uid: number;
  };
  lesson?: {
    id?: string;
    _id?: string;
    startTime: string;
    endTime: string;
    tutor: any;
    student: any;
    subject: string;
    aiAnalysisEnabledAtTime?: boolean | null;
  };
  class?: {
    id?: string;
    _id?: string;
    name?: string;
    description?: string;
    startTime: string;
    endTime: string;
    tutor: any;
    students?: any[];
    capacity?: number;
  };
  userRole: 'tutor' | 'student';
  serverTime: string;
}

export interface LessonStatusResponse {
  success: boolean;
  canJoin: boolean;
  timeUntilStart: number;
  timeUntilJoin: number;
  serverTime: string;
  lesson: {
    id: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  participant?: {
    joinedBefore: boolean;
    leftAfterJoin: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class LessonService {
  private baseUrl = `${environment.backendUrl}/api/lessons`;
  private lessonsSubject = new BehaviorSubject<Lesson[]>([]);
  public lessons$ = this.lessonsSubject.asObservable();

  /**
   * Per-lesson detail cache keyed by lesson/class id. Evicted on user change,
   * known mutations (cancel, reschedule), and a conservative TTL. The detail
   * page reads the cached bundle synchronously to skip its skeleton loader,
   * then revalidates in the background.
   */
  private detailCache = new Map<string, CachedLessonDetailBundle>();
  private lastCachedUserId: string | null = null;

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private translateService: TranslateService,
  ) {
    this.userService.currentUser$.subscribe((u) => {
      const uid = ((u as any)?._id ?? (u as any)?.id ?? null);
      const next = uid != null ? String(uid) : null;
      if (next !== this.lastCachedUserId) {
        this.detailCache.clear();
        this.lastCachedUserId = next;
      }
    });

    // Global invalidation: any caller dispatching `lesson-cancelled` or
    // `lesson-updated` with a lessonId in `detail` evicts that id.
    if (typeof window !== 'undefined') {
      const evict = (e: Event) => {
        const id = (e as CustomEvent)?.detail?.lessonId;
        if (id) this.detailCache.delete(id);
      };
      window.addEventListener('lesson-cancelled', evict as EventListener);
      window.addEventListener('lesson-updated', evict as EventListener);
    }
  }

  // Create a new lesson (called after checkout)
  createLesson(lessonData: LessonCreateRequest): Observable<{ success: boolean; lesson: Lesson }> {
    console.log('📅 Creating lesson:', lessonData);
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; lesson: Lesson }>(`${this.baseUrl}`, lessonData, { headers });
  }

  // Create office hours instant booking
  createOfficeHoursBooking(bookingData: {
    tutorId: string;
    duration: number;
    startTime?: string; // Optional - defaults to "now" if not provided
    instant?: boolean; // True if booking for immediate session
  }): Observable<{ success: boolean; lesson: Lesson }> {
    console.log('⚡ Creating office hours booking:', bookingData);
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; lesson: Lesson }>(
      `${this.baseUrl}/office-hours`,
      bookingData,
      { headers }
    );
  }

  // Record when the call actually starts (both parties connected)
  recordCallStart(lessonId: string): Observable<{ success: boolean; actualCallStartTime: string }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; actualCallStartTime: string }>(
      `${this.baseUrl}/${lessonId}/call-start`,
      {},
      { headers }
    );
  }

  // Record when the call ends and calculate actual billing
  recordCallEnd(
    lessonId: string,
    speakingTime?: { studentSeconds: number; tutorSeconds: number }
  ): Observable<{
    success: boolean;
    actualCallEndTime: string;
    actualDurationMinutes: number;
    actualPrice: number;
  }> {
    const headers = this.userService.getAuthHeadersSync();
    const body: any = {};
    if (speakingTime) {
      body.clientSpeakingSeconds = speakingTime;
    }
    return this.http.post<{
      success: boolean;
      actualCallEndTime: string;
      actualDurationMinutes: number;
      actualPrice: number;
    }>(
      `${this.baseUrl}/${lessonId}/call-end`,
      body,
      { headers }
    );
  }

  endCall(
    lessonId: string,
    speakingTime?: { studentSeconds: number; tutorSeconds: number }
  ): Observable<{
    success: boolean;
    actualCallEndTime: string;
    actualDurationMinutes: number;
    actualPrice: number;
  }> {
    return this.recordCallEnd(lessonId, speakingTime);
  }

  // Save tutor's supplementary note. Optional `capturedCorrections` are
  // pushed into the student's spaced-repetition deck server-side.
  saveTutorNote(
    lessonId: string,
    note: {
      text: string;
      quickImpression: string;
      homework: string;
      capturedCorrections?: Array<{ original: string; corrected: string; explanation?: string }>;
    }
  ): Observable<{ success: boolean; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; message: string }>(
      `${this.baseUrl}/${lessonId}/tutor-note`,
      note,
      { headers }
    );
  }

  // Get billing summary for a lesson
  getBillingSummary(lessonId: string): Observable<{
    success: boolean;
    billing: {
      estimatedPrice: number;
      actualPrice: number;
      estimatedDuration: number;
      actualDuration: number;
      status: string;
      callStartTime: string;
      callEndTime: string;
      isOfficeHours: boolean;
    };
  }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<any>(`${this.baseUrl}/${lessonId}/billing`, { headers });
  }

  // Get lessons by tutor ID (requires authentication)
  getLessonsByTutor(tutorId: string, all: boolean = false, startDate?: string, endDate?: string): Observable<{ success: boolean; lessons: Lesson[] }> {
    let url = `${this.baseUrl}/by-tutor/${tutorId}`;
    const params: string[] = [];
    
    if (all) {
      params.push('all=true');
    }
    if (startDate) {
      params.push(`startDate=${encodeURIComponent(startDate)}`);
    }
    if (endDate) {
      params.push(`endDate=${encodeURIComponent(endDate)}`);
    }
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }
    
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; lessons: Lesson[] }>(url, { headers });
  }

  /**
   * Current UI locale, normalized to a short code (e.g. `pt-BR` → `pt`).
   */
  getProseLang(): string {
    const raw = this.translateService.currentLang || this.translateService.defaultLang || '';
    return this.normalizeProseLang(raw);
  }

  private normalizeProseLang(raw: string | null | undefined): string {
    return (raw || '').toLowerCase().split(/[-_]/)[0].trim();
  }

  /** Keep in sync with backend `SUPPORTED_PROSE_LANGS` (lessons.js). */
  private static readonly SUPPORTED_PROSE_LANGS = new Set([
    'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'da', 'sv', 'no', 'fi',
    'pl', 'cs', 'ro', 'el', 'tr', 'ru', 'uk', 'he', 'ar', 'fa', 'hi',
    'th', 'vi', 'id', 'ms', 'ja', 'ko', 'zh',
  ]);

  isSupportedProseLang(lang: string | null | undefined): boolean {
    const norm = this.normalizeProseLang(lang);
    return !!norm && LessonService.SUPPORTED_PROSE_LANGS.has(norm);
  }

  /**
   * Language the user reads in — profile interface language, then native,
   * then durable local picks. Works for English UI users, German tutors, etc.
   */
  getProseReadingLanguage(): string {
    const user = this.userService.getCurrentUserValue();
    const fromProfile =
      this.normalizeProseLang(user?.interfaceLanguage) ||
      this.normalizeProseLang(user?.nativeLanguage);
    if (fromProfile) {
      return fromProfile;
    }

    if (typeof localStorage !== 'undefined') {
      const picked = localStorage.getItem('userLanguagePicked');
      const fromPick = this.normalizeProseLang(picked);
      if (fromPick) {
        return fromPick;
      }

      const stored = localStorage.getItem('userLanguage');
      const fromStored = this.normalizeProseLang(stored);
      if (fromStored) {
        return fromStored;
      }
    }

    return 'en';
  }

  /** Saved interface language from the user profile (not ephemeral UI toggles). */
  getSavedInterfaceProseLang(): string {
    const user = this.userService.getCurrentUserValue();
    const fromProfile = this.normalizeProseLang(user?.interfaceLanguage);
    if (fromProfile) {
      return fromProfile;
    }

    if (typeof localStorage !== 'undefined') {
      const picked = localStorage.getItem('userLanguagePicked');
      const fromPick = this.normalizeProseLang(picked);
      if (fromPick) {
        return fromPick;
      }

      const stored = localStorage.getItem('userLanguage');
      const fromStored = this.normalizeProseLang(stored);
      if (fromStored) {
        return fromStored;
      }
    }

    return '';
  }

  /** Whether opt-in prose translation is allowed for this user. */
  canTranslateProse(): boolean {
    return this.getProseTranslationTarget() !== null;
  }

  /**
   * Target language for lesson prose — the user's reading language.
   * English is valid (e.g. German tutor notes → English UI).
   */
  getProseTranslationTarget(): string | null {
    const lang = this.getProseReadingLanguage();
    if (!this.isSupportedProseLang(lang)) {
      return null;
    }
    return lang;
  }

  /**
   * Whether to offer a translate control for prose in a known source language.
   */
  shouldOfferProseTranslation(contentLanguage?: string | null): boolean {
    const target = this.getProseTranslationTarget();
    if (!target) {
      return false;
    }
    const source = this.normalizeProseLang(contentLanguage);
    if (!source) {
      return false;
    }
    return source !== target;
  }

  /** Profile language for a lesson participant (interface, then native). */
  getParticipantProseLang(participant?: {
    nativeLanguage?: string;
    interfaceLanguage?: string;
  } | null): string {
    return (
      this.normalizeProseLang(participant?.interfaceLanguage) ||
      this.normalizeProseLang(participant?.nativeLanguage) ||
      ''
    );
  }

  /** AI-generated / student-facing prose (analysis, plan, prep). */
  inferStudentFacingProseLang(lesson?: Pick<Lesson, 'studentId'> | null): string {
    const embedded = lesson?.studentId;
    if (embedded && typeof embedded === 'object') {
      const lang = this.getParticipantProseLang(embedded);
      if (lang) {
        return lang;
      }
    }
    return this.getProseReadingLanguage();
  }

  /** Tutor-authored prose (notes, feedback, manual assessment). */
  inferTutorAuthoredProseLang(lesson?: Pick<Lesson, 'tutorId'> | null): string {
    const embedded = lesson?.tutorId;
    if (embedded && typeof embedded === 'object') {
      return this.getParticipantProseLang(embedded);
    }
    return '';
  }

  /**
   * Lightweight sniff when author metadata matches the reader but the note
   * may still be in another language (e.g. English tutor, Spanish note).
   */
  sniffProseLangFromText(text?: string | null): string {
    const sample = (text || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    if (sample.length < 16) {
      return '';
    }

    const scores: Record<string, number> = {};
    const countWords = (lang: string, words: string[]) => {
      const re = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
      scores[lang] = (sample.match(re)?.length || 0);
    };

    countWords('es', ['el', 'la', 'los', 'las', 'de', 'que', 'en', 'un', 'una', 'por', 'con', 'para', 'está', 'muy', 'bien', 'lección', 'nota', 'alumno', 'practica', 'verbos', 'sesión']);
    countWords('en', ['the', 'and', 'you', 'was', 'were', 'with', 'this', 'that', 'lesson', 'good', 'great', 'need', 'should', 'practice', 'student', 'progress', 'review']);
    countWords('fr', ['le', 'la', 'les', 'des', 'une', 'dans', 'pour', 'avec', 'très', 'bien', 'leçon', 'élève']);
    countWords('de', ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'sehr', 'gut', 'schüler', 'lektion']);
    countWords('pt', ['não', 'uma', 'com', 'para', 'muito', 'bem', 'aula', 'aluno', 'prática']);

    if (/[ñ¿¡]/i.test(sample)) {
      scores['es'] = (scores['es'] || 0) + 2;
    }

    let best = '';
    let bestScore = 0;
    for (const [lang, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        best = lang;
      }
    }
    return bestScore >= 2 ? best : '';
  }

  /** Best-effort language for a tutor note on an analysis document. */
  inferTutorNoteProseLang(
    lesson: Pick<Lesson, 'tutorId'> | null | undefined,
    noteText?: string | null,
  ): string {
    const sniffed = this.sniffProseLangFromText(noteText);
    if (sniffed) {
      return sniffed;
    }
    return this.inferTutorAuthoredProseLang(lesson);
  }

  /** True when any known prose block differs from the reader's language. */
  shouldOfferProseTranslationForAnyBlock(languages: (string | null | undefined)[]): boolean {
    return languages.some((lang) => this.shouldOfferProseTranslation(lang));
  }

  // Get all lessons for current user
  getMyLessons(userId?: string): Observable<{ success: boolean; lessons: Lesson[] }> {
    const params: Record<string, string> = {};
    if (userId) {
      params['userId'] = userId;
    }
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; lessons: Lesson[] }>(`${this.baseUrl}/my-lessons`, { params, headers });
  }

  /**
   * On-demand translation of the previous-session prose ("Last session: …",
   * "First lesson with …", etc.) shown under an upcoming lesson card.
   * Result is cached server-side in LessonAnalysis.translations /
   * TutorFeedback.translations, so subsequent calls for the same
   * (lesson, language) pair never hit GPT again.
   */
  translateLessonContext(lessonId: string, targetLanguage: string): Observable<{
    success: boolean;
    hasTranslation: boolean;
    language?: string;
    summary?: string | null;
    recommendedFocus?: string[];
    areasForImprovement?: string[];
  }> {
    return this.http.post<any>(
      `${this.baseUrl}/${lessonId}/translate-context`,
      { targetLanguage },
    );
  }

  /** Translate all dynamic prose on the lesson detail page in one request. */
  translateLessonDetail(
    lessonId: string,
    targetLanguage: string,
    clientSections?: Record<string, unknown> | null,
  ): Observable<{
    success: boolean;
    language?: string;
    lastSession?: {
      summary?: string | null;
      recommendedFocus?: string[];
      areasForImprovement?: string[];
    } | null;
    analysis?: Record<string, unknown> | null;
    feedback?: Record<string, unknown> | null;
    client?: Record<string, unknown> | null;
  }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<any>(
      `${this.baseUrl}/${lessonId}/translate-detail`,
      { targetLanguage, clientSections: clientSections || undefined },
      { headers },
    );
  }

  // Get specific lesson details
  getLesson(lessonId: string): Observable<{ success: boolean; lesson: Lesson }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; lesson: Lesson }>(`${this.baseUrl}/${lessonId}`, { headers });
  }

  // Check if user can join lesson (without generating token)
  getLessonStatus(lessonId: string): Observable<LessonStatusResponse> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<LessonStatusResponse>(`${this.baseUrl}/${lessonId}/status`, { headers });
  }

  // Join lesson (generates Agora token if within time window)
  joinLesson(lessonId: string, role: 'tutor' | 'student', userId?: string): Observable<LessonJoinResponse> {
    const body = { role, userId };
    const headers = this.userService.getAuthHeadersSync();
    const url = `${this.baseUrl}/${lessonId}/join`;
    console.log('🚀🚀🚀 LessonService.joinLesson called 🚀🚀🚀');
    console.log('🚀 URL:', url);
    console.log('🚀 Body:', body);
    console.log('🚀 Headers:', headers);
    return this.http.post<LessonJoinResponse>(url, body, { headers });
  }

  // End lesson
  endLesson(lessonId: string, userId?: string): Observable<{ success: boolean; message: string }> {
    const body = userId ? { userId } : {};
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; message: string }>(`${this.baseUrl}/${lessonId}/end`, body, { headers });
  }

  // Update lesson status (cancel, reschedule, etc.)
  updateLessonStatus(lessonId: string, status: 'cancelled' | 'completed' | 'scheduled' | 'in_progress' | 'confirmed'): Observable<{ success: boolean; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.baseUrl}/${lessonId}/status`,
      { status },
      { headers }
    );
  }

  // Update lesson data (e.g., whiteboard room UUID)
  updateLesson(lessonId: string, data: any): Observable<{ success: boolean; lesson: Lesson }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; lesson: Lesson }>(
      `${this.baseUrl}/${lessonId}`,
      data,
      { headers }
    );
  }

  // Record that the current user left the lesson (but did not end it)
  leaveLesson(lessonId: string): Observable<{ success: boolean; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; message: string }>(`${this.baseUrl}/${lessonId}/leave`, {}, { headers });
  }

  // Helper methods for UI
  canJoinLesson(lesson: Lesson, serverTime?: string): boolean {
    const now = serverTime ? new Date(serverTime) : new Date();
    const startTime = new Date(lesson.startTime);
    const endTime = new Date(lesson.endTime);
    
    const earliestJoin = new Date(startTime.getTime() - 15 * 60000); // 15 minutes early
    const latestJoin = new Date(endTime.getTime() + 5 * 60000); // 5 minutes after end
    
    // Allow joining through the scheduled end window. If a participant leaves
    // early, the backend marks the lesson `ended_early`, but both users should
    // still be able to rejoin until the booked end time.
    const withinTimeWindow = now >= earliestJoin && now <= latestJoin;
    const canJoinStatus =
      lesson.status === 'scheduled' ||
      lesson.status === 'confirmed' ||
      lesson.status === 'in_progress' ||
      lesson.status === 'ended_early';
    
    return withinTimeWindow && canJoinStatus;
  }

  getTimeUntilJoin(lesson: Lesson, serverTime?: string): number {
    const now = serverTime ? new Date(serverTime) : new Date();
    const startTime = new Date(lesson.startTime);
    const earliestJoin = new Date(startTime.getTime() - 15 * 60000);
    
    return Math.max(0, Math.ceil((earliestJoin.getTime() - now.getTime()) / 1000));
  }

  /**
   * Human-readable time until the join window (or start). For waits ≥1 day,
   * shows days + hours (e.g. "2 days 4 hrs") instead of a large hour count.
   */
  formatTimeUntil(seconds: number): string {
    if (seconds <= 0) return 'Now';

    const days = Math.floor(seconds / 86400);
    const rem = seconds % 86400;
    const hours = Math.floor(rem / 3600);
    const minutes = Math.floor((rem % 3600) / 60);

    if (days > 0) {
      const dayPart = days === 1 ? '1 day' : `${days} days`;
      if (hours > 0) {
        const hrPart = hours === 1 ? '1 hr' : `${hours} hrs`;
        return `${dayPart} ${hrPart}`;
      }
      if (minutes > 0) {
        return `${dayPart} ${minutes} min`;
      }
      return dayPart;
    }
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return 'Less than 1m';
  }

  // Update local lessons cache
  updateLessonsCache(lessons: Lesson[]): void {
    this.lessonsSubject.next(lessons);
    this.reconcileDetailCacheWithList(lessons);
  }

  // Get lessons from cache
  getCachedLessons(): Lesson[] {
    return this.lessonsSubject.value;
  }

  /* ── Lesson-detail cache ────────────────────────────────────────── */

  /**
   * Return cached detail bundle for a lesson id, or null when missing/stale.
   * When `listLesson` is supplied (e.g. from the Lessons list), the cached
   * fingerprint must still match — otherwise we treat the entry as stale.
   */
  getCachedLessonDetail(id: string, listLesson?: Lesson): CachedLessonDetailBundle | null {
    const entry = this.detailCache.get(id);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > LESSON_DETAIL_TTL_MS) {
      this.detailCache.delete(id);
      return null;
    }
    if (listLesson && entry.fingerprint && lessonFingerprint(listLesson) !== entry.fingerprint) {
      this.detailCache.delete(id);
      return null;
    }
    return entry;
  }

  /**
   * Merge a partial bundle into the cache. Keeps fingerprint in sync when the
   * underlying lesson changes, and enforces a soft LRU cap to avoid growth.
   */
  updateCachedLessonDetail(id: string, patch: Partial<CachedLessonDetailBundle>): void {
    if (!id) return;
    const prev = this.detailCache.get(id);
    const merged: CachedLessonDetailBundle = {
      lesson: patch.lesson ?? prev?.lesson ?? null,
      classData: patch.classData ?? prev?.classData ?? null,
      isClass: patch.isClass ?? prev?.isClass ?? false,
      lessonsCompleted: patch.lessonsCompleted ?? prev?.lessonsCompleted,
      tutorStats: patch.tutorStats ?? prev?.tutorStats,
      recentLessons: patch.recentLessons ?? prev?.recentLessons,
      analysis: patch.analysis !== undefined ? patch.analysis : prev?.analysis,
      analysisUnavailable: patch.analysisUnavailable !== undefined
        ? patch.analysisUnavailable
        : prev?.analysisUnavailable,
      feedback: patch.feedback !== undefined ? patch.feedback : prev?.feedback,
      billing: patch.billing !== undefined ? patch.billing : prev?.billing,
      payment: patch.payment !== undefined ? patch.payment : prev?.payment,
      previousNotes: patch.previousNotes !== undefined ? patch.previousNotes : prev?.previousNotes,
      paymentMethod: patch.paymentMethod !== undefined ? patch.paymentMethod : prev?.paymentMethod,
      recommendedMaterials: patch.recommendedMaterials ?? prev?.recommendedMaterials,
      recommendedStruggles: patch.recommendedStruggles ?? prev?.recommendedStruggles,
      tutorMaterials: patch.tutorMaterials ?? prev?.tutorMaterials,
      fingerprint: patch.lesson
        ? lessonFingerprint(patch.lesson)
        : (prev?.fingerprint ?? (patch.classData ? 'class' : '')),
      cachedAt: Date.now(),
    };

    this.detailCache.delete(id); // re-insert to move to LRU tail
    this.detailCache.set(id, merged);
    if (this.detailCache.size > LESSON_DETAIL_MAX_ENTRIES) {
      const oldest = this.detailCache.keys().next().value;
      if (oldest) this.detailCache.delete(oldest);
    }
  }

  /** Evict one entry (when known-stale) or the whole cache. */
  clearDetailCache(id?: string): void {
    if (id) this.detailCache.delete(id);
    else this.detailCache.clear();
  }

  /**
   * When the lessons list changes, drop detail entries whose fingerprint no
   * longer matches the list copy — covers server-side status changes noticed
   * via a list refresh without an explicit invalidation call.
   */
  private reconcileDetailCacheWithList(lessons: Lesson[]): void {
    if (!this.detailCache.size) return;
    for (const l of lessons) {
      const id = (l as any)?._id;
      if (!id) continue;
      const entry = this.detailCache.get(id);
      if (!entry || !entry.fingerprint) continue;
      if (lessonFingerprint(l) !== entry.fingerprint) {
        this.detailCache.delete(id);
      }
    }
  }

  // Reschedule lesson to a new time
  rescheduleLesson(lessonId: string, newStartTime: string, newEndTime: string): Observable<{ success: boolean; lesson: Lesson; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    const body = {
      startTime: newStartTime,
      endTime: newEndTime
    };
    return this.http.put<{ success: boolean; lesson: Lesson; message: string }>(`${this.baseUrl}/${lessonId}/reschedule`, body, { headers });
  }

  // Propose a reschedule for a lesson
  proposeReschedule(lessonId: string, proposedStartTime: string, proposedEndTime: string): Observable<{ success: boolean; lesson: any; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    const body = {
      proposedStartTime,
      proposedEndTime
    };
    return this.http.post<{ success: boolean; lesson: any; message: string }>(`${this.baseUrl}/${lessonId}/propose-reschedule`, body, { headers });
  }

  // Respond to a reschedule proposal
  respondToReschedule(lessonId: string, accept: boolean): Observable<{ success: boolean; lesson: any; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    const body = { accept };
    return this.http.post<{ success: boolean; lesson: any; message: string }>(`${this.baseUrl}/${lessonId}/respond-reschedule`, body, { headers });
  }

  // Cancel a lesson with optional reason
  cancelLesson(lessonId: string, reasonId?: string, reasonText?: string): Observable<{ success: boolean; message: string; lesson: Lesson }> {
    const headers = this.userService.getAuthHeadersSync();
    
    // Build query params for cancellation reason
    let url = `${this.baseUrl}/${lessonId}/cancel`;
    const params: string[] = [];
    if (reasonId) {
      params.push(`reasonId=${encodeURIComponent(reasonId)}`);
    }
    if (reasonText) {
      params.push(`reasonText=${encodeURIComponent(reasonText)}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    
    console.log('🔴 [LESSON-SERVICE] Cancelling lesson - URL:', url, 'reasonId:', reasonId, 'reasonText:', reasonText);
    
    return this.http.delete<{ success: boolean; message: string; lesson: Lesson }>(
      url,
      { headers }
    );
  }

  // Get lessons by student ID (for checking availability conflicts)
  getLessonsByStudent(studentId: string, all: boolean = false): Observable<{ success: boolean; lessons: Lesson[] }> {
    const headers = this.userService.getAuthHeadersSync();
    const url = `${this.baseUrl}/student/${studentId}`;
    
    if (all) {
      return this.http.get<{ success: boolean; lessons: Lesson[] }>(url, { params: { all: 'true' }, headers });
    } else {
      return this.http.get<{ success: boolean; lessons: Lesson[] }>(url, { headers });
    }
  }

  // Get signed URL for audio playback
  getAudioSignedUrl(gcsPath: string): Observable<{ url: string }> {
    const headers = this.userService.getAuthHeadersSync();
    const transcriptionUrl = `${environment.backendUrl}/api/transcription`;
    return this.http.get<{ url: string }>(`${transcriptionUrl}/audio-url`, {
      params: { gcsPath },
      headers
    });
  }

  // Check if booking with a tutor would be a trial lesson
  checkTrialLesson(tutorId: string): Observable<{ success: boolean; isTrialLesson: boolean; previousLessons: number }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; isTrialLesson: boolean; previousLessons: number }>(
      `${this.baseUrl}/check-trial/${tutorId}`,
      { headers }
    );
  }

  getPopularSlots(timezone: string): Observable<PopularSlotsResponse> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<PopularSlotsResponse>(
      `${this.baseUrl}/popular-slots`,
      { headers, params: { timezone, days: '90' } }
    );
  }

  getPreviousNotes(lessonId: string): Observable<PreviousNotesResponse> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<PreviousNotesResponse>(
      `${this.baseUrl}/previous-notes/${lessonId}`,
      { headers }
    );
  }

  translateAnalysis(analysisId: string, targetLanguage: string): Observable<{ success: boolean; translation: any; cached: boolean }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; translation: any; cached: boolean }>(
      `${environment.backendUrl}/api/transcription/analysis/${analysisId}/translate`,
      { targetLanguage },
      { headers }
    );
  }
}

export interface PreviousNotesAnalysis {
  source?: string;
  tutorNote: { text: string; quickImpression: string; homework: string; addedAt: string } | null;
  overallAssessment: { summary: string; proficiencyLevel: string; progressFromLastLesson: string; confidence: number } | null;
  progressionMetrics: {
    persistentChallenges: string[];
    keyImprovements: string[];
    errorRate: number | null;
    errorRateChange: number | null;
    vocabularyGrowth: number | null;
    fluencyImprovement: number | null;
    grammarAccuracyChange: number | null;
    confidenceLevel: number | null;
    speakingTimeMinutes: number | null;
  } | null;
  strengths: string[];
  areasForImprovement: string[];
  topErrors: { rank: number; issue: string; impact: string; occurrences: number; teachingPriority: string }[];
  errorPatterns: {
    pattern: string;
    frequency: number;
    severity: string;
    examples: { original: string; corrected: string; explanation: string }[];
    practiceNeeded: string;
  }[];
  correctedExcerpts: { context: string; original: string; corrected: string; keyCorrections: string[] }[];
  grammarAnalysis: {
    accuracyScore: number;
    suggestions: string[];
    mistakeTypes: { type: string; frequency: number; severity: string; examples: string[] }[];
  } | null;
  fluencyAnalysis: {
    overallFluencyScore: number;
    speakingSpeed: string | null;
    pauseFrequency: string | null;
    fillerWords: { count: number; examples: string[] } | null;
  } | null;
  vocabularyAnalysis: {
    vocabularyRange: string;
    uniqueWordCount: number | null;
    suggestedWords: string[];
    advancedWordsUsed: string[];
  } | null;
  topicsDiscussed: string[];
  recommendedFocus: string[];
  suggestedExercises: string[];
  homeworkSuggestions: string[];
  studentSummary: string | null;
}

export interface PreviousNotesResponse {
  success: boolean;
  hasPreviousNotes: boolean;
  previousLessonId?: string;
  previousLessonDate?: string;
  previousLessonSubject?: string;
  analysisId?: string;
  analysis?: PreviousNotesAnalysis;
  translations?: Record<string, any>;
}

export interface PopularSlot {
  dayOfWeek: number; // 0=Sun … 6=Sat
  slotIndex: number; // 0–47 (30-min slots in a day)
  count: number;
  intensity: number; // 0–1 normalized
}

export interface PopularSlotsResponse {
  success: boolean;
  slots: PopularSlot[];
  threshold: number;
  maxCount: number;
  insufficientData: boolean;
}