import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface Lesson {
  _id: string;
  tutorId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
  };
  studentId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
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

  constructor(private http: HttpClient, private userService: UserService) {}

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

  // Save tutor's supplementary note
  saveTutorNote(
    lessonId: string,
    note: { text: string; quickImpression: string; homework: string }
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

  // Get all lessons for current user
  getMyLessons(userId?: string): Observable<{ success: boolean; lessons: Lesson[] }> {
    const params: Record<string, string> = {};
    if (userId) {
      params['userId'] = userId;
    }
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; lessons: Lesson[] }>(`${this.baseUrl}/my-lessons`, { params, headers });
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
    
    // Allow joining if within time window and lesson is scheduled or in progress
    const withinTimeWindow = now >= earliestJoin && now <= latestJoin;
    const canJoinStatus = lesson.status === 'scheduled' || lesson.status === 'in_progress';
    
    return withinTimeWindow && canJoinStatus;
  }

  getTimeUntilJoin(lesson: Lesson, serverTime?: string): number {
    const now = serverTime ? new Date(serverTime) : new Date();
    const startTime = new Date(lesson.startTime);
    const earliestJoin = new Date(startTime.getTime() - 15 * 60000);
    
    return Math.max(0, Math.ceil((earliestJoin.getTime() - now.getTime()) / 1000));
  }

  formatTimeUntil(seconds: number): string {
    if (seconds <= 0) return 'Now';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return 'Less than 1m';
    }
  }

  // Update local lessons cache
  updateLessonsCache(lessons: Lesson[]): void {
    this.lessonsSubject.next(lessons);
  }

  // Get lessons from cache
  getCachedLessons(): Lesson[] {
    return this.lessonsSubject.value;
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