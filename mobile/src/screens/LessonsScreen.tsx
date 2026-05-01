import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Image,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Platform,
  findNodeHandle,
  UIManager,
  Animated as RNAnimated,
  Easing,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { useHomeTabBarOverlay } from '../contexts/HomeTabBarOverlayContext';
import { lessonService, Lesson, getLessonEnd, getLessonStart, clearDetailCache } from '../services/lessons';
import { buildMockLessonForId } from '../utils/lessonMockPreview';
import { getMyClasses } from '../services/classes';
import {
  buildProcessedLessonCard,
  classRecordToLesson,
  filterLessonsByStatus,
  sortLessonsNewestFirst,
  ProcessedLessonCard,
  StatusFilter,
} from '../utils/lessonCardModel';
import LessonDetailOverlay, { CardRect } from '../components/LessonDetailOverlay';
import { ClassGoingMessageModal, type ClassGoingMessageRequest } from '../components/ClassGoingMessageModal';
import { LessonDateHeaderCenter } from '../components/LessonDateHeaderCenter';
import { cardShadowDark } from '../utils/cardShadow';
import { lessonFeedbackBanner } from '../utils/lessonFeedbackBannerColors';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

/** Matches web lessons `.lgc-avatar`: 80×80 rounded square (~¼ radius), hairline border. */
const LESSON_CARD_AVATAR = 80;
const LESSON_CARD_AVATAR_RADIUS = Math.round(LESSON_CARD_AVATAR * 0.25);
/** Web `.lgc-class-thumb` — fixed height strip, not 16:9 */
const LESSON_CLASS_COVER_HEIGHT = 80;

// Matches the overlay's morph spring so the background recede and the
// overlay expand are perfectly in sync.
const OVERLAY_SPRING = { duration: 520, dampingRatio: 0.94 } as const;

// Matches HomeScreen scroll content paddingHorizontal
const CONTENT_PAD = 20;

const SPINNER_COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

function AiGeneratingSpinner() {
  const spin = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      spin.setValue(0);
      RNAnimated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!cancelled && finished) run();
      });
    };
    run();
    return () => { cancelled = true; spin.stopAnimation(); };
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={spinnerStyles.wrap}>
      <RNAnimated.View style={[spinnerStyles.ring, { transform: [{ rotate }] }]}>
        {SPINNER_COLORS.slice(0, 6).map((color, i) => (
          <View
            key={i}
            style={[
              spinnerStyles.dot,
              {
                backgroundColor: color,
                opacity: 0.35 + (i / 5) * 0.65,
                transform: [
                  { rotate: `${i * 60}deg` },
                  { translateY: -14 },
                ],
              },
            ]}
          />
        ))}
      </RNAnimated.View>
      <Text style={spinnerStyles.label}>Generating analysis…</Text>
    </View>
  );
}

const spinnerStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  ring: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8b8b8e',
  },
});

