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
  bookingData?: {
    selectedDate: string;
    selectedTime: string;
    timeRange: string;
  };
  createdAt: string;
  updatedAt: string;
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
  lesson: {
    id: string;
    startTime: string;
    endTime: string;
    tutor: any;
    student: any;
    subject: string;
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

  // Get lessons by tutor ID (public endpoint)
  getLessonsByTutor(tutorId: string, all: boolean = false): Observable<{ success: boolean; lessons: Lesson[] }> {
    const url = all ? `${this.baseUrl}/by-tutor/${tutorId}?all=true` : `${this.baseUrl}/by-tutor/${tutorId}`;
    return this.http.get<{ success: boolean; lessons: Lesson[] }>(url);
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
    console.log('📅 Attempting to join lesson:', { lessonId, role, userId });
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<LessonJoinResponse>(`${this.baseUrl}/${lessonId}/join`, body, { headers });
  }

  // End lesson
  endLesson(lessonId: string, userId?: string): Observable<{ success: boolean; message: string }> {
    const body = userId ? { userId } : {};
    const headers = this.userService.getAuthHeadersSync();
    return this.http.post<{ success: boolean; message: string }>(`${this.baseUrl}/${lessonId}/end`, body, { headers });
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
}