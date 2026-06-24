import { Lesson } from '../services/lesson.service';
import { LearningPlanSummary, LessonPrep } from '../services/learning-plan.service';

/** Keep in sync with mobile `lessonMockPreview.ts` */
export function isLessonMockId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('__mock_');
}

export interface LessonMockSpec {
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

export const LESSON_MOCK_SPECS: LessonMockSpec[] = [
  /** Tutor-perspective lesson detail — listed on the student lessons screen for design QA. */
  { id: '__mock_preview_tutor_view__', cardRole: 'tutor', status: 'scheduled', durationMin: 60, price: 40, otherName: 'James L.', otherPicture: 'https://randomuser.me/api/portraits/men/22.jpg' },
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

function timeWindow(status: LessonMockSpec['status'], durationMin: number): { start: Date; end: Date } {
  const now = Date.now();
  if (status === 'scheduled') {
    const start = new Date(now + 3 * 24 * 60 * 60 * 1000);
    return { start, end: new Date(start.getTime() + durationMin * 60000) };
  }
  const start = new Date(now - 4 * 24 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + durationMin * 60000) };
}

/**
 * Builds a lesson-shaped object for event details / API preview (no network).
 */
export function buildMockLessonEntity(
  id: string,
  currentUser: { _id?: string; id?: string; userType?: string } | null,
): Lesson | null {
  if (!currentUser) return null;

  const spec = LESSON_MOCK_SPECS.find(s => s.id === id);
  if (!spec) {
    return null;
  }

  const uid = String(currentUser._id || currentUser.id || '');
  const accountIsTutor = currentUser.userType === 'tutor';
  const { start, end } = timeWindow(spec.status, spec.durationMin);
  const { firstName, lastName } = parseName(spec.otherName);

  const other = {
    _id: `mock-other-${spec.id}`,
    firstName,
    lastName,
    name: spec.otherName.replace(/\.$/, '').trim(),
    email: 'preview@example.com',
    picture: spec.otherPicture,
  };

  const me = {
    _id: uid,
    firstName: 'You',
    lastName: '',
    name: 'You',
    email: 'you@example.com',
    picture: '',
  };

  // Assign tutorId/studentId so the detail page's role detection
  // sees the logged-in user in the correct participant slot for the
  // mock's intended viewing role (cardRole).
  let tutorId: typeof other;
  let studentId: typeof other;
  if (spec.cardRole === 'tutor') {
    // Viewer should be seen as the tutor
    tutorId = accountIsTutor ? me : (me as typeof other);
    studentId = other;
  } else {
    // Viewer should be seen as the student
    tutorId = other;
    studentId = accountIsTutor ? (me as typeof other) : me;
  }

  const lesson: any = {
    _id: id,
    _mockViewRole: spec.cardRole,
    status: spec.status,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: spec.durationMin,
    subject: 'Spanish',
    language: 'Spanish',
    price: spec.price,
    tutorId: tutorId as any,
    studentId: studentId as any,
    isTrialLesson: !!spec.isTrial,
    channelName: 'preview',
    createdAt: start.toISOString(),
    updatedAt: end.toISOString(),
    tip: spec.tipSent ? ({ amount: spec.cardRole === 'tutor' ? 8 : 5 } as any) : undefined,
  };

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
      lesson.tutorNote = {
        text: 'Buen progreso con el pretérito hoy. Sigue practicando los verbos irregulares antes de la próxima sesión.',
      };
      lesson.tutorFeedback = {
        status: 'completed',
        strengths: ['Good pronunciation of vowel sounds', 'Active participation throughout'],
        areasForImprovement: ['Irregular preterite verbs still inconsistent', 'Ser vs estar in past contexts'],
        overallNotes: 'Great session! You are building a solid base in past tense narration. Keep up the daily listening practice.',
        estimatedCefrLevel: 'B1',
        providedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
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
      lesson.aiAnalysis = {
        status: 'completed',
        hasAnalysis: true,
        overallAssessment: {
          proficiencyLevel: 'B1 – Intermediate',
          confidence: 78,
          summary: 'Solid work on ser vs estar in present tense. Temporary vs permanent states still need contextual practice.',
          progressFromLastLesson: 'Maintained B1 level with clearer self-corrections.',
        },
        grammarAnalysis: { accuracyScore: 70 },
        vocabularyAnalysis: { uniqueWordCount: 80, vocabularyRange: 'Intermediate' },
        fluencyAnalysis: { overallFluencyScore: 66 },
        pronunciationAnalysis: { overallScore: 74 },
        topicsDiscussed: ['Ser vs estar', 'Temporary states', 'Daily routines'],
        recommendedFocus: ['Contextual ser/estar', 'Irregular preterite'],
        studentSummary: 'Good session — push on past tense next.',
      };
      lesson.tutorNote = {
        text: 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.',
      };
      lesson.notes = 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.';
      lesson.tutorFeedback = {
        status: 'completed',
        strengths: ['Consistent effort throughout the session', 'Good pronunciation of rolled r'],
        areasForImprovement: ['Ser vs estar in temporary states', 'Irregular preterite stems (ir, ser, tener)'],
        overallNotes: 'Solid session overall. Recommend 10 minutes of daily conjugation drilling before next lesson.',
        estimatedCefrLevel: 'B1',
        providedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      };
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
      lesson.aiAnalysis = {
        status: 'completed',
        hasAnalysis: true,
        overallAssessment: {
          proficiencyLevel: 'B2 – Upper Intermediate',
          confidence: 85,
          summary: 'Excellent reading comprehension work. Strong analytical skills with short passages.',
          progressFromLastLesson: 'Noticeable improvement in reading speed and inference.',
        },
        grammarAnalysis: { accuracyScore: 80 },
        vocabularyAnalysis: { uniqueWordCount: 98, vocabularyRange: 'Upper-Intermediate' },
        fluencyAnalysis: { overallFluencyScore: 74 },
        pronunciationAnalysis: { overallScore: 78 },
        topicsDiscussed: ['Reading comprehension', 'Analytical passages', 'Vocabulary in context'],
        recommendedFocus: ['Complex sentence structures', 'Advanced vocabulary usage'],
      };
      lesson.tutorNote = {
        text: 'Reviewed reading comprehension strategies. Student showed strong analytical skills with short passages.',
      };
      lesson.notes = 'Reviewed reading comprehension strategies. Student showed strong analytical skills with short passages.';
      lesson.tutorFeedback = {
        status: 'completed',
        strengths: ['Excellent reading speed', 'Strong inference skills', 'Good vocabulary recall'],
        areasForImprovement: ['Complex grammatical structures in written tasks'],
        overallNotes: 'Outstanding session. Student clearly put in the extra study time — the tip is very appreciated!',
        estimatedCefrLevel: 'B2',
        providedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
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
        summaryLanguage: 'es',
        summaryTranslatable: true,
      };
      break;
    case '__mock_tutor_upcoming__':
    case '__mock_preview_tutor_view__':
      lesson.lastSessionContext = {
        isFirstLesson: false,
        summary: 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.',
        recommendedFocus: ['Contextual ser/estar', 'Irregular preterite'],
        summaryLanguage: 'es',
        summaryTranslatable: true,
      };
      break;
    default:
      break;
  }
}

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
  _typeIcon: string;
  _typeLabel: string;
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
    _typeIcon: 'videocam',
    _typeLabel: 'VIDEO QUIZ',
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
    _typeIcon: 'book',
    _typeLabel: 'READING',
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
    _typeIcon: 'headset',
    _typeLabel: 'LISTENING',
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
    _typeIcon: 'videocam',
    _typeLabel: 'VIDEO QUIZ',
  },
];

/**
 * Returns mock recommended materials for student mock IDs that have analysis data.
 * Tutor mocks + cancelled/upcoming return empty.
 */
export function getMockRecommendedMaterials(mockId: string): MockRecommendedMaterial[] {
  const spec = LESSON_MOCK_SPECS.find(s => s.id === mockId);
  if (!spec) return [];
  if (spec.cardRole !== 'student') return [];
  if (spec.status === 'cancelled' || spec.status === 'scheduled') return [];
  // Only show recs for mocks that have analysis or tutor feedback
  const showIds = ['__mock_student_completed__', '__mock_student_tip__', '__mock_student_tutor_feedback__'];
  if (!showIds.includes(mockId)) return [];
  return MOCK_RECS;
}

export interface MockPaymentBreakdownRow {
  /** Suffix under EVENT_DETAILS.PAYMENT (e.g. ROW_LESSON_PRICE) */
  key: string;
  value: string;
}

export interface MockBillingPayment {
  billing: { actualPrice?: number; actualDuration?: number; estimatedPrice?: number; estimatedDuration?: number; status?: string };
  payment: { status?: string; amount?: number; transferStatus?: string; tutorPayout?: number };
  /** Preview-only rows appended after computePaymentStatus (student mocks). */
  breakdown?: MockPaymentBreakdownRow[];
  /** Preview-only payment method label source (student mocks). */
  paymentMethod?: string;
}

/** Preview payment extras — student mock with expandable breakdown. */
const MOCK_PAYMENT_EXTRAS: Record<string, Pick<MockBillingPayment, 'breakdown' | 'paymentMethod'>> = {
  '__mock_student_completed__': {
    paymentMethod: 'wallet',
    breakdown: [
      { key: 'ROW_LESSON_PRICE', value: '$25.00' },
      { key: 'ROW_FINAL_CHARGE', value: '$25.00' },
    ],
  },
  '__mock_student_awaiting__': {
    paymentMethod: 'card',
    breakdown: [
      { key: 'ROW_LESSON_PRICE', value: '$25.00' },
      { key: 'ROW_FINAL_CHARGE', value: '$25.00' },
    ],
  },
  '__mock_student_tip__': {
    paymentMethod: 'card',
    breakdown: [
      { key: 'ROW_LESSON_PRICE', value: '$35.00' },
      { key: 'ROW_TIP_SENT', value: '$5.00' },
      { key: 'ROW_FINAL_CHARGE', value: '$40.00' },
    ],
  },
  '__mock_student_generating__': {
    paymentMethod: 'apple_pay',
    breakdown: [
      { key: 'ROW_LESSON_PRICE', value: '$25.00' },
      { key: 'ROW_FINAL_CHARGE', value: '$25.00' },
    ],
  },
  '__mock_student_analysis_empty__': {
    paymentMethod: 'wallet',
    breakdown: [
      { key: 'ROW_LESSON_PRICE', value: '$20.00' },
      { key: 'ROW_FINAL_CHARGE', value: '$20.00' },
    ],
  },
  '__mock_student_tutor_feedback__': {
    paymentMethod: 'card',
    breakdown: [
      { key: 'ROW_LESSON_PRICE', value: '$30.00' },
      { key: 'ROW_FINAL_CHARGE', value: '$30.00' },
    ],
  },
};

/** Mock IDs that show the Learning focus section on event details. */
const MOCK_IDS_WITH_LEARNING_PLAN = new Set([
  '__mock_preview_tutor_view__',
  '__mock_student_upcoming__',
  '__mock_tutor_upcoming__',
  '__mock_student_completed__',
  '__mock_tutor_completed__',
  '__mock_student_tip__',
  '__mock_tutor_tip_received__',
  '__mock_student_tutor_feedback__',
  '__mock_student_awaiting__',
  '__mock_student_generating__',
  '__mock_student_analysis_empty__',
  '__mock_tutor_feedback_needed__',
  '__mock_tutor_feedback_optional__',
  '__mock_tutor_no_notes__',
]);

const MOCK_SPANISH_PLAN_SUMMARY: LearningPlanSummary = {
  _id: 'mock-plan-spanish',
  language: 'Spanish',
  status: 'active',
  goal: {
    type: 'travel',
    description: 'Get comfortable speaking before a trip to Barcelona',
    targetLevel: 'B1',
    timeline: '3 months',
    timelinePressure: 'few_months',
  },
  currentPhaseIndex: 1,
  totalPhases: 4,
  currentPhase: {
    title: 'Past Tense & Storytelling',
    description: 'Tell short stories about past events using preterite and imperfect naturally.',
    focusAreas: [
      'Irregular preterite verbs',
      'Ser vs estar in past contexts',
      'Narrating weekend events',
    ],
    suggestedTopics: ['Weekend recap', 'Travel stories', 'Childhood memories'],
    exitCriteria: 'Can narrate a 2-minute past event with mostly accurate verb forms',
    estimatedLessons: 6,
    lessonsCompleted: 2,
    status: 'active',
  },
  studentSummary:
    'Building conversational confidence for an upcoming trip. Prefers speaking practice over heavy grammar drills.',
  nextLessonFocus:
    'Practice irregular preterite verbs in natural conversation — weave in ser vs estar when describing past states.',
  tutorOverrides: [],
  selfAssessedLevel: 'simple_conversations',
  chapterTheme: 'a2-coast',
  chapterLevel: 'A2',
  phases: [
    { title: 'Getting Around Town', status: 'completed' },
    { title: 'Past Tense & Storytelling', status: 'active' },
    { title: 'Social Interactions', status: 'locked' },
    { title: 'Exploring Culture', status: 'locked' },
  ],
};

function buildMockLessonPrep(summary: LearningPlanSummary, includeBriefing: boolean): LessonPrep {
  const phase = summary.currentPhase!;
  return {
    plan: {
      _id: summary._id,
      language: summary.language,
      status: summary.status,
      goal: summary.goal,
      studentSummary: summary.studentSummary,
      nextLessonFocus: summary.nextLessonFocus,
      currentPhaseIndex: summary.currentPhaseIndex,
      totalPhases: summary.totalPhases,
      currentPhase: {
        title: phase.title,
        description: phase.description,
        focusAreas: phase.focusAreas,
        suggestedTopics: phase.suggestedTopics,
        exitCriteria: phase.exitCriteria,
        lessonsCompleted: phase.lessonsCompleted,
        estimatedLessons: phase.estimatedLessons,
        masteryAverage: includeBriefing ? 62 : null,
        lessonScores: includeBriefing ? [58, 65] : [],
      },
      tutorOverrides: summary.tutorOverrides,
    },
    latestAnalysis: includeBriefing
      ? {
          lessonId: 'mock-prev-lesson',
          lessonDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          proficiencyLevel: 'B1',
          summary:
            'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states.',
          topErrors: [
            { rank: 1, issue: 'Ser vs estar with temporary states', impact: 'high', occurrences: 4 },
            { rank: 2, issue: 'Irregular preterite stems (ir, ser)', impact: 'medium', occurrences: 3 },
          ],
          errorPatterns: [{ pattern: 'State vs identity confusion', severity: 'medium' }],
          persistentChallenges: ['Ser vs estar', 'Irregular preterite'],
          proficiencyChange: 'maintained',
          areasForImprovement: ['Contextual ser/estar', 'Irregular preterite'],
          recommendedFocus: ['Contextual ser/estar', 'Irregular preterite'],
          correctedExcerpts: [
            {
              original: 'Yo estoy cansado ayer',
              corrected: 'Yo estaba cansado ayer',
              keyCorrections: ['Imperfect for past state'],
            },
          ],
        }
      : null,
    agenda: [
      'Warm up with a quick weekend recap using preterite',
      'Target irregular verbs: ir, ser, tener in past-tense dialogue',
      'Close with a 1-minute story using ser vs estar for past states',
    ],
    priorLessonCount: includeBriefing ? 3 : 1,
    firstTimePairing: false,
    otherTutorNotes: includeBriefing
      ? [{ tutorFirstName: 'Ana', text: 'Strong vocabulary — push harder on verb accuracy.', setAt: new Date().toISOString() }]
      : [],
  };
}

/**
 * Returns mock plan + lesson-prep for event-details preview (no network).
 * Tutor upcoming mocks include the full briefing payload.
 */
export function getMockLearningPlanContext(
  mockId: string
): { summary: LearningPlanSummary; prep: LessonPrep } | null {
  if (!MOCK_IDS_WITH_LEARNING_PLAN.has(mockId)) return null;
  const includeBriefing =
    mockId === '__mock_preview_tutor_view__' ||
    mockId === '__mock_tutor_upcoming__' ||
    mockId === '__mock_tutor_completed__' ||
    mockId === '__mock_tutor_tip_received__' ||
    mockId === '__mock_tutor_feedback_needed__' ||
    mockId === '__mock_tutor_feedback_optional__' ||
    mockId === '__mock_tutor_no_notes__';
  return {
    summary: MOCK_SPANISH_PLAN_SUMMARY,
    prep: buildMockLessonPrep(MOCK_SPANISH_PLAN_SUMMARY, includeBriefing),
  };
}

export function getMockBillingAndPayment(id: string): MockBillingPayment | null {
  const spec = LESSON_MOCK_SPECS.find(s => s.id === id);
  if (!spec) return null;
  const ap = spec.actualPrice ?? spec.price;
  const ad = spec.actualDurationMin ?? spec.durationMin;
  const billing = {
    actualPrice: ap,
    actualDuration: ad,
    estimatedPrice: spec.price,
    estimatedDuration: spec.durationMin,
    status: spec.status === 'cancelled' ? 'cancelled' : 'completed',
  };
  const payment = {
    status: spec.status === 'cancelled' ? 'cancelled' : 'succeeded',
    amount: spec.price,
    transferStatus: 'paid',
    tutorPayout: Math.round(spec.price * 0.75 * 100) / 100,
  };
  const extras = MOCK_PAYMENT_EXTRAS[id];
  return {
    billing,
    payment,
    breakdown: extras?.breakdown,
    paymentMethod: extras?.paymentMethod,
  };
}