export default function LessonsScreen() {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { setLessonOverlayCoversTabBar } = useHomeTabBarOverlay();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allLessons, setAllLessons] = useState<Lesson[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | '7days' | '30days' | '3months'>('all');
  const [tutorFilter, setTutorFilter] = useState('all');
  const [studentFilter, setStudentFilter] = useState('all');
  const [lessonTypeFilter, setLessonTypeFilter] = useState<'all' | 'one-on-one' | 'class'>('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [filterHasTip, setFilterHasTip] = useState(false);
  const [filterOutstandingFeedback, setFilterOutstandingFeedback] = useState(false);
  const [filterIsTrial, setFilterIsTrial] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [overlayCard, setOverlayCard] = useState<ProcessedLessonCard | null>(null);
  const [overlayRect, setOverlayRect] = useState<CardRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [overlayThumbnailRect, setOverlayThumbnailRect] = useState<CardRect | null>(null);
  const [overlayClosing, setOverlayClosing] = useState(false);
  const [classGoingMessage, setClassGoingMessage] = useState<ClassGoingMessageRequest | null>(null);
  const navigation = useNavigation<any>();
  const cardRefs = useRef<Record<string, View | null>>({});
  const classCoverRefs = useRef<Record<string, View | null>>({});

  // Source card painting during the overlay close.
  //
  // Key idea: there is NO fade-in animation on the card. The moment the
  // overlay reports `onBeginReveal` (fired synchronously at close-start,
  // not at the end), we snap `cardRevealOpacity` from 0 to 1 in a single
  // frame. From that point on the source card is fully painted at its
  // natural position, just hidden behind the overlay's opaque surface.
  //
  // As the overlay's surface fades out in its tail (driven inside the
  // overlay by `surfaceStyle.opacity`), the card underneath is revealed —
  // already at 100% opacity, so there is no opacity-vs-opacity cross-fade
  // where two sets of text ("APR 7" vs "APR 18", two time lines, two
  // stats grids) can ghost through each other. One surface fading out,
  // ONE card underneath. Matches the "same line is just shrinking" feel
  // the user wants rather than a blurred two-layer fade.
  const cardRevealOpacity = useRef(new RNAnimated.Value(0)).current;
  const beginCardReveal = useCallback(() => {
    cardRevealOpacity.setValue(1);
  }, [cardRevealOpacity]);

  // Background recede — the list page subtly scales + shifts down as the
  // overlay expands, giving the detail a sense of depth (like Airbnb /
  // App Store detail transitions). 0 = list at rest, 1 = fully receded.
  // Synced to the overlay's morph spring so the two motions feel like one.
  const listRecede = useSharedValue(0);
  const listRecedeStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(listRecede.value, [0, 1], [1, 0.94], Extrapolation.CLAMP) },
      { translateY: interpolate(listRecede.value, [0, 1], [0, 40], Extrapolation.CLAMP) },
    ],
    // Round the top corners of the receded page so it visually reads as a
    // sheet behind the detail — flat corners (0) feel like a paused tab,
    // rounded (22) match Airbnb's stacked-sheet look.
    borderRadius: interpolate(listRecede.value, [0, 1], [0, 62], Extrapolation.CLAMP),
  }));
  // __DEV__-only: controls the native shared-element prototype modal.
  // Kept out of any persisted state on purpose — we never want this leaking
  // into a production build surface.

  const userTz = user?.profile?.timezone as string | undefined;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [lessonList, classRecords] = await Promise.all([
          lessonService.getMyLessons(),
          getMyClasses(),
        ]);
        const classesAsLessons: Lesson[] = (classRecords || [])
          .filter(c => (c.status || 'scheduled') !== 'draft')
          .map(c => classRecordToLesson(c, user, t));
        const merged = [...lessonList, ...classesAsLessons]
          .filter(l => !(l.status === 'cancelled' && (l as any).cancelReason === 'payment_failed'))
          .sort((a, b) => getLessonStart(b).getTime() - getLessonStart(a).getTime());
        setAllLessons(merged);
      } catch {
        setAllLessons([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user, t],
  );

  useFocusEffect(
    useCallback(() => {
      load(true);
      return () => {
        clearDetailCache();
      };
    }, [load]),
  );

  const uniqueTutors = useMemo(() => {
    if (user?.userType !== 'student') return [];
    const map = new Map<string, { id: string; name: string }>();
    allLessons.forEach(l => {
      const tutor = l.tutorId as any;
      const id = String(tutor?._id || tutor?.id || tutor || '');
      if (!id || map.has(id)) return;
      const name = tutor?.name || (tutor?.firstName ? `${tutor.firstName} ${(tutor.lastName || '').charAt(0)}.`.trim() : '') || t('LESSONS_PAGE.UNKNOWN');
      map.set(id, { id, name });
    });
    return Array.from(map.values());
  }, [allLessons, user, t]);

  const uniqueStudents = useMemo(() => {
    if (user?.userType !== 'tutor') return [];
    const map = new Map<string, { id: string; name: string }>();
    allLessons.forEach(l => {
      const student = l.studentId as any;
      const id = String(student?._id || student?.id || student || '');
      if (!id || map.has(id)) return;
      const name = student?.name || (student?.firstName ? `${student.firstName} ${(student.lastName || '').charAt(0)}.`.trim() : '') || t('LESSONS_PAGE.UNKNOWN');
      map.set(id, { id, name });
    });
    return Array.from(map.values());
  }, [allLessons, user, t]);

  const uniqueSubjects = useMemo(() => {
    const seen = new Set<string>();
    allLessons.forEach(l => {
      const s = ((l as any).subject || '').trim();
      if (s && !(l as any).isClass) seen.add(s);
    });
    return Array.from(seen).sort();
  }, [allLessons]);

  const filtered = useMemo(() => {
    let list = filterLessonsByStatus(allLessons, statusFilter);

    if (timeFilter !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (timeFilter === '7days') cutoff.setDate(now.getDate() - 7);
      else if (timeFilter === '30days') cutoff.setDate(now.getDate() - 30);
      else if (timeFilter === '3months') cutoff.setMonth(now.getMonth() - 3);
      list = list.filter(l => getLessonStart(l) >= cutoff);
    }

    if (lessonTypeFilter === 'class') list = list.filter(l => !!(l as any).isClass);
    else if (lessonTypeFilter === 'one-on-one') list = list.filter(l => !(l as any).isClass);

    if (subjectFilter !== 'all') {
      list = list.filter(l => ((l as any).subject || '').trim() === subjectFilter);
    }

    if (tutorFilter !== 'all' && user?.userType === 'student') {
      list = list.filter(l => {
        const tutor = l.tutorId as any;
        return String(tutor?._id || tutor?.id || tutor || '') === tutorFilter;
      });
    }

    if (studentFilter !== 'all' && user?.userType === 'tutor') {
      list = list.filter(l => {
        const student = l.studentId as any;
        return String(student?._id || student?.id || student || '') === studentFilter;
      });
    }

    return sortLessonsNewestFirst(list);
  }, [allLessons, statusFilter, timeFilter, lessonTypeFilter, subjectFilter, tutorFilter, studentFilter, user]);

  const processed = useMemo(() => {
    const cards = filtered.map(l => buildProcessedLessonCard(l, user, t, userTz));

    // ── MOCK: Preview cards (remove after review) ──
    const uid = String(user?._id || user?.id || 'preview-user');
    const mkLesson = (mockId: string) =>
      buildMockLessonForId(mockId, uid) || ({} as any);
    const baseShared = {
      isTrial: false,
      isClass: false,
      className: '',
      classStudentCount: 0,
      classCapacity: 0,
      classAttendees: [] as any[],
      classAttendeesOverflow: 0,
    };
    const dur = t('LESSONS_PAGE.CARD_STAT_DURATION');
    const pri = t('LESSONS_PAGE.CARD_STAT_PRICE');
    const rec = t('LESSONS_PAGE.CARD_STAT_RECEIVED');
    const sta = t('LESSONS_PAGE.CARD_STAT_STATUS');
    const dl = (_mins: number, _isCls = false) => '';
    const withPill = <T extends { formattedTime: string }>(
      row: T,
      weekday: string,
      durationMins: number,
      isCls = false,
    ): T & {
      formattedWeekday: string;
      formattedTimeRange: string;
      durationLabel: string;
      isToday: boolean;
      isPast: boolean;
    } => ({
      ...row,
      formattedWeekday: weekday,
      formattedTimeRange: row.formattedTime,
      durationLabel: dl(durationMins, isCls),
      isToday: false,
      isPast: (row as Partial<ProcessedLessonCard>).isPast ?? false,
    });

    const mocks: ProcessedLessonCard[] = [
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_student_upcoming__'),
        id: '__mock_student_upcoming__',
        role: 'student',
        roleLabel: t('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Carlos R.',
        otherPicture: 'https://randomuser.me/api/portraits/men/32.jpg',
        otherInitials: 'CR',
        formattedDate: 'April 14',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '14',
        formattedTime: '3:00 PM – 4:00 PM',
        status: 'scheduled',
        statusLabel: t('LESSONS_PAGE.STATUS_UPCOMING'),
        cardDescMode: 'schedule',
        cardDescText: t('LESSONS_PAGE.LAST_SESSION_PREFIX') + 'Great progress with past tense conjugations — keep practicing irregular verbs.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$30', label: pri },
          { value: t('LESSONS_PAGE.STATUS_UPCOMING'), label: sta, color: '#1a73e8' },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: false,
      },
      'MON',
      60,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_student_completed__'),
        id: '__mock_student_completed__',
        role: 'student',
        roleLabel: t('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Maria G.',
        otherPicture: 'https://randomuser.me/api/portraits/women/44.jpg',
        otherInitials: 'MG',
        formattedDate: 'April 8',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '8',
        formattedTime: '10:00 AM – 10:45 AM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText: 'Great progress with past tense conjugations today. Your conversational fluency improved noticeably — keep practicing irregular verbs.',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$25', label: pri },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: true,
      },
      'TUE',
      45,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_student_tutor_feedback__'),
        id: '__mock_student_tutor_feedback__',
        role: 'student',
        roleLabel: t('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Liam B.',
        otherPicture: 'https://randomuser.me/api/portraits/men/11.jpg',
        otherInitials: 'LB',
        formattedDate: 'April 6',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '2',
        formattedTime: '1:00 PM – 1:50 PM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText: 'Student has a strong foundation in grammar but needs to work on listening comprehension.',
        cardStats: [
          { value: '50 min', label: dur },
          { value: '$30', label: pri },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: true,
      },
      'WED',
      50,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_student_awaiting__'),
        id: '__mock_student_awaiting__',
        role: 'student',
        roleLabel: t('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Elena V.',
        otherPicture: 'https://randomuser.me/api/portraits/women/21.jpg',
        otherInitials: 'EV',
        formattedDate: 'April 7',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '7',
        formattedTime: '2:00 PM – 2:45 PM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText: '',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$25', label: pri },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: true,
        feedbackPendingForStudent: true,
      },
      'SUN',
      45,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_student_cancelled__'),
        id: '__mock_student_cancelled__',
        role: 'student',
        roleLabel: t('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Lucia P.',
        otherPicture: 'https://randomuser.me/api/portraits/women/68.jpg',
        otherInitials: 'LP',
        formattedDate: 'April 5',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '5',
        formattedTime: '11:00 AM – 11:30 AM',
        status: 'cancelled',
        statusLabel: t('LESSONS_PAGE.STATUS_CANCELLED'),
        cardDescMode: 'schedule',
        cardDescText: t('LESSONS_PAGE.CANCELLED_BY_TUTOR') + ' — Tutor unavailable',
        cardStats: [
          { value: '30 min', label: dur },
          { value: '$15', label: pri },
          { value: t('LESSONS_PAGE.STATUS_CANCELLED'), label: sta },
        ],
        tipSent: false,
        isCancelled: true,
        isPast: true,
      },
      'THU',
      30,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_tutor_tip_received__'),
        id: '__mock_tutor_tip_received__',
        role: 'tutor',
        roleLabel: t('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Daniel K.',
        otherPicture: 'https://randomuser.me/api/portraits/men/46.jpg',
        otherInitials: 'DK',
        formattedDate: 'April 27',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '27',
        formattedTime: '10:10 AM – 11:10 AM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText: 'Reviewed reading comprehension strategies. Student showed strong analytical skills.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$26', label: rec, sub: '+ $8 tip' },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: true,
        isCancelled: false,
        isPast: true,
      },
      'MON',
      60,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_tutor_completed__'),
        id: '__mock_tutor_completed__',
        role: 'tutor',
        roleLabel: t('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Daniel K.',
        otherPicture: 'https://randomuser.me/api/portraits/men/46.jpg',
        otherInitials: 'DK',
        formattedDate: 'April 7',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '7',
        formattedTime: '1:00 PM – 2:00 PM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText:
          'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$28', label: rec },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: true,
      },
      'FRI',
      60,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_tutor_upcoming__'),
        id: '__mock_tutor_upcoming__',
        role: 'tutor',
        roleLabel: t('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'James L.',
        otherPicture: 'https://randomuser.me/api/portraits/men/22.jpg',
        otherInitials: 'JL',
        formattedDate: 'April 15',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '15',
        formattedTime: '11:00 AM – 12:00 PM',
        status: 'scheduled',
        statusLabel: t('LESSONS_PAGE.STATUS_UPCOMING'),
        cardDescMode: 'schedule',
        cardDescText: t('LESSONS_PAGE.LAST_SESSION_PREFIX') + 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$0', label: rec },
          { value: t('LESSONS_PAGE.STATUS_UPCOMING'), label: sta, color: '#1a73e8' },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: false,
      },
      'SAT',
      60,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_tutor_feedback_needed__'),
        id: '__mock_tutor_feedback_needed__',
        role: 'tutor',
        roleLabel: t('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Amy W.',
        otherPicture: 'https://randomuser.me/api/portraits/women/33.jpg',
        otherInitials: 'AW',
        formattedDate: 'April 6',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '6',
        formattedTime: '5:00 PM – 5:45 PM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText: '',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$20', label: rec },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: true,
        needsTutorFeedback: true,
      },
      'SUN',
      45,
      ),
      withPill(
      {
        ...baseShared,
        lesson: mkLesson('__mock_tutor_feedback_optional__'),
        id: '__mock_tutor_feedback_optional__',
        role: 'tutor',
        roleLabel: t('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Olivia C.',
        otherPicture: 'https://randomuser.me/api/portraits/women/12.jpg',
        otherInitials: 'OC',
        formattedDate: 'April 5',
        dateBadgeMonth: 'APR',
        dateBadgeDay: '5',
        formattedTime: '3:00 PM – 4:00 PM',
        status: 'completed',
        statusLabel: t('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText: 'AI analysis handled this lesson — adding a note is optional.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$24', label: rec },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
        isPast: true,
        // AI was enabled → no feedback banner; skip remains visible on post-lesson form
        needsTutorFeedback: false,
      },
      'SAT',
      60,
      ),
    ];
    // Only show mocks matching the logged-in user's account type
    const showRole = user?.userType === 'tutor' ? 'tutor' : 'student';
    const filteredMocks = mocks.filter(p => p.role === showRole);
    cards.unshift(...filteredMocks);
    // ── END MOCK ──

    // Post-process filters (operate on computed card fields)
    let result = cards;
    if (filterHasTip) result = result.filter(p => p.tipSent);
    if (filterIsTrial) result = result.filter(p => p.isTrial);
    if (filterOutstandingFeedback && user?.userType === 'tutor') {
      result = result.filter(p => p.needsTutorFeedback);
    }

    return result;
  }, [filtered, user, t, userTz, filterHasTip, filterIsTrial, filterOutstandingFeedback]);

  const filterModalLabel = (k: StatusFilter) => {
    switch (k) {
      case 'all':
        return t('LESSONS_PAGE.ALL_STATUSES');
      case 'upcoming':
        return t('LESSONS_PAGE.STATUS_UPCOMING');
      case 'completed':
        return t('LESSONS_PAGE.STATUS_COMPLETED');
      case 'cancelled':
        return t('LESSONS_PAGE.STATUS_CANCELLED');
      default:
        return k;
    }
  };

  const activeFilterCount = [
    statusFilter !== 'all',
    timeFilter !== 'all',
    tutorFilter !== 'all',
    studentFilter !== 'all',
    lessonTypeFilter !== 'all',
    subjectFilter !== 'all',
    filterHasTip,
    filterOutstandingFeedback,
    filterIsTrial,
  ].filter(Boolean).length;

  /**
   * Guards against rapid taps that could otherwise race to open multiple
   * overlays / interleave an open with an in-flight close. `openingRef` is
   * flipped synchronously before the async `measureInWindow` fires, so even
   * back-to-back taps in the same render tick are collapsed to a single
   * open. It's cleared when the measurement resolves (on success or
   * failure), and also by `onCloseEnd` once the overlay is fully gone.
   */
  const openingRef = useRef(false);

  // Prefetch every avatar and cover image as soon as the card list is ready,
  // so ExpoImage's disk cache has them before they scroll into view.
  useEffect(() => {
    const urls: string[] = [];
    processed.forEach(pl => {
      if (pl.otherPicture) urls.push(pl.otherPicture);
      if (pl.classCoverUrl) urls.push(pl.classCoverUrl);
      pl.classAttendees.forEach(a => { if (a.picture) urls.push(a.picture); });
    });
    if (urls.length > 0) ExpoImage.prefetch(urls);
  }, [processed]);

  const openDetail = useCallback((pl: ProcessedLessonCard) => {
    if (openingRef.current) return;
    if (overlayCard || overlayClosing) return;
    const ref = cardRefs.current[pl.id];
    if (!ref) return;
    const handle = findNodeHandle(ref);
    if (!handle) return;

    openingRef.current = true;

    // Parallel measurements: the card rect (required) and the class cover
    // thumbnail (optional — only for classes with a cover image). When present
    // the overlay uses it to morph the hero image into the exact list-card
    // thumbnail on close — matching the Up Next card's shared-element feel.
    const measureNode = (node: View | null): Promise<CardRect | null> =>
      new Promise((resolve) => {
        if (!node) return resolve(null);
        const h = findNodeHandle(node);
        if (!h) return resolve(null);
        const measureWin = (node as any).measureInWindow;
        if (typeof measureWin === 'function') {
          measureWin.call(node, (px: number, py: number, w: number, hgt: number) => {
            resolve({ x: px, y: py, width: w, height: hgt });
          });
        } else {
          UIManager.measure(h, (_x, _y, w, hgt, px, py) => {
            resolve({ x: px, y: py, width: w, height: hgt });
          });
        }
      });

    Promise.all([
      measureNode(ref),
      measureNode(classCoverRefs.current[pl.id] ?? null),
    ]).then(([cardRect, thumbRect]) => {
      if (!cardRect) {
        openingRef.current = false;
        return;
      }
      setOverlayRect(cardRect);
      setOverlayThumbnailRect(thumbRect);
      // Reset card reveal opacity to 0 BEFORE the card enters "hidden" mode,
      // so when close eventually fires beginCardReveal it animates from 0.
      cardRevealOpacity.setValue(0);
      // Push the list into its receded state on the same spring the overlay
      // uses — they animate as one motion, not two.
      listRecede.value = withSpring(1, OVERLAY_SPRING);
      setOverlayCard(pl);
      setLessonOverlayCoversTabBar(true);
    }).catch(() => {
      openingRef.current = false;
    });
  }, [overlayCard, overlayClosing, setLessonOverlayCoversTabBar]);

  const clearAllFilters = () => {
    setStatusFilter('all');
    setTimeFilter('all');
    setTutorFilter('all');
    setStudentFilter('all');
    setLessonTypeFilter('all');
    setSubjectFilter('all');
    setFilterHasTip(false);
    setFilterOutstandingFeedback(false);
    setFilterIsTrial(false);
  };

  const renderCard = ({ item: pl }: { item: ProcessedLessonCard }) => {
    const C = colors;
    // The source card is hidden (opacity 0) for the full overlay lifetime
    // EXCEPT during the last ~10% of the close — the overlay fires
    // `beginCardReveal` at progress ~0.1 and the card fades 0 → 1 over 60ms,
    // just after the outgoing overlay text has faded out. No frame has both
    // overlay text and card text visible at the same time.
    const isHidden = overlayCard?.id === pl.id;
    const finalOpacity = pl.isCancelled ? 0.65 : 1;
    const wrapperOpacity = isHidden
      ? cardRevealOpacity.interpolate({
          inputRange: [0, 1],
          outputRange: [0, finalOpacity],
        })
      : finalOpacity;
    // Shadow is applied unconditionally — the wrapper's animated opacity
    // fades the shadow in along with the rest of the card during the close
    // cross-fade. Previously we disabled shadow whenever `isHidden` was
    // true, which caused a visible "shadow pop" at the end when the overlay
    // unmounted (isHidden false → shadow appears).
    const cardShadow = isDark
      ? cardShadowDark('raised')
      : {
          shadowOpacity: Platform.OS === 'ios' ? 0.16 : 0.12,
          elevation: Platform.OS === 'android' ? 14 : 0,
        };
    const feedbackBannerTutor = user?.userType === 'tutor' && pl.needsTutorFeedback;
    const feedbackBannerStudent = user?.userType === 'student' && pl.feedbackPendingForStudent;
    const showFeedbackBanner = !!(feedbackBannerTutor || feedbackBannerStudent);
    const showDescFeedbackIcon =
      (pl.feedbackPendingForStudent || pl.needsTutorFeedback) && !showFeedbackBanner;
    return (
      <RNAnimated.View style={{ opacity: wrapperOpacity }}>
      <TouchableOpacity
        ref={(r) => { cardRefs.current[pl.id] = r as unknown as View; }}
        style={[
          styles.card,
          {
            backgroundColor: C.card,
            borderColor: C.border,
            ...cardShadow,
          },
        ]}
        activeOpacity={0.85}
        onPress={() => openDetail(pl)}
      >
        {pl.isClass ? (
          <View
            ref={(r) => {
              classCoverRefs.current[pl.id] = r as unknown as View;
            }}
            style={[
              styles.classCoverWrap,
              { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' },
            ]}
          >
            {pl.classCoverUrl ? (
              <ExpoImage
                source={{ uri: pl.classCoverUrl }}
                style={styles.classCoverImg}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={styles.classCoverPlaceholderInner}>
                <Ionicons name="people-outline" size={28} color={isDark ? '#636366' : '#b0b0b0'} />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.avatarBlock}>
            <View
              style={[
                styles.avatar,
                isDark && { backgroundColor: '#3a3a3c' },
                { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' },
              ]}
            >
              {pl.otherPicture ? (
                <ExpoImage source={{ uri: pl.otherPicture }} style={styles.avatarImg} contentFit="cover" transition={200} />
              ) : (
                <Text style={[styles.avatarInitials, { color: C.textSecondary }]}>{pl.otherInitials}</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>
            {pl.isClass ? pl.className || pl.lesson.subject : pl.otherName}
          </Text>
        </View>
        <View style={styles.dateTimeBlockOuter}>
          <LessonDateHeaderCenter
            dateBadgeMonth={pl.dateBadgeMonth}
            dateBadgeDay={pl.dateBadgeDay}
            weekdayShort={pl.formattedWeekday}
            timeRange={pl.formattedTimeRange}
            durationLine={pl.durationLabel}
            isToday={pl.isToday}
            isDark={isDark}
            textPrimary={C.text}
            textSecondary={C.textSecondary}
          />
        </View>

        {pl.isTrial ? (
          <View style={styles.badgesRow}>
            <View
              style={[
                styles.trialPill,
                isDark
                  ? { backgroundColor: 'rgba(255, 159, 10, 0.12)', borderColor: 'rgba(255, 159, 10, 0.22)' }
                  : { backgroundColor: 'rgba(255, 149, 0, 0.08)', borderColor: 'rgba(255, 149, 0, 0.2)' },
              ]}
            >
              <Text style={[styles.trialPillText, { color: isDark ? '#FFB340' : '#9A3412' }]}>
                {t('LESSONS_PAGE.TRIAL_BADGE')}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.midSection, showFeedbackBanner && styles.midSectionWithBanner]}>
          {showFeedbackBanner ? (
            <View style={styles.feedbackBannerSlot}>
              <View
                style={[
                  styles.feedbackBanner,
                  {
                    borderColor: '#ffffff',
                    backgroundColor: feedbackBannerStudent
                      ? (isDark ? lessonFeedbackBanner.student.dark.background : lessonFeedbackBanner.student.light.background)
                      : (isDark ? lessonFeedbackBanner.tutor.dark.background : lessonFeedbackBanner.tutor.light.background),
                  },
                ]}
              >
                <View
                  style={[
                    styles.feedbackBannerIconWrap,
                    {
                      backgroundColor: feedbackBannerStudent
                        ? (isDark ? lessonFeedbackBanner.student.dark.iconBackground : lessonFeedbackBanner.student.light.iconBackground)
                        : (isDark ? lessonFeedbackBanner.tutor.dark.iconBackground : lessonFeedbackBanner.tutor.light.iconBackground),
                    },
                  ]}
                >
                  <Ionicons
                    name={feedbackBannerStudent ? 'time-outline' : 'warning-outline'}
                    size={14}
                    color={
                      feedbackBannerStudent
                        ? (isDark ? lessonFeedbackBanner.student.dark.icon : lessonFeedbackBanner.student.light.icon)
                        : (isDark ? lessonFeedbackBanner.tutor.dark.icon : lessonFeedbackBanner.tutor.light.icon)
                    }
                  />
                </View>
                <View style={styles.feedbackBannerTextCol}>
                  <Text
                    style={[
                      styles.feedbackBannerTitle,
                      { color: isDark ? lessonFeedbackBanner.textDark.title : lessonFeedbackBanner.textLight.title },
                    ]}
                  >
                    {feedbackBannerTutor
                      ? t('LESSONS_PAGE.FEEDBACK_BANNER_TITLE_TUTOR')
                      : t('LESSONS_PAGE.FEEDBACK_BANNER_TITLE_STUDENT')}
                  </Text>
                  <Text
                    style={[
                      styles.feedbackBannerSub,
                      { color: isDark ? lessonFeedbackBanner.textDark.sub : lessonFeedbackBanner.textLight.sub },
                    ]}
                  >
                    {feedbackBannerTutor
                      ? t('LESSONS_PAGE.FEEDBACK_BANNER_SUB_TUTOR')
                      : t('LESSONS_PAGE.FEEDBACK_BANNER_SUB_STUDENT')}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <View style={[styles.descBlock, showFeedbackBanner && styles.descBlockCollapsed]}>
          {pl.isClass ? (
            pl.classAttendees.length > 0 ? (
              <View style={styles.classGoing}>
                <View style={styles.classGoingAvatars}>
                  {pl.classAttendees.map((att, i) => (
                    <View
                      key={`${pl.id}-go-${i}`}
                      style={[
                        styles.classGoingAv,
                        {
                          marginLeft: i === 0 ? 0 : -8,
                          borderColor: C.card,
                          zIndex: 4 - i,
                          backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
                        },
                      ]}
                    >
                      {att.picture ? (
                        <ExpoImage source={{ uri: att.picture }} style={styles.classGoingAvImg} contentFit="cover" transition={200} />
                      ) : (
                        <Text style={[styles.classGoingIni, { color: C.textSecondary }]} numberOfLines={1}>
                          {att.initials}
                        </Text>
                      )}
                    </View>
                  ))}
                  {pl.classAttendeesOverflow > 0 ? (
                    <Text style={[styles.classGoingMore, { color: C.textSecondary }]}>
                      +{pl.classAttendeesOverflow}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.classGoingLabel, { color: C.textSecondary }]}>
                  {pl.isPast
                    ? t('LESSONS_PAGE.CLASS_ATTENDED_COUNT', { count: pl.classStudentCount })
                    : t('LESSONS_PAGE.CLASS_GOING_COUNT', { count: pl.classStudentCount })}
                </Text>
              </View>
            ) : (
              <View style={styles.classGoingEmpty}>
                <Ionicons name="people-outline" size={20} color={C.textTertiary} style={{ opacity: 0.45 }} />
                <Text style={[styles.classGoingEmptyText, { color: C.textTertiary }]}>
                  {pl.isPast
                    ? t('LESSONS_PAGE.CLASS_NO_SIGNUPS_PAST')
                    : t('LESSONS_PAGE.CLASS_NO_SIGNUPS_YET')}
                </Text>
              </View>
            )
          ) : (
            <>
              {pl.cardDescMode === 'analysis_generating' && <AiGeneratingSpinner />}
              {pl.cardDescMode === 'analysis_empty' && (
                <Text style={[styles.descText, { color: C.textSecondary }]}>
                  {t('LESSONS_PAGE.CARD_DESC_EMPTY')}
                </Text>
              )}
              {(pl.cardDescMode === 'analysis' || pl.cardDescMode === 'schedule') && !!pl.cardDescText && (
                <View style={styles.descRow}>
                  {showDescFeedbackIcon ? (
                    <Ionicons name="warning-outline" size={15} color="#f97316" style={styles.feedbackWarnIcon} />
                  ) : null}
                  <Text style={[styles.descText, { color: C.textSecondary }]}>{pl.cardDescText}</Text>
                </View>
              )}
            </>
          )}
          </View>

          <View style={[styles.sep, { borderTopColor: isDark ? C.border : '#EBEBEB' }]} />
        </View>

        <View style={styles.cardFooterStats}>
          {pl.cardStats.map((st, i) => (
            <View key={i} style={styles.cardFooterStatCol}>
              <Text style={[styles.cardFooterStatVal, { color: st.color ?? C.text }]} numberOfLines={1}>
                {st.value}
                {st.sub ? (
                  <Text style={[styles.cardFooterStatTip, { color: isDark ? '#30d158' : '#34c759' }]}>
                    {' '}
                    {st.sub}
                  </Text>
                ) : null}
              </Text>
              <Text style={[styles.cardFooterStatLbl, { color: C.textTertiary }]} numberOfLines={1}>
                {st.label}
              </Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
      </RNAnimated.View>
    );
  };

  const showInitialLoading = loading && allLessons.length === 0;

  const stickyHeader = (
    <View style={[styles.stickyHeader, { backgroundColor: colors.background, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : '#ebebeb' }]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('LESSONS_PAGE.PAGE_TITLE')}</Text>

      <View style={styles.filtersBar}>
        <View style={styles.filtersBtnWrap}>
          <TouchableOpacity
            style={[
              styles.filtersBtn,
              {
                backgroundColor: colors.card,
                borderColor: colors.text,
              },
            ]}
            onPress={() => setFiltersOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="options-outline" size={16} color={colors.text} />
            <Text style={[styles.filtersBtnText, { color: colors.text }]}>{t('LESSONS_PAGE.FILTERS')}</Text>
          </TouchableOpacity>
          {activeFilterCount > 0 && (
            <View style={[styles.filtersBadge, { backgroundColor: colors.text }]}>
              <Text style={[styles.filtersBadgeText, { color: colors.background }]}>{activeFilterCount}</Text>
            </View>
          )}
        </View>

        {activeFilterCount > 0 && (
          <>
            <View style={[styles.filterPreviewChip, { backgroundColor: colors.inputBg }]}>
              <Text style={[styles.filterPreviewText, { color: colors.text }]} numberOfLines={1}>
                {activeFilterCount === 1
                  ? statusFilter !== 'all' ? filterModalLabel(statusFilter)
                    : timeFilter !== 'all' ? (timeFilter === '7days' ? t('LESSONS_PAGE.LAST_7_DAYS') : timeFilter === '30days' ? t('LESSONS_PAGE.LAST_30_DAYS') : t('LESSONS_PAGE.LAST_3_MONTHS'))
                    : lessonTypeFilter !== 'all' ? (lessonTypeFilter === 'class' ? t('LESSONS_PAGE.FILTER_TYPE_CLASS') : t('LESSONS_PAGE.FILTER_TYPE_ONE_ON_ONE'))
                    : subjectFilter !== 'all' ? subjectFilter
                    : filterHasTip ? t('LESSONS_PAGE.FILTER_WITH_TIP')
                    : filterIsTrial ? t('LESSONS_PAGE.FILTER_TRIAL')
                    : filterOutstandingFeedback ? t('LESSONS_PAGE.FILTER_OUTSTANDING_FEEDBACK')
                    : `${activeFilterCount} filters`
                  : `${activeFilterCount} filters`}
              </Text>
            </View>
            <TouchableOpacity onPress={clearAllFilters} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.clearAll, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.CLEAR_ALL')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  return (
    // The outer View provides a dark "shelf" that's visible behind the
    // scaled-down list during the overlay open, giving the sense of
    // receding into Z-depth. Only the list (inside Animated.View) scales
    // and shifts — the overlay and modals render at true screen coords.
    <View style={[styles.safe, { backgroundColor: isDark ? '#000' : '#1a1a1a' }]}>
      <Animated.View style={[styles.safe, { overflow: 'hidden' }, listRecedeStyle]}>
        <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
          {stickyHeader}
      <FlatList
        data={processed}
        keyExtractor={item => item.id}
        renderItem={renderCard}
        contentContainerStyle={[
          styles.listContent,
          processed.length === 0 && !showInitialLoading && styles.listEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              clearDetailCache();
              setRefreshing(true);
              load(true);
            }}
            tintColor={colors.textSecondary}
          />
        }
        ListEmptyComponent={
          showInitialLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, marginTop: 12 }}>{t('LESSONS_PAGE.LOADING')}</Text>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.inputBg }]}>
                <Ionicons name="calendar-outline" size={32} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('LESSONS_PAGE.EMPTY_TITLE')}</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                {statusFilter !== 'all'
                  ? t('LESSONS_PAGE.EMPTY_FILTERED')
                  : user?.userType === 'student'
                    ? t('LESSONS_PAGE.EMPTY_STUDENT')
                    : t('LESSONS_PAGE.EMPTY_TUTOR')}
              </Text>
            </View>
          )
        }
      />
        </SafeAreaView>
      </Animated.View>

      <Modal
        visible={filtersOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFiltersOpen(false)}
      >
        <View style={[styles.fmRoot, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
          {/* Header */}
          <View style={[styles.fmHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 16 }]}>
            <TouchableOpacity style={styles.fmCloseBtn} onPress={() => setFiltersOpen(false)} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.fmTitle, { color: colors.text }]}>{t('LESSONS_PAGE.MODAL_FILTERS_TITLE')}</Text>
            <View style={styles.fmCloseBtn} />
          </View>

          {/* Scrollable body */}
          <ScrollView style={styles.fmScroll} contentContainerStyle={styles.fmScrollContent} showsVerticalScrollIndicator={false}>

            {/* Active filter chips */}
            {activeFilterCount > 0 && (
              <>
                <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.SELECTED')}</Text>
                <View style={styles.fmChipRow}>
                  {statusFilter !== 'all' && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setStatusFilter('all')}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{filterModalLabel(statusFilter)}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {timeFilter !== 'all' && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setTimeFilter('all')}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>
                        {timeFilter === '7days' ? t('LESSONS_PAGE.LAST_7_DAYS') : timeFilter === '30days' ? t('LESSONS_PAGE.LAST_30_DAYS') : t('LESSONS_PAGE.LAST_3_MONTHS')}
                      </Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {lessonTypeFilter !== 'all' && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setLessonTypeFilter('all')}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>
                        {lessonTypeFilter === 'class' ? t('LESSONS_PAGE.FILTER_TYPE_CLASS') : t('LESSONS_PAGE.FILTER_TYPE_ONE_ON_ONE')}
                      </Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {subjectFilter !== 'all' && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setSubjectFilter('all')}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{subjectFilter}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {tutorFilter !== 'all' && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setTutorFilter('all')}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{uniqueTutors.find(x => x.id === tutorFilter)?.name ?? tutorFilter}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {studentFilter !== 'all' && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setStudentFilter('all')}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{uniqueStudents.find(x => x.id === studentFilter)?.name ?? studentFilter}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {filterHasTip && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setFilterHasTip(false)}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{t('LESSONS_PAGE.FILTER_WITH_TIP')}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {filterOutstandingFeedback && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setFilterOutstandingFeedback(false)}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{t('LESSONS_PAGE.FILTER_OUTSTANDING_FEEDBACK')}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                  {filterIsTrial && (
                    <TouchableOpacity style={[styles.fmChip, { backgroundColor: colors.text }]} onPress={() => setFilterIsTrial(false)}>
                      <Text style={[styles.fmChipText, { color: colors.background }]}>{t('LESSONS_PAGE.FILTER_TRIAL')}</Text>
                      <Ionicons name="close" size={13} color={colors.background} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />
              </>
            )}

            {/* Time period */}
            <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.TIME_PERIOD')}</Text>
            <View style={styles.fmPillRow}>
              {(['all', '7days', '30days', '3months'] as const).map(opt => {
                const sel = timeFilter === opt;
                const label = opt === 'all' ? t('LESSONS_PAGE.ALL_TIME') : opt === '7days' ? t('LESSONS_PAGE.LAST_7_DAYS') : opt === '30days' ? t('LESSONS_PAGE.LAST_30_DAYS') : t('LESSONS_PAGE.LAST_3_MONTHS');
                return (
                  <TouchableOpacity key={opt} style={[styles.fmPill, { backgroundColor: sel ? colors.text : colors.inputBg, borderColor: sel ? colors.text : colors.border }]} onPress={() => setTimeFilter(opt)} activeOpacity={0.85}>
                    <Text style={[styles.fmPillText, { color: sel ? colors.background : colors.text }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />

            {/* Tutor (students only) */}
            {user?.userType === 'student' && uniqueTutors.length >= 1 && (
              <>
                <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.TUTOR')}</Text>
                <View style={styles.fmList}>
                  {[{ id: 'all', name: t('LESSONS_PAGE.ALL_TUTORS') }, ...uniqueTutors].map(item => {
                    const sel = tutorFilter === item.id;
                    return (
                      <TouchableOpacity key={item.id} style={[styles.fmListRow, { borderBottomColor: colors.border }]} onPress={() => setTutorFilter(item.id)} activeOpacity={0.8}>
                        <Text style={[styles.fmListRowText, { color: colors.text }]}>{item.name}</Text>
                        {sel && <Ionicons name="checkmark" size={18} color={colors.text} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />
              </>
            )}

            {/* Student (tutors only) */}
            {user?.userType === 'tutor' && uniqueStudents.length >= 1 && (
              <>
                <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.STUDENT')}</Text>
                <View style={styles.fmList}>
                  {[{ id: 'all', name: t('LESSONS_PAGE.ALL_STUDENTS') }, ...uniqueStudents].map(item => {
                    const sel = studentFilter === item.id;
                    return (
                      <TouchableOpacity key={item.id} style={[styles.fmListRow, { borderBottomColor: colors.border }]} onPress={() => setStudentFilter(item.id)} activeOpacity={0.8}>
                        <Text style={[styles.fmListRowText, { color: colors.text }]}>{item.name}</Text>
                        {sel && <Ionicons name="checkmark" size={18} color={colors.text} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />
              </>
            )}

            {/* Status */}
            <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.STATUS')}</Text>
            <View style={styles.fmList}>
              {(['all', 'upcoming', 'completed', 'cancelled'] as StatusFilter[]).map(opt => {
                const sel = statusFilter === opt;
                const label = opt === 'all' ? t('LESSONS_PAGE.ALL_STATUSES') : opt === 'upcoming' ? t('LESSONS_PAGE.STATUS_UPCOMING') : opt === 'completed' ? t('LESSONS_PAGE.STATUS_COMPLETED') : t('LESSONS_PAGE.STATUS_CANCELLED');
                return (
                  <TouchableOpacity key={opt} style={[styles.fmListRow, { borderBottomColor: colors.border }]} onPress={() => setStatusFilter(opt)} activeOpacity={0.8}>
                    <Text style={[styles.fmListRowText, { color: colors.text }]}>{label}</Text>
                    {sel && <Ionicons name="checkmark" size={18} color={colors.text} />}
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />

            {/* Lesson type */}
            <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.FILTER_TYPE')}</Text>
            <View style={styles.fmPillRow}>
              {(['all', 'one-on-one', 'class'] as const).map(opt => {
                const sel = lessonTypeFilter === opt;
                const label = opt === 'all' ? t('LESSONS_PAGE.ALL_TIME') : opt === 'one-on-one' ? t('LESSONS_PAGE.FILTER_TYPE_ONE_ON_ONE') : t('LESSONS_PAGE.FILTER_TYPE_CLASS');
                return (
                  <TouchableOpacity key={opt} style={[styles.fmPill, { backgroundColor: sel ? colors.text : colors.inputBg, borderColor: sel ? colors.text : colors.border }]} onPress={() => setLessonTypeFilter(opt)} activeOpacity={0.85}>
                    <Text style={[styles.fmPillText, { color: sel ? colors.background : colors.text }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />

            {/* Language / Subject */}
            {uniqueSubjects.length >= 1 && (
              <>
                <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.FILTER_SUBJECT')}</Text>
                <View style={styles.fmList}>
                  {[{ id: 'all', label: t('LESSONS_PAGE.ALL_SUBJECTS') }, ...uniqueSubjects.map(s => ({ id: s, label: s }))].map(item => {
                    const sel = subjectFilter === item.id;
                    return (
                      <TouchableOpacity key={item.id} style={[styles.fmListRow, { borderBottomColor: colors.border }]} onPress={() => setSubjectFilter(item.id)} activeOpacity={0.8}>
                        <Text style={[styles.fmListRowText, { color: colors.text }]}>{item.label}</Text>
                        {sel && <Ionicons name="checkmark" size={18} color={colors.text} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={[styles.fmDivider, { backgroundColor: colors.border }]} />
              </>
            )}

            {/* More filters (toggles) */}
            <Text style={[styles.fmSectionTitle, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.FILTER_SPECIAL')}</Text>
            <View style={styles.fmList}>
              <TouchableOpacity style={[styles.fmToggleRow, { borderBottomColor: colors.border }]} onPress={() => setFilterIsTrial(v => !v)} activeOpacity={0.8}>
                <View style={styles.fmToggleLeft}>
                  <Ionicons name="star-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.fmListRowText, { color: colors.text }]}>{t('LESSONS_PAGE.FILTER_TRIAL')}</Text>
                </View>
                <View style={[styles.fmSwitch, filterIsTrial && styles.fmSwitchOn, filterIsTrial && { backgroundColor: colors.text }]}>
                  <View style={[styles.fmSwitchThumb, filterIsTrial && styles.fmSwitchThumbOn]} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fmToggleRow, { borderBottomColor: colors.border }]} onPress={() => setFilterHasTip(v => !v)} activeOpacity={0.8}>
                <View style={styles.fmToggleLeft}>
                  <Ionicons name="gift-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.fmListRowText, { color: colors.text }]}>{t('LESSONS_PAGE.FILTER_WITH_TIP')}</Text>
                </View>
                <View style={[styles.fmSwitch, filterHasTip && styles.fmSwitchOn, filterHasTip && { backgroundColor: colors.text }]}>
                  <View style={[styles.fmSwitchThumb, filterHasTip && styles.fmSwitchThumbOn]} />
                </View>
              </TouchableOpacity>
              {user?.userType === 'tutor' && (
                <TouchableOpacity style={[styles.fmToggleRow, { borderBottomColor: 'transparent' }]} onPress={() => setFilterOutstandingFeedback(v => !v)} activeOpacity={0.8}>
                  <View style={styles.fmToggleLeft}>
                    <Ionicons name="alert-circle-outline" size={20} color={colors.textSecondary} />
                    <Text style={[styles.fmListRowText, { color: colors.text }]}>{t('LESSONS_PAGE.FILTER_OUTSTANDING_FEEDBACK')}</Text>
                  </View>
                  <View style={[styles.fmSwitch, filterOutstandingFeedback && styles.fmSwitchOn, filterOutstandingFeedback && { backgroundColor: colors.text }]}>
                    <View style={[styles.fmSwitchThumb, filterOutstandingFeedback && styles.fmSwitchThumbOn]} />
                  </View>
                </TouchableOpacity>
              )}
            </View>

          </ScrollView>

          {/* Footer */}
          <View style={[styles.fmFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity style={styles.fmClearBtn} onPress={clearAllFilters} disabled={activeFilterCount === 0} activeOpacity={0.7}>
              <Text style={[styles.fmClearText, { color: activeFilterCount > 0 ? colors.text : colors.textTertiary }]}>{t('LESSONS_PAGE.CLEAR_ALL')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.fmApplyBtn, { backgroundColor: colors.text }]} onPress={() => setFiltersOpen(false)} activeOpacity={0.85}>
              <Text style={[styles.fmApplyText, { color: colors.background }]}>
                {processed.length === 1 ? t('LESSONS_PAGE.SHOW_LESSON', { count: processed.length }) : t('LESSONS_PAGE.SHOW_LESSONS', { count: processed.length })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {overlayCard && (
        <LessonDetailOverlay
          card={overlayCard}
          cardRect={overlayRect}
          thumbnailTargetRect={overlayThumbnailRect}
          onCloseStart={() => {
            setOverlayClosing(true);
            // Return the list to its resting position alongside the
            // shrinking overlay — both springs end together.
            listRecede.value = withSpring(0, OVERLAY_SPRING);
          }}
          onBeginReveal={beginCardReveal}
          onCloseEnd={() => {
            setOverlayCard(null);
            setOverlayThumbnailRect(null);
            setOverlayClosing(false);
            setLessonOverlayCoversTabBar(false);
            // Clear the open-guard so the next tap is accepted. Done here
            // (not at open-resolve) so the card can't be re-tapped during
            // the live overlay's lifetime.
            openingRef.current = false;
          }}
          onClassGoingMessageRequest={setClassGoingMessage}
        />
      )}

      <ClassGoingMessageModal
        visible={classGoingMessage !== null}
        onClose={() => setClassGoingMessage(null)}
        attendees={classGoingMessage?.attendees ?? []}
        receiverId={classGoingMessage?.receiverId}
        receiverIds={classGoingMessage?.receiverIds}
        className={classGoingMessage?.className}
        classId={classGoingMessage?.classId}
        onSent={(result) => {
          // Close the modal then deep-link the Messages tab to the thread that
          // was just created/updated so the user lands directly in context.
          setClassGoingMessage(null);
          if (result.kind === 'group') {
            navigation.navigate('Messages', { groupId: result.groupId });
          } else {
            navigation.navigate('Messages', { userId: result.userId });
          }
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  stickyHeader: {
    borderBottomWidth: 1,
    paddingTop: 20,
    paddingBottom: 4,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    paddingHorizontal: CONTENT_PAD,
    marginBottom: 14,
    letterSpacing: -0.5,
  },

  // ── Filters bar ──
  filtersBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    rowGap: 10,
    paddingHorizontal: CONTENT_PAD,
    paddingBottom: 14,
  },
  filtersBtnWrap: { position: 'relative', alignSelf: 'flex-start' },
  filtersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  filtersBtnText: { fontSize: 13, fontWeight: '600' },
  filtersBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  filtersBadgeText: { fontSize: 11, fontWeight: '600' },
  filterPreviewChip: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    maxWidth: '55%',
  },
  filterPreviewText: { fontSize: 13, fontWeight: '500' },
  clearAll: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 36,
  },
  modalGrab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 16, letterSpacing: -0.3 },
  modalSection: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  modalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
  },
  modalOptionText: { fontSize: 14, fontWeight: '600' },
  modalCloseRow: { marginTop: 20, alignItems: 'center', paddingVertical: 8 },
  modalCloseText: { fontSize: 15, fontWeight: '600' },

  // ── Full-page filter modal ──
  fmRoot: { flex: 1 },
  fmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fmCloseBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  fmTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  fmScroll: { flex: 1 },
  fmScrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
  fmSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  fmDivider: { height: StyleSheet.hairlineWidth, marginVertical: 20 },
  fmPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  fmPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
  },
  fmPillText: { fontSize: 14, fontWeight: '600' },
  fmList: { gap: 0 },
  fmListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fmListRowText: { fontSize: 16, fontWeight: '400' },
  fmToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fmToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fmSwitch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e5e5e5',
    justifyContent: 'center',
    padding: 2,
  },
  fmSwitchOn: {},
  fmSwitchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2,
  },
  fmSwitchThumbOn: { alignSelf: 'flex-end' },
  fmChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  fmChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  fmChipText: { fontSize: 13, fontWeight: '600' },
  fmFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fmClearBtn: { paddingVertical: 12, paddingHorizontal: 4 },
  fmClearText: { fontSize: 16, fontWeight: '600' },
  fmApplyBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  fmApplyText: { fontSize: 16, fontWeight: '700' },

  // ── List ──
  listContent: { paddingHorizontal: CONTENT_PAD, paddingTop: 20, paddingBottom: 32 },
  listEmpty: { flexGrow: 1 },

  // ── Card — copy of HomeScreen upNextCardSurface ──
  // Single View, overflow visible so shadow renders on iOS.
  // Content (text, avatars with own clip) doesn't bleed past radius.
  /**
   * Wrapper for class cover: overflow:hidden is on the View so the Image
   * corners are properly clipped (borderRadius on Image alone doesn't clip
   * on iOS when the parent has overflow:visible for shadows).
   */
  /** Exact copy of HomeScreen `upNextClassCoverWrap` / `upNextClassCoverImage` */
  classCoverWrap: {
    width: 144,
    height: 90,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  classCoverImg: { width: '100%', height: '100%' },
  classCoverPlaceholderInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Web `lgc-going` — under title/date, not under cover */
  classGoing: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
  },
  classGoingAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  classGoingAv: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  classGoingAvImg: { width: '100%', height: '100%' },
  classGoingIni: { fontSize: 11, fontWeight: '600' },
  classGoingMore: { marginLeft: 6, fontSize: 11, fontWeight: '600' },
  classGoingLabel: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  classGoingEmpty: {
    width: '100%',
    alignItems: 'center',
    gap: 5,
  },
  classGoingEmptyText: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 28,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 20,
    shadowOpacity: 0.08,
    elevation: 14,
    marginBottom: 24,
    marginHorizontal: 12,
  },

  avatarBlock: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  dateTimeBlockOuter: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  avatar: {
    width: LESSON_CARD_AVATAR,
    height: LESSON_CARD_AVATAR,
    borderRadius: LESSON_CARD_AVATAR_RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8e8',
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: { fontSize: 22, fontWeight: '600' },

  // ── Title (matches web `lgc-title` + fixed wrap height) ──
  titleWrap: {
    minHeight: 55,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    lineHeight: 28,
    maxWidth: '100%',
  },

  // ── Badges ──
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 8 },

  midSection: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  midSectionWithBanner: {
    justifyContent: 'center',
    minHeight: 90,
  },
  feedbackBannerSlot: {
    width: '100%',
    paddingHorizontal: 10,
  },
  feedbackBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  feedbackBannerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackBannerTextCol: { flex: 1, gap: 1 },
  feedbackBannerTitle: { fontSize: 12, fontWeight: '600', letterSpacing: -0.1, lineHeight: 15 },
  feedbackBannerSub: { fontSize: 11, fontWeight: '400', lineHeight: 14 },
  descBlockCollapsed: { paddingVertical: 0 },
  trialPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  trialPillText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.2, textTransform: 'uppercase' },
  tipPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tipPillText: { fontSize: 10, fontWeight: '500' },

  // ── Description ──
  descBlock: {
    width: '100%',
    marginBottom: 0,
    paddingVertical: 14,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  descRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    justifyContent: 'center',
  },
  feedbackWarnIcon: {
    marginTop: 2, // optical alignment with text baseline
  },
  descText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    flex: 1,
  },

  // ── Separator + stats (extra top padding so duration/price/status aren’t tight to the rule) ──
  sep: { width: '100%', borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 6 },
  cardFooterStats: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 10,
  },
  cardFooterStatCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  cardFooterStatVal: {
    width: '100%',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  cardFooterStatTip: {
    fontSize: 10,
    fontWeight: '500',
  },
  cardFooterStatLbl: {
    width: '100%',
    fontSize: 10,
    fontWeight: '400',
    textTransform: 'lowercase',
    textAlign: 'center',
  },

  // ── Empty / loading ──
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyBox: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: LESSON_CARD_AVATAR,
    height: LESSON_CARD_AVATAR,
    borderRadius: LESSON_CARD_AVATAR_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
