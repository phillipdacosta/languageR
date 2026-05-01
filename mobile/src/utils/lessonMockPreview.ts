/**
 * Preview lesson mocks — IDs must match web `lesson-mock-preview.ts` and LessonsScreen mocks.
 */
import type {
  BillingData,
  CachedLessonDetail,
  Lesson,
  LessonDetailResponse,
  PaymentData,
} from '../services/lessons';

export function isLessonMockId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('__mock_');
}

export interface MockSpec {
  id: string;
  cardRole: 'tutor' | 'student';
  status: 'scheduled' | 'completed' | 'cancelled';
  durationMin: number;
  price: number;
  otherName: string;
  otherPicture: string;
  isTrial?: boolean;
  tipSent?: boolean;
  actualDurationMin?: number;
  actualPrice?: number;
}

export const LESSON_MOCK_SPECS: MockSpec[] = [
  { id: '__mock_student_completed__', cardRole: 'student', status: 'completed', durationMin: 45, price: 25, otherName: 'Maria G.', otherPicture: 'https://randomuser.me/api/portraits/women/44.jpg', actualDurationMin: 43, actualPrice: 25 },
  { id: '__mock_student_upcoming__', cardRole: 'student', status: 'scheduled', durationMin: 60, price: 30, otherName: 'Carlos R.', otherPicture: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { id: '__mock_student_cancelled__', cardRole: 'student', status: 'cancelled', durationMin: 30, price: 15, otherName: 'Lucia P.', otherPicture: 'https://randomuser.me/api/portraits/women/68.jpg' },
  { id: '__mock_student_awaiting__', cardRole: 'student', status: 'completed', durationMin: 45, price: 25, otherName: 'Elena V.', otherPicture: 'https://randomuser.me/api/portraits/women/21.jpg', actualDurationMin: 45, actualPrice: 25 },
  { id: '__mock_student_generating__', cardRole: 'student', status: 'completed', durationMin: 45, price: 25, otherName: 'Rafael T.', otherPicture: 'https://randomuser.me/api/portraits/men/75.jpg', actualDurationMin: 44, actualPrice: 25 },
  { id: '__mock_student_trial__', cardRole: 'student', status: 'completed', durationMin: 30, price: 0, otherName: 'Sofia M.', otherPicture: 'https://randomuser.me/api/portraits/women/55.jpg', isTrial: true, actualDurationMin: 28, actualPrice: 0 },
  { id: '__mock_student_tip__', cardRole: 'student', status: 'completed', durationMin: 60, price: 35, otherName: 'Maria G.', otherPicture: 'https://randomuser.me/api/portraits/women/44.jpg', tipSent: true, actualDurationMin: 58, actualPrice: 35 },
  { id: '__mock_tutor_completed__', cardRole: 'tutor', status: 'completed', durationMin: 60, price: 35, otherName: 'Daniel K.', otherPicture: 'https://randomuser.me/api/portraits/men/46.jpg', actualDurationMin: 60, actualPrice: 35 },
  { id: '__mock_tutor_upcoming__', cardRole: 'tutor', status: 'scheduled', durationMin: 60, price: 40, otherName: 'James L.', otherPicture: 'https://randomuser.me/api/portraits/men/22.jpg' },
  { id: '__mock_tutor_feedback_needed__', cardRole: 'tutor', status: 'completed', durationMin: 45, price: 25, otherName: 'Amy W.', otherPicture: 'https://randomuser.me/api/portraits/women/33.jpg', actualDurationMin: 45, actualPrice: 25 },
  { id: '__mock_tutor_feedback_optional__', cardRole: 'tutor', status: 'completed', durationMin: 60, price: 30, otherName: 'Olivia C.', otherPicture: 'https://randomuser.me/api/portraits/women/12.jpg', actualDurationMin: 60, actualPrice: 30 },
  { id: '__mock_tutor_tip_received__', cardRole: 'tutor', status: 'completed', durationMin: 60, price: 35, otherName: 'Daniel K.', otherPicture: 'https://randomuser.me/api/portraits/men/46.jpg', tipSent: true, actualDurationMin: 60, actualPrice: 35 },
  { id: '__mock_student_analysis_empty__', cardRole: 'student', status: 'completed', durationMin: 45, price: 20, otherName: 'Hana T.', otherPicture: 'https://randomuser.me/api/portraits/women/90.jpg', actualDurationMin: 44, actualPrice: 20 },
  { id: '__mock_student_tutor_feedback__', cardRole: 'student', status: 'completed', durationMin: 50, price: 30, otherName: 'Liam B.', otherPicture: 'https://randomuser.me/api/portraits/men/11.jpg', actualDurationMin: 50, actualPrice: 30 },
  { id: '__mock_tutor_no_notes__', cardRole: 'tutor', status: 'completed', durationMin: 30, price: 20, otherName: 'Priya S.', otherPicture: 'https://randomuser.me/api/portraits/women/77.jpg', actualDurationMin: 30, actualPrice: 20 },
  { id: '__mock_tutor_cancelled__', cardRole: 'tutor', status: 'cancelled', durationMin: 45, price: 25, otherName: 'Marco V.', otherPicture: 'https://randomuser.me/api/portraits/men/52.jpg' },
];

function parseName(display: string): { firstName: string; lastName: string } {
  const parts = display.replace(/\.$/, '').trim().split(/\s+/);
  if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  return { firstName: display, lastName: '' };
}

function timeWindow(
  status: MockSpec['status'],
  durationMin: number,
): { start: Date; end: Date } {
  const now = Date.now();
  if (status === 'scheduled') {
    const start = new Date(now + 3 * 24 * 60 * 60 * 1000);
    return { start, end: new Date(start.getTime() + durationMin * 60000) };
  }
  const start = new Date(now - 4 * 24 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + durationMin * 60000) };
}

export function buildMockLessonForId(
  id: string,
  currentUserId: string,
): Lesson | null {
  const spec = LESSON_MOCK_SPECS.find(s => s.id === id);
  if (!spec) return null;

  const { start, end } = timeWindow(spec.status, spec.durationMin);
  const { firstName, lastName } = parseName(spec.otherName);
  const other: Lesson['tutorId'] = {
    _id: `mock-other-${spec.id}`,
    firstName,
    lastName,
    name: spec.otherName,
    email: 'preview@example.com',
    picture: spec.otherPicture,
  };
  const me: Lesson['studentId'] = {
    _id: currentUserId,
    firstName: 'You',
    lastName: '',
    name: 'You',
    email: 'you@example.com',
    picture: '',
  };

  // Assign participants so the overlay's role detection places the
  // logged-in user in the correct slot for the card's intended role.
  let tutorId: typeof other;
  let studentId: typeof other;
  if (spec.cardRole === 'tutor') {
    tutorId = me as typeof other;
    studentId = other;
  } else {
    tutorId = other;
    studentId = me as typeof other;
  }

  const lesson: any = {
    _id: id,
    _mockViewRole: spec.cardRole,
    status: spec.status,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: spec.durationMin,
    subject: 'Spanish',
    price: spec.price,
    tutorId,
    studentId,
    isTrialLesson: !!spec.isTrial,
    tip: spec.tipSent ? { amount: spec.cardRole === 'tutor' ? 8 : 5 } : undefined,
    actualDurationMinutes: spec.actualDurationMin ?? spec.durationMin,
    actualPrice: spec.actualPrice ?? spec.price,
  };

  if (spec.cardRole === 'tutor') {
    if (spec.status === 'cancelled' || spec.status === 'scheduled') {
      lesson.tutorPayout = 0;
    } else {
      lesson.tutorPayout = Math.max(0, Math.round((spec.price || 0) * 0.8));
    }
  }

  applyMockAnalysisData(lesson, id);

  return lesson as Lesson;
}

function applyMockAnalysisData(lesson: any, id: string): void {
  switch (id) {
    case '__mock_student_completed__':
      lesson.aiAnalysis = {
        status: 'completed',
        hasAnalysis: true,
        overallAssessment: {
          proficiencyLevel: 'B1 – Intermediate',
          confidence: 82,
          summary: 'Great progress with past tense conjugations today. Your conversational fluency improved noticeably — keep practicing irregular verbs.',
          progressFromLastLesson: 'Slight improvement in verb accuracy.',
        },
        grammarAnalysis: { accuracyScore: 72 },
        vocabularyAnalysis: { uniqueWordCount: 85, vocabularyRange: 'Intermediate' },
        fluencyAnalysis: { overallFluencyScore: 68 },
        pronunciationAnalysis: { overallScore: 75 },
        topicsDiscussed: ['Past tense narration', 'Daily routines', 'Weekend plans'],
        recommendedFocus: ['Irregular preterite verbs', 'Ser vs estar contextual usage'],
        homeworkSuggestions: ['Complete chapter 5 exercises', 'Write a short paragraph about your last vacation'],
        progressionMetrics: { keyImprovements: ['Verb conjugation accuracy improved from 60% to 82%'] },
        studentSummary: 'Solid session focused on past tense. Good improvement in conversational flow.',
      };
      lesson.notes = 'Great progress with past tense conjugations today. Your conversational fluency improved noticeably — keep practicing irregular verbs.';
      break;
    case '__mock_student_generating__':
      lesson.aiAnalysis = { status: 'generating', hasAnalysis: false };
      lesson.notes = 'Analysis is being generated…';
      break;
    case '__mock_student_awaiting__':
      lesson.tutorFeedback = { status: 'pending', required: true };
      lesson.requiresTutorFeedback = true;
      lesson.notes = 'Waiting for your tutor to submit feedback for this lesson.';
      break;
    case '__mock_student_tip__':
      lesson.aiAnalysis = {
        status: 'completed',
        hasAnalysis: true,
        overallAssessment: {
          proficiencyLevel: 'B1 – Intermediate',
          confidence: 88,
          summary: 'Excellent session on subjunctive mood — you nailed the conditional triggers. Review irregular stems before next week.',
        },
        grammarAnalysis: { accuracyScore: 80 },
        vocabularyAnalysis: { uniqueWordCount: 92, vocabularyRange: 'Upper-Intermediate' },
        fluencyAnalysis: { overallFluencyScore: 76 },
        pronunciationAnalysis: { overallScore: 79 },
        topicsDiscussed: ['Subjunctive mood', 'Conditional triggers', 'Expressing wishes'],
        recommendedFocus: ['Irregular subjunctive stems', 'Si clauses with imperfect subjunctive'],
        homeworkSuggestions: ['Practice 10 subjunctive trigger sentences', 'Listen to podcast episode 12 on conditionals'],
        studentSummary: 'Strong grasp of subjunctive triggers. Irregular verb stems need targeted practice.',
      };
      lesson.notes = 'Excellent session on subjunctive mood — you nailed the conditional triggers. Review irregular stems before next week.';
      break;
    case '__mock_student_analysis_empty__':
      lesson.aiAnalysisEnabledAtTime = true;
      break;
    case '__mock_student_tutor_feedback__':
      lesson.tutorFeedback = {
        _id: `mock-fb-${id}`,
        lessonId: id,
        tutorId: lesson.tutorId?._id || '',
        studentId: lesson.studentId?._id || '',
        status: 'completed',
        strengths: ['Good pronunciation', 'Active participation', 'Quick recall of vocabulary'],
        areasForImprovement: ['Listening comprehension', 'Irregular verb conjugation'],
        homework: 'Complete exercises 4-6 in workbook chapter 3. Practice listening with a 5-minute podcast daily.',
        overallNotes: 'Student has a strong foundation in grammar but needs to work on listening comprehension. Recommend more exposure to native-speed audio content.',
        estimatedCefrLevel: 'B1',
        required: true,
        providedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        remindersSent: 0,
      };
      lesson.tutorNote = {
        text: 'Focus on listening comprehension next session. Try podcast exercises from unit 5.',
      };
      lesson.notes = 'Focus on listening comprehension next session. Try podcast exercises from unit 5.';
      break;
    case '__mock_tutor_completed__':
      lesson.tutorNote = {
        text: 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.',
      };
      lesson.notes = 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.';
      break;
    case '__mock_tutor_feedback_needed__':
      // AI was DISABLED → tutor feedback required, banner visible, skip hidden
      lesson.aiAnalysisEnabledAtTime = false;
      lesson.requiresTutorFeedback = true;
      lesson.tutorFeedback = { _id: `mock-fb-${id}`, lessonId: id, tutorId: lesson.tutorId?._id || '', studentId: lesson.studentId?._id || '', status: 'pending', required: true, strengths: [], areasForImprovement: [], homework: '', overallNotes: '', createdAt: new Date().toISOString(), remindersSent: 0 };
      lesson.notes = 'Feedback has not been submitted yet.';
      break;
    case '__mock_tutor_feedback_optional__':
      // AI was ENABLED → tutor feedback is optional, no banner, skip visible
      lesson.aiAnalysisEnabledAtTime = true;
      lesson.notes = 'Optional note: AI handled the analysis for this lesson.';
      break;
    case '__mock_tutor_tip_received__':
      lesson.tutorNote = {
        text: 'Reviewed reading comprehension strategies. Student showed strong analytical skills with short passages.',
      };
      lesson.tip = {
        amount: 8,
        paidAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        stripeFee: 0.53,
        tutorReceived: 7.47,
      };
      break;
    case '__mock_tutor_no_notes__':
      break;
    case '__mock_tutor_cancelled__':
      lesson.cancelledBy = 'student';
      lesson.cancelReason = 'schedule_conflict';
      lesson.cancelReasonText = 'Schedule conflict';
      lesson.cancelledAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '__mock_student_cancelled__':
      lesson.cancelledBy = 'tutor';
      lesson.cancelReason = 'tutor_unavailable';
      lesson.cancelReasonText = 'Tutor unavailable';
      lesson.cancelledAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '__mock_student_upcoming__':
      lesson.lastSessionContext = {
        isFirstLesson: false,
        summary: 'Great progress with past tense conjugations today. Your conversational fluency improved noticeably — keep practicing irregular verbs.',
        recommendedFocus: ['Irregular preterite verbs', 'Ser vs estar contextual usage'],
      };
      break;
    case '__mock_tutor_upcoming__':
      lesson.lastSessionContext = {
        isFirstLesson: false,
        summary: 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.',
        recommendedFocus: ['Contextual ser/estar', 'Irregular preterite'],
      };
      break;
    default:
      break;
  }
}

