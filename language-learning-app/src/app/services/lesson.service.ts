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
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
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
  
  // Per-minute billing tracking (for office hours)
  actualCallStartTime?: string;
  actualCallEndTime?: string;
  actualDurationMinutes?: number;
  actualPrice?: number;
  billingStatus?: 'pending' | 'authorized' | 'charged' | 'refunded' | null;
}

export interface LessonCreateRequest {
  tutorId: string;
  studentId: string;
  startTime: string;
  endTime: string;
  subject?: string;
  price: number;
  duration?: number;
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
  recordCallEnd(lessonId: string): Observable<{
    success: boolean;
    actualCallEndTime: string;
    actualDurationMinutes: number;
    actualPrice: number;
  }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{
      success: boolean;
      actualCallEndTime: string;
      actualDurationMinutes: number;
      actualPrice: number;
    }>(
      `${this.baseUrl}/${lessonId}/call-end`,
      {},
      { headers }
    );
  }

  // Alias for recordCallEnd
  endCall(lessonId: string): Observable<{
    success: boolean;
    actualCallEndTime: string;
    actualDurationMinutes: number;
    actualPrice: number;
  }> {
    return this.recordCallEnd(lessonId);
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
  getLessonsByTutor(tutorId: string, all: boolean = false): Observable<{ success: boolean; lessons: Lesson[] }> {
    const url = all ? `${this.baseUrl}/by-tutor/${tutorId}?all=true` : `${this.baseUrl}/by-tutor/${tutorId}`;
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
}