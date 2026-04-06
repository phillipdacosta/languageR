import { api } from './api';

export interface Lesson {
  _id: string;
  status: string;
  /** API returns startTime (same as web); scheduledTime kept for compatibility */
  startTime?: string;
  endTime?: string;
  scheduledTime?: string;
  duration: number;
  language?: string;
  subject?: string;
  studentId?: {
    _id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
  };
  tutorId?: {
    _id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
  };
  isClass?: boolean;
  className?: string;
  classData?: {
    thumbnail?: string;
  };
  attendees?: any[];
  capacity?: number;
  cancelReason?: string;
  rescheduleProposal?: {
    status?: string;
    proposedBy?: string;
  };
  isTrialLesson?: boolean;
}

interface MyLessonsResponse {
  success?: boolean;
  lessons?: Lesson[];
}

interface LessonDetailResponse {
  success?: boolean;
  lesson?: Lesson;
}

/** Start time from API (web uses startTime; legacy clients may use scheduledTime). */
export function getLessonStart(lesson: Lesson): Date {
  const raw = lesson.startTime || lesson.scheduledTime;
  return raw ? new Date(raw) : new Date(NaN);
}

export function getLessonEnd(lesson: Lesson): Date {
  if (lesson.endTime) return new Date(lesson.endTime);
  const start = getLessonStart(lesson);
  if (Number.isNaN(start.getTime())) return start;
  return new Date(start.getTime() + (lesson.duration || 30) * 60000);
}

export interface TimelineEvent {
  lesson: Lesson;
  name: string;
  avatar: string | null;
  date: string;
  time: string;
  duration: number;
  statusLabel: string;
  statusClass: string;
  isToday: boolean;
  isTrialLesson: boolean;
  countdown: string;
  timeRange: string;
  dateTag: string;
  subject: string;
}

export const lessonService = {
  async getMyLessons(): Promise<Lesson[]> {
    try {
      const data = await api.get<MyLessonsResponse>('/lessons/my-lessons');
      return data.lessons || [];
    } catch {
      return [];
    }
  },

  async getLesson(lessonId: string): Promise<Lesson | null> {
    try {
      const data = await api.get<LessonDetailResponse>(`/lessons/${lessonId}`);
      return data.lesson || null;
    } catch {
      return null;
    }
  },

  async getUpcomingLessons(): Promise<Lesson[]> {
    try {
      const all = await this.getMyLessons();
      const now = new Date();
      return all
        .filter(l => {
          if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') {
            return false;
          }
          const start = getLessonStart(l);
          const end = getLessonEnd(l);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
          if (start <= now && now < end) return true;
          return start > now;
        })
        .sort((a, b) => getLessonStart(a).getTime() - getLessonStart(b).getTime());
    } catch {
      return [];
    }
  },
};

export function buildTimelineEvents(lessons: Lesson[], userId: string): TimelineEvent[] {
  const now = new Date();

  const upcoming = lessons
    .filter(l => {
      if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') {
        return false;
      }
      const start = getLessonStart(l);
      const end = getLessonEnd(l);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
      if (start <= now && now < end) return true;
      return start > now;
    })
    .sort((a, b) => getLessonStart(a).getTime() - getLessonStart(b).getTime());

  return upcoming.slice(0, 5).map(lesson => {
    const start = getLessonStart(lesson);
    const end = getLessonEnd(lesson);
    const isToday = start.toDateString() === now.toDateString();

    const otherPerson = lesson.tutorId?._id === userId ? lesson.studentId : lesson.tutorId;
    const name = otherPerson?.firstName
      ? `${otherPerson.firstName} ${(otherPerson.lastName || '').charAt(0)}.`
      : otherPerson?.name || 'Student';

    const diffMs = start.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffM = Math.floor((diffMs % 3600000) / 60000);
    let countdown = '';
    if (diffMs > 0) {
      if (diffH > 24) countdown = `${Math.floor(diffH / 24)}d`;
      else if (diffH > 0) countdown = `${diffH}h ${diffM}m`;
      else countdown = `${diffM}m`;
    }

    return {
      lesson,
      name,
      avatar: otherPerson?.picture || null,
      date: start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      duration: lesson.duration || 30,
      statusLabel: lesson.isTrialLesson ? 'Trial' : 'Scheduled',
      statusClass: lesson.isTrialLesson ? 'status-trial' : 'status-scheduled',
      isToday,
      isTrialLesson: lesson.isTrialLesson || false,
      countdown,
      timeRange: `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      dateTag: isToday ? 'Today' : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      subject: lesson.subject || lesson.language || '',
    };
  });
}
