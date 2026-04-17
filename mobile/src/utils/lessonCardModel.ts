import type { TFunction } from 'i18next';
import type { Lesson } from '../services/lessons';
import type { MyClassRecord } from '../services/classes';
import { getLessonEnd, getLessonStart } from '../services/lessons';

export type CardDescMode = 'schedule' | 'analysis' | 'analysis_generating' | 'analysis_empty';

export interface ProcessedLessonCard {
  id: string;
  lesson: Lesson;
  role: 'tutor' | 'student';
  roleLabel: string;
  otherName: string;
  otherPicture: string;
  otherInitials: string;
  formattedDate: string;
  /** Short month for calendar badge, e.g. "APR" */
  dateBadgeMonth: string;
  /** Day of month for badge, e.g. "17" */
  dateBadgeDay: string;
  formattedTime: string;
  status: string;
  statusLabel: string;
  isTrial: boolean;
  isClass: boolean;
  className: string;
  classStudentCount: number;
  classCapacity: number;
  classAttendees: { name: string; picture?: string; initials: string }[];
  classAttendeesOverflow: number;
  /** Class cover from hub thumbnail (tutor classes). */
  classCoverUrl?: string;
  /** e.g. "3 / 8 students" for list subtitle */
  classEnrollmentLine?: string;
  cardDescMode: CardDescMode;
  cardDescText: string;
  cardStats: { value: string; label: string }[];
  tipSent: boolean;
  isCancelled: boolean;
}

