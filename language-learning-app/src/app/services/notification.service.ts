import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';

export interface Notification {
  _id: string;
  userId: string;
  type: 'lesson_created' | 'message' | 'lesson_reminder' | 'lesson_cancelled' | 'potential_student'
    | 'class_invitation' | 'class_accepted' | 'class_removed' | 'invitation_cancelled'
    | 'lesson_rescheduled' | 'reschedule_proposed' | 'reschedule_accepted' | 'reschedule_rejected'
    | 'office_hours_booking' | 'office_hours_starting' | 'office_hours_accepted'
    | 'lesson_analysis_ready' | 'class_cancelled' | 'class_auto_cancelled' | 'class_invitation_cancelled'
    | 'tutor_video_approved' | 'tutor_video_rejected'
    | 'payment_received' | 'lesson_refunded' | 'lesson_partial_refund' | 'payment_cancelled' | 'payment_reduced'
    | 'investigation_resolved' | 'dispute_submitted'
    | 'feedback_required' | 'tip_sent' | 'tip_received' | 'withdrawal_initiated'
    | 'lesson_completed' | 'feedback_reminder' | 'feedback_received'
    | 'progress_milestone' | 'credential_approved' | 'credential_rejected' | 'tutor_note_saved' | 'payout_paused'
    | 'material_approved' | 'material_rejected' | 'material_shared' | 'learning_plan_ready';
  title: string;
  message: string;
  data: any;
  relatedUserId?: string;
  relatedUserPicture?: string;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  urgent?: boolean; // For time-sensitive office hours notifications
}

interface NotificationCachePayload {
  userId: string;
  notifications: Notification[];
  savedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private static readonly STORAGE_KEY = 'barnabi.notifications.v1';

  private baseUrl = `${environment.backendUrl}/api/notifications`;
  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();

  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  public notifications$ = this.notificationsSubject.asObservable();

  private activeUserId: string | null = null;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {
    this.userService.currentUser$.subscribe(user => {
      this.setActiveUser(user?.auth0Id);
    });
  }

  /** Hydrate in-memory list from session cache for the signed-in user. */
  setActiveUser(auth0Id: string | null | undefined): void {
    const nextId = auth0Id?.trim() || null;
    if (nextId === this.activeUserId) {
      return;
    }

    this.activeUserId = nextId;
    if (!nextId) {
      this.notificationsSubject.next([]);
      return;
    }

    this.notificationsSubject.next(this.readStorageCache(nextId) ?? []);
  }

  hasCachedNotifications(): boolean {
    return this.notificationsSubject.value.length > 0;
  }

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
          this.commitNotifications(response.notifications);
        }
      })
    );
  }

  /**
   * Merge a websocket payload immediately (before API refresh completes).
   * Returns true when the payload was applied to the live list + cache.
   */
  ingestRealtimeNotification(payload: unknown): boolean {
    const notification = this.coerceNotification(payload);
    if (!notification?._id) {
      return false;
    }

    const current = this.notificationsSubject.value;
    const existingIdx = current.findIndex(n => n._id === notification._id);
    let next: Notification[];

    if (existingIdx >= 0) {
      next = [...current];
      next[existingIdx] = { ...next[existingIdx], ...notification };
    } else {
      next = [notification, ...current];
    }

    this.commitNotifications(next);
    return true;
  }

  patchNotification(updated: Partial<Notification> & { _id: string }): void {
    const next = this.notificationsSubject.value.map(n =>
      n._id === updated._id ? { ...n, ...updated } : n
    );
    this.commitNotifications(next);
  }

  markAsRead(notificationId: string): Observable<{ success: boolean; notification: Notification }> {
    const headers = this.userService.getAuthHeadersSync();
    return this.http.patch<{ success: boolean; notification: Notification }>(
      `${this.baseUrl}/${notificationId}/read`,
      {},
      { headers }
    ).pipe(
      tap(response => {
        if (response.success && response.notification) {
          this.patchNotification(response.notification);
        } else {
          this.patchNotification({ _id: notificationId, read: true, readAt: new Date() });
        }
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
        const next = this.notificationsSubject.value.map(n => ({
          ...n,
          read: true,
          readAt: n.readAt ?? new Date(),
        }));
        this.commitNotifications(next);
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

  private commitNotifications(notifications: Notification[]): void {
    this.notificationsSubject.next(notifications);
    if (this.activeUserId) {
      this.writeStorageCache(this.activeUserId, notifications);
    }
  }

  private readStorageCache(userId: string): Notification[] | null {
    try {
      const raw = sessionStorage.getItem(NotificationService.STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as NotificationCachePayload;
      if (parsed.userId !== userId || !Array.isArray(parsed.notifications)) {
        return null;
      }
      return parsed.notifications.map(n => this.coerceNotification(n)).filter(Boolean) as Notification[];
    } catch {
      return null;
    }
  }

  private writeStorageCache(userId: string, notifications: Notification[]): void {
    try {
      const payload: NotificationCachePayload = {
        userId,
        notifications,
        savedAt: Date.now(),
      };
      sessionStorage.setItem(NotificationService.STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota / private mode errors.
    }
  }

  private coerceNotification(raw: unknown): Notification | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const value = raw as Record<string, unknown>;
    const id = value['_id'];
    if (typeof id !== 'string' || !id.trim()) {
      return null;
    }

    const type = value['type'];
    if (typeof type !== 'string' || !type.trim()) {
      return null;
    }

    return {
      ...(value as unknown as Notification),
      _id: id,
      userId: String(value['userId'] ?? this.activeUserId ?? ''),
      type: type as Notification['type'],
      title: String(value['title'] ?? ''),
      message: String(value['message'] ?? ''),
      data: value['data'] ?? {},
      read: Boolean(value['read']),
      readAt: value['readAt'] ? new Date(String(value['readAt'])) : null,
      createdAt: value['createdAt'] ? new Date(String(value['createdAt'])) : new Date(),
      updatedAt: value['updatedAt'] ? new Date(String(value['updatedAt'])) : new Date(),
    };
  }
}
