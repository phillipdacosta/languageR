import { Pipe, PipeTransform } from '@angular/core';
import { Notification } from '../services/notification.service';

@Pipe({
  name: 'notificationFilter',
  standalone: true,
  pure: true
})
export class NotificationFilterPipe implements PipeTransform {
  transform(notifications: Notification[] | null, filterType: 'read' | 'unread'): Notification[] {
    if (!notifications) return [];
    
    if (filterType === 'unread') {
      return notifications.filter(n => !n.read);
    } else {
      return notifications.filter(n => n.read);
    }
  }
}

