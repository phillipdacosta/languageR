import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';

export interface Notification {
  _id: string;
  userId: string;
  type: 'lesson_created' | 'message' | 'lesson_reminder' | 'lesson_cancelled' | 'class_invitation' | 'class_accepted' | 'office_hours_booking' | 'office_hours_starting' | 'lesson_analysis_ready' | 'tutor_video_approved' | 'tutor_video_rejected';
  title: string;
  message: string;
  data: any;
  relatedUserPicture?: string;
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
  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();
  
  // Observable stream of notifications
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  public notifications$ = this.notificationsSubject.asObservable();

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  getNotifications(limit: number = 50, before?: string): Observable<{ success: boolean; notifications: Notification[] }> {
    const headers = this.userService.getAuthHeadersSync();
    let url = `${this.baseUrl}?limit=${limit}`;
    
    if (before) {
      url += `&before=${before}`;
    }
    
    return this.http.get<{ success: boolean; notifications: Notification[] }>(
      url,
      { headers }
    ).pipe(
      tap(response => {
        if (response.success) {
          // Update the BehaviorSubject with latest notifications
          this.notificationsSubject.next(response.notifications);
        }
      })
    );
  }

  markAsRead(notificationId: string): Observable<{ success: boolean; notification: Notification }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; notification: Notification }>(
      `${this.baseUrl}/${notificationId}/read`,
      {},
      { headers }
    ).pipe(
      tap(() => {
        // Reload count after marking as read
        this.refreshUnreadCount();
      })
    );
  }

  markAllAsRead(): Observable<{ success: boolean; message: string }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.baseUrl}/read-all`,
      {},
      { headers }
    ).pipe(
      tap(() => {
        // Immediately set count to 0 and refresh from server
        this.unreadCountSubject.next(0);
        this.refreshUnreadCount();
      })
    );
  }

  getUnreadCount(): Observable<{ success: boolean; count: number }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.get<{ success: boolean; count: number }>(
      `${this.baseUrl}/unread-count`,
      { headers }
    ).pipe(
      tap(response => {
        if (response.success) {
          this.unreadCountSubject.next(response.count);
        }
      })
    );
  }

  refreshUnreadCount(): void {
    this.getUnreadCount().subscribe();
  }
}