function truncateCardText(s: string, max: number): string {
  const t = (s || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/** USD string for card middle column; whole dollars omit decimals. */
function formatCardUsd(n: number): string {
  const x = Math.max(0, n);
  const rounded = Math.abs(x - Math.round(x)) < 0.005 ? Math.round(x) : Math.round(x * 100) / 100;
  return `$${rounded.toFixed(Number.isInteger(rounded) ? 0 : 2)}`;
}

function getInitialsFromName(name: string): string {
  return name
    .split(' ')
    .map(p => p.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatInTimeZone(
  date: Date,
  tz: string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale: string,
): string {
  try {
    if (tz) {
      return date.toLocaleString(locale, { ...options, timeZone: tz });
    }
  } catch {
    /* fall through */
  }
  return date.toLocaleString(locale, options);
}

function getUserRole(lesson: Lesson, currentUserId: string): 'tutor' | 'student' {
  const tutorId = String(
    (lesson.tutorId as any)?._id || (lesson.tutorId as any)?.id || lesson.tutorId || '',
  );
  return tutorId === currentUserId ? 'tutor' : 'student';
}

function getOtherParticipant(lesson: Lesson, role: 'tutor' | 'student', t: TFunction): { name: string; picture: string } {
  const participant = role === 'tutor' ? lesson.studentId : lesson.tutorId;
  if (!participant) {
    return { name: t('LESSONS_PAGE.UNKNOWN'), picture: '' };
  }
  const p = participant as any;
  let formattedName = '';
  if (p.firstName && p.lastName) {
    formattedName = `${p.firstName} ${p.lastName.charAt(0).toUpperCase()}.`;
  } else if (p.firstName) {
    formattedName = p.firstName;
  } else if (p.name) {
    const parts = p.name.trim().split(' ');
    if (parts.length > 1) {
      formattedName = `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
    } else {
      formattedName = p.name;
    }
  } else {
    formattedName = p.email || t('LESSONS_PAGE.UNKNOWN');
  }
  const picture = p.picture || p.profilePicture || '';
  return { name: formattedName, picture };
}

function statusLabelFor(lesson: Lesson, t: TFunction): string {
  switch (lesson.status) {
    case 'scheduled':
    case 'confirmed':
      return t('LESSONS_PAGE.STATUS_SCHEDULED');
    case 'in_progress':
      return t('LESSONS_PAGE.STATUS_IN_PROGRESS');
    case 'completed':
    case 'ended_early':
      return t('LESSONS_PAGE.STATUS_COMPLETED');
    case 'cancelled':
      return t('LESSONS_PAGE.STATUS_CANCELLED');
    case 'pending_reschedule':
      return t('LESSONS_PAGE.STATUS_PENDING');
    default:
      return lesson.status;
  }
}

export function classRecordToLesson(cls: MyClassRecord, currentUser: any, t: TFunction): Lesson {
  const userId = String(currentUser?._id || currentUser?.id || '');
  const isTutor = String(cls.tutorId?._id || cls.tutorId) === userId;
  const firstStudent = cls.confirmedStudents?.[0];
  const thumb = cls.thumbnail?.trim();
  return {
    _id: cls._id,
    tutorId: cls.tutorId || { _id: '', name: t('LESSONS_PAGE.UNKNOWN') },
    studentId: isTutor
      ? firstStudent || {
          _id: '',
          name: `${cls.confirmedStudents?.length || 0}${t('LESSONS_PAGE.CLASS_STUDENTS')}`,
        }
      : { _id: userId, name: currentUser?.name || '' },
    startTime: cls.startTime,
    endTime: cls.endTime || new Date(new Date(cls.startTime).getTime() + (cls.duration || 60) * 60000).toISOString(),
    status:
      cls.status === 'scheduled'
        ? 'scheduled'
        : cls.status === 'in_progress'
          ? 'in_progress'
          : cls.status === 'completed'
            ? 'completed'
            : 'cancelled',
    subject: cls.name || t('LESSONS_PAGE.CLASS'),
    price: cls.price || 0,
    duration: cls.duration || 60,
    isClass: true,
    className: cls.name,
    attendees: cls.confirmedStudents || [],
    capacity: cls.capacity || 1,
    classData: thumb ? { thumbnail: thumb } : undefined,
  } as Lesson;
}

export function buildProcessedLessonCard(
  lesson: Lesson,
  currentUser: { _id?: string; id?: string } | null,
  t: TFunction,
  userTz?: string,
): ProcessedLessonCard {
  const userId = String(currentUser?._id || currentUser?.id || '');
  const role = getUserRole(lesson, userId);
  const other = getOtherParticipant(lesson, role, t);
  const start = getLessonStart(lesson);
  const end = lesson.endTime ? new Date(lesson.endTime) : getLessonEnd(lesson);
  const locale = 'en-US';

  const fmtMonthLong = formatInTimeZone(start, userTz, { month: 'long' }, locale);
  const fmtMonthShort = formatInTimeZone(start, userTz, { month: 'short' }, locale);
  const fmtDayNum = formatInTimeZone(start, userTz, { day: 'numeric' }, locale);
  const formattedDate = `${fmtMonthLong} ${fmtDayNum}`;
  const dateBadgeMonth = fmtMonthShort.replace(/\./g, '').toUpperCase();
  const dateBadgeDay = fmtDayNum;

  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const fmtStart = formatInTimeZone(start, userTz, timeOpts, locale);
  const fmtEnd = formatInTimeZone(end, userTz, timeOpts, locale);
  const formattedTime = `${fmtStart} – ${fmtEnd}`;

  const status = lesson.status;
  const statusLabel = statusLabelFor(lesson, t);
  const isTrial = !!lesson.isTrialLesson;

  let analysisStatus: 'available' | 'generating' | 'unavailable' = 'unavailable';
  const aiAnalysis = (lesson as any).aiAnalysis;
  const tutorFeedback = (lesson as any).tutorFeedback;
  if (tutorFeedback?.status === 'completed') {
    analysisStatus = 'available';
  } else if (aiAnalysis?.status === 'generating') {
    analysisStatus = 'generating';
  } else if (aiAnalysis?.status === 'completed' || aiAnalysis?.hasAnalysis) {
    analysisStatus = 'available';
  }

  const tutorNote = (lesson as any).tutorNote;
  const hasTutorNoteAvailable = !!(tutorNote && tutorNote.text);
  const hasTutorFeedbackAvailable = tutorFeedback?.status === 'completed';
  const needsTutorFeedback =
    role === 'tutor' &&
    status === 'completed' &&
    !isTrial &&
    !!tutorFeedback &&
    tutorFeedback.status === 'pending' &&
    tutorFeedback.required !== false;

  const hasAiAnalysis = aiAnalysis?.status === 'completed' || !!aiAnalysis?.hasAnalysis;
  const aiWasEnabled = (lesson as any).aiAnalysisEnabledAtTime === true;
  const requiresTutorFeedback = !!(lesson as any).requiresTutorFeedback;
  const hasPendingFeedbackRecord = !!tutorFeedback && tutorFeedback.status === 'pending';
  const feedbackPendingForStudent =
    role === 'student' &&
    status === 'completed' &&
    !isTrial &&
    !hasTutorFeedbackAvailable &&
    !hasTutorNoteAvailable &&
    !hasAiAnalysis &&
    (requiresTutorFeedback || hasPendingFeedbackRecord || !aiWasEnabled);

  let cardDescMode: CardDescMode = 'schedule';
  let cardDescText = '';

  if (status === 'completed' || status === 'ended_early') {
    if (role === 'tutor') {
      const noteBody = tutorNote?.text;
      const feedbackNotes = (tutorFeedback as any)?.overallNotes;
      if (noteBody) {
        cardDescMode = 'schedule';
        cardDescText = truncateCardText(noteBody, 220);
      } else if (feedbackNotes && hasTutorFeedbackAvailable) {
        cardDescMode = 'schedule';
        cardDescText = truncateCardText(String(feedbackNotes), 220);
      } else if (needsTutorFeedback) {
        cardDescMode = 'schedule';
        cardDescText = t('LESSONS_PAGE.TUTOR_FEEDBACK_NEEDED');
      } else {
        cardDescMode = 'schedule';
        cardDescText = t('LESSONS_PAGE.TUTOR_NO_NOTES');
      }
    } else {
      if (isTrial) {
        /* empty */
      } else if (analysisStatus === 'generating') {
        cardDescMode = 'analysis_generating';
      } else if (feedbackPendingForStudent) {
        cardDescMode = 'analysis';
        cardDescText = t('LESSONS_PAGE.AWAITING_TUTOR_FEEDBACK');
      } else {
        const sum = aiAnalysis?.overallAssessment?.summary || aiAnalysis?.studentSummary;
        const firstImprovement = aiAnalysis?.progressionMetrics?.keyImprovements?.[0];
        const noteBody = tutorNote?.text;
        const feedbackNotes = (tutorFeedback as any)?.overallNotes;

        if (sum && String(sum).trim()) {
          cardDescMode = 'analysis';
          cardDescText = truncateCardText(String(sum), 220);
        } else if (firstImprovement) {
          cardDescMode = 'analysis';
          cardDescText = truncateCardText(firstImprovement, 220);
        } else if (noteBody) {
          cardDescMode = 'analysis';
          cardDescText = truncateCardText(noteBody, 220);
        } else if (feedbackNotes && hasTutorFeedbackAvailable) {
          cardDescMode = 'analysis';
          cardDescText = truncateCardText(String(feedbackNotes), 220);
        } else if (analysisStatus === 'available') {
          cardDescMode = 'analysis';
          cardDescText = t('LESSONS_PAGE.ANALYSIS_AVAILABLE_TAP');
        } else {
          cardDescMode = 'analysis_empty';
        }
      }
    }
  } else if (status === 'cancelled') {
    const cancelBy = lesson.cancelledBy;
    const reasonText = lesson.cancelReasonText || lesson.cancelReason || '';
    let byLabel = '';
    if (cancelBy === 'tutor') byLabel = t('LESSONS_PAGE.CANCELLED_BY_TUTOR');
    else if (cancelBy === 'student') byLabel = t('LESSONS_PAGE.CANCELLED_BY_STUDENT');
    else if (cancelBy === 'system' || cancelBy === 'admin') byLabel = t('LESSONS_PAGE.CANCELLED_BY_SYSTEM');

    if (byLabel && reasonText) {
      cardDescText = `${byLabel} — ${reasonText}`;
    } else if (byLabel) {
      cardDescText = byLabel;
    } else if (reasonText) {
      cardDescText = reasonText;
    }
  } else if (status === 'in_progress') {
    cardDescText = t('LESSONS_PAGE.LESSON_IN_PROGRESS');
  } else if (status === 'pending_reschedule') {
    cardDescText = t('LESSONS_PAGE.RESCHEDULE_PENDING');
  } else if (status === 'scheduled' || status === 'confirmed') {
    const ctx = lesson.lastSessionContext;
    const shortName = other.name.split(' ')[0] || other.name;
    if (ctx?.isFirstLesson) {
      const key = role === 'tutor'
        ? 'LESSONS_PAGE.FIRST_LESSON_TUTOR'
        : 'LESSONS_PAGE.FIRST_LESSON_STUDENT';
      cardDescText = t(key, { name: shortName });
    } else if (ctx?.summary) {
      cardDescText = t('LESSONS_PAGE.LAST_SESSION_PREFIX') + truncateCardText(ctx.summary, 180);
    }
  }

  const durLabel = t('LESSONS_PAGE.DURATION_MIN');
  const priceOrReceived =
    role === 'tutor'
      ? {
          value: formatCardUsd(
            typeof lesson.tutorPayout === 'number' && !Number.isNaN(lesson.tutorPayout)
              ? lesson.tutorPayout
              : 0,
          ),
          label: t('LESSONS_PAGE.CARD_STAT_RECEIVED'),
        }
      : {
          value: `$${(lesson.price || 0).toFixed(0)}`,
          label: t('LESSONS_PAGE.CARD_STAT_PRICE'),
        };
  const enrolled = lesson.attendees?.length ?? 0;
  const cap = lesson.capacity || 0;
  const enrollmentStat =
    lesson.isClass && role === 'tutor'
      ? { value: `${enrolled}/${Math.max(1, cap)}`, label: t('LESSONS_PAGE.CARD_STAT_ENROLLED') }
      : priceOrReceived;
  const cardStats = [
    { value: `${lesson.duration}${durLabel}`, label: t('LESSONS_PAGE.CARD_STAT_DURATION') },
    enrollmentStat,
    { value: statusLabel, label: t('LESSONS_PAGE.CARD_STAT_STATUS') },
  ];

  const nameParts = other.name.split(' ');
  const initials =
    nameParts.length > 1
      ? `${nameParts[0].charAt(0)}${nameParts[1].charAt(0)}`
      : nameParts[0].charAt(0);

  const classCoverUrl =
    lesson.isClass && lesson.classData?.thumbnail && String(lesson.classData.thumbnail).trim().length > 0
      ? String(lesson.classData.thumbnail).trim()
      : undefined;
  const classEnrollmentLine =
    lesson.isClass && cap > 0 ? t('LESSONS_PAGE.CLASS_ENROLLMENT_LINE', { current: enrolled, max: cap }) : undefined;

  return {
    id: lesson._id,
    lesson,
    role,
    roleLabel: role === 'student' ? t('LESSONS_PAGE.ROLE_TUTOR') : t('LESSONS_PAGE.ROLE_STUDENT'),
    otherName: lesson.isClass ? lesson.className || lesson.subject || t('LESSONS_PAGE.CLASS') : other.name,
    otherPicture: lesson.isClass ? '' : other.picture,
    otherInitials: initials.toUpperCase(),
    formattedDate,
    dateBadgeMonth,
    dateBadgeDay,
    formattedTime,
    status,
    statusLabel,
    isTrial,
    isClass: !!lesson.isClass,
    className: lesson.className || '',
    classStudentCount: lesson.attendees?.length || 0,
    classCapacity: lesson.capacity || 0,
    classAttendees: (lesson.attendees || []).slice(0, 3).map((a: any) => ({
      name: a.name || a.firstName || '',
      picture: a.picture || a.profilePicture,
      initials: getInitialsFromName(a.name || a.firstName || ''),
    })),
    classAttendeesOverflow: Math.max(0, (lesson.attendees?.length || 0) - 3),
    classCoverUrl,
    classEnrollmentLine,
    cardDescMode,
    cardDescText,
    cardStats,
    tipSent: !!(lesson as any).tip && !!(lesson as any).tip.amount,
    isCancelled: status === 'cancelled',
  };
}

export type StatusFilter = 'all' | 'upcoming' | 'completed' | 'cancelled';

export function filterLessonsByStatus(lessons: Lesson[], filter: StatusFilter): Lesson[] {
  const now = new Date();
  if (filter === 'all') return lessons;
  if (filter === 'upcoming') {
    return lessons.filter(
      l =>
        (l.status === 'scheduled' || l.status === 'confirmed' || l.status === 'in_progress' || l.status === 'pending_reschedule') &&
        getLessonEnd(l) >= now,
    );
  }
  if (filter === 'completed') return lessons.filter(l => l.status === 'completed' || l.status === 'ended_early');
  if (filter === 'cancelled') return lessons.filter(l => l.status === 'cancelled');
  return lessons;
}

export function sortLessonsNewestFirst(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort(
    (a, b) => getLessonStart(b).getTime() - getLessonStart(a).getTime(),
  );
}
