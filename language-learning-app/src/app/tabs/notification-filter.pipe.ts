import { Pipe, PipeTransform } from '@angular/core';
import { Notification } from '../services/notification.service';

@Pipe({
  name: 'notificationFilter',
  standalone: true,
  pure: true
})
export class NotificationFilterPipe implements PipeTransform {
  // 🚀 PERFORMANCE FIX: Made generic to preserve extended notification types
  transform<T extends Notification>(notifications: T[] | null, filterType: 'read' | 'unread'): T[] {
    if (!notifications) return [];
    
    if (filterType === 'unread') {
      return notifications.filter(n => !n.read);
    } else {
      return notifications.filter(n => n.read);
    }
  }
}

