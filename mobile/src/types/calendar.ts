export interface AvailabilityBlock {
  id: string;
  day: number;
  startTime: string;
  endTime: string;
  absoluteStart?: string;
  absoluteEnd?: string;
  type: 'available' | 'unavailable' | 'break' | 'class';
  title?: string;
  color?: string;
}

export interface CalendarLesson {
  _id: string;
  startTime: string;
  endTime: string;
  status: string;
  duration: number;
  subject?: string;
  notes?: string;
  language?: string;
  isTrialLesson?: boolean;
  price?: number;
  bookingData?: any;
  rescheduleProposal?: {
    status?: string;
    proposedBy?: string;
    proposedTime?: string;
  };
  studentId?: {
    _id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
    email?: string;
  };
  tutorId?: {
    _id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
  };
}

export interface CalendarClass {
  _id: string;
  startTime: string;
  endTime: string;
  title: string;   // legacy alias kept for timeline entry
  name?: string;   // actual backend field (Class.name)
  description?: string;
  maxStudents: number;
  attendees: any[];
  confirmedStudents?: any[];
  invitedStudents?: any[];
  status: string;
  duration?: number;
  price?: number;
  language?: string;
  thumbnail?: string;
  tutorId?: any;
  invitationStats?: {
    total: number;
    accepted: number;
    pending: number;
    declined: number;
  };
}

export interface TimelineEntry {
  id: string;
  type: 'lesson' | 'class' | 'availability' | 'googleEvent';
  startTime: Date;
  endTime: Date;
  title: string;
  subtitle?: string;
  avatar?: string;
  status?: string;
  isTrialLesson?: boolean;
  isPast?: boolean;
  isNow?: boolean;
  lessonId?: string;
  classId?: string;
  duration?: number;
  attendeeCount?: number;
  maxStudents?: number;
  isCancelled?: boolean;
  isReschedule?: boolean;
  isGoogleCalendar?: boolean;
  lesson?: CalendarLesson;
  calendarClass?: CalendarClass;
}

export interface PendingFeedback {
  _id: string;
  lessonId: string;
  tutorId: string;
  studentId: string;
  status: string;
  required: boolean;
  lesson?: {
    startTime: string;
    endTime: string;
    subject?: string;
    duration?: number;
  };
  studentName?: string;
  studentPicture?: string;
}

export interface DayCell {
  date: Date;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  isSelected: boolean;
  hasLessons: boolean;
  lessonCount: number;
}
