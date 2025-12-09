import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';

export interface Notification {
  _id: string;
  userId: string;
  type: 'lesson_created' | 'message' | 'lesson_reminder' | 'lesson_cancelled' | 'class_invitation' | 'class_accepted' | 'office_hours_booking' | 'office_hours_starting' | 'lesson_analysis_ready';
  title: string;
  message: string;
  data: any;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  urgent?: boolean; // For time-sensitive office hours notifications
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private baseUrl = `${environment.backendUrl}/api/notifications`;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  getNotifications(): Observable<{ success: boolean; notifications: Notification[] }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; notifications: Notification[] }>(
      this.baseUrl,
      { headers }
    );
  }

  markAsRead(notificationId: string): Observable<{ success: boolean; notification: Notification }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; notification: Notification }>(
      `${this.baseUrl}/${notificationId}/read`,
      {},
      { headers }
    );
  }

  markAllAsRead(): Observable<{ success: boolean; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.baseUrl}/read-all`,
      {},
      { headers }
    );
  }

  getUnreadCount(): Observable<{ success: boolean; count: number }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; count: number }>(
      `${this.baseUrl}/unread-count`,
      { headers }
    );
  }
}

