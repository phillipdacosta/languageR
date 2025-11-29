import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, take, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface CreateClassRequest {
  name: string;
  description?: string;
  capacity: number;
  isPublic: boolean;
  thumbnail?: string;
  price?: number;
  startTime: string; // ISO
  endTime: string;   // ISO
  recurrence?: { type: 'none' | 'daily' | 'weekly' | 'monthly'; count: number };
  invitedStudentIds?: string[];
}

export interface ClassInvitation {
  _id: string;
  tutorId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
  };
  name: string;
  description?: string;
  capacity: number;
  price: number;
  startTime: string;
  endTime: string;
  invitedStudents: Array<{
    studentId: any;
    status: 'pending' | 'accepted' | 'declined';
    invitedAt: string;
    respondedAt?: string;
  }>;
  confirmedStudents: any[];
  attendees?: any[]; // Populated confirmed students
  invitationStats?: {
    total: number;
    accepted: number;
    pending: number;
    declined: number;
  };
}

@Injectable({ providedIn: 'root' })
export class ClassService {
  private apiUrl = `${environment.backendUrl}/api`;

  constructor(private http: HttpClient, private userService: UserService) {}

  createClass(payload: CreateClassRequest): Observable<{ success: boolean; classes: any[] }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; classes: any[] }>(`${this.apiUrl}/classes`, payload, { headers });
      })
    );
  }

  acceptInvitation(classId: string): Observable<{ success: boolean; class: any }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; class: any }>(`${this.apiUrl}/classes/${classId}/accept`, {}, { headers });
      })
    );
  }

  declineInvitation(classId: string): Observable<{ success: boolean; message: string }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/classes/${classId}/decline`, {}, { headers });
      })
    );
  }

  getPendingInvitations(): Observable<{ success: boolean; classes: ClassInvitation[] }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; classes: ClassInvitation[] }>(`${this.apiUrl}/classes/invitations/pending`, { headers });
      })
    );
  }

  getClassesForTutor(tutorId: string): Observable<{ success: boolean; classes: ClassInvitation[] }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; classes: ClassInvitation[] }>(`${this.apiUrl}/classes/tutor/${tutorId}`, { headers });
      })
    );
  }

  inviteStudentsToClass(classId: string, studentIds: string[]): Observable<{ success: boolean; message: string; newInvitationsCount: number }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; message: string; newInvitationsCount: number }>(
          `${this.apiUrl}/classes/${classId}/invite`,
          { studentIds },
          { headers }
        );
      })
    );
  }

  removeStudentFromClass(classId: string, studentId: string): Observable<{ success: boolean; message: string }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.delete<{ success: boolean; message: string }>(
          `${this.apiUrl}/classes/${classId}/student/${studentId}`,
          { headers }
        );
      })
    );
  }

  joinClass(classId: string, role: string, userId?: string): Observable<any> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<any>(
          `${this.apiUrl}/classes/${classId}/join`,
          { role, userId },
          { headers }
        );
      })
    );
  }

  getClass(classId: string): Observable<{ success: boolean; class: any }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; class: any }>(
          `${this.apiUrl}/classes/${classId}`,
          { headers }
        );
      })
    );
  }

  updateClass(classId: string, data: any): Observable<{ success: boolean; class: any }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; class: any }>(
      `${this.apiUrl}/classes/${classId}`,
      data,
      { headers }
    );
  }

  leaveClass(classId: string): Observable<{ success: boolean; message: string }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; message: string }>(
          `${this.apiUrl}/classes/${classId}/leave`,
          {},
          { headers }
        );
      })
    );
  }

  getAcceptedClasses(): Observable<{ success: boolean; classes: ClassInvitation[] }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; classes: ClassInvitation[] }>(
          `${this.apiUrl}/classes/student/accepted`,
          { headers }
        );
      })
    );
  }

  getPublicClasses(): Observable<{ success: boolean; classes: any[] }> {
    return this.userService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; classes: any[] }>(
          `${this.apiUrl}/classes/public/all`,
          { headers }
        );
      })
    );
  }
}


