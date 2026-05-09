import { api } from './api';
import {
  AvailabilityBlock,
  CalendarLesson,
  CalendarClass,
  PendingFeedback,
} from '../types/calendar';

export interface GoogleCalendarStatus {
  connected: boolean;
  email?: string;
  syncEnabled?: boolean;
  pushToGoogle?: boolean;
  lastSyncAt?: string;
  watchActive?: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay?: boolean;
  status?: string;
}

interface AvailabilityResponse {
  success: boolean;
  availability: AvailabilityBlock[];
}

interface UpdateAvailabilityResponse {
  success: boolean;
  message: string;
  availability: AvailabilityBlock[];
}

interface LessonsResponse {
  success: boolean;
  lessons: CalendarLesson[];
}

interface ClassesResponse {
  success: boolean;
  classes: CalendarClass[];
}

interface PendingFeedbackResponse {
  success: boolean;
  pendingFeedback: PendingFeedback[];
  count: number;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const calendarService = {
  async getAvailability(): Promise<AvailabilityBlock[]> {
    try {
      const data = await api.get<AvailabilityResponse>('/users/availability');
      return data.availability || [];
    } catch {
      return [];
    }
  },

  /** Public tutor availability (same payload as web booking / reschedule). */
  async getTutorAvailabilityByUserId(
    userId: string,
  ): Promise<{ availability: AvailabilityBlock[]; acceptingBookings?: boolean }> {
    try {
      const data = await api.get<{
        success?: boolean;
        availability?: AvailabilityBlock[];
        acceptingBookings?: boolean;
      }>(`/users/${encodeURIComponent(userId)}/availability`);
      return {
        availability: data.availability || [],
        acceptingBookings: data.acceptingBookings,
      };
    } catch {
      return { availability: [] };
    }
  },

  async updateAvailability(
    blocks: AvailabilityBlock[],
    editedDates?: string[],
  ): Promise<UpdateAvailabilityResponse> {
    return api.put<UpdateAvailabilityResponse>('/users/availability', {
      availabilityBlocks: blocks,
      editedDates,
    });
  },

  async getTutorLessons(
    tutorId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<CalendarLesson[]> {
    try {
      let path = `/lessons/by-tutor/${tutorId}?all=true`;
      if (startDate) path += `&startDate=${toISODate(startDate)}`;
      if (endDate) path += `&endDate=${toISODate(endDate)}`;
      const data = await api.get<LessonsResponse>(path);
      return data.lessons || [];
    } catch {
      return [];
    }
  },

  async getTutorClasses(
    tutorId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<CalendarClass[]> {
    try {
      let path = `/classes/tutor/${tutorId}`;
      const params: string[] = [];
      if (startDate) params.push(`startDate=${toISODate(startDate)}`);
      if (endDate) params.push(`endDate=${toISODate(endDate)}`);
      if (params.length) path += `?${params.join('&')}`;
      const data = await api.get<ClassesResponse>(path);
      return data.classes || [];
    } catch {
      return [];
    }
  },

  async getPendingFeedback(): Promise<{ items: PendingFeedback[]; count: number }> {
    try {
      const data = await api.get<PendingFeedbackResponse>('/tutor-feedback/pending');
      return { items: data.pendingFeedback || [], count: data.count || 0 };
    } catch {
      return { items: [], count: 0 };
    }
  },

  async getGoogleCalendarAuthUrl(): Promise<string | null> {
    try {
      const data = await api.get<{ url: string }>('/auth/google-calendar/url');
      return data.url || null;
    } catch {
      return null;
    }
  },

  async getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
    try {
      return await api.get<GoogleCalendarStatus>('/auth/google-calendar/status');
    } catch {
      return { connected: false };
    }
  },

  async disconnectGoogleCalendar(): Promise<void> {
    await api.post('/auth/google-calendar/disconnect');
  },

  async updateGoogleCalendarSettings(settings: { syncEnabled?: boolean; pushToGoogle?: boolean }): Promise<void> {
    await api.put('/auth/google-calendar/settings', settings);
  },

  async getGoogleCalendarEvents(timeMin: Date, timeMax: Date): Promise<GoogleCalendarEvent[]> {
    try {
      const params = `timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
      const data = await api.get<{ events: GoogleCalendarEvent[] }>(`/auth/google-calendar/events?${params}`);
      return data.events || [];
    } catch {
      return [];
    }
  },

  async registerGoogleCalendarWatch(): Promise<void> {
    try {
      await api.post('/auth/google-calendar/register-watch');
    } catch { /* non-critical */ }
  },
};