// ── Mock Recommended Materials ──────────────────────────────────────

export interface MockRecommendedMaterial {
  _id: string;
  title: string;
  description: string;
  language: string;
  level: string;
  materialType: string;
  thumbnailUrl: string;
  topics: string[];
  pricingType: string;
  price: number;
  status: string;
  stats: { views: number; quizAttempts: number; purchases: number; averageScore: number };
  tutorId: { _id: string; firstName: string; lastName: string; picture: string };
  isSaved: boolean;
  _matchedStruggles: string[];
  _isCurrentTutor: boolean;
}

const MOCK_RECS: MockRecommendedMaterial[] = [
  {
    _id: 'mock-rec-1',
    title: 'Irregular Preterite Verbs: Master the Basics',
    description: 'Practice the most common irregular preterite verbs through interactive exercises.',
    language: 'Spanish',
    level: 'intermediate',
    materialType: 'video_quiz',
    thumbnailUrl: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=220&fit=crop',
    topics: ['irregular verbs', 'preterite', 'grammar'],
    pricingType: 'free',
    price: 0,
    status: 'published',
    stats: { views: 312, quizAttempts: 89, purchases: 0, averageScore: 72 },
    tutorId: { _id: 'mock-tutor-rec-1', firstName: 'Maria', lastName: 'Garcia', picture: 'https://randomuser.me/api/portraits/women/44.jpg' },
    isSaved: false,
    _matchedStruggles: ['irregular preterite verbs'],
    _isCurrentTutor: true,
  },
  {
    _id: 'mock-rec-2',
    title: 'Ser vs Estar: When to Use Each',
    description: 'A comprehensive reading guide with practice sentences for ser and estar.',
    language: 'Spanish',
    level: 'intermediate',
    materialType: 'reading',
    thumbnailUrl: 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=400&h=220&fit=crop',
    topics: ['ser vs estar', 'grammar', 'contextual usage'],
    pricingType: 'free',
    price: 0,
    status: 'published',
    stats: { views: 245, quizAttempts: 67, purchases: 0, averageScore: 68 },
    tutorId: { _id: 'mock-tutor-rec-2', firstName: 'Carlos', lastName: 'Mendez', picture: 'https://randomuser.me/api/portraits/men/32.jpg' },
    isSaved: false,
    _matchedStruggles: ['ser vs estar contextual usage'],
    _isCurrentTutor: false,
  },
  {
    _id: 'mock-rec-3',
    title: 'Daily Routines Listening Practice',
    description: 'Listen to native speakers describe their daily routines and answer comprehension questions.',
    language: 'Spanish',
    level: 'intermediate',
    materialType: 'listening',
    thumbnailUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop',
    topics: ['daily routines', 'listening comprehension', 'vocabulary'],
    pricingType: 'free',
    price: 0,
    status: 'published',
    stats: { views: 189, quizAttempts: 45, purchases: 0, averageScore: 75 },
    tutorId: { _id: 'mock-tutor-rec-1', firstName: 'Maria', lastName: 'Garcia', picture: 'https://randomuser.me/api/portraits/women/44.jpg' },
    isSaved: true,
    _matchedStruggles: ['daily routines'],
    _isCurrentTutor: true,
  },
  {
    _id: 'mock-rec-4',
    title: 'Past Tense Narration Workshop',
    description: 'Build your storytelling skills using preterite and imperfect tenses together.',
    language: 'Spanish',
    level: 'intermediate',
    materialType: 'video_quiz',
    thumbnailUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&h=220&fit=crop',
    topics: ['past tense', 'narration', 'preterite vs imperfect'],
    pricingType: 'paid',
    price: 3,
    status: 'published',
    stats: { views: 156, quizAttempts: 38, purchases: 22, averageScore: 70 },
    tutorId: { _id: 'mock-tutor-rec-3', firstName: 'Ana', lastName: 'Lopez', picture: 'https://randomuser.me/api/portraits/women/65.jpg' },
    isSaved: false,
    _matchedStruggles: ['past tense narration'],
    _isCurrentTutor: false,
  },
];

