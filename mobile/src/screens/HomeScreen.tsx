import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  TouchableOpacity,
  Pressable,
  Modal,
  Animated,
  Easing,
  Dimensions,
  Platform,
  AccessibilityInfo,
  Alert,
  findNodeHandle,
  UIManager,
  StatusBar,
} from 'react-native';
import { SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useHomeTabBarOverlay } from '../contexts/HomeTabBarOverlayContext';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import {
  lessonService,
  buildTimelineEvents,
  buildTimelineEventsForLessons,
  TIMELINE_AVATAR_STACK_MAX,
  TimelineEvent,
  Lesson,
  getLessonStart,
  getJoinGateState,
  formatTimeUntilLessonStart,
  isLessonInProgressSlot,
} from '../services/lessons';
import { getMyClasses, getClassesForTutor, cancelClass } from '../services/classes';
import { earningsService, EarningsBalance } from '../services/earnings';
import { calendarService } from '../services/calendar';
import EarningsScreen from './EarningsScreen';
import MaterialsScreen from './MaterialsScreen';
import MyClassesScreen from './MyClassesScreen';
import ForumScreen from './ForumScreen';
import { preloadMaterials } from '../services/materials';
import { api } from '../services/api';
import { getUnreadCount } from '../services/notifications';
import { buildProcessedLessonCard, type ProcessedLessonCard } from '../utils/lessonCardModel';
import LessonDetailOverlay, { type CardRect } from '../components/LessonDetailOverlay';
import { RescheduleLessonModal } from '../components/RescheduleLessonModal';
import { InviteStudentsModal } from '../components/InviteStudentsModal';
import { CancelClassReasonModal, classLessonToCancelModalProps } from '../components/CancelClassReasonModal';
import { ClassGoingMessageModal, type ClassGoingMessageRequest } from '../components/ClassGoingMessageModal';
import { cardShadowDark } from '../utils/cardShadow';
import { getLanguageFlag } from '../utils/languageFlags';
import {
  resolveClassAttendeesForPreview,
  attendeeStackInitials,
} from '../constants/mockClassAttendeesPreview';
import { useSpringPopAnim } from '../hooks/useSpringPopAnim';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';
import { Image as ExpoImage } from 'expo-image';
import ShimmerSkeleton from '../components/ShimmerSkeleton';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
/** Shorter viewports (SE, mini): tighter Up Next so Quick Actions can sit above the fold. */
const UP_NEXT_MIN_H = SCREEN_H < 700 ? 308 : SCREEN_H < 780 ? 318 : 328;
const HOME_SCROLL_PAD_X = 20;

/**
 * Quick-action overlays (Materials / My Classes / Forum): slide up from bottom as an opaque
 * sheet — no opacity cross-fade (which would blend home through forum UI on entry). Matches
 * iOS full-screen modal presentation; exit slides back down.
 */
const OVERLAY_SLIDE_IN_MS = 320;
const OVERLAY_SLIDE_OUT_MS = 260;
const OVERLAY_SLIDE_IN_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const OVERLAY_SLIDE_OUT_EASING = Easing.bezier(0.4, 0, 1, 1);

/** “This week” summary row: overlapping circles (flex + negative margin is unreliable inside TouchableOpacity). */
const TW_PILE_SIZE = 34;
const TW_PILE_OVERLAP = 11;
const TW_PILE_STEP = TW_PILE_SIZE - TW_PILE_OVERLAP;

const CTA_DARK_BLUE = '#3a7bc8';

/** Match web `.upnext-filled-avatar` (80×80 @ 20px radius → 0.25 of side). */
const UP_NEXT_AVATAR_SIZE = 80;
const UP_NEXT_AVATAR_RADIUS = Math.round(UP_NEXT_AVATAR_SIZE * 0.25);
/**
 * Shared min height for Up Next filled + empty cards so the home stack (“This Week”, etc.)
 * shifts by the same amount. Empty state content (120px art + copy + CTA) is taller than
 * filled (avatar + meta + CTA); without this, filled stayed at 268px while empty grew past it.
 */
/** See `UP_NEXT_MIN_H` — was fixed 328px and pushed Quick Actions below the fold on many devices. */
const UP_NEXT_CARD_MIN_HEIGHT = UP_NEXT_MIN_H;

/** Mirrors web: no reschedule once lesson/class has started or ended. */
function lessonAllowsReschedule(lesson: Lesson | null | undefined): boolean {
  if (!lesson) return false;
  const st = String(lesson.status || '');
  if (st === 'in_progress' || st === 'completed' || st === 'cancelled') return false;
  const start = lesson.startTime || (lesson as { scheduledTime?: string }).scheduledTime;
  if (!start) return true;
  return new Date(start).getTime() > Date.now();
}

function upNextCardShellShadow(isDark: boolean) {
  return isDark
    ? cardShadowDark('raised')
    : {
        shadowOpacity: Platform.OS === 'ios' ? 0.16 : 0.12,
        elevation: Platform.OS === 'android' ? 14 : 0,
      };
}

/** Matches web `.pop-float` + `@keyframes popFloat` (tab1.page.scss): delay 0.6s, duration 0.7s. */
const TRIAL_BADGE_POP_DELAY_MS = 600;
const TRIAL_BADGE_POP_BEZIER = Easing.bezier(0.34, 1.56, 0.64, 1);

