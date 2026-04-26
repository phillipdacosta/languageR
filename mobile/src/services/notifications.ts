import { api } from './api';

export type AppNotification = {
  _id: string;
  userId?: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  relatedUserPicture?: string;
  read: boolean;
  readAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export async function getNotifications(
  limit = 50,
  beforeId?: string,
): Promise<{ success: boolean; notifications: AppNotification[] }> {
  let path = `/notifications?limit=${limit}`;
  if (beforeId) path += `&before=${encodeURIComponent(beforeId)}`;
  return api.get(path);
}

export async function getUnreadCount(): Promise<{ success: boolean; count: number }> {
  return api.get('/notifications/unread-count');
}

export async function markNotificationRead(
  id: string,
): Promise<{ success: boolean; notification: AppNotification }> {
  return api.patch(`/notifications/${encodeURIComponent(id)}/read`, {});
}

export async function markAllNotificationsRead(): Promise<{ success: boolean; message?: string }> {
  return api.patch('/notifications/read-all', {});
}