export function getMockRecommendedMaterials(mockId: string): MockRecommendedMaterial[] {
  const spec = LESSON_MOCK_SPECS.find(s => s.id === mockId);
  if (!spec) return [];
  if (spec.cardRole !== 'student') return [];
  if (spec.status === 'cancelled' || spec.status === 'scheduled') return [];
  const showIds = ['__mock_student_completed__', '__mock_student_tip__', '__mock_student_tutor_feedback__'];
  if (!showIds.includes(mockId)) return [];
  return MOCK_RECS;
}

export function buildMockCachedLessonDetail(
  id: string,
  listLesson: Lesson | undefined,
  currentUserId: string | undefined,
): CachedLessonDetail {
  const uid =
    currentUserId ||
    String((listLesson as any)?.studentId?._id || (listLesson as any)?.tutorId?._id || 'preview-user');
  const lesson = buildMockLessonForId(id, uid);
  if (!lesson) {
    const empty: CachedLessonDetail = {
      detail: null,
      payment: null,
      billing: null,
      fingerprint: '',
    };
    return empty;
  }
  const spec = LESSON_MOCK_SPECS.find(s => s.id === id);

  const detail: LessonDetailResponse = {
    success: true,
    lesson,
    lessonsCompleted: 12,
    tutorStats: { rating: 4.9, totalLessons: 240, students: 18 },
  };

  const billing: BillingData = {
    actualPrice: spec?.actualPrice ?? spec?.price ?? lesson.price,
    actualDuration: spec?.actualDurationMin ?? spec?.durationMin ?? lesson.duration,
    estimatedPrice: lesson.price,
    estimatedDuration: lesson.duration,
    status: lesson.status === 'cancelled' ? 'cancelled' : 'completed',
  };

  const payment: PaymentData = {
    status: lesson.status === 'cancelled' ? 'cancelled' : 'succeeded',
    amount: lesson.price ?? 0,
    transferStatus: 'paid',
    tutorPayout: (lesson.price || 0) * 0.75,
  };

  const fingerprint = `${lesson.status}|mock|${lesson.price}|${lesson.tip?.amount ?? ''}`;
  return { detail, payment, billing, fingerprint };
}