/** Matches web `.badge-inline.badge-trial` (tab1): gradient pill, star + uppercase label. */
function UpNextTrialBadge({ label }: { label: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.4)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    let cancelled = false;
    let running: Animated.CompositeAnimation | null = null;
    const native = { useNativeDriver: true as const };

    const skipToEnd = () => {
      opacity.setValue(1);
      scale.setValue(1);
      translateY.setValue(0);
    };

    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (cancelled) return;
      if (reduce) {
        skipToEnd();
        return;
      }

      running = Animated.sequence([
        Animated.delay(TRIAL_BADGE_POP_DELAY_MS),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            ...native,
          }),
          Animated.timing(scale, {
            toValue: 1.12,
            duration: 280,
            easing: TRIAL_BADGE_POP_BEZIER,
            ...native,
          }),
          Animated.timing(translateY, {
            toValue: -6,
            duration: 280,
            easing: TRIAL_BADGE_POP_BEZIER,
            ...native,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.96, duration: 175, easing: Easing.inOut(Easing.quad), ...native }),
          Animated.timing(translateY, { toValue: 2, duration: 175, easing: Easing.inOut(Easing.quad), ...native }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.03, duration: 119, easing: Easing.inOut(Easing.quad), ...native }),
          Animated.timing(translateY, { toValue: -1, duration: 119, easing: Easing.inOut(Easing.quad), ...native }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 126, easing: Easing.inOut(Easing.quad), ...native }),
          Animated.timing(translateY, { toValue: 0, duration: 126, easing: Easing.inOut(Easing.quad), ...native }),
        ]),
      ]);
      if (cancelled) return;
      running.start();
    });

    return () => {
      cancelled = true;
      running?.stop();
    };
  }, []);

  return (
    <Animated.View
      style={[
        styles.trialBadgePopWrap,
        {
          opacity,
          transform: [{ scale }, { translateY }],
        },
      ]}
    >
      <LinearGradient
        colors={['#ff9500', '#ff6b35']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.trialBadgeInline}
      >
        <Ionicons name="star" size={10} color="#ffffff" />
        <Text style={styles.trialBadgeInlineText}>{label}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  /** Stacked avatar rings on the “This week” summary row (not the sheet). */
  const thisWeekRowRingBorder = colors.isDark ? 'rgba(255,255,255,0.92)' : '#ffffff';
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { setHomeOverlayCoversTabBar, setLessonOverlayCoversTabBar } = useHomeTabBarOverlay();
  const userId = user?._id || user?.id || '';
  const isTutor = user?.userType === 'tutor';

  const openNotifications = useCallback(() => {
    /** `Notifications` is on the root stack (sibling of `Main`); navigate bubbles up. */
    navigation.navigate('Notifications' as never);
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await getUnreadCount();
          if (!cancelled && res.success) setNotifUnreadCount(res.count);
        } catch {
          if (!cancelled) setNotifUnreadCount(0);
        }
      })();
      return () => { cancelled = true; };
    }, []),
  );

  const [loading, setLoading] = useState(true);
  const { shellMotion, listGateMotion } = useScreenEntranceAnimations(loading);
  const [refreshing, setRefreshing] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsBalance>({ available: 0, pending: 0, lifetime: 0 });
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [materialsVisible, setMaterialsVisible] = useState(false);
  const materialsSlideY = useRef(new Animated.Value(SCREEN_H)).current;
  const [showMyClasses, setShowMyClasses] = useState(false);
  const [myClassesVisible, setMyClassesVisible] = useState(false);
  const myClassesSlideY = useRef(new Animated.Value(SCREEN_H)).current;
  const [showForum, setShowForum] = useState(false);
  const [forumVisible, setForumVisible] = useState(false);
  const forumSlideY = useRef(new Animated.Value(SCREEN_H)).current;
  const [thisWeekSheetVisible, setThisWeekSheetVisible] = useState(false);
  const thisWeekSheetTranslateY = useRef(new Animated.Value(SCREEN_H)).current;
  const thisWeekSheetBackdropOpacity = useRef(new Animated.Value(0)).current;
  const [upNextMenuVisible, setUpNextMenuVisible] = useState(false);
  const upNextMenuTranslateY = useRef(new Animated.Value(SCREEN_H)).current;
  const upNextMenuBackdropOpacity = useRef(new Animated.Value(0)).current;
  const [upNextRescheduleLesson, setUpNextRescheduleLesson] = useState<Lesson | null>(null);
  const [upNextInviteClass, setUpNextInviteClass] = useState<{ classId: string; className: string } | null>(null);
  const [upNextCancelClass, setUpNextCancelClass] = useState<{
    classId: string;
    className: string;
    lesson: Lesson;
  } | null>(null);
  const [cancellingClass, setCancellingClass] = useState(false);
  const [hasAvailability, setHasAvailability] = useState(false);
  const [hasPayoutSetup, setHasPayoutSetup] = useState(false);
  const [payoutLoaded, setPayoutLoaded] = useState(false);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);

  const [homeLessonOverlayCard, setHomeLessonOverlayCard] = useState<ProcessedLessonCard | null>(null);
  const [homeLessonOverlayRect, setHomeLessonOverlayRect] = useState<CardRect>({ x: 0, y: 0, width: 0, height: 0 });
  /**
   * Tracks whether the overlay was opened from the "This Week" action sheet.
   * When true we render the overlay inside the sheet's Modal tree (so it can
   * visually sit above the sheet), keep the sheet open underneath, and morph
   * back to the exact row that was tapped — not the Up Next fallback rect.
   */
  const [homeLessonOverlayFromSheet, setHomeLessonOverlayFromSheet] = useState(false);
  /**
   * Target CTA rect for the lesson detail overlay's close animation. When set,
   * the overlay's bottom CTA translates to land exactly on top of this rect as
   * the surface collapses — so it reads as one element morphing rather than a
   * cross-fade between two mismatched buttons.
   */
  const [homeLessonOverlayCtaRect, setHomeLessonOverlayCtaRect] = useState<CardRect | null>(null);
  /**
   * Target thumbnail rect (e.g. the 144×90 class cover on Up Next). When set,
   * the overlay's full-bleed hero image morphs into this exact rect on close.
   */
  const [homeLessonOverlayThumbnailRect, setHomeLessonOverlayThumbnailRect] = useState<CardRect | null>(null);
  const [classGoingMessage, setClassGoingMessage] = useState<ClassGoingMessageRequest | null>(null);
  const upNextCardMeasureRef = useRef<View>(null);
  const upNextCtaMeasureRef = useRef<View>(null);
  const upNextThumbnailMeasureRef = useRef<View>(null);
  const thisWeekRowRefs = useRef<Map<string, RefObject<View | null>>>(new Map());

  const getThisWeekRowRef = useCallback((id: string): RefObject<View | null> => {
    let ref = thisWeekRowRefs.current.get(id);
    if (!ref) {
      ref = React.createRef<View>();
      thisWeekRowRefs.current.set(id, ref);
    }
    return ref;
  }, []);

  const userTz = user?.profile?.timezone as string | undefined;

  const homeLessonFallbackRect = useMemo((): CardRect => {
    const metricsTop = initialWindowMetrics?.insets?.top;
    const topInset =
      typeof metricsTop === 'number' && metricsTop > 0
        ? metricsTop
        : Platform.OS === 'android'
          ? StatusBar.currentHeight ?? 24
          : 56;
    return {
      x: HOME_SCROLL_PAD_X,
      y: Math.min(topInset + 168, SCREEN_H * 0.3),
      width: SCREEN_W - HOME_SCROLL_PAD_X * 2,
      height: 156,
    };
  }, []);

  const openLessonDetailOverlay = useCallback(
    (
      lesson: Lesson,
      measureTargetRef?: RefObject<View | null>,
      fromSheet = false,
      ctaTargetRef?: RefObject<View | null>,
      thumbnailTargetRef?: RefObject<View | null>,
    ) => {
      const apply = (
        rect: CardRect,
        ctaRect: CardRect | null,
        thumbRect: CardRect | null,
      ) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const pl = buildProcessedLessonCard(lesson, user, t, userTz);
        setHomeLessonOverlayRect(rect);
        setHomeLessonOverlayCtaRect(ctaRect);
        setHomeLessonOverlayThumbnailRect(thumbRect);
        setHomeLessonOverlayCard(pl);
        setHomeLessonOverlayFromSheet(fromSheet);
        setLessonOverlayCoversTabBar(true);
      };

      // Best-effort measurement. We run all targets in parallel and resolve
      // before applying. A missing ref just means the overlay falls back to
      // its own fade without pinpoint alignment — no error.
      const measureNode = (ref?: RefObject<View | null>): Promise<CardRect | null> =>
        new Promise((resolve) => {
          const node = ref?.current;
          if (!node) return resolve(null);
          const handle = findNodeHandle(node);
          if (!handle) return resolve(null);
          const measureWin = (node as any).measureInWindow;
          if (typeof measureWin === 'function') {
            measureWin.call(node, (px: number, py: number, w: number, h: number) => {
              resolve({ x: px, y: py, width: w, height: h });
            });
          } else {
            UIManager.measure(handle, (_x, _y, w, h, px, py) => {
              resolve({ x: px, y: py, width: w, height: h });
            });
          }
        });

      Promise.all([
        measureNode(measureTargetRef),
        measureNode(ctaTargetRef),
        measureNode(thumbnailTargetRef),
      ]).then(([cardRect, ctaRect, thumbRect]) => {
        apply(cardRect ?? homeLessonFallbackRect, ctaRect, thumbRect);
      });
    },
    [user, t, userTz, homeLessonFallbackRect, setLessonOverlayCoversTabBar],
  );

  const displayName = user?.firstName || user?.name?.split(' ')[0] || 'there';
  const nextLesson = timeline[0] || null;

  const thisWeekLessons = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
    weekEnd.setHours(23, 59, 59, 999);
    return lessons.filter(l => {
      if (l.status !== 'scheduled') return false;
      const d = getLessonStart(l);
      return d >= now && d <= weekEnd;
    });
  }, [lessons]);

  const recentStudents = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string; avatar: string | null }[] = [];
    const sorted = [...lessons]
      .filter(l => l.status === 'completed' || l.status === 'scheduled')
      .sort((a, b) => getLessonStart(b).getTime() - getLessonStart(a).getTime());

    for (const l of sorted) {
      const student = l.studentId;
      if (!student?._id || seen.has(student._id)) continue;
      seen.add(student._id);
      result.push({
        id: student._id,
        name: student.firstName || student.name?.split(' ')[0] || 'Student',
        avatar: student.picture || null,
      });
      if (result.length >= 8) break;
    }
    return result;
  }, [lessons]);

  /**
   * One face per scheduled item this week (sorted), so the row stacks multiple lessons.
   * Deduping unique people collapsed tutors/students into a single circle when repeat clients booked often.
   */
  const thisWeekLessonSlots = useMemo(() => {
    const sorted = [...thisWeekLessons].sort(
      (a, b) => getLessonStart(a).getTime() - getLessonStart(b).getTime(),
    );
    const slots: { id: string; name: string; avatar: string | null }[] = [];

    for (const l of sorted) {
      const slotId = `week-slot-${l._id}`;
      if ((l as any).isClass) {
        const attendees = (l.attendees || []) as any[];
        const thumb = (l as any).classData?.thumbnail || null;
        if (attendees.length > 0) {
          const a = attendees[0];
          const name =
            a.firstName && a.lastName
              ? `${a.firstName} ${String(a.lastName).charAt(0)}.`
              : a.firstName || a.name || 'Student';
          const pic = (a.picture || a.profilePicture || null) as string | null;
          slots.push({ id: slotId, name, avatar: pic || thumb });
        } else {
          slots.push({
            id: slotId,
            name: (l as any).className || l.subject || 'Group class',
            avatar: thumb,
          });
        }
      } else {
        const other = l.tutorId?._id === userId ? l.studentId : l.tutorId;
        const name = other?.firstName
          ? `${other.firstName} ${(other.lastName || '').charAt(0)}.`
          : other?.name || 'Student';
        slots.push({
          id: slotId,
          name,
          avatar: (other?.picture || (other as any)?.profilePicture || null) as string | null,
        });
      }
    }
    return slots;
  }, [thisWeekLessons, userId]);

  const thisWeekPileLayout = useMemo(() => {
    const n = thisWeekLessonSlots.length;
    const shown = thisWeekLessonSlots.slice(0, TIMELINE_AVATAR_STACK_MAX);
    const overflow = Math.max(0, n - TIMELINE_AVATAR_STACK_MAX);
    const hasOverflowPill = overflow > 0;
    const slotCount = shown.length + (hasOverflowPill ? 1 : 0);
    const width = slotCount === 0 ? 0 : TW_PILE_SIZE + (slotCount - 1) * TW_PILE_STEP;
    return { shown, overflow, hasOverflowPill, slotCount, width };
  }, [thisWeekLessonSlots]);

  const thisWeekSheetEvents = useMemo(
    () => (thisWeekLessons.length ? buildTimelineEventsForLessons(thisWeekLessons, userId) : []),
    [thisWeekLessons, userId],
  );

  const openThisWeekSheet = useCallback(() => {
    if (thisWeekLessons.length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setThisWeekSheetVisible(true);
  }, [thisWeekLessons.length]);

  const closeThisWeekSheet = useCallback(() => {
    thisWeekSheetTranslateY.stopAnimation();
    thisWeekSheetBackdropOpacity.stopAnimation();
    Animated.parallel([
      Animated.timing(thisWeekSheetBackdropOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(thisWeekSheetTranslateY, {
        toValue: SCREEN_H,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setThisWeekSheetVisible(false);
    });
  }, [thisWeekSheetTranslateY, thisWeekSheetBackdropOpacity]);

  useLayoutEffect(() => {
    if (!thisWeekSheetVisible) return;
    thisWeekSheetTranslateY.stopAnimation();
    thisWeekSheetBackdropOpacity.stopAnimation();
    thisWeekSheetTranslateY.setValue(SCREEN_H);
    thisWeekSheetBackdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(thisWeekSheetBackdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(thisWeekSheetTranslateY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [thisWeekSheetVisible, thisWeekSheetTranslateY, thisWeekSheetBackdropOpacity]);

  const fetchData = useCallback(async () => {
    const allLessons = await lessonService.getMyLessons();

    // Fetch classes and convert to lesson-like objects
    let classLessons: Lesson[] = [];
    try {
      if (isTutor && userId) {
        const classes = await getClassesForTutor(userId);
        classLessons = classes.map(cls => ({
          _id: cls._id,
          status: cls.status || 'scheduled',
          startTime: cls.startTime,
          endTime: cls.endTime,
          duration: cls.duration || Math.round(
            (new Date(cls.endTime || cls.startTime).getTime() - new Date(cls.startTime).getTime()) / 60000
          ),
          tutorId: { _id: userId },
          isClass: true,
          className: cls.name,
          classData: {
            ...(cls.thumbnail ? { thumbnail: cls.thumbnail } : {}),
            ...(cls.description && String(cls.description).trim()
              ? { description: String(cls.description) }
              : {}),
          },
          attendees: cls.confirmedStudents || [],
          capacity: cls.capacity,
        } as unknown as Lesson));
      } else if (!isTutor) {
        const classes = await getMyClasses();
        classLessons = classes.map(cls => ({
          _id: cls._id,
          status: cls.status || 'scheduled',
          startTime: cls.startTime,
          endTime: cls.endTime,
          duration: cls.duration || Math.round(
            (new Date(cls.endTime || cls.startTime).getTime() - new Date(cls.startTime).getTime()) / 60000
          ),
          tutorId: cls.tutorId,
          isClass: true,
          className: cls.name,
          classData: {
            ...(cls.thumbnail ? { thumbnail: cls.thumbnail } : {}),
            ...(cls.description && String(cls.description).trim()
              ? { description: String(cls.description) }
              : {}),
          },
          attendees: cls.confirmedStudents || [],
          capacity: cls.capacity,
        } as unknown as Lesson));
      }
    } catch {
      // non-fatal: show lessons even if classes fail to load
    }

    const combined = [...allLessons, ...classLessons];
    setLessons(combined);
    setTimeline(buildTimelineEvents(combined, userId));
  }, [userId, isTutor]);

  const fetchEarnings = useCallback(async () => {
    setEarningsLoading(true);
    const bal = await earningsService.getBalance();
    setEarnings(bal);
    setEarningsLoading(false);
  }, []);

  const fetchAvailability = useCallback(async () => {
    if (!isTutor) return;
    const blocks = await calendarService.getAvailability();
    const now = new Date();
    const hasFuture = blocks.some(slot => {
      if (slot.absoluteEnd) return new Date(slot.absoluteEnd) > now;
      if (slot.absoluteStart) return new Date(slot.absoluteStart) > now;
      return true;
    });
    setHasAvailability(hasFuture);
  }, [isTutor]);

  const fetchPayoutStatus = useCallback(async () => {
    if (!isTutor) return;
    try {
      const res = await api.get<any>('/payments/payout-options');
      const p = res?.currentProvider || user?.payoutProvider || 'none';
      setHasPayoutSetup(p !== 'none');
    } catch { setHasPayoutSetup(false); }
    finally { setPayoutLoaded(true); }
  }, [isTutor, user?.payoutProvider]);

  const profileCompletion = useMemo(() => {
    if (!isTutor || !user) return { complete: true, items: [] as { key: string; label: string; done: boolean }[] };
    const od = user.onboardingData;
    const hasCustomPhoto = !!(user.picture && (
      user.picture.includes('storage.googleapis.com') ||
      (user.auth0Picture && user.picture !== user.auth0Picture)
    ));
    const hasVideo = !!(od?.introductionVideo || od?.pendingVideo);
    const videoApproved = user.tutorOnboarding?.videoApproved === true;
    const creds = user.tutorCredentials;
    const govIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
    const certsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
    const credsComplete = govIdUploaded && certsUploaded;
    const credsApproved = creds?.governmentId?.status === 'approved' && !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved'));
    const payoutDone = payoutLoaded ? hasPayoutSetup : (user.stripeConnectOnboarded || user.payoutProvider === 'paypal' || user.payoutProvider === 'manual');

    const items: { key: string; label: string; done: boolean }[] = [
      { key: 'photo', label: t('PROFILE_SCREEN.PROFILE_PHOTO') || 'Profile photo', done: hasCustomPhoto },
      { key: 'video', label: hasVideo && !videoApproved ? t('HOME.BANNER_VIDEO_PENDING') : (t('PROFILE_SCREEN.INTRO_VIDEO') || 'Introduction video'), done: hasVideo },
      { key: 'creds', label: credsComplete && !credsApproved ? t('HOME.BANNER_CREDENTIALS_PENDING') : (t('PROFILE_SCREEN.CREDENTIALS') || 'Credentials'), done: credsComplete },
      { key: 'payout', label: t('PROFILE_SCREEN.PAYOUT_METHOD') || 'Payout method', done: !!payoutDone },
    ];
    const allDone = items.every(i => i.done);
    return { complete: allDone, items };
  }, [isTutor, user, payoutLoaded, hasPayoutSetup, t]);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchData(), fetchEarnings(), fetchAvailability(), fetchPayoutStatus()]);
      setLoading(false);
    })();
    if (isTutor) preloadMaterials();
  }, [fetchData, fetchEarnings, fetchAvailability, fetchPayoutStatus, isTutor]);

  const openMaterials = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowMaterials(true);
    setMaterialsVisible(true);
    materialsSlideY.setValue(SCREEN_H);
    Animated.timing(materialsSlideY, {
      toValue: 0,
      duration: OVERLAY_SLIDE_IN_MS,
      easing: OVERLAY_SLIDE_IN_EASING,
      useNativeDriver: true,
    }).start();
  }, [materialsSlideY]);

  const closeMaterials = useCallback(() => {
    Animated.timing(materialsSlideY, {
      toValue: SCREEN_H,
      duration: OVERLAY_SLIDE_OUT_MS,
      easing: OVERLAY_SLIDE_OUT_EASING,
      useNativeDriver: true,
    }).start(() => {
      setShowMaterials(false);
      setMaterialsVisible(false);
    });
  }, [materialsSlideY]);

  const openMyClasses = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowMyClasses(true);
    setMyClassesVisible(true);
    myClassesSlideY.setValue(SCREEN_H);
    Animated.timing(myClassesSlideY, {
      toValue: 0,
      duration: OVERLAY_SLIDE_IN_MS,
      easing: OVERLAY_SLIDE_IN_EASING,
      useNativeDriver: true,
    }).start();
  }, [myClassesSlideY]);

  const closeMyClasses = useCallback(() => {
    Animated.timing(myClassesSlideY, {
      toValue: SCREEN_H,
      duration: OVERLAY_SLIDE_OUT_MS,
      easing: OVERLAY_SLIDE_OUT_EASING,
      useNativeDriver: true,
    }).start(() => {
      setShowMyClasses(false);
      setMyClassesVisible(false);
    });
  }, [myClassesSlideY]);

  const closeUpNextMenu = useCallback(() => {
    upNextMenuTranslateY.stopAnimation();
    upNextMenuBackdropOpacity.stopAnimation();
    Animated.parallel([
      Animated.timing(upNextMenuBackdropOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(upNextMenuTranslateY, {
        toValue: SCREEN_H,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setUpNextMenuVisible(false);
    });
  }, [upNextMenuTranslateY, upNextMenuBackdropOpacity]);

  const openUpNextMenu = useCallback(() => {
    if (!nextLesson) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUpNextMenuVisible(true);
  }, [nextLesson]);

  useLayoutEffect(() => {
    if (!upNextMenuVisible) return;
    upNextMenuTranslateY.stopAnimation();
    upNextMenuBackdropOpacity.stopAnimation();
    upNextMenuTranslateY.setValue(SCREEN_H);
    upNextMenuBackdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(upNextMenuBackdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(upNextMenuTranslateY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [upNextMenuVisible, upNextMenuTranslateY, upNextMenuBackdropOpacity]);

  useEffect(() => {
    if (!nextLesson && upNextMenuVisible) {
      closeUpNextMenu();
    }
  }, [nextLesson, upNextMenuVisible, closeUpNextMenu]);

  const handleUpNextMenuInvite = useCallback(() => {
    const snap = nextLesson;
    if (!snap) return;
    closeUpNextMenu();
    setTimeout(() => {
      if (!isTutor) {
        Alert.alert('', t('HOME.UP_NEXT_INVITE_TUTORS_ONLY'));
        return;
      }
      if (!snap.lesson.isClass) {
        Alert.alert('', t('HOME.UP_NEXT_INVITE_STUDENT_ONLY_GROUPS'));
        return;
      }
      const className =
        (snap.lesson as any).className || snap.lesson.subject || snap.lesson.language || '';
      setUpNextInviteClass({ classId: snap.lesson._id, className });
    }, 280);
  }, [nextLesson, closeUpNextMenu, isTutor, t]);

  const handleUpNextMenuReschedule = useCallback(() => {
    const snap = nextLesson;
    if (!snap) return;
    closeUpNextMenu();
    setTimeout(() => {
      setUpNextRescheduleLesson(snap.lesson);
    }, 280);
  }, [nextLesson, closeUpNextMenu]);

  const handleUpNextMenuCancelLesson = useCallback(() => {
    const snap = nextLesson;
    if (!snap) return;
    const lesson = snap.lesson;
    closeUpNextMenu();
    setTimeout(() => {
      if (lesson.isClass) {
        const anyLesson = lesson as unknown as { className?: string; classData?: { name?: string } };
        const className = anyLesson.className || anyLesson.classData?.name || '';
        setUpNextCancelClass({ classId: lesson._id, className, lesson });
        return;
      }
      Alert.alert(t('HOME.UP_NEXT_CANCEL_CONFIRM_TITLE'), t('HOME.UP_NEXT_CANCEL_CONFIRM_MSG'), [
        { text: t('COMMON.CANCEL'), style: 'cancel' },
        {
          text: t('HOME.UP_NEXT_RESCHEDULE_INSTEAD_CTA'),
          onPress: () => {
            if (lessonAllowsReschedule(lesson)) {
              setUpNextRescheduleLesson(lesson);
            } else {
              Alert.alert('', t('HOME.UP_NEXT_NO_RESCHEDULE_STARTED'));
            }
          },
        },
        {
          text: t('HOME.CANCEL_LESSON'),
          style: 'destructive',
          onPress: async () => {
            try {
              await lessonService.cancelLesson(lesson._id, {
                reasonId: isTutor ? 'tutor_cancelled' : 'student_cancelled',
              });
              Alert.alert('', t('HOME.UP_NEXT_CANCEL_SUCCESS'));
              await fetchData();
            } catch (e: any) {
              Alert.alert(t('COMMON.ERROR'), e?.message || t('HOME.UP_NEXT_CANCEL_FAILED'));
            }
          },
        },
      ]);
    }, 280);
  }, [nextLesson, closeUpNextMenu, isTutor, t, fetchData]);

  const handleConfirmCancelClass = useCallback(
    (reason: { id: string; label: string; originalLabel: string }) => {
      if (!upNextCancelClass || cancellingClass) return;
      const { classId, className, lesson } = upNextCancelClass;
      const fromLesson = classLessonToCancelModalProps(lesson);
      const displayName = (className || fromLesson.className || '').trim() || t('CANCEL_CLASS_REASON.DEFAULT_CLASS_TITLE');
      Alert.alert(
        t('CANCEL_CLASS_REASON.CONFIRM_TITLE'),
        t('CANCEL_CLASS_REASON.CONFIRM_MESSAGE', { className: displayName }),
        [
          { text: t('CANCEL_CLASS_REASON.CONFIRM_STAY'), style: 'cancel' },
          {
            text: t('CANCEL_CLASS_REASON.CONFIRM_PROCEED'),
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setCancellingClass(true);
                try {
                  const res = await cancelClass(classId, {
                    reasonId: reason.id,
                    reasonText: reason.label,
                  });
                  if (res.success === false) {
                    throw new Error(res.message || t('HOME.UP_NEXT_CANCEL_CLASS_FAILED'));
                  }
                  setUpNextCancelClass(null);
                  Alert.alert('', t('HOME.UP_NEXT_CANCEL_CLASS_SUCCESS'));
                  await fetchData();
                } catch (e: any) {
                  Alert.alert(t('COMMON.ERROR'), e?.message || t('HOME.UP_NEXT_CANCEL_CLASS_FAILED'));
                } finally {
                  setCancellingClass(false);
                }
              })();
            },
          },
        ],
      );
    },
    [upNextCancelClass, cancellingClass, t, fetchData],
  );

  const handleCancelClassRescheduleInstead = useCallback(() => {
    if (cancellingClass) return;
    setUpNextCancelClass((prev) => {
      if (!prev?.lesson) return prev;
      const L = prev.lesson;
      if (!lessonAllowsReschedule(L)) {
        setTimeout(() => Alert.alert('', t('HOME.UP_NEXT_NO_RESCHEDULE_STARTED')), 0);
        return prev;
      }
      setTimeout(() => setUpNextRescheduleLesson(L), 280);
      return null;
    });
  }, [cancellingClass, t]);

  const openForum = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowForum(true);
    setForumVisible(true);
    forumSlideY.setValue(SCREEN_H);
    Animated.timing(forumSlideY, {
      toValue: 0,
      duration: OVERLAY_SLIDE_IN_MS,
      easing: OVERLAY_SLIDE_IN_EASING,
      useNativeDriver: true,
    }).start();
  }, [forumSlideY]);

  const closeForum = useCallback(() => {
    Animated.timing(forumSlideY, {
      toValue: SCREEN_H,
      duration: OVERLAY_SLIDE_OUT_MS,
      easing: OVERLAY_SLIDE_OUT_EASING,
      useNativeDriver: true,
    }).start(() => {
      setShowForum(false);
      setForumVisible(false);
    });
  }, [forumSlideY]);

  useEffect(() => {
    setHomeOverlayCoversTabBar((showMaterials || showEarnings || showMyClasses || showForum) && isFocused);
  }, [showMaterials, showEarnings, showMyClasses, showForum, isFocused, setHomeOverlayCoversTabBar]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), fetchEarnings(), fetchAvailability(), fetchPayoutStatus()]);
    setRefreshing(false);
  }, [fetchData, fetchEarnings, fetchAvailability, fetchPayoutStatus]);

  const hadLessonsToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return lessons.some(l => {
      const d = getLessonStart(l);
      return d >= today && d < tomorrow && (l.status === 'completed' || l.status === 'cancelled');
    });
  }, [lessons]);

  const emptyStateTitle = useMemo(() => {
    return hadLessonsToday
      ? t('HOME.EMPTY_TITLE_DONE')
      : t('HOME.EMPTY_TITLE_CLEAR');
  }, [hadLessonsToday, t]);

  const emptyStateMessage = useMemo(() => {
    if (!hasAvailability) return t('HOME.EMPTY_MSG_NO_AVAILABILITY');
    if (!hadLessonsToday) return t('HOME.EMPTY_MSG_OPEN');
    return t('HOME.EMPTY_MSG_COMPLETED');
  }, [hasAvailability, hadLessonsToday, t]);

  const emptyStateCta = useMemo(() => {
    return hasAvailability ? t('HOME.VIEW_CALENDAR') : t('HOME.SET_AVAILABILITY');
  }, [hasAvailability, t]);

  const greetingSub = useMemo(() => {
    if (!isTutor) {
      if (nextLesson?.countdown) return t('HOME.STARTS_IN_TIME', { time: nextLesson.countdown });
      return '';
    }
    if (!profileCompletion.complete && profileCompletion.items.some(i => !i.done)) {
      const pending = profileCompletion.items.filter(i => !i.done);
      return `⚠️ ${pending[0].label}`;
    }
    if (nextLesson?.countdown) return t('HOME.STARTS_IN_TIME', { time: nextLesson.countdown });
    if (!hasAvailability) return t('HOME.WELCOME_SET_AVAILABILITY');
    if (hadLessonsToday) return t('HOME.WELCOME_GREAT_WORK');
    return t('HOME.WELCOME_OPEN_SCHEDULE');
  }, [nextLesson, isTutor, hasAvailability, hadLessonsToday, profileCompletion, t]);

  return (
    <View style={{ flex: 1 }}>
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ── Toolbar ── */}
      <Animated.View style={shellMotion}>
      <Toolbar
        user={user}
        onEarningsTap={() => setShowEarnings(true)}
        onNotificationsTap={openNotifications}
        notifUnreadCount={notifUnreadCount}
        colors={colors}
        loading={loading}
        greetingTitle={getGreeting(t, displayName)}
        greetingSub={greetingSub}
      />
      </Animated.View>

      {/* Skeleton – rendered outside listGateMotion so it's visible while opacity is 0 */}
      {loading && <UpNextSkeleton colors={colors} />}

      <Animated.View style={[{ flex: loading ? 0 : 1, overflow: 'hidden' }, listGateMotion]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting moved to toolbar (experiment) — was:
        <View style={styles.greeting}> ... </View>
        */}

        {/* ── Profile Checklist ── */}
        {isTutor && !profileCompletion.complete && profileCompletion.items.length > 0 && !loading && (
          <View style={[styles.profileChecklist, { backgroundColor: colors.isDark ? '#1c1c1e' : '#fff', borderColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', ...(colors.isDark ? cardShadowDark('subtle') : { shadowOpacity: 0.06 }) }]}>
            <View style={styles.pclHeader}>
              <Ionicons name="alert-circle-outline" size={18} color="#e8893c" />
              <Text style={[styles.pclTitle, { color: colors.text }]}>
                {profileCompletion.items.filter(i => i.done).length} / {profileCompletion.items.length} complete
              </Text>
              {profileCompletion.items.some(i => !i.done) && (
                <View style={[styles.pclHiddenBadge, { backgroundColor: colors.isDark ? 'rgba(232,137,60,0.15)' : 'rgba(232,137,60,0.1)' }]}>
                  <Ionicons name="eye-off-outline" size={12} color="#e8893c" />
                  <Text style={styles.pclHiddenText}>Hidden from students</Text>
                </View>
              )}
            </View>
            {profileCompletion.items.map(item => (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.7}
                onPress={() => { if (!item.done) navigation.navigate('Profile'); }}
                style={[styles.pclItem, item.done && styles.pclItemDone]}
              >
                <Ionicons
                  name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={item.done ? (colors.isDark ? '#30d158' : '#34c759') : (colors.isDark ? '#555' : '#ccc')}
                />
                <Text style={[styles.pclLabel, { color: colors.text }, item.done && styles.pclLabelDone]}>{item.label}</Text>
                {!item.done && <Ionicons name="chevron-forward-outline" size={14} color={colors.isDark ? '#555' : '#bbb'} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Up Next ── */}
        {nextLesson ? (
          <UpNextFilled
            event={nextLesson}
            colors={colors}
            t={t}
            onOpenMenu={openUpNextMenu}
            cardMeasureRef={upNextCardMeasureRef}
            ctaMeasureRef={upNextCtaMeasureRef}
            thumbnailMeasureRef={upNextThumbnailMeasureRef}
            onPressCard={() =>
              openLessonDetailOverlay(
                nextLesson.lesson,
                upNextCardMeasureRef,
                false,
                upNextCtaMeasureRef,
                upNextThumbnailMeasureRef,
              )
            }
            onJoin={() => {
              const tabNav = navigation.getParent();
              const stackNav = tabNav?.getParent?.() ?? tabNav;
              stackNav?.navigate('PreCall' as never, {
                lessonId: nextLesson.lesson._id,
                isClass: !!nextLesson.lesson.isClass,
              } as never);
            }}
          />
        ) : (
          <UpNextEmpty
            colors={colors}
            title={emptyStateTitle}
            message={emptyStateMessage}
            ctaLabel={emptyStateCta}
            disabled={!profileCompletion.complete}
            onCta={() => {
              if (hasAvailability) {
                navigation.navigate('Calendar');
              } else {
                navigation.navigate('Calendar', { screen: 'AvailabilitySetup' });
              }
            }}
          />
        )}

        {/* ── This Week ── */}
        {!loading && (
          <View style={styles.thisWeekSectionWrap}>
          <Section title={t('HOME.THIS_WEEK')} colors={colors}>
            {thisWeekLessons.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('HOME.THIS_WEEK_NOTHING_YET')}</Text>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.thisWeekRow,
                  {
                    // Match Quick Actions (`ActionChip`) surface treatment
                    backgroundColor: colors.isDark ? '#1c1c1e' : '#fff',
                    borderColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    borderWidth: 1,
                    ...(colors.isDark ? cardShadowDark('subtle') : { shadowOpacity: 0.04 }),
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
                onPress={openThisWeekSheet}
              >
                {thisWeekPileLayout.slotCount > 0 ? (
                  <View
                    style={[
                      styles.twStackPile,
                      {
                        width: thisWeekPileLayout.width,
                        minWidth: thisWeekPileLayout.width,
                        marginRight: 12,
                      },
                    ]}
                  >
                    {thisWeekPileLayout.shown.map((a, i) => (
                        <View
                          key={a.id}
                          style={[
                            styles.twStackRing,
                            {
                              position: 'absolute',
                              left: i * TW_PILE_STEP,
                              top: 0,
                              zIndex: i + 1,
                              borderColor: thisWeekRowRingBorder,
                              ...(Platform.OS === 'android' ? { elevation: i + 1 } : {}),
                            },
                          ]}
                        >
                          {a.avatar ? (
                            <ExpoImage source={{ uri: a.avatar }} style={styles.twStackImg} contentFit="cover" transition={200} />
                          ) : (
                            <View
                              style={[
                                styles.twStackImg,
                                {
                                  backgroundColor: colors.isDark ? '#3a3a3c' : '#e8e8e8',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                },
                              ]}
                            >
                              <Text style={[styles.twStackIni, { color: colors.isDark ? '#ccc' : '#999' }]}>
                                {a.name.charAt(0)}
                              </Text>
                            </View>
                          )}
                        </View>
                    ))}
                    {thisWeekPileLayout.hasOverflowPill ? (
                      <View
                        style={[
                          styles.twStackRing,
                          styles.twStackMoreRing,
                          {
                            position: 'absolute',
                            left: thisWeekPileLayout.shown.length * TW_PILE_STEP,
                            top: 0,
                            zIndex: thisWeekPileLayout.shown.length + 1,
                            borderColor: thisWeekRowRingBorder,
                            backgroundColor: colors.isDark ? '#3a3a3c' : '#e5e5ea',
                            ...(Platform.OS === 'android'
                              ? { elevation: thisWeekPileLayout.shown.length + 1 }
                              : {}),
                          },
                        ]}
                      >
                        <Text
                          style={[styles.twStackMoreText, { color: colors.isDark ? '#aeaeb2' : '#8e8e93' }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          +{thisWeekPileLayout.overflow}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <Text style={[styles.thisWeekCount, { color: colors.text }]}>
                  {thisWeekLessons.length} {thisWeekLessons.length === 1 ? t('HOME.LESSON_SINGULAR') : t('HOME.LESSON_PLURAL')}
                </Text>
                <Text style={[styles.chevron, { color: colors.isDark ? '#555' : '#ccc' }]}>›</Text>
              </Pressable>
            )}
          </Section>
          </View>
        )}

        {/* ── Quick Actions ── */}
        {!loading && (
          <View style={styles.quickActionsSectionWrap}>
          <Section title={t('HOME.QUICK_ACTIONS')} colors={colors}>
            <View style={styles.actionsGrid}>
              <ActionChip
                image={
                  colors.isDark
                    ? require('../../assets/shared/classroom-original.png')
                    : require('../../assets/shared/classroom.png')
                }
                label={t('HOME.CLASSES')}
                sub={t('HOME.CLASSES_SUB')}
                colors={colors}
                largeAsset={!colors.isDark}
                onPress={isTutor ? openMyClasses : undefined}
              />
              <ActionChip
                image={
                  colors.isDark
                    ? require('../../assets/shared/quick-actions-create-material-original.png')
                    : require('../../assets/shared/quick-actions-create-material.png')
                }
                label={t('HOME.CREATE_MATERIAL')}
                sub={t('HOME.CREATE_MATERIAL_SUB')}
                colors={colors}
                onPress={openMaterials}
                largeAsset={!colors.isDark}
              />
              <ActionChip
                image={
                  colors.isDark
                    ? require('../../assets/shared/quick-actions-forum-original.png')
                    : require('../../assets/shared/quick-actions-forum.png')
                }
                label={t('HOME.FORUM')}
                sub={t('HOME.FORUM_SUB')}
                colors={colors}
                largeAsset={!colors.isDark}
                onPress={openForum}
              />
              <ActionChip icon="star-outline" label={t('HOME.MY_REVIEWS')} sub={t('HOME.MY_REVIEWS_SUB')} colors={colors} />
            </View>
          </Section>
          </View>
        )}

        {/* ── Recent Students ── */}
        {!loading && (
          <View style={styles.recentStudentsSectionWrap}>
          <Section title={t('HOME.RECENT_STUDENTS')} colors={colors}>
            {recentStudents.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('HOME.NO_RECENT_STUDENTS')}</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentScroll}>
                {recentStudents.map(s => (
                  <View key={s.id} style={styles.recentItem}>
                    {s.avatar ? (
                      <ExpoImage source={{ uri: s.avatar }} style={styles.recentAvatar} contentFit="cover" transition={200} />
                    ) : (
                      <View style={[styles.recentAvatar, { backgroundColor: colors.isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={[styles.placeholderLetterLg, { color: colors.isDark ? '#ccc' : '#999' }]}>{s.name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={[styles.recentName, { color: colors.textSecondary }]} numberOfLines={1}>{s.name}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </Section>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
      </Animated.View>
    </SafeAreaView>

    <Modal
      visible={thisWeekSheetVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={closeThisWeekSheet}
    >
      <View style={styles.twSheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: thisWeekSheetBackdropOpacity }]}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.isDark ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.45)' },
            ]}
            onPress={closeThisWeekSheet}
          />
        </Animated.View>
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.twSheetSheetSlot]}>
          <Animated.View style={{ transform: [{ translateY: thisWeekSheetTranslateY }] }}>
            <View
              style={[styles.twSheetCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.twSheetHandleWrap}>
                <View style={[styles.twSheetHandle, { backgroundColor: colors.isDark ? '#48484a' : '#d1d5db' }]} />
              </View>
              <View
                style={[
                  styles.twSheetHeader,
                  { borderBottomColor: colors.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' },
                ]}
              >
                <Text style={[styles.twSheetTitle, { color: colors.text }]}>{t('HOME.THIS_WEEK')}</Text>
                <TouchableOpacity
                  onPress={closeThisWeekSheet}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('COMMON.DONE')}
                >
                  <Text style={[styles.twSheetDone, { color: colors.textSecondary }]}>{t('COMMON.DONE')}</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.twSheetScroll}
                contentContainerStyle={styles.twSheetScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {thisWeekSheetEvents.map((ev, idx) => {
                  const rowRef = getThisWeekRowRef(String(ev.lesson._id));
                  return (
                    <ComingUpRow
                      key={String(ev.lesson._id)}
                      innerRef={rowRef}
                      index={idx}
                      event={ev}
                      colors={colors}
                      t={t}
                      rowStyle={styles.comingUpRowSheet}
                      onPress={() => {
                        // Keep the sheet open. The overlay renders above it and
                        // the close animation morphs back to this exact row.
                        openLessonDetailOverlay(ev.lesson, rowRef, true);
                      }}
                    />
                  );
                })}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
        {homeLessonOverlayCard && homeLessonOverlayFromSheet ? (
          <View
            style={[StyleSheet.absoluteFill, { zIndex: 200, elevation: 200 }]}
            pointerEvents="box-none"
          >
            <LessonDetailOverlay
              card={homeLessonOverlayCard}
              cardRect={homeLessonOverlayRect}
              ctaTargetRect={homeLessonOverlayCtaRect}
              thumbnailTargetRect={homeLessonOverlayThumbnailRect}
              onCloseStart={() => {}}
              onCloseEnd={() => {
                setHomeLessonOverlayCard(null);
                setHomeLessonOverlayFromSheet(false);
                setHomeLessonOverlayCtaRect(null);
                setHomeLessonOverlayThumbnailRect(null);
                setLessonOverlayCoversTabBar(false);
              }}
              onClassGoingMessageRequest={setClassGoingMessage}
            />
          </View>
        ) : null}
      </View>
    </Modal>

    <Modal
      visible={upNextMenuVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={closeUpNextMenu}
    >
      <View style={styles.twSheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: upNextMenuBackdropOpacity }]}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.isDark ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.45)' },
            ]}
            onPress={closeUpNextMenu}
          />
        </Animated.View>
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.twSheetSheetSlot]}>
          <Animated.View style={{ transform: [{ translateY: upNextMenuTranslateY }] }}>
            <View
              style={[styles.twSheetCard, styles.unMenuCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.twSheetHandleWrap}>
                <View style={[styles.twSheetHandle, { backgroundColor: colors.isDark ? '#48484a' : '#d1d5db' }]} />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={handleUpNextMenuInvite}
                style={({ pressed }) => [styles.unMenuRow, pressed && { opacity: 0.65 }]}
              >
                <Ionicons name="person-add-outline" size={22} color={colors.text} />
                <Text style={[styles.unMenuLabel, { color: colors.text }]}>{t('HOME.INVITE_STUDENT')}</Text>
              </Pressable>
              <View style={[styles.unMenuSep, { backgroundColor: colors.border }]} />
              <Pressable
                accessibilityRole="button"
                onPress={handleUpNextMenuReschedule}
                style={({ pressed }) => [styles.unMenuRow, pressed && { opacity: 0.65 }]}
              >
                <Ionicons name="calendar-outline" size={22} color={colors.text} />
                <Text style={[styles.unMenuLabel, { color: colors.text }]}>{t('HOME.RESCHEDULE')}</Text>
              </Pressable>
              <View style={[styles.unMenuSep, { backgroundColor: colors.border }]} />
              <Pressable
                accessibilityRole="button"
                onPress={handleUpNextMenuCancelLesson}
                style={({ pressed }) => [styles.unMenuRow, pressed && { opacity: 0.65 }]}
              >
                <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
                <Text style={[styles.unMenuLabel, { color: colors.danger }]}>{t('HOME.CANCEL_LESSON')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={closeUpNextMenu}
                style={({ pressed }) => [styles.unMenuDismiss, { backgroundColor: colors.isDark ? '#3a3a3c' : '#f2f2f7' }, pressed && { opacity: 0.85 }]}
              >
                <Text style={[styles.unMenuDismissText, { color: colors.text }]}>{t('COMMON.CANCEL')}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>

    <RescheduleLessonModal
      visible={!!upNextRescheduleLesson}
      lesson={upNextRescheduleLesson}
      isTutor={isTutor}
      currentUserId={userId}
      onClose={() => setUpNextRescheduleLesson(null)}
      onSuccess={() => {
        setUpNextRescheduleLesson(null);
        void fetchData();
      }}
    />

    <InviteStudentsModal
      visible={!!upNextInviteClass}
      classId={upNextInviteClass?.classId ?? ''}
      className={upNextInviteClass?.className ?? ''}
      onClose={() => setUpNextInviteClass(null)}
      onInvitesSent={() => {
        void fetchData();
      }}
    />

    <CancelClassReasonModal
      visible={!!upNextCancelClass}
      {...classLessonToCancelModalProps(upNextCancelClass?.lesson)}
      className={upNextCancelClass?.className ?? ''}
      userTimezone={userTz}
      submitting={cancellingClass}
      onContinue={handleConfirmCancelClass}
      onRescheduleInstead={handleCancelClassRescheduleInstead}
      onClose={() => {
        if (!cancellingClass) setUpNextCancelClass(null);
      }}
    />

    {showEarnings && (
      <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
        <EarningsScreen goBack={() => setShowEarnings(false)} />
      </View>
    )}
    {materialsVisible && (
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { zIndex: 50, elevation: 50, backgroundColor: colors.background, transform: [{ translateY: materialsSlideY }] },
        ]}
        collapsable={false}
      >
        <MaterialsScreen goBack={closeMaterials} />
      </Animated.View>
    )}
    {myClassesVisible && (
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { zIndex: 50, elevation: 50, backgroundColor: colors.background, transform: [{ translateY: myClassesSlideY }] },
        ]}
        collapsable={false}
      >
        <MyClassesScreen goBack={closeMyClasses} />
      </Animated.View>
    )}
    {forumVisible && (
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { zIndex: 50, elevation: 50, backgroundColor: colors.background, transform: [{ translateY: forumSlideY }] },
        ]}
        collapsable={false}
      >
        <ForumScreen goBack={closeForum} />
      </Animated.View>
    )}
    {homeLessonOverlayCard && !homeLessonOverlayFromSheet ? (
      <View
        style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}
        pointerEvents="box-none"
      >
        <LessonDetailOverlay
          card={homeLessonOverlayCard}
          cardRect={homeLessonOverlayRect}
          ctaTargetRect={homeLessonOverlayCtaRect}
          thumbnailTargetRect={homeLessonOverlayThumbnailRect}
          onCloseStart={() => {}}
          onCloseEnd={() => {
            setHomeLessonOverlayCard(null);
            setHomeLessonOverlayFromSheet(false);
            setHomeLessonOverlayCtaRect(null);
            setHomeLessonOverlayThumbnailRect(null);
            setLessonOverlayCoversTabBar(false);
          }}
          onClassGoingMessageRequest={setClassGoingMessage}
        />
      </View>
    ) : null}

    <ClassGoingMessageModal
      visible={classGoingMessage !== null}
      onClose={() => setClassGoingMessage(null)}
      attendees={classGoingMessage?.attendees ?? []}
      receiverId={classGoingMessage?.receiverId}
      receiverIds={classGoingMessage?.receiverIds}
      className={classGoingMessage?.className}
      classId={classGoingMessage?.classId}
      onSent={(result) => {
        // Clear the open request then jump to the Messages tab on the right
        // thread so the user sees the conversation they just created.
        setClassGoingMessage(null);
        if (result.kind === 'group') {
          navigation.navigate('Messages', { groupId: result.groupId } as never);
        } else {
          navigation.navigate('Messages', { userId: result.userId } as never);
        }
      }}
    />
    </View>
  );
}

/* ─── Toolbar ─── */

function Toolbar({
  user,
  onEarningsTap,
  onNotificationsTap,
  notifUnreadCount,
  colors,
  loading,
  greetingTitle,
  greetingSub,
}: {
  user: any;
  onEarningsTap: () => void;
  onNotificationsTap: () => void;
  notifUnreadCount: number;
  colors: any;
  loading: boolean;
  greetingTitle: string;
  greetingSub: string;
}) {
  const isDark = colors.isDark;
  const prevCount = useRef(0);
  const badgePop = useSpringPopAnim({
    delay: 150,
    overshoot: 1.35,
    translateYPeak: -3,
    enabled: notifUnreadCount > 0 && prevCount.current === 0,
  });
  // Update ref after render so next transition can detect 0→N
  useEffect(() => { prevCount.current = notifUnreadCount; });

  return (
    <View style={[styles.toolbar, { backgroundColor: colors.background }]}>
      <View style={styles.toolbarLeft}>
        {/* Experiment: hide Barnabi mark in toolbar — welcome lives here instead
        <Image source={require('../../assets/shared/barnabi-bird.png')} style={styles.toolbarIcon} />
        <Text style={[styles.toolbarBrand, { color: colors.text }]}>Barnabi</Text>
        */}
        {loading ? (
          <View style={styles.toolbarWelcomeInner}>
            <Skeleton width={Math.min(SCREEN_W - 160, 220)} height={22} colors={colors} style={{ marginBottom: 6 }} />
            <Skeleton width={Math.min(SCREEN_W - 200, 160)} height={13} colors={colors} />
          </View>
        ) : (
          <View style={styles.toolbarWelcomeInner}>
            <Text style={[styles.toolbarWelcomeTitle, { color: colors.text }]} numberOfLines={1}>
              {greetingTitle}
            </Text>
            {greetingSub ? (
              <Text style={[styles.toolbarWelcomeSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {greetingSub}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      <View style={styles.toolbarRight}>
        <TouchableOpacity style={[styles.earningsPill, { backgroundColor: isDark ? '#2a2a2a' : '#f2f2f7' }]} onPress={onEarningsTap} activeOpacity={0.7}>
          <Image
            source={
              isDark
                ? require('../assets/home/earnings-dollar-3d-dark.png')
                : require('../assets/home/earnings-dollar-3d-light.png')
            }
            style={styles.earningsPillDollarImg}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.notifBtn}
          activeOpacity={0.7}
          onPress={onNotificationsTap}
          accessibilityRole="button"
          accessibilityLabel={notifUnreadCount > 0 ? `Notifications, ${notifUnreadCount} unread` : 'Notifications'}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          {notifUnreadCount > 0 ? (
            <Animated.View
              style={[
                styles.notifBadge,
                {
                  opacity: badgePop.opacity,
                  transform: [{ scale: badgePop.scale }, { translateY: badgePop.translateY }],
                },
              ]}
            >
              <Text style={styles.notifBadgeText}>
                {notifUnreadCount > 99 ? '99+' : notifUnreadCount}
              </Text>
            </Animated.View>
          ) : null}
        </TouchableOpacity>
        {user?.picture ? (
          <ExpoImage source={{ uri: user.picture }} style={styles.toolbarAvatar} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.toolbarAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[styles.toolbarAvatarLetter, { color: isDark ? '#ccc' : '#fff' }]}>
              {(user?.firstName || user?.name || 'U').charAt(0)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ─── Section wrapper ─── */

function Section({ title, rightLabel, children, colors }: { title: string; rightLabel?: string; children: React.ReactNode; colors: any }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        {rightLabel && (
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={[styles.seeAllText, { color: colors.textSecondary }]}>{rightLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

/* ─── Up Next: Filled ─── */

function UpNextFilled({
  event,
  colors,
  t,
  onOpenMenu,
  cardMeasureRef,
  ctaMeasureRef,
  thumbnailMeasureRef,
  onPressCard,
  onJoin,
}: {
  event: TimelineEvent;
  colors: any;
  t: any;
  onOpenMenu: () => void;
  cardMeasureRef: RefObject<View | null>;
  ctaMeasureRef?: RefObject<View | null>;
  thumbnailMeasureRef?: RefObject<View | null>;
  onPressCard: () => void;
  onJoin: () => void;
}) {
  const isDark = colors.isDark;
  const [, setJoinUiTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setJoinUiTick(n => n + 1), 10000);
    return () => clearInterval(id);
  }, [event.lesson._id]);

  const joinGate = getJoinGateState(event.lesson);
  const inSlot = isLessonInProgressSlot(event.lesson);

  const joinCtaPop = useSpringPopAnim({ delay: 620 });

  const classAttendeesRaw = useMemo(
    () => resolveClassAttendeesForPreview(event.lesson as any),
    [event.lesson],
  );
  const classAttendeeStack = useMemo(() => {
    const max = 3;
    const slice = classAttendeesRaw.slice(0, max);
    return {
      items: slice.map((a: any) => ({
        picture: a.picture || a.profilePicture,
        initials: attendeeStackInitials(a),
      })),
      extra: Math.max(0, classAttendeesRaw.length - max),
    };
  }, [classAttendeesRaw]);

  const joinCtaLabel = joinGate.canJoin
    ? inSlot
      ? t('HOME.JOIN_NOW')
      : event.lesson.isClass
        ? t('HOME.JOIN_CLASS')
        : t('HOME.JOIN_LESSON')
    : t('HOME.JOIN_IN_TIME', { time: formatTimeUntilLessonStart(event.lesson) });

  /**
   * 1:1 lesson "subject chip" (🇪🇸 Spanish) shown under the name. Mirrors
   * web `.upnext-filled-meta`. Computed once per render, no template fn.
   */
  const subjectChipText = !event.lesson.isClass ? event.subject || '' : '';
  const subjectChipFlag = subjectChipText ? getLanguageFlag(subjectChipText) : null;

  const onJoinPress = () => {
    const gate = getJoinGateState(event.lesson);
    if (gate.canJoin) {
      onJoin();
      return;
    }
    if (gate.sessionEnded) {
      Alert.alert(t('HOME.JOIN_LESSON_ENDED_TITLE'), t('HOME.JOIN_LESSON_ENDED_MSG'), [{ text: t('COMMON.OK') }]);
      return;
    }
    Alert.alert(
      t('HOME.JOIN_NOT_READY_TITLE'),
      t('HOME.JOIN_NOT_READY_MSG', {
        session: t(event.lesson.isClass ? 'HOME.JOIN_SESSION_CLASS' : 'HOME.JOIN_SESSION_LESSON'),
        time: formatTimeUntilLessonStart(event.lesson),
      }),
      [{ text: t('COMMON.OK') }],
    );
  };

  return (
    <View style={[styles.section, styles.upNextSectionSpacing]}>
      <Text style={[styles.sectionTitle, styles.sectionTitleBelow, { color: colors.text }]}>
        {t('HOME.UP_NEXT')}
      </Text>
      <View style={styles.upNextCardRelWrap}>
        <Pressable
          ref={cardMeasureRef}
          accessibilityRole="button"
          onPress={onPressCard}
          style={({ pressed }) => [
            styles.upNextCardSurface,
            styles.upNextCard,
            styles.upNextCardFilled,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              ...upNextCardShellShadow(isDark),
              opacity: pressed ? 0.96 : 1,
            },
          ]}
          android_ripple={{ color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
        >
        <View
          ref={thumbnailMeasureRef}
          style={event.lesson.isClass ? styles.upNextClassCoverWrap : styles.upNextAvatarWrap}
        >
          {event.avatar ? (
            <ExpoImage
              source={{ uri: event.avatar }}
              style={event.lesson.isClass ? styles.upNextClassCoverImage : styles.upNextAvatarImage}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View
              style={[
                event.lesson.isClass ? styles.upNextClassCoverImage : styles.upNextAvatarImage,
                { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
              ]}
            >
              <Ionicons
                name={event.lesson.isClass ? 'people' : 'person'}
                size={event.lesson.isClass ? 28 : 24}
                color={colors.textTertiary}
              />
            </View>
          )}
        </View>

        <Text
          style={[
            styles.cardTitle,
            event.lesson.isClass ? styles.upNextClassTitleBelowCover : styles.upNextLessonTitle,
            { color: colors.text },
          ]}
        >
          {event.name}
        </Text>

        {event.isTrialLesson && <UpNextTrialBadge label={t('HOME.STATUS_TRIAL')} />}

        <View style={styles.upNextFilledMetaWrap}>
          {event.lesson.isClass ? (
            <>
              <View
                style={[
                  styles.upNextClassScheduleTray,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f7f7f9',
                    shadowColor: isDark ? 'transparent' : '#000',
                  },
                ]}
              >
                {/* Date badge tile — mirrors web .tw-date-badge */}
                <View
                  style={[
                    styles.upNextDateBadge,
                    event.isToday
                      ? { backgroundColor: '#4298d3' }
                      : isDark
                        ? { backgroundColor: '#3a3a3c' }
                        : { backgroundColor: '#f2f2f7' },
                  ]}
                >
                  <Text
                    style={[
                      styles.upNextDateBadgeMonth,
                      event.isToday
                        ? { color: '#ffffff' }
                        : { color: isDark ? '#ff6b8a' : '#ff3b30' },
                    ]}
                  >
                    {event.isToday ? 'TODAY' : event.isTomorrow ? 'TMW' : event.dateBadgeMonth}
                  </Text>
                  <Text
                    style={[
                      styles.upNextDateBadgeDay,
                      event.isToday
                        ? { color: '#ffffff' }
                        : isDark
                          ? { color: '#f5f5f7' }
                          : { color: '#1d1d1f' },
                    ]}
                  >
                    {event.dateBadgeDay}
                  </Text>
                  <Text
                    style={[
                      styles.upNextDateBadgeWeekday,
                      event.isToday
                        ? { color: 'rgba(255,255,255,0.78)' }
                        : isDark
                          ? { color: '#8e8e93' }
                          : { color: '#8e8e93' },
                    ]}
                  >
                    {event.dateBadgeWeekday}
                  </Text>
                </View>

                {/* Time + duration block */}
                <View style={styles.upNextClassScheduleInfo}>
                  <Text style={[styles.upNextClassScheduleTime, { color: isDark ? '#ffffff' : '#1d1d1f' }]}>
                    {event.timeRange}
                  </Text>
                  {event.duration > 0 && (
                    <Text style={[styles.upNextClassScheduleDuration, { color: '#8e8e93' }]}>
                      {t('HOME.CLASS_DURATION_MIN', { count: event.duration })}
                    </Text>
                  )}
                </View>
              </View>
            </>
          ) : (
            <>
              {subjectChipText ? (
                <View
                  style={[
                    styles.upNextLessonSubjectChip,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#f1f1f3',
                    },
                  ]}
                >
                  {subjectChipFlag ? (
                    <Text style={styles.upNextLessonSubjectFlag}>{subjectChipFlag}</Text>
                  ) : null}
                  <Text style={[styles.upNextLessonSubjectText, { color: colors.textSecondary }]}>
                    {subjectChipText}
                  </Text>
                </View>
              ) : null}
              <View
                style={[
                  styles.upNextLessonScheduleTray,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f7f7f9',
                    shadowColor: isDark ? 'transparent' : '#000',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.upNextLessonDay,
                    event.isToday || event.isTomorrow
                      ? { color: '#34C759' }
                      : { color: colors.textTertiary },
                  ]}
                >
                  {event.dateTag}
                </Text>
                <Text style={[styles.upNextLessonTime, { color: colors.text }]}>
                  {event.timeRange}
                </Text>
                {event.duration > 0 && (
                  <Text style={[styles.upNextLessonDuration, { color: colors.textTertiary }]}>
                    {t('HOME.LESSON_DURATION_MIN', { count: event.duration })}
                  </Text>
                )}
              </View>
              {!!event.countdown && joinGate.canJoin && (
                <Text style={[styles.cardCountdown, styles.upNextFilledCountdown, { color: colors.textSecondary }]}>
                  {t('HOME.STARTS_IN_TIME', { time: event.countdown })}
                </Text>
              )}
            </>
          )}
        </View>

        {event.lesson.isClass && classAttendeeStack.items.length > 0 ? (
          <View style={styles.upNextGoingRow}>
            <Text style={[styles.upNextGoingLabel, { color: colors.textSecondary }]}>Going</Text>
            <View style={styles.upNextStackRow}>
              {classAttendeeStack.items.map((it, i) => (
                <View
                  key={i}
                  style={[
                    styles.upNextStackAv,
                    {
                      marginLeft: i === 0 ? 0 : -7,
                      borderColor: colors.card,
                      zIndex: 3 - i,
                      backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8',
                    },
                  ]}
                >
                  {it.picture ? (
                    <ExpoImage source={{ uri: it.picture }} style={styles.upNextStackImg} contentFit="cover" transition={200} />
                  ) : (
                    <Text style={[styles.upNextStackIni, { color: colors.textSecondary }]}>{it.initials}</Text>
                  )}
                </View>
              ))}
              {classAttendeeStack.extra > 0 ? (
                <Text style={[styles.upNextStackMore, { color: colors.textTertiary }]}>+{classAttendeeStack.extra}</Text>
              ) : null}
            </View>
            {(event.lesson as any).capacity > 0 ? (
              <Text style={[styles.upNextCapacityInline, { color: colors.textTertiary }]}>
                {' · '}
                {classAttendeesRaw.length}/{(event.lesson as any).capacity}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.upNextFilledCtaWrap, { marginTop: 'auto' }]}>
          <Animated.View style={{ opacity: joinCtaPop.opacity, transform: [{ scale: joinCtaPop.scale }, { translateY: joinCtaPop.translateY }] }}>
          <TouchableOpacity
            ref={ctaMeasureRef as any}
            accessibilityRole="button"
            activeOpacity={joinGate.canJoin ? 0.88 : 1}
            onPress={onJoinPress}
            style={[
              styles.ctaBtn,
              styles.upNextCardCtaWide,
              { backgroundColor: colors.joinCtaBackground },
            ]}
          >
            <Text style={[styles.ctaBtnText, { color: '#ffffff' }]}>{joinCtaLabel}</Text>
            <Image
              source={require('../../assets/shared/setup-availability-arrow.png')}
              style={[styles.ctaBtnArrowImg, { tintColor: '#ffffff' }]}
            />
          </TouchableOpacity>
          </Animated.View>
        </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('HOME.UP_NEXT_MENU_A11Y')}
          hitSlop={10}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpenMenu();
          }}
          style={({ pressed }) => [styles.upNextCardMenuBtn, pressed && { opacity: 0.55 }]}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

/* ─── Up Next: Empty ─── */

function UpNextEmpty({ colors, title, message, ctaLabel, onCta, disabled }: {
  colors: any; title: string; message: string; ctaLabel: string; onCta: () => void; disabled?: boolean;
}) {
  const isDark = colors.isDark;
  const { t } = useTranslation();
  return (
    <View style={[styles.section, styles.upNextSectionSpacing, styles.upNextScheduleSectionTopPad]}>
      <Text style={[styles.sectionTitle, styles.sectionTitleBelow, { color: colors.text }]}>{t('HOME.YOUR_SCHEDULE')}</Text>
      <View
        style={[
          styles.upNextCardSurface,
          styles.upNextCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            ...upNextCardShellShadow(isDark),
          },
        ]}
      >
        <View style={[styles.emptyArtWrap, styles.upNextEmptyArtSpacing]}>
          <Image
            source={
              isDark
                ? require('../../assets/shared/calendar-mobile-original.png')
                : require('../../assets/shared/calendar-mobile.png')
            }
            style={isDark ? styles.emptyArtImgDark : styles.emptyArtImg}
          />
        </View>
        <Text style={[styles.cardTitle, styles.upNextEmptyTitleSpacing, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.cardSubtitle, styles.upNextEmptyMessageSpacing, { color: colors.textSecondary }]}>
          {message}
        </Text>
        <TouchableOpacity
          style={[
            styles.ctaBtn,
            styles.upNextCardCtaWide,
            styles.upNextEmptyCtaSpacing,
            { backgroundColor: isDark ? CTA_DARK_BLUE : '#000000' },
            disabled && { opacity: 0.35 },
          ]}
          activeOpacity={0.85}
          onPress={disabled ? undefined : onCta}
          disabled={disabled}
        >
          <Text style={styles.ctaBtnText}>{ctaLabel}</Text>
          <Image source={require('../../assets/shared/setup-availability-arrow.png')} style={styles.ctaBtnArrowImg} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Up Next: Skeleton ─── */

function UpNextSkeleton({ colors }: { colors: any }) {
  return (
    <View style={[styles.section, styles.upNextSectionSpacing, styles.upNextScheduleSectionTopPad]}>
      <Skeleton width={80} height={15} style={{ marginBottom: 14 }} colors={colors} />
      <View
        style={[
          styles.upNextCardSurface,
          styles.upNextCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            ...upNextCardShellShadow(colors.isDark),
          },
        ]}
      >
        <ShimmerSkeleton
          width={UP_NEXT_AVATAR_SIZE}
          height={UP_NEXT_AVATAR_SIZE}
          borderRadius={UP_NEXT_AVATAR_RADIUS}
          style={{ marginBottom: 12 }}
          colors={colors}
        />
        <Skeleton width={140} height={15} style={{ marginBottom: 8 }} colors={colors} />
        <Skeleton width={210} height={12} style={{ marginBottom: 8 }} colors={colors} />
        <Skeleton width={100} height={12} colors={colors} />
      </View>
    </View>
  );
}

/* ─── Coming Up Row ─── */

function ComingUpRow({
  event,
  colors,
  t,
  onPress,
  rowStyle,
  innerRef,
  index = 0,
}: {
  event: TimelineEvent;
  colors: any;
  t: any;
  onPress?: () => void;
  rowStyle?: object;
  innerRef?: RefObject<View | null>;
  index?: number;
}) {
  const isDark = colors.isDark;
  const enterAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 260,
      delay: index * 55,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const avatarStackBorder = isDark ? 'rgba(255,255,255,0.92)' : '#ffffff';
  const stackLen = event.avatarStack?.length ?? 0;
  const isClass = !!(event.lesson as any)?.isClass;
  const classCoverUri = String(
    (event.lesson as any)?.classData?.thumbnail || event.avatar || '',
  ).trim();
  const row = [
    styles.comingUpRow,
    rowStyle,
    {
      backgroundColor: colors.card,
      ...(isDark ? cardShadowDark('subtle') : { shadowOpacity: 0.04 }),
    },
  ];
  const body = (
    <View style={[styles.comingUpRowInner, isClass && styles.comingUpRowInnerClass]}>
      <View style={styles.cuLeft}>
        <Text style={[styles.cuDate, { color: colors.text }]}>{event.date}</Text>
        <Text style={[styles.cuTime, { color: colors.textSecondary }]}>{event.time}</Text>
        <Text style={[styles.cuDuration, { color: colors.textTertiary }]}>{event.duration} {t('HOME.MINS')}</Text>
      </View>
      {isClass ? (
        <View style={styles.cuCenterClass}>
          <View
            style={[
              styles.cuClassCoverWrap,
              { backgroundColor: isDark ? '#2c2c2e' : '#e8e8ea' },
            ]}
          >
            {classCoverUri ? (
              <ExpoImage source={{ uri: classCoverUri }} style={styles.cuClassCoverImage} contentFit="cover" transition={200} />
            ) : (
              <View style={styles.cuClassCoverPlaceholder}>
                <Ionicons name="people" size={14} color={colors.textTertiary} />
              </View>
            )}
          </View>
          <Text style={[styles.cuNameClass, { color: colors.text }]} numberOfLines={2}>
            {event.name}
          </Text>
        </View>
      ) : (
      <View style={styles.cuCenter}>
        {event.avatarStack && event.avatarStack.length > 0 ? (
          <View style={styles.cuAvatarStackRow}>
            {event.avatarStack.map((face, i) => (
              <View
                key={i}
                style={[
                  styles.cuAvatarStackRing,
                  {
                    marginLeft: i > 0 ? -10 : 0,
                    zIndex: i + 1,
                    borderColor: avatarStackBorder,
                  },
                ]}
              >
                {face.picture ? (
                  <ExpoImage source={{ uri: face.picture }} style={styles.cuAvatarStackImg} contentFit="cover" transition={200} />
                ) : (
                  <View
                    style={[
                      styles.cuAvatarStackImg,
                      {
                        backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8',
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <Text style={[styles.cuAvatarStackIni, { color: isDark ? '#ccc' : '#999' }]} numberOfLines={1}>
                      {face.initials}
                    </Text>
                  </View>
                )}
              </View>
            ))}
            {(event.avatarStackOverflow ?? 0) > 0 ? (
              <View
                style={[
                  styles.cuAvatarStackRing,
                  styles.cuAvatarStackMoreRing,
                  {
                    marginLeft: -10,
                    zIndex: stackLen + 1,
                    borderColor: avatarStackBorder,
                    backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea',
                  },
                ]}
              >
                <Text
                  style={[styles.cuAvatarStackMoreText, { color: isDark ? '#aeaeb2' : '#8e8e93' }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  +{event.avatarStackOverflow}
                </Text>
              </View>
            ) : null}
          </View>
        ) : event.avatar ? (
          <ExpoImage source={{ uri: event.avatar }} style={styles.cuAvatar} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.cuAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[styles.placeholderLetter, { color: isDark ? '#ccc' : '#999' }]}>{event.name.charAt(0)}</Text>
          </View>
        )}
        <Text style={[styles.cuName, { color: colors.text }]} numberOfLines={1}>{event.name}</Text>
      </View>
      )}
      <View
        style={[
          styles.cuBadge,
          {
            backgroundColor: isDark
              ? (event.isTrialLesson ? 'rgba(245,166,35,0.15)' : 'rgba(46,125,50,0.15)')
              : event.isTrialLesson
                ? '#FFF8E1'
                : '#E8F5E9',
          },
        ]}
      >
        <Text
          style={[
            styles.cuBadgeText,
            { color: event.isTrialLesson ? (isDark ? '#fbbf24' : '#F5A623') : isDark ? '#4ade80' : '#2E7D32' },
          ]}
        >
          {event.statusLabel}
        </Text>
      </View>
    </View>
  );
  const enterMotion = {
    opacity: enterAnim,
    transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };
  if (onPress) {
    return (
      <Animated.View style={enterMotion}>
        <TouchableOpacity
          ref={innerRef as any}
          style={row}
          activeOpacity={0.7}
          onPress={onPress}
        >
          {body}
        </TouchableOpacity>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={enterMotion}>
      <View ref={innerRef} style={row}>
        {body}
      </View>
    </Animated.View>
  );
}

/* ─── Action Chip ─── */

function ActionChip({ image, icon, label, sub, colors, onPress, largeAsset }: {
  image?: any;
  icon?: string;
  label: string;
  sub: string;
  colors: any;
  onPress?: () => void;
  /** Wider canvas padding in PNG — same scale for classes / materials / forum */
  largeAsset?: boolean;
}) {
  const isDark = colors.isDark;
  const lift = !isDark;
  return (
    <TouchableOpacity
      style={[
        styles.actionChip,
        {
          backgroundColor: isDark ? '#1c1c1e' : '#fff',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          ...(isDark
            ? cardShadowDark('subtle')
            : {
                shadowOpacity: Platform.OS === 'ios' ? 0.08 : 0,
                elevation: Platform.OS === 'android' ? 3 : 0,
              }),
        },
      ]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      {(image || icon) ? (
        <View
          style={[
            styles.actionChipIconWrap,
            styles.actionChipIconBg,
            image && styles.actionChipIconBgAsset,
            {
              backgroundColor: icon
                ? (isDark ? 'rgba(176,158,114,0.08)' : 'rgba(176,158,114,0.1)')
                : 'transparent',
            },
          ]}
        >
          {image ? (
            <Image
              source={image}
              style={[styles.actionChipImg, largeAsset && styles.actionChipImgLargeAsset]}
            />
          ) : (
            <Ionicons name={icon as any} size={20} color={isDark ? '#9A8E72' : '#B09E72'} />
          )}
        </View>
      ) : null}
      <View style={styles.actionChipText}>
        <Text style={[styles.actionChipLabel, { color: isDark ? colors.text : '#222' }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.actionChipSub, { color: isDark ? '#8e8e93' : '#717171' }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ─── Skeleton ─── */

function Skeleton({ width, height, style, colors }: { width: number; height: number; style?: any; colors?: any }) {
  return <ShimmerSkeleton width={width} height={height} borderRadius={Math.min(height / 2, 10)} style={style} colors={colors} />;
}

function getGreeting(t: any, name: string) {
  const h = new Date().getHours();
  if (h < 12) return t('HOME.GREETING_MORNING', { name });
  if (h < 18) return t('HOME.GREETING_AFTERNOON', { name });
  return t('HOME.GREETING_EVENING', { name });
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f7f7' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 30 },

  // Profile Checklist
  profileChecklist: {
    borderRadius: 14,
    padding: 16,
    paddingBottom: 8,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
    elevation: 2,
  },
  pclHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  pclTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  pclHiddenBadge: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  pclHiddenText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#e8893c',
  },
  pclItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  pclItemDone: {
    opacity: 0.5,
  },
  pclLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  pclLabelDone: {
    textDecorationLine: 'line-through',
    textDecorationColor: 'rgba(0,0,0,0.2)',
  },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: '#f7f7f7',
  },
  toolbarLeft: { flex: 1, minWidth: 0, marginRight: 8, justifyContent: 'center' },
  toolbarWelcomeInner: { width: '100%' },
  toolbarWelcomeTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  toolbarWelcomeSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  toolbarIcon: { width: 28, height: 28, borderRadius: 14 },
  toolbarBrand: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  toolbarRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  earningsPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Fills the fixed 32×32 pill; pill + toolbar layout unchanged. Nudge down so the 3D art isn’t tight to the top edge. */
  earningsPillDollarImg: {
    width: 30,
    height: 30,
    backgroundColor: 'transparent',
    marginTop: 4,
  },
  notifBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  notifIcon: { fontSize: 18 },
  toolbarAvatar: { width: 30, height: 30, borderRadius: 15 },
  toolbarAvatarLetter: { fontSize: 13, fontWeight: '600', color: '#fff' },

  // Greeting
  greeting: { marginTop: 4, marginBottom: 20 },
  greetingTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  greetingSub: { fontSize: 14, color: '#717171', marginTop: 4, lineHeight: 20, paddingBottom: 20 },

  // Section
  section: { marginBottom: 20 },
  /** Space below Up Next before This Week. */
  upNextSectionSpacing: { marginBottom: 20 },
  /** Space above “Your schedule” title (empty + skeleton only; RN). */
  upNextScheduleSectionTopPad: { paddingTop: 18 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 0 },
  /** Titles not wrapped in `sectionHeader` (e.g. Up Next) need space before the card. */
  sectionTitleBelow: { marginBottom: 12 },
  upNextCardRelWrap: {
    position: 'relative',
    alignSelf: 'stretch',
  },
  upNextCardMenuBtn: {
    position: 'absolute',
    top: 10,
    right: 14,
    zIndex: 6,
    padding: 8,
  },
  seeAllText: { fontSize: 13, fontWeight: '600', color: '#717171' },
  emptyText: { fontSize: 14, color: '#999' },

  /**
   * Up Next card shell — iOS uses shadow* props; Android uses elevation (shadowOpacity is ignored).
   * Values are stronger than before so the lift reads on a real device.
   */
  upNextCardSurface: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 28,
    padding: 23,
    paddingTop: 14,
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 28,
    // Defaults; iOS/Android light mode refined inline (opacity + elevation)
    shadowOpacity: 0.14,
    elevation: 14,
  },
  /** Same shell for filled + empty Up Next (see UP_NEXT_CARD_MIN_HEIGHT). */
  upNextCard: {
    paddingTop: 23,
    paddingBottom: 42,
    minHeight: UP_NEXT_CARD_MIN_HEIGHT,
    justifyContent: 'center',
  },
  /**
   * Filled card: stack from the top; Join CTA sits in `upNextFilledCtaWrap` with
   * `marginTop: 'auto'` so it stays anchored to the bottom of the min-height
   * shell (1:1 lessons align with the class “Going” layout).
   */
  upNextCardFilled: {
    justifyContent: 'flex-start',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    marginBottom: 4,
    textAlign: 'center',
  },
  /** Class Up Next: extra air between cover thumbnail and title (see `upNextClassCoverWrap`). */
  upNextClassTitleBelowCover: {
    marginTop: 8,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  /** 1:1 Up Next: bigger title to balance the larger 80px avatar. */
  upNextLessonTitle: {
    fontSize: 24,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  /**
   * Subject chip below the name (e.g., 🇪🇸 Spanish). Mirrors web
   * `.upnext-filled-meta` pill so 1:1 cards carry the language signal.
   */
  upNextLessonSubjectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 12,
  },
  upNextLessonSubjectFlag: {
    fontSize: 13,
    marginRight: 6,
  },
  upNextLessonSubjectText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  /**
   * Schedule "tray": soft surface that groups date → time → duration into
   * one block (mirrors web `.upnext-filled-schedule`). Sits centered, hugs
   * its content, no full-width fill.
   */
  upNextLessonScheduleTray: {
    alignSelf: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    minWidth: 160,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {},
    }),
  },
  /** 1:1 Up Next meta — Apple-style stacked hierarchy: day → time → duration. */
  upNextLessonDay: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    textAlign: 'center',
    marginBottom: 2,
  },
  upNextLessonTime: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    textAlign: 'center',
    marginBottom: 1,
  },
  upNextLessonDuration: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 260,
    marginBottom: 4,
  },
  cardMeta: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  metaToday: { color: '#34C759', fontWeight: '600' },
  cardCountdown: { fontSize: 13, color: '#999', marginBottom: 8 },
  /** Extra space above Join on Up Next filled card (date/time block → button). */
  upNextFilledMetaWrap: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 4,
  },
  upNextFilledMeta: { marginBottom: 0 },
  upNextFilledCountdown: { marginTop: 6, marginBottom: 0 },
  /**
   * Class Up Next: schedule tray — mirrors web `.upnext-filled-schedule`.
   * Horizontal: date badge tile on the left, time+duration block on the right.
   */
  upNextClassScheduleTray: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    minWidth: 196,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {},
    }),
  },
  /** Date tile inside the class schedule tray (MAY / 2 / SAT). */
  upNextDateBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    height: 52,
    paddingVertical: 6,
    borderRadius: 10,
  },
  upNextDateBadgeMonth: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
    color: '#ff3b30',
    marginBottom: 0,
  },
  upNextDateBadgeDay: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.45,
    lineHeight: 22,
  },
  upNextDateBadgeWeekday: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 0.35,
    textTransform: 'uppercase' as const,
    marginTop: 0,
  },
  upNextClassScheduleInfo: {
    flexShrink: 1,
    alignItems: 'flex-start',
    gap: 1,
  },
  upNextClassScheduleTime: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  upNextClassScheduleDuration: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  /** Class Up Next — one horizontal line (label + avatars + capacity) so the card doesn’t grow tall. */
  upNextGoingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    width: '100%',
    maxWidth: '100%',
    marginTop: 6,
    marginBottom: 0,
    paddingHorizontal: 4,
  },
  upNextGoingLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
    marginRight: 8,
    flexShrink: 0,
  },
  upNextStackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  upNextStackAv: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextStackImg: { width: '100%', height: '100%' },
  upNextStackIni: { fontSize: 9, fontWeight: '600', textAlign: 'center' },
  upNextStackMore: { marginLeft: 6, fontSize: 12, fontWeight: '600', flexShrink: 0 },
  upNextCapacityInline: { fontSize: 11, fontWeight: '500', flexShrink: 0 },
  /** Full width of card (parent uses horizontal padding); centers label + arrow. */
  upNextCardCtaWide: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  /**
   * Pushes the Join CTA to the card bottom; `marginTop: 'auto'` is applied
   * inline. `paddingTop` = minimum space when there is no extra flex gap.
   */
  upNextFilledCtaWrap: {
    alignSelf: 'stretch',
    width: '100%',
    paddingTop: 20,
  },
  emptyArtWrap: {
    width: 88,
    height: 88,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  /** Extra vertical rhythm inside Up Next empty card only (not filled state). */
  upNextEmptyArtSpacing: { marginBottom: 22 },
  upNextEmptyTitleSpacing: { marginBottom: 12 },
  upNextEmptyMessageSpacing: { marginBottom: 22 },
  upNextEmptyCtaSpacing: { marginTop: 18 },
  /** Light: new calendar art has extra canvas padding — scale up without shifting layout */
  emptyArtImg: { width: 72, height: 72, resizeMode: 'contain', transform: [{ scale: 2.05 }] },
  /** Dark: original calendar asset — no extra scale */
  emptyArtImgDark: { width: 72, height: 72, resizeMode: 'contain' },

  // CTA button (black pill with arrow — matching .m-card-empty-link)
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    marginTop: 6,
  },
  ctaBtnText: { fontSize: 14, fontWeight: '600', color: '#ffffff', letterSpacing: -0.1 },
  ctaBtnArrow: { fontSize: 16, color: '#ffffff' },
  ctaBtnArrowImg: { width: 26, height: 26, resizeMode: 'contain', marginRight: -6 },

  // Up Next avatar — rounded square like web `ion-avatar.upnext-filled-avatar` (not a circle)
  upNextAvatarWrap: {
    width: UP_NEXT_AVATAR_SIZE,
    height: UP_NEXT_AVATAR_SIZE,
    borderRadius: UP_NEXT_AVATAR_RADIUS,
    overflow: 'hidden',
    marginBottom: 14,
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
    }),
  },
  upNextAvatarImage: { width: '100%', height: '100%' },

  upNextClassCoverWrap: {
    width: 144,
    height: 90,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 17,
    backgroundColor: 'transparent',
  },
  upNextClassCoverImage: { width: '100%', height: '100%' },

  // Trial badge — web `.badge-inline.badge-trial` (Up Next)
  trialBadgePopWrap: {
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  trialBadgeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    gap: 4,
  },
  trialBadgeInlineText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  thisWeekSectionWrap: { marginTop: 9 },
  thisWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  twStackPile: {
    height: TW_PILE_SIZE,
    position: 'relative',
    alignSelf: 'center',
    flexShrink: 0,
  },
  twStackRing: {
    width: TW_PILE_SIZE,
    height: TW_PILE_SIZE,
    borderRadius: TW_PILE_SIZE / 2,
    borderWidth: 1,
    overflow: 'hidden',
  },
  twStackImg: { width: '100%', height: '100%' },
  twStackIni: { fontSize: 13, fontWeight: '700' },
  twStackMoreRing: { alignItems: 'center', justifyContent: 'center' },
  twStackMoreText: { fontSize: 12, fontWeight: '700', letterSpacing: -0.2 },
  thisWeekCount: { flex: 1, fontSize: 15, fontWeight: '600', color: '#222' },
  chevron: { fontSize: 22, color: '#ccc', fontWeight: '300' },

  // Quick Actions
  quickActionsSectionWrap: { marginTop: 11 },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%' as any,
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  actionChipIconWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionChipIconBg: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  /** PNGs use transform scale — allow paint outside 40×40 */
  actionChipIconBgAsset: {
    overflow: 'visible',
  },
  actionChipImg: { width: 40, height: 40, resizeMode: 'contain' },
  actionChipImgLargeAsset: { transform: [{ scale: 1.38 }] },
  actionChipText: {
    flexDirection: 'column',
    gap: 1,
    flex: 1,
  },
  actionChipLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  actionChipSub: {
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: -0.05,
  },

  // Coming Up
  comingUpRow: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  comingUpRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  /** Class rows: align date + badge to top beside a taller cover thumbnail. */
  comingUpRowInnerClass: {
    alignItems: 'flex-start',
  },
  /** Slightly tighter bottom margin when stacked in “This week” sheet */
  comingUpRowSheet: {
    marginBottom: 10,
  },
  twSheetRoot: {
    flex: 1,
  },
  twSheetSheetSlot: {
    justifyContent: 'flex-end',
  },
  twSheetCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    maxHeight: Math.round(Dimensions.get('window').height * 0.68),
    paddingBottom: 28,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 24,
  },
  twSheetHandleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  twSheetHandle: { width: 40, height: 4, borderRadius: 2 },
  twSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  twSheetTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  twSheetDone: { fontSize: 16, fontWeight: '600' },
  twSheetScroll: { flexGrow: 0 },
  twSheetScrollContent: { paddingBottom: 8 },
  /** Up Next overflow menu — compact action sheet (not the tall “This week” sheet). */
  unMenuCard: {
    maxHeight: undefined,
    paddingBottom: 20,
    paddingHorizontal: 18,
  },
  unMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 2,
  },
  unMenuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  unMenuSep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 36,
  },
  unMenuDismiss: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unMenuDismissText: {
    fontSize: 16,
    fontWeight: '600',
  },
  /** Min width fits a full range on one line; sheet row scrolls if needed. */
  cuLeft: { minWidth: 168, flexShrink: 0, alignItems: 'flex-start' as const },
  cuDate: { fontSize: 12, fontWeight: '600', color: '#222' },
  cuTime: { fontSize: 11, color: '#717171', marginTop: 2, flexShrink: 0 },
  cuDuration: { fontSize: 10, color: '#999', marginTop: 2 },
  cuCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 8 },
  /** This Week sheet — class: compact landscape thumb + title (no avatar stack). */
  cuCenterClass: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
    gap: 6,
  },
  cuClassCoverWrap: {
    alignSelf: 'flex-start',
    width: 64,
    height: 40,
    borderRadius: 6,
    overflow: 'hidden',
  },
  cuClassCoverImage: {
    width: '100%',
    height: '100%',
  },
  cuClassCoverPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cuNameClass: {
    fontSize: 14,
    fontWeight: '600',
    width: '100%',
    letterSpacing: -0.2,
  },
  cuAvatar: { width: 30, height: 30, borderRadius: 15 },
  cuAvatarStackRow: { flexDirection: 'row', alignItems: 'center' },
  cuAvatarStackRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  cuAvatarStackImg: { width: '100%', height: '100%' },
  cuAvatarStackIni: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  cuAvatarStackMoreRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cuAvatarStackMoreText: { fontSize: 11, fontWeight: '700', letterSpacing: -0.2 },
  cuName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222' },
  cuBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  cuBadgeTrial: { backgroundColor: '#FFF8E1' },
  cuBadgeText: { fontSize: 11, fontWeight: '600', color: '#2E7D32' },
  cuBadgeTextTrial: { color: '#F5A623' },

  // Recent Students (paddingTop so space isn’t lost to margin collapse with section above)
  recentStudentsSectionWrap: { paddingTop: 18 },
  recentScroll: { gap: 14 },
  recentItem: { alignItems: 'center', width: 60 },
  recentAvatar: { width: 48, height: 48, borderRadius: 24, marginBottom: 6 },
  recentName: { fontSize: 11, color: '#717171', textAlign: 'center' },

  // Shared placeholder
  placeholderCircle: { backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
  placeholderLetter: { fontSize: 13, fontWeight: '600', color: '#999' },
  placeholderLetterLg: { fontSize: 18, fontWeight: '600', color: '#999' },
});
