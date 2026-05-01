import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  Dimensions,
  Alert,
  ActionSheetIOS,
  Platform,
  Image,
  StatusBar,
  AppState,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Line as SvgLine } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { useHomeTabBarOverlay } from '../contexts/HomeTabBarOverlayContext';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';
import { calendarService, GoogleCalendarStatus, GoogleCalendarEvent } from '../services/calendar';
import { socketService } from '../services/socket';
import type { MyClassRecord } from '../services/classes';
import type { Lesson } from '../services/lessons';
import { buildProcessedLessonCard, classRecordToLesson, type ProcessedLessonCard } from '../utils/lessonCardModel';
import LessonDetailOverlay, { type CardRect } from '../components/LessonDetailOverlay';
import { ClassGoingMessageModal, type ClassGoingMessageRequest } from '../components/ClassGoingMessageModal';
import {
  AvailabilityBlock,
  CalendarLesson,
  CalendarClass,
  TimelineEntry,
  DayCell,
} from '../types/calendar';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DAY_CELL_SIZE = 40;
const ACCENT_BLUE = '#08a0e8';
const MONTH_CELL_SIZE = Math.floor((SCREEN_W - 16) / 7);
const MONTH_CIRCLE_SIZE = Math.min(MONTH_CELL_SIZE - 8, 52);
// Stacked avatar sizing for class cells
const STACK_AVATAR_SIZE = Math.round(MONTH_CIRCLE_SIZE * 0.56);
const STACK_AVATAR_STEP = Math.round(STACK_AVATAR_SIZE * 0.68); // horizontal step between avatar centers
const STACK_TOTAL_W = STACK_AVATAR_SIZE + STACK_AVATAR_STEP;
const STACK_LEFT_ORIGIN = Math.round((MONTH_CIRCLE_SIZE - STACK_TOTAL_W) / 2);
const STACK_TOP = Math.round((MONTH_CIRCLE_SIZE - STACK_AVATAR_SIZE) / 2);
const TODAY_BG = '#4298d3';
const TIMELINE_HOUR_HEIGHT = 120;
// Sheet row avatar sizes
const SHEET_AVATAR = 44;
const SHEET_STACK = 28;
const SHEET_STACK_STEP = 20; // horizontal offset between stacked items
const TIMELINE_LABEL_W = 72;
const TIMELINE_LINE_GAP = 6;
const TIMELINE_LEFT_PAD = 16;
const TIMELINE_START_HOUR = 0;
const TIMELINE_END_HOUR = 24;

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatHourLabel(hour24: number, timeFormat: '12h' | '24h'): string {
  if (timeFormat === '24h') {
    const h = hour24 % 24;
    return `${String(h).padStart(2, '0')}:00`;
  }
  const h = hour24 % 24;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:00 ${ampm}`;
}

function calendarClassToMyRecord(c: CalendarClass): MyClassRecord {
  return {
    _id: c._id,
    name: c.name || c.title,
    description: c.description,
    startTime: c.startTime,
    endTime: c.endTime,
    status: c.status,
    duration: c.duration ?? 60,
    price: c.price,
    capacity: c.maxStudents,
    thumbnail: c.thumbnail,
    confirmedStudents:
      c.confirmedStudents && c.confirmedStudents.length > 0 ? c.confirmedStudents : c.attendees,
    tutorId: c.tutorId,
    invitationStats: c.invitationStats,
    minStudents: (c as any).minStudents,
    flexibleMinimum: (c as any).flexibleMinimum,
  };
}

function formatDisplayName(person: any): string {
  if (!person) return '';
  if (person.firstName) return `${person.firstName} ${(person.lastName || '').charAt(0)}.`.trim();
  if (person.name) {
    const parts = person.name.split(' ');
    return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];
  }
  return '';
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function getInitials(person: any): string {
  if (!person) return '?';
  const first = person.firstName || (person.name ? person.name.split(' ')[0] : '') || '';
  const last = person.lastName || (person.name ? (person.name.split(' ')[1] || '') : '') || '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?';
}

const GOOGLE_LOGO = require('../../assets/shared/google.png');

// Skeleton components
function CalendarSkeleton({ viewMode, colors }: { viewMode: 'week' | 'month'; colors: any }) {
  // Month: wave through 42 grid circles. Week: wave through 7 day circles + 8 timeline rows.
  const MONTH_CELLS = 42;
  const WEEK_CIRCLES = 7;
  const WEEK_ROWS = 8;
  const cellCount = viewMode === 'month' ? MONTH_CELLS : WEEK_CIRCLES + WEEK_ROWS;
  const WAVE_W = 2.5; // glow width in cells

  const wavePos = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(wavePos, {
        toValue: cellCount,
        duration: cellCount * 70,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [wavePos, cellCount]);

  const cellOpacities = useMemo(
    () =>
      Array.from({ length: cellCount }, (_, i) =>
        wavePos.interpolate({
          inputRange: [Math.max(0, i - WAVE_W), i, Math.min(cellCount, i + WAVE_W)],
          outputRange: [0.45, 1.0, 0.45],
          extrapolate: 'clamp',
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellCount],
  );

  const baseBg = colors.isDark ? '#2a2a2e' : '#e8e8ec';

  // Static block (header / nav — not animated)
  const staticBlock = (w: number | string, h: number, br = 4, style?: any) => (
    <View style={[{ width: w as any, height: h, borderRadius: br, backgroundColor: baseBg }, style]} />
  );

  // Animated block driven by the wave
  const waveBlock = (index: number, w: number | string, h: number, br = 4, style?: any) => (
    <Animated.View
      style={[{ width: w as any, height: h, borderRadius: br, backgroundColor: baseBg, opacity: cellOpacities[index] }, style]}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {viewMode === 'month' ? (
        <>
          {/* Header — static */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 }}>
            {staticBlock(80, 20)}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {staticBlock(70, 32, 16)}
              {staticBlock(50, 32, 16)}
            </View>
          </View>
          {/* Month nav — static */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
            {staticBlock(20, 20, 10)}
            {staticBlock(120, 18)}
            {staticBlock(20, 20, 10)}
          </View>
          {/* Day headers — static */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                {staticBlock(20, 12, 2)}
              </View>
            ))}
          </View>
          {/* Grid circles — waving */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 }}>
            {Array.from({ length: MONTH_CELLS }).map((_, i) => (
              <View key={i} style={{ width: MONTH_CELL_SIZE, height: MONTH_CELL_SIZE, alignItems: 'center', justifyContent: 'center' }}>
                {waveBlock(i, MONTH_CIRCLE_SIZE - 8, MONTH_CIRCLE_SIZE - 8, (MONTH_CIRCLE_SIZE - 8) / 2)}
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          {/* Header — static */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 }}>
            {staticBlock(80, 20)}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {staticBlock(70, 32, 16)}
              {staticBlock(50, 32, 16)}
            </View>
          </View>
          {/* Week day circles — waving (indices 0–6) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 16 }}>
            {staticBlock(20, 20, 10)}
            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
              {Array.from({ length: WEEK_CIRCLES }).map((_, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 4 }}>
                  {staticBlock(20, 12, 2)}
                  {waveBlock(i, 28, 28, 14)}
                </View>
              ))}
            </View>
            {staticBlock(20, 20, 10)}
          </View>
          {/* Date bar — static */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 }}>
            {staticBlock(120, 24)}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {staticBlock(60, 24, 12)}
              {staticBlock(80, 24, 12)}
            </View>
          </View>
          {/* Timeline rows — waving (indices 7–14) */}
          <View style={{ flex: 1, paddingHorizontal: 16 }}>
            {Array.from({ length: WEEK_ROWS }).map((_, i) => (
              <View key={i} style={{ height: 60, flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 }}>
                {staticBlock(40, 12, 2)}
                {waveBlock(WEEK_CIRCLES + i, '82%', 32, 8)}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const FAB_OPTIONS = [
  { key: 'availability', icon: 'calendar-outline' as const, labelKey: 'TUTOR_CALENDAR.SET_AVAILABILITY' },
  { key: 'blockTime', icon: 'time-outline' as const, labelKey: 'TUTOR_CALENDAR.BLOCK_TIME' },
  { key: 'officeHours', icon: 'flash-outline' as const, labelKey: 'TUTOR_CALENDAR.ENABLE_OFFICE_HOURS' },
  { key: 'googleCal', icon: 'logo-google' as const, labelKey: 'TUTOR_CALENDAR.GOOGLE_CALENDAR' },
];

export default function CalendarScreen() {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { setLessonOverlayCoversTabBar } = useHomeTabBarOverlay();
  const userId = user?._id || user?.id || '';
  const isTutor = user?.userType === 'tutor';
  const timeFormat = user?.profile?.calendarTimeFormat || '12h';
  const userTz = user?.profile?.timezone as string | undefined;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'week' | 'month'>('month');
  const [displayedViewMode, setDisplayedViewMode] = useState<'week' | 'month'>('month');
  const viewFade = useRef(new Animated.Value(1)).current;
  const [skeletonViewMode, setSkeletonViewMode] = useState<'week' | 'month'>('month'); // For skeleton while loading
  const [viewPickerVisible, setViewPickerVisible] = useState(false);
  const vpTranslateY = useRef(new Animated.Value(SCREEN_H)).current;
  const vpBackdropOpacity = useRef(new Animated.Value(0)).current;
  const [monthViewDate, setMonthViewDate] = useState(() => new Date());
  const [daySheetDate, setDaySheetDate] = useState<Date | null>(null);
  const [daySheetVisible, setDaySheetVisible] = useState(false);
  const daySheetTranslateY = useRef(new Animated.Value(SCREEN_H)).current;
  const daySheetBackdropOpacity = useRef(new Animated.Value(0)).current;

  // Pullable sheet state
  const [sheetHeight, setSheetHeight] = useState<'compact' | 'expanded'>('compact');
  const panY = useRef(new Animated.Value(0)).current;
  const lastPanY = useRef(0);

  const sheetPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        panY.stopAnimation(val => { lastPanY.current = val; });
      },
      onPanResponderMove: (_, g) => {
        const PULL_LIMIT = SCREEN_H * 0.45;
        const raw = lastPanY.current + g.dy;
        panY.setValue(Math.max(-PULL_LIMIT, Math.min(0, raw)));
      },
      onPanResponderRelease: (_, g) => {
        const cur = lastPanY.current + g.dy;
        const EXPAND_THRESHOLD = -100;
        if (cur < EXPAND_THRESHOLD || g.vy < -0.6) {
          const target = -SCREEN_H * 0.42;
          lastPanY.current = target;
          setSheetHeight('expanded');
          Animated.spring(panY, { toValue: target, useNativeDriver: true, damping: 22, stiffness: 220 }).start();
        } else if (cur > -30 && g.vy > 0.5) {
          // swipe down → close
          panY.setValue(0);
          lastPanY.current = 0;
          setSheetHeight('compact');
          // Trigger full close
          Animated.timing(panY, { toValue: 0, duration: 1, useNativeDriver: true }).start();
          setTimeout(closeDaySheet, 10);
        } else {
          lastPanY.current = 0;
          setSheetHeight('compact');
          Animated.spring(panY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }).start();
        }
      },
    })
  ).current;

  const prefetchedUrls = useRef(new Set<string>()).current;
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [lessons, setLessons] = useState<CalendarLesson[]>([]);
  const [classes, setClasses] = useState<CalendarClass[]>([]);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  const [lessonOverlayCard, setLessonOverlayCard] = useState<ProcessedLessonCard | null>(null);
  const [classGoingMessage, setClassGoingMessage] = useState<ClassGoingMessageRequest | null>(null);
  const lessonOverlayBusy = useRef(false);

  const calendarLessonFallbackRect = useMemo((): CardRect => {
    const metricsTop = initialWindowMetrics?.insets?.top;
    const topInset =
      typeof metricsTop === 'number' && metricsTop > 0
        ? metricsTop
        : Platform.OS === 'android'
          ? StatusBar.currentHeight ?? 24
          : 56;
    return {
      x: TIMELINE_LEFT_PAD,
      y: Math.min(topInset + 140, SCREEN_H * 0.28),
      width: SCREEN_W - TIMELINE_LEFT_PAD * 2,
      height: 148,
    };
  }, []);

  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarStatus>({ connected: false });
  const [gcalEvents, setGcalEvents] = useState<GoogleCalendarEvent[]>([]);
  const [gcalConnecting, setGcalConnecting] = useState(false);
  const gcalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastGcalEventsFetchRef = useRef<number>(0);
  const GCAL_REFRESH_MIN_GAP_MS = 3 * 1000;
  const GCAL_POLL_MS = 2 * 60 * 1000;
  const timelineScrollRef = useRef<ScrollView>(null);
  const dayCells: DayCell[] = useMemo(() => {
    const today = new Date();
    const cells: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dayLessons = lessons.filter(l => {
        const lDate = new Date(l.startTime);
        return isSameDay(lDate, d) && l.status !== 'cancelled';
      });
      cells.push({
        date: d,
        dayLabel: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase(),
        dateLabel: String(d.getDate()),
        isToday: isSameDay(d, today),
        isSelected: isSameDay(d, selectedDate),
        hasLessons: dayLessons.length > 0,
        lessonCount: dayLessons.length,
      });
    }
    return cells;
  }, [weekStart, selectedDate, lessons]);

  const timeline: TimelineEntry[] = useMemo(() => {
    const now = new Date();
    const entries: TimelineEntry[] = [];

    const dayAvail = availability.filter(b => {
      if (b.type === 'class') return false;
      if (b.absoluteStart) return isSameDay(new Date(b.absoluteStart), selectedDate);
      return b.day === selectedDate.getDay();
    });
    dayAvail.forEach(b => {
      let start: Date, end: Date;
      if (b.absoluteStart && b.absoluteEnd) {
        start = new Date(b.absoluteStart);
        end = new Date(b.absoluteEnd);
      } else {
        start = new Date(selectedDate);
        const [sh, sm] = b.startTime.split(':').map(Number);
        start.setHours(sh, sm, 0, 0);
        end = new Date(selectedDate);
        const [eh, em] = b.endTime.split(':').map(Number);
        end.setHours(eh, em, 0, 0);
      }
      entries.push({ id: `avail-${b.id}`, type: 'availability', startTime: start, endTime: end, title: b.title || t('TUTOR_CALENDAR.AVAILABLE'), isPast: end < now, duration: Math.round((end.getTime() - start.getTime()) / 60000) });
    });

    lessons.filter(l => isSameDay(new Date(l.startTime), selectedDate)).forEach(l => {
      const start = new Date(l.startTime);
      const end = new Date(l.endTime || start.getTime() + (l.duration || 30) * 60000);
      const student = l.studentId;
      entries.push({ id: `lesson-${l._id}`, type: 'lesson', startTime: start, endTime: end, title: formatDisplayName(student) || t('TUTOR_CALENDAR.STUDENT'), subtitle: l.subject || l.language || '', avatar: student?.picture, status: l.status, isTrialLesson: l.isTrialLesson, isPast: end < now, isNow: start <= now && end > now, lessonId: l._id, duration: l.duration || Math.round((end.getTime() - start.getTime()) / 60000), isCancelled: l.status === 'cancelled', isReschedule: l.rescheduleProposal?.status === 'pending', lesson: l });
    });

    classes.filter(c => isSameDay(new Date(c.startTime), selectedDate)).forEach(c => {
      const start = new Date(c.startTime);
      const end = new Date(c.endTime || start.getTime() + (c.duration || 60) * 60000);
      entries.push({ id: `class-${c._id}`, type: 'class', startTime: start, endTime: end, title: c.name || c.title || 'Group Class', subtitle: c.language || '', status: c.status, isPast: end < now, isNow: start <= now && end > now, classId: c._id, duration: c.duration || Math.round((end.getTime() - start.getTime()) / 60000), attendeeCount: c.attendees?.length || 0, maxStudents: c.maxStudents, calendarClass: c });
    });

    gcalEvents.forEach(ge => {
      const startStr = ge.start;
      const endStr = ge.end;
      if (!startStr || !endStr) return;
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (!isSameDay(start, selectedDate)) return;
      entries.push({
        id: `gcal-${ge.id}`,
        type: 'googleEvent',
        startTime: start,
        endTime: end,
        title: ge.summary || 'Google Calendar',
        isPast: end < now,
        isNow: start <= now && end > now,
        isGoogleCalendar: true,
        duration: Math.round((end.getTime() - start.getTime()) / 60000),
      });
    });

    entries.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return entries;
  }, [selectedDate, availability, lessons, classes, gcalEvents, t]);

  const availEntries = timeline.filter(e => e.type === 'availability');
  const dayLessonCount = timeline.filter(e => e.type !== 'availability' && !e.isCancelled).length;
  const dayAvailHours = availEntries.reduce((sum, e) => sum + (e.duration || 0), 0) / 60;

  const weekAvailSummary = useMemo(() => {
    const fmt = (t24: string) => {
      const [h, m] = t24.split(':').map(Number);
      if (timeFormat === '24h') return t24;
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? 'AM' : 'PM';
      return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    };
    const summary: { fullDate: string; hours: number; totalMinutes: number; slots: { label: string; durationLabel: string }[] }[] = [];
    let totalWeekMinutes = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dayBlocks = availability.filter(b => {
        if (b.type === 'class') return false;
        if (b.absoluteStart) return isSameDay(new Date(b.absoluteStart), d);
        return b.day === d.getDay();
      });
      const totalMin = dayBlocks.reduce((sum, b) => {
        const [sh, sm] = b.startTime.split(':').map(Number);
        const [eh, em] = b.endTime.split(':').map(Number);
        return sum + (eh * 60 + em) - (sh * 60 + sm);
      }, 0);
      totalWeekMinutes += totalMin;
      const slots = dayBlocks.map(b => {
        const [sh, sm] = b.startTime.split(':').map(Number);
        const [eh, em] = b.endTime.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        const durLabel = mins >= 60 ? (mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`) : `${mins}m`;
        return { label: `${fmt(b.startTime)} – ${fmt(b.endTime)}`, durationLabel: durLabel };
      });
      summary.push({ fullDate: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), hours: totalMin / 60, totalMinutes: totalMin, slots });
    }
    return { days: summary, totalWeekHours: totalWeekMinutes / 60 };
  }, [weekStart, availability, timeFormat]);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    // Range covers the week view window AND the full month currently shown in month view
    const weekRangeStart = new Date(weekStart);
    weekRangeStart.setDate(weekRangeStart.getDate() - 14);
    const weekRangeEnd = new Date(weekStart);
    weekRangeEnd.setDate(weekRangeEnd.getDate() + 35);

    const monthStart = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), 1);
    const monthEnd = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 0);

    const rangeStart = weekRangeStart < monthStart ? weekRangeStart : monthStart;
    const rangeEnd = weekRangeEnd > monthEnd ? weekRangeEnd : monthEnd;

    const [avail, lsns, cls, fb] = await Promise.all([
      calendarService.getAvailability(),
      calendarService.getTutorLessons(userId, rangeStart, rangeEnd),
      calendarService.getTutorClasses(userId, rangeStart, rangeEnd),
      isTutor ? calendarService.getPendingFeedback() : Promise.resolve({ items: [], count: 0 }),
    ]);

    // Prefetch all avatars so they appear instantly when the calendar renders
    const avatarUrls = [
      ...lsns.map((l: any) => l.studentId?.picture).filter(Boolean),
      ...cls.flatMap((c: any) => (c.confirmedStudents || c.attendees || []).map((s: any) => s?.picture).filter(Boolean)),
    ] as string[];
    const newUrls = [...new Set(avatarUrls)].filter(url => !prefetchedUrls.has(url));
    if (newUrls.length > 0) {
      await Promise.all(newUrls.map(url => ExpoImage.prefetch(url, { cachePolicy: 'memory-disk' }).then(() => prefetchedUrls.add(url)).catch(() => {})));
    }

    setAvailability(avail); setLessons(lsns); setClasses(cls); setFeedbackCount(fb.count);
  }, [userId, weekStart, monthViewDate, isTutor, prefetchedUrls]);

  const loadGcalStatus = useCallback(async () => {
    if (!isTutor) return;
    const status = await calendarService.getGoogleCalendarStatus();
    setGcalStatus(status);
    return status;
  }, [isTutor]);

  const loadGcalEvents = useCallback(async () => {
    if (!gcalStatus.connected) return;
    const rangeStart = new Date(weekStart);
    rangeStart.setDate(rangeStart.getDate() - 1);
    const rangeEnd = new Date(weekStart);
    rangeEnd.setDate(rangeEnd.getDate() + 8);
    const events = await calendarService.getGoogleCalendarEvents(rangeStart, rangeEnd);
    setGcalEvents(events.filter(e => !e.allDay));
    lastGcalEventsFetchRef.current = Date.now();
  }, [gcalStatus.connected, weekStart]);

  const startGcalPolling = useCallback(() => {
    if (gcalPollRef.current) clearInterval(gcalPollRef.current);
    gcalPollRef.current = setInterval(() => { loadGcalEvents(); }, GCAL_POLL_MS);
  }, [loadGcalEvents]);

  const stopGcalPolling = useCallback(() => {
    if (gcalPollRef.current) { clearInterval(gcalPollRef.current); gcalPollRef.current = null; }
  }, []);

  const connectGoogleCalendar = useCallback(async () => {
    setGcalConnecting(true);
    try {
      const url = await calendarService.getGoogleCalendarAuthUrl();
      if (!url) { Alert.alert('Error', 'Could not get Google Calendar auth URL.'); setGcalConnecting(false); return; }
      await WebBrowser.openBrowserAsync(url);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const status = await calendarService.getGoogleCalendarStatus();
        if (status.connected || attempts > 20) {
          clearInterval(poll);
          setGcalStatus(status);
          setGcalConnecting(false);
          if (status.connected) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(t('TUTOR_CALENDAR.GOOGLE_CALENDAR'), t('TUTOR_CALENDAR.GCAL_CONNECTED_MSG') || 'Google Calendar connected successfully.');
            loadGcalEvents();
            calendarService.registerGoogleCalendarWatch();
            startGcalPolling();
          }
        }
      }, 1500);
    } catch {
      setGcalConnecting(false);
    }
  }, [t, loadGcalEvents, startGcalPolling]);

  const disconnectGoogleCalendar = useCallback(async () => {
    try {
      await calendarService.disconnectGoogleCalendar();
      setGcalStatus({ connected: false });
      setGcalEvents([]);
      stopGcalPolling();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not disconnect.');
    }
  }, [stopGcalPolling]);

  const toggleGcalSetting = useCallback(async (key: 'syncEnabled' | 'pushToGoogle') => {
    const current = gcalStatus[key] || false;
    const updated = { ...gcalStatus, [key]: !current };
    setGcalStatus(updated);
    try {
      await calendarService.updateGoogleCalendarSettings({ [key]: !current });
    } catch {
      setGcalStatus(prev => ({ ...prev, [key]: current }));
    }
  }, [gcalStatus]);

  const showGcalActions = useCallback(() => {
    const syncLabel = gcalStatus.syncEnabled ? (t('TUTOR_CALENDAR.GCAL_DISABLE_SYNC') || 'Disable sync') : (t('TUTOR_CALENDAR.GCAL_ENABLE_SYNC') || 'Block busy times');
    const pushLabel = gcalStatus.pushToGoogle ? (t('TUTOR_CALENDAR.GCAL_DISABLE_PUSH') || 'Stop pushing lessons') : (t('TUTOR_CALENDAR.GCAL_ENABLE_PUSH') || 'Push lessons to Google');
    const disconnectLabel = t('TUTOR_CALENDAR.GCAL_DISCONNECT') || 'Disconnect Google Calendar';
    const cancelLabel = t('COMMON.CANCEL') || 'Cancel';

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [syncLabel, pushLabel, disconnectLabel, cancelLabel], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
        idx => {
          if (idx === 0) toggleGcalSetting('syncEnabled');
          else if (idx === 1) toggleGcalSetting('pushToGoogle');
          else if (idx === 2) {
            Alert.alert(disconnectLabel, t('TUTOR_CALENDAR.GCAL_DISCONNECT_CONFIRM') || 'Are you sure?', [
              { text: cancelLabel, style: 'cancel' },
              { text: disconnectLabel, style: 'destructive', onPress: disconnectGoogleCalendar },
            ]);
          }
        },
      );
    } else {
      Alert.alert(t('TUTOR_CALENDAR.GOOGLE_CALENDAR'), gcalStatus.email || '', [
        { text: syncLabel, onPress: () => toggleGcalSetting('syncEnabled') },
        { text: pushLabel, onPress: () => toggleGcalSetting('pushToGoogle') },
        { text: disconnectLabel, style: 'destructive', onPress: () => {
          Alert.alert(disconnectLabel, t('TUTOR_CALENDAR.GCAL_DISCONNECT_CONFIRM') || 'Are you sure?', [
            { text: cancelLabel, style: 'cancel' },
            { text: disconnectLabel, style: 'destructive', onPress: disconnectGoogleCalendar },
          ]);
        }},
        { text: cancelLabel, style: 'cancel' },
      ]);
    }
  }, [gcalStatus, t, toggleGcalSetting, disconnectGoogleCalendar]);

  useEffect(() => {
    (async () => {
      const [, status] = await Promise.all([fetchData(), loadGcalStatus()]);
      if (status?.connected) {
        loadGcalEvents();
        calendarService.registerGoogleCalendarWatch();
        startGcalPolling();
      }
      setLoading(false);
    })();
    return () => stopGcalPolling();
  }, [fetchData, loadGcalStatus]);

  const refreshGcalIfDue = useCallback(async () => {
    if (!isTutor) return;
    const now = Date.now();
    if (now - lastGcalEventsFetchRef.current < GCAL_REFRESH_MIN_GAP_MS) return;
    const status = await loadGcalStatus();
    if (status?.connected) loadGcalEvents();
  }, [isTutor, loadGcalStatus, loadGcalEvents]);

  useEffect(() => {
    if (!isFocused || loading) return;
    fetchData();
    refreshGcalIfDue();
  }, [isFocused]);

  useEffect(() => {
    if (!isTutor) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshGcalIfDue();
    });
    return () => { sub.remove(); };
  }, [isTutor, refreshGcalIfDue]);

  useEffect(() => {
    if (!isTutor) return;
    const offStatus = socketService.on('gcal-status-updated', async () => {
      const status = await loadGcalStatus();
      if (status?.connected) {
        loadGcalEvents();
        if (!gcalPollRef.current) startGcalPolling();
      } else {
        setGcalEvents([]);
        stopGcalPolling();
      }
    });
    const offEvents = socketService.on('gcal-events-updated', () => {
      loadGcalEvents();
    });
    return () => { offStatus(); offEvents(); };
  }, [isTutor, loadGcalStatus, loadGcalEvents, startGcalPolling, stopGcalPolling]);

  useEffect(() => {
    if (!isFocused) return;
    const parent = navigation.getParent?.();
    if (parent) {
      parent.setOptions({
        tabBarStyle: {
          display: 'flex',
          backgroundColor: colors.tabBar,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.tabBarBorder,
          height: 88,
          paddingTop: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
          elevation: 5,
        },
      });
    }
  }, [isFocused, colors]);

  useEffect(() => { if (gcalStatus.connected) loadGcalEvents(); }, [weekStart, gcalStatus.connected]);

  // Persist + restore view mode preference
  useEffect(() => {
    AsyncStorage.getItem('calendarViewMode').then(v => {
      if (v === 'week' || v === 'month') {
        setViewMode(v);
        setDisplayedViewMode(v);
        setSkeletonViewMode(v);
      }
    });
  }, []);
  useEffect(() => {
    AsyncStorage.setItem('calendarViewMode', viewMode);
  }, [viewMode]);

  // Re-fetch when navigating to a different month in month view
  useEffect(() => {
    if (userId) fetchData();
  }, [monthViewDate]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const shiftWeek = (dir: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + dir);
    setWeekStart(next);
    setSelectedDate(dir > 0 ? new Date(next) : (() => { const d = new Date(next); d.setDate(d.getDate() + 6); return d; })());
  };

  const goToToday = () => {
    setWeekStart(getMonday(new Date()));
    setSelectedDate(new Date());
    setMonthViewDate(new Date());
  };

  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);

  const switchView = useCallback((mode: 'week' | 'month') => {
    if (mode === viewModeRef.current) return;
    Animated.timing(viewFade, {
      toValue: 0,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setDisplayedViewMode(mode);
      setViewMode(mode);
      Animated.timing(viewFade, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        // After the new view is fully visible, scroll to now if week view and today is selected
        if (mode === 'week' && isSameDay(selectedDateRef.current, new Date())) {
          const nowOffset = Math.max(
            0,
            ((minutesSinceMidnight(new Date()) - TIMELINE_START_HOUR * 60) / 60) * TIMELINE_HOUR_HEIGHT - 100,
          );
          setTimeout(() => {
            timelineScrollRef.current?.scrollTo({ y: nowOffset, animated: true });
          }, 80);
        }
      });
    });
  }, [viewFade]);

  const showViewPicker = useCallback(() => {
    vpTranslateY.setValue(SCREEN_H);
    vpBackdropOpacity.setValue(0);
    setViewPickerVisible(true);
    Animated.parallel([
      Animated.timing(vpBackdropOpacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(vpTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [vpTranslateY, vpBackdropOpacity]);

  const hideViewPicker = useCallback((mode?: 'week' | 'month') => {
    Animated.parallel([
      Animated.timing(vpBackdropOpacity, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(vpTranslateY, { toValue: SCREEN_H, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      setViewPickerVisible(false);
      if (mode) {
        switchView(mode);
        AsyncStorage.setItem('calendarViewMode', mode).catch(() => {});
        setSkeletonViewMode(mode);
      }
    });
  }, [vpTranslateY, vpBackdropOpacity]);

  const shiftMonth = (dir: number) => {
    setMonthViewDate(prev => {
      const next = new Date(prev);
      next.setDate(1);
      next.setMonth(next.getMonth() + dir);
      return next;
    });
  };

  /* ─── Day-events sheet animation ──────────────────────────── */
  const openDaySheet = useCallback((day: Date) => {
    setDaySheetDate(day);
    setDaySheetVisible(true);
  }, []);

  const closeDaySheet = useCallback(() => {
    daySheetTranslateY.stopAnimation();
    daySheetBackdropOpacity.stopAnimation();
    Animated.parallel([
      Animated.timing(daySheetBackdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(daySheetTranslateY, {
        toValue: SCREEN_H,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDaySheetVisible(false);
      setDaySheetDate(null);
      setSheetHeight('compact');
      panY.setValue(0);
      lastPanY.current = 0;
    });
  }, [daySheetTranslateY, daySheetBackdropOpacity, panY]);

  useLayoutEffect(() => {
    if (!daySheetVisible) return;
    daySheetTranslateY.stopAnimation();
    daySheetBackdropOpacity.stopAnimation();
    daySheetTranslateY.setValue(SCREEN_H);
    daySheetBackdropOpacity.setValue(0);
    panY.setValue(0);
    lastPanY.current = 0;
    setSheetHeight('compact');
    Animated.parallel([
      Animated.timing(daySheetBackdropOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(daySheetTranslateY, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [daySheetVisible, daySheetTranslateY, daySheetBackdropOpacity, panY]);

  // Days for month grid — Sunday-first, padded to full 6-row grid
  const monthDays = useMemo(() => {
    const year = monthViewDate.getFullYear();
    const month = monthViewDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay()); // Sunday = 0
    const days: Date[] = [];
    const cur = new Date(gridStart);
    while (cur <= lastOfMonth || days.length % 7 !== 0) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return { days, month, year };
  }, [monthViewDate]);

  // Events for the tapped day, shown in the bottom sheet
  const daySheetEntries = useMemo(() => {
    if (!daySheetDate) return [];
    type DaySheetEntry = {
      id: string;
      type: 'lesson' | 'class' | 'gcal';
      title: string;
      startTime: Date;
      endTime: Date;
      durationMin: number;
      color: string;
      avatar?: string;
      thumbnail?: string; // For classes
      classStudents: { picture?: string; name?: string }[];
      rawLesson?: CalendarLesson;
      rawClass?: CalendarClass;
    };
    const entries: DaySheetEntry[] = [];
    lessons
      .filter(l => isSameDay(new Date(l.startTime), daySheetDate) && l.status !== 'cancelled')
      .forEach(l => {
        const start = new Date(l.startTime);
        const end = new Date(l.endTime || start.getTime() + (l.duration || 30) * 60000);
        const durationMin = l.duration || Math.round((end.getTime() - start.getTime()) / 60000);
        entries.push({
          id: l._id, type: 'lesson',
          title: formatDisplayName(l.studentId) || 'Lesson',
          startTime: start, endTime: end, durationMin,
          color: '#007AFF',
          avatar: l.studentId?.picture,
          classStudents: [],
          rawLesson: l,
        });
      });
    classes
      .filter(c => isSameDay(new Date(c.startTime), daySheetDate))
      .forEach(c => {
        const start = new Date(c.startTime);
        const end = new Date(c.endTime || start.getTime() + (c.duration || 60) * 60000);
        const durationMin = c.duration || Math.round((end.getTime() - start.getTime()) / 60000);
        const students = (c.confirmedStudents || c.attendees || []).map((s: any) => ({
          picture: s?.picture,
          name: formatDisplayName(s),
        }));
        entries.push({
          id: c._id, type: 'class',
          title: c.name || c.title || 'Group Class',
          startTime: start, endTime: end, durationMin,
          color: '#8b5cf6',
          thumbnail: c.thumbnail,
          classStudents: students,
          rawClass: c,
        });
      });
    gcalEvents
      .filter(ge => ge.start && isSameDay(new Date(ge.start), daySheetDate) && !ge.allDay)
      .forEach(ge => {
        const start = new Date(ge.start!);
        const end = new Date(ge.end!);
        const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
        entries.push({
          id: ge.id, type: 'gcal',
          title: ge.summary || 'Google Calendar',
          startTime: start, endTime: end, durationMin,
          color: '#4285F4',
          classStudents: [],
        });
      });
    entries.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return entries;
  }, [daySheetDate, lessons, classes, gcalEvents]);

  const toggleFab = () => {
    const toValue = fabOpen ? 0 : 1;
    setFabOpen(!fabOpen);
    Animated.spring(fabAnim, { toValue, useNativeDriver: true, friction: 8 }).start();
  };

  const profileChecklist = useMemo(() => {
    if (!user || user.userType !== 'tutor') return { incomplete: false, items: [], doneCount: 0 };
    const hasCustomPhoto = !!(user.picture && (
      user.picture.includes('storage.googleapis.com') ||
      (user.auth0Picture && user.picture !== user.auth0Picture)
    ));
    const od = user.onboardingData;
    const hasVideo = !!(od?.introductionVideo || od?.pendingVideo);
    const videoApproved = user.tutorOnboarding?.videoApproved === true;
    const creds = user.tutorCredentials;
    const govIdOk = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
    const certsOk = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
    const credsComplete = govIdOk && certsOk;
    const credsApproved = creds?.governmentId?.status === 'approved' && !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved'));
    const hasPayout = !!(user.stripeConnectOnboarded || user.payoutProvider === 'paypal' || user.payoutProvider === 'manual');

    const items = [
      { id: 'photo', label: t('PROFILE_SCREEN.PROFILE_PHOTO') || 'Profile photo', done: hasCustomPhoto },
      { id: 'video', label: hasVideo && !videoApproved ? (t('TUTOR_CALENDAR.VIDEO_PENDING_REVIEW') || 'Intro video (pending)') : (t('TUTOR_CALENDAR.UPLOAD_INTRO_VIDEO') || 'Introduction video'), done: hasVideo },
      { id: 'creds', label: credsComplete && !credsApproved ? (t('PROFILE_SCREEN.CREDENTIALS') + ' (pending)') : (t('PROFILE_SCREEN.CREDENTIALS') || 'Credentials'), done: credsComplete },
      { id: 'payout', label: t('PROFILE_SCREEN.PAYOUT_METHOD') || 'Payout method', done: hasPayout },
    ];
    const doneCount = items.filter(i => i.done).length;
    return { incomplete: doneCount < items.length, items, doneCount };
  }, [user, t]);

  const isProfileIncomplete = profileChecklist.incomplete;

  const handleFabOption = (key: string) => {
    setFabOpen(false);
    Animated.timing(fabAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    if (key === 'availability' || key === 'blockTime') {
      if (isProfileIncomplete) {
        Alert.alert(
          t('TUTOR_CALENDAR.COMPLETE_PROFILE_SETUP') || 'Complete Your Profile',
          t('TUTOR_CALENDAR.COMPLETE_PROFILE_BEFORE_AVAILABILITY') || 'Complete your profile setup before adding availability.',
          [
            { text: t('COMMON.CANCEL') || 'Cancel', style: 'cancel' },
            { text: t('TUTOR_CALENDAR.CONTINUE_SETUP') || 'Continue Setup', onPress: () => navigation.navigate('Profile') },
          ]
        );
        return;
      }
      if (key === 'availability') navigation.navigate('AvailabilitySetup', {});
      else navigation.navigate('AvailabilitySetup', { date: formatDateKey(selectedDate) });
    } else if (key === 'googleCal') {
      if (gcalStatus.connected) showGcalActions();
      else connectGoogleCalendar();
    }
  };

  const openTimelineLessonOverlay = useCallback(
    (entry: TimelineEntry) => {
      if (lessonOverlayBusy.current || lessonOverlayCard) return;
      if (!user) return;
      let lessonModel: Lesson | null = null;
      if (entry.type === 'lesson' && entry.lesson) {
        lessonModel = entry.lesson as unknown as Lesson;
      } else if (entry.type === 'class' && entry.calendarClass) {
        lessonModel = classRecordToLesson(calendarClassToMyRecord(entry.calendarClass), user, t);
      } else {
        return;
      }
      lessonOverlayBusy.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const pl = buildProcessedLessonCard(lessonModel, user, t, userTz);
      setLessonOverlayCard(pl);
      setLessonOverlayCoversTabBar(true);
    },
    [user, t, userTz, lessonOverlayCard, setLessonOverlayCoversTabBar],
  );

  const formatTime = (d: Date): string => {
    if (timeFormat === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const timelineBounds = { startHour: TIMELINE_START_HOUR, endHour: TIMELINE_END_HOUR };

  const positionedTimelineEntries = useMemo(() => {
    const startMin = TIMELINE_START_HOUR * 60;
    return timeline
      .filter(e => e.type !== 'availability')
      .map(entry => {
        const top = ((minutesSinceMidnight(entry.startTime) - startMin) / 60) * TIMELINE_HOUR_HEIGHT;
        const rawHeight = ((minutesSinceMidnight(entry.endTime) - minutesSinceMidnight(entry.startTime)) / 60) * TIMELINE_HOUR_HEIGHT;
        const height = Math.max(44, rawHeight);
        return { entry, top, height };
      });
  }, [timeline]);

  const positionedAvailEntries = useMemo(() => {
    const startMin = TIMELINE_START_HOUR * 60;
    const endMin = TIMELINE_END_HOUR * 60;
    return timeline
      .filter(e => e.type === 'availability')
      .map(entry => {
        const eStart = Math.max(minutesSinceMidnight(entry.startTime), startMin);
        const eEnd = Math.min(minutesSinceMidnight(entry.endTime), endMin);
        if (eEnd <= eStart) return null;
        const top = ((eStart - startMin) / 60) * TIMELINE_HOUR_HEIGHT;
        const height = ((eEnd - eStart) / 60) * TIMELINE_HOUR_HEIGHT;
        return { entry, top, height };
      })
      .filter(Boolean) as { entry: typeof timeline[0]; top: number; height: number }[];
  }, [timeline]);

  const C = colors;
  const { shellMotion, listGateMotion } = useScreenEntranceAnimations(loading, {
    deferShellUntilListReady: true,
  });

  // Calendar-specific fade-in (avoids tab flash but gives smooth entrance)
  const calendarFade = useRef(new Animated.Value(0)).current;
  const calendarAnimated = useRef(false);

  useEffect(() => {
    if (loading) {
      calendarFade.setValue(0);
      calendarAnimated.current = false;
      return;
    }
    if (calendarAnimated.current) return;
    calendarAnimated.current = true;
    
    const timer = setTimeout(() => {
      Animated.timing(calendarFade, {
        toValue: 1,
        duration: 280,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      }).start();
    }, 50); // Small delay to ensure background is solid
    return () => clearTimeout(timer);
  }, [loading, calendarFade]);

  // Scroll to current time on initial week view load (switchView handles subsequent transitions)
  useEffect(() => {
    if (loading || viewMode !== 'week') return;
    if (!isSameDay(selectedDate, new Date())) return;
    const nowOffset = Math.max(
      0,
      ((minutesSinceMidnight(new Date()) - TIMELINE_START_HOUR * 60) / 60) * TIMELINE_HOUR_HEIGHT - 100,
    );
    const timer = setTimeout(() => {
      timelineScrollRef.current?.scrollTo({ y: nowOffset, animated: true });
    }, 500);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading) return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      <CalendarSkeleton viewMode={skeletonViewMode} colors={colors} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      <Animated.View style={[shellMotion, { opacity: calendarFade }]}>
      {/* Header */}
      <View style={[st.header, { backgroundColor: C.surface }]}>
        <Text style={[st.headerTitle, { color: C.text }]}>{t('TABS.CALENDAR')}</Text>
        <View style={st.headerActions}>
          <TouchableOpacity onPress={showViewPicker} activeOpacity={0.7} style={[st.viewPickerBtn, { backgroundColor: C.inputBg }]}>
            <Ionicons name={viewMode === 'month' ? 'grid-outline' : 'calendar-outline'} size={13} color={C.accent} />
            <Text style={[st.viewPickerText, { color: C.accent }]}>{viewMode === 'week' ? 'Week' : 'Month'}</Text>
            <Ionicons name="chevron-down" size={11} color={C.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goToToday} activeOpacity={0.7} style={[st.todayBtn, { backgroundColor: C.inputBg }]}>
            <Text style={[st.todayBtnText, { color: C.accent }]}>{t('HOME.TODAY')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Week Strip — hidden in month view */}
      {displayedViewMode === 'week' && <View style={[st.weekStrip, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={() => shiftWeek(-7)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </TouchableOpacity>
        <View style={st.weekDays}>
          {dayCells.map((cell, i) => (
            <TouchableOpacity key={i} style={st.dayCellWrap} onPress={() => setSelectedDate(cell.date)} activeOpacity={0.7}>
              <Text
                style={[
                  st.dayLabel,
                  {
                    color:
                      cell.isSelected && cell.isToday
                        ? TODAY_BG
                        : cell.isSelected
                          ? C.accent
                          : cell.isToday
                            ? TODAY_BG
                            : C.textSecondary,
                  },
                ]}
              >
                {cell.dayLabel}
              </Text>
              <View
                style={[
                  st.dateCircle,
                  cell.isToday && { backgroundColor: TODAY_BG },
                  cell.isSelected && !cell.isToday && { backgroundColor: C.accent },
                ]}
              >
                <Text style={[st.dateLabel, { color: cell.isSelected || cell.isToday ? '#fff' : C.text }]}>{cell.dateLabel}</Text>
              </View>
              {cell.hasLessons && !cell.isSelected && <View style={[st.dayDot, { backgroundColor: C.accent }]} />}
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => shiftWeek(7)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-forward" size={20} color={C.textSecondary} />
        </TouchableOpacity>
      </View>}

      {/* Date Bar — hidden in month view */}
      {displayedViewMode === 'week' && <View style={[st.dateBar, { backgroundColor: C.surface }]}>
        <View style={st.dateBarLeft}>
          <Text style={[st.dateBarDay, { color: C.text }]}>
            {isSameDay(selectedDate, new Date()) ? t('HOME.TODAY') : selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}
          </Text>
          <Text style={[st.dateBarDate, { color: C.textSecondary }]}>
            {' '}{selectedDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <View style={st.dateBarPills}>
          {dayLessonCount > 0 && <View style={[st.pill, { backgroundColor: isDark ? '#1a3a1a' : '#E8F5E9' }]}><Text style={[st.pillText, { color: '#2E7D32' }]}>{dayLessonCount} {dayLessonCount === 1 ? t('HOME.LESSON_SINGULAR') : t('HOME.LESSON_PLURAL')}</Text></View>}
          {dayAvailHours > 0 && (
            <TouchableOpacity
              style={[
                st.pill,
                {
                  backgroundColor: isDark ? 'rgba(8, 160, 232, 0.14)' : 'rgba(8, 160, 232, 0.1)',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isDark ? 'rgba(8, 160, 232, 0.35)' : 'rgba(8, 160, 232, 0.25)',
                },
              ]}
              onPress={() => setAvailModalVisible(true)}
            >
              <Ionicons name="time-outline" size={12} color={ACCENT_BLUE} style={{ marginRight: 4 }} />
              <Text style={[st.pillText, { color: isDark ? '#5ac8fa' : '#0077b3' }]}>
                {dayAvailHours % 1 === 0 ? dayAvailHours.toFixed(0) : dayAvailHours.toFixed(1)}h {t('TUTOR_CALENDAR.AVAILABLE_SHORT')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>}
      </Animated.View>

      {/* Timeline or Month view */}
      <Animated.View style={[{ flex: 1 }, listGateMotion]}>
      <Animated.View style={{ flex: 1, opacity: viewFade }}>

      {displayedViewMode === 'month' ? (
        <View style={{ flex: 1 }}>
          {/* Month navigation */}
          <View style={[st.monthNav, { borderBottomColor: C.border }]}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
              <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
            </TouchableOpacity>
            <Text style={[st.monthNavTitle, { color: C.text }]}>
              {monthViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
              <Ionicons name="chevron-forward" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={st.monthDayHeaders}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <Text key={d} style={[st.monthDayHeader, { color: C.textTertiary }]}>{d}</Text>
            ))}
          </View>

          {/* Month grid */}
          <View style={st.monthGrid}>
            {monthDays.days.map((day, i) => {
              const today = new Date();
              const isThisMonth = day.getMonth() === monthDays.month;
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selectedDate);

              // Collect all events with their avatars
              const dayLessons = lessons.filter(l => isSameDay(new Date(l.startTime), day) && l.status !== 'cancelled');
              const dayClasses = classes.filter(c => isSameDay(new Date(c.startTime), day));
              const dayGcal = gcalEvents.filter(ge => ge.start && isSameDay(new Date(ge.start), day) && !ge.allDay);

              // Class students — all enrolled, for initials fallback if no photo
              const classStudents: { picture?: string; name?: string; personObj?: any }[] = dayClasses.flatMap(c =>
                (c.confirmedStudents || c.attendees || []).map((s: any) => ({
                  picture: s?.picture || null,
                  name: formatDisplayName(s),
                  personObj: s,
                }))
              );
              const hasClassStudents = classStudents.length > 0;

              const lessonStudent = dayLessons[0]?.studentId || null;
              const lessonAvatar = lessonStudent?.picture || null;

              const totalEvents = dayLessons.length + dayClasses.length + dayGcal.length;
              const hasEvents = totalEvents > 0;

              // Check if tutor has availability set for this day
              const hasAvailability = availability.some(b =>
                b.type !== 'unavailable' &&
                b.type !== 'class' &&
                (b.absoluteStart
                  ? isSameDay(new Date(b.absoluteStart), day)
                  : b.day === day.getDay())
              );

              // Display priority: classes → lesson → google event
              // Classes always show stacked avatars (initials if no photo)
              const showStackedAvatars = hasClassStudents || (dayClasses.length > 0 && dayGcal.length === 0 && dayLessons.length === 0);
              const primaryAvatar = !showStackedAvatars ? lessonAvatar : null;
              const primaryLessonStudent = !showStackedAvatars ? lessonStudent : null;
              const isGcalOnly = !showStackedAvatars && !lessonStudent && dayGcal.length > 0;
              const stackAvatars = classStudents.slice(0, 2);
              const stackRemaining = classStudents.length - 2;
              const extraCount = showStackedAvatars
                ? (classStudents.length - 2 > 0 ? classStudents.length - 2 : 0) + dayLessons.length + dayGcal.length
                : totalEvents - 1;

              // Cell is an empty placeholder for outside-month days (maintains grid spacing)
              if (!isThisMonth) {
                return (
                  <View key={i} style={st.monthCell}>
                    <View style={[st.monthCellCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
                      <Text style={[st.monthCellText, { color: C.textTertiary, opacity: 0.4 }]}>{day.getDate()}</Text>
                    </View>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={i}
                  style={st.monthCell}
                  activeOpacity={0.65}
                  onPress={() => {
                    setSelectedDate(day);
                    openDaySheet(day);
                  }}
                >
                  <View style={[
                    st.monthCellCircle,
                    // BASE — driven SOLELY by availability so all cells with the same
                    // availability look identical, regardless of events.
                    hasAvailability && {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.95)',
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
                    },
                    !hasAvailability && {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                    },
                    // Today: accent ring on top of the base
                    isToday && { borderWidth: 2, borderColor: TODAY_BG },
                  ]}>
                    {/* Clipped layer — keeps avatars inside the circle shape */}
                    <View style={st.monthCellAvatarClip}>
                      {showStackedAvatars ? (
                        // Stacked class-student avatars (photo or initials)
                        <>
                          {stackAvatars.length === 0 ? (
                            // No students enrolled yet — grey people icon
                            <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                              <Ionicons name="people" size={Math.round(MONTH_CIRCLE_SIZE * 0.44)} color={C.textTertiary} />
                            </View>
                          ) : stackAvatars.map((s, si) => {
                            const left = stackAvatars.length === 1
                              ? (MONTH_CIRCLE_SIZE - STACK_AVATAR_SIZE) / 2
                              : si === 0 ? STACK_LEFT_ORIGIN : STACK_LEFT_ORIGIN + STACK_AVATAR_STEP;
                            return s.picture ? (
                              <ExpoImage
                                key={si}
                                source={{ uri: s.picture }}
                                style={{ position: 'absolute', width: STACK_AVATAR_SIZE, height: STACK_AVATAR_SIZE, borderRadius: STACK_AVATAR_SIZE / 2, left, top: STACK_TOP, borderWidth: 1.5, borderColor: '#fff' }}
                                cachePolicy="memory-disk"
                                transition={0}
                              />
                            ) : (
                              <View
                                key={si}
                                style={{ position: 'absolute', width: STACK_AVATAR_SIZE, height: STACK_AVATAR_SIZE, borderRadius: STACK_AVATAR_SIZE / 2, left, top: STACK_TOP, borderWidth: 1.5, borderColor: '#fff', backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center' }}
                              >
                                <Text style={{ color: '#fff', fontSize: Math.round(STACK_AVATAR_SIZE * 0.35), fontWeight: '700' }}>
                                  {getInitials(s.personObj)}
                                </Text>
                              </View>
                            );
                          })}
                        </>
                      ) : hasEvents && primaryAvatar ? (
                        <ExpoImage source={{ uri: primaryAvatar }} style={st.monthCellAvatar} cachePolicy="memory-disk" transition={0} />
                      ) : hasEvents && primaryLessonStudent ? (
                        // Lesson student with no photo — show initials
                        <View style={[st.monthCellAvatar, { backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={{ color: '#fff', fontSize: Math.round(MONTH_CIRCLE_SIZE * 0.28), fontWeight: '700' }}>
                            {getInitials(primaryLessonStudent)}
                          </Text>
                        </View>
                      ) : isGcalOnly ? (
                        // Google Calendar event — small centred logo, not full-bleed
                        <>
                          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#fff' }} />
                          <Image
                            source={GOOGLE_LOGO}
                            style={{ width: MONTH_CIRCLE_SIZE * 0.52, height: MONTH_CIRCLE_SIZE * 0.52, resizeMode: 'contain' }}
                          />
                        </>
                      ) : (
                        // No events — just the date number
                        <Text style={[st.monthCellText, { color: isToday ? TODAY_BG : hasAvailability ? C.text : C.textTertiary }]}>
                          {day.getDate()}
                        </Text>
                      )}
                    </View>

                    {/* "+N" badge — outside clip layer so it's never cut off */}
                    {hasEvents && extraCount > 0 && (
                      <View style={st.monthExtraBadge}>
                        <Text style={st.monthExtraBadgeText}>+{extraCount}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : (
      <ScrollView
        style={st.scroll}
        contentContainerStyle={st.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.textSecondary} />}
        showsVerticalScrollIndicator={false}
        ref={timelineScrollRef}
      >
        {isProfileIncomplete && profileChecklist.items.length > 0 && (
          <View style={[st.pclCard, { backgroundColor: C.card, borderColor: C.border, marginHorizontal: 16 }]}>
            <View style={st.pclHeader}>
              <Ionicons name="alert-circle-outline" size={18} color="#e8893c" />
              <Text style={[st.pclTitle, { color: C.text }]}>{profileChecklist.doneCount} / {profileChecklist.items.length} {t('COMMON.COMPLETE') || 'complete'}</Text>
              <View style={st.pclBadge}>
                <Ionicons name="eye-off-outline" size={12} color="#e8893c" />
                <Text style={st.pclBadgeText}>{t('PROFILE_SCREEN.HIDDEN_UNTIL_COMPLETE') || 'Hidden from students'}</Text>
              </View>
            </View>
            {profileChecklist.items.map(item => (
              <TouchableOpacity
                key={item.id}
                style={[st.pclRow, item.done && st.pclRowDone]}
                onPress={() => { if (!item.done) navigation.navigate('Profile'); }}
                activeOpacity={item.done ? 1 : 0.7}
              >
                <Ionicons
                  name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={item.done ? '#34c759' : (isDark ? '#555' : '#ccc')}
                />
                <Text style={[st.pclLabel, { color: C.text }, item.done && st.pclLabelDone]}>{item.label}</Text>
                {!item.done && <Ionicons name="chevron-forward-outline" size={14} color={isDark ? '#555' : '#bbb'} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {feedbackCount > 0 && (
          <View style={[st.feedbackBanner, { backgroundColor: isDark ? '#2a2000' : '#FFF8E1', marginHorizontal: 16 }]}>
            <Ionicons name="chatbox-ellipses-outline" size={18} color="#F5A623" />
            <Text style={[st.feedbackText, { color: isDark ? '#fbbf24' : '#92400e' }]}>{t('HOME.FEEDBACK_COUNT', { count: feedbackCount, plural: feedbackCount > 1 ? 's' : '' })}</Text>
          </View>
        )}

        {/* Day timeline — always show grid; empty state only when no bookable events */}
        {(() => {
          const hasEvents = timeline.some(e => e.type !== 'availability');
          const hourCount = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
          const gridHeight = hourCount * TIMELINE_HOUR_HEIGHT;
          const now = new Date();
          const nowInView = isSameDay(selectedDate, now);
          const nowTop = nowInView
            ? ((minutesSinceMidnight(now) - TIMELINE_START_HOUR * 60) / 60) * TIMELINE_HOUR_HEIGHT
            : -1;

          return (
            <View style={st.timelineOuter}>
              {/* Grid: normal-flow rows — labels are in document flow, never clipped */}
              <View style={{ position: 'relative' }}>
                {Array.from({ length: hourCount + 1 }, (_, idx) => {
                  const hour = TIMELINE_START_HOUR + idx;
                  return (
                    <View key={hour} style={[st.timelineRow, idx === hourCount && st.timelineRowTerminator]}>
                      <Text style={[st.timelineHourLabel, { color: C.textTertiary }]}>
                        {formatHourLabel(hour, timeFormat as '12h' | '24h')}
                      </Text>
                      <View style={[st.timelineLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)' }]} />
                      {/* 30-min dashed subdivision line (skip on terminator row) */}
                      {idx < hourCount && (
                        <View pointerEvents="none" style={st.halfHourLine}>
                          <Svg width="100%" height={1}>
                            <SvgLine
                              x1="0"
                              y1="0.5"
                              x2="100%"
                              y2="0.5"
                              stroke={isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
                              strokeWidth={1}
                              strokeDasharray="3,4"
                            />
                          </Svg>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Vertical separator — very subtle, just enough to anchor the label column */}
                <View
                  style={[
                    st.timelineVerticalRule,
                    {
                      height: gridHeight,
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                      left: TIMELINE_LABEL_W,
                    },
                  ]}
                  pointerEvents="none"
                />

                {/* Events layer — absolutely overlaid, left-offset past label column */}
                <View style={[st.timelineEventsLayer, { height: gridHeight }]}>
                  {/* Availability shading — silent green overlay, behind events */}
                  {positionedAvailEntries.map(({ entry, top, height }) => (
                    <View
                      key={`avail-${entry.id}`}
                      pointerEvents="none"
                      style={[
                        st.timelineAvailBlock,
                        {
                          top,
                          height,
                          backgroundColor: isDark
                            ? 'rgba(52,199,89,0.10)'
                            : 'rgba(4,65,44,0.06)',
                        },
                      ]}
                    />
                  ))}
                  {positionedTimelineEntries.map(({ entry, top, height }, idx) => {
                    const isClass = entry.type === 'class';
                    const isGoogle = entry.isGoogleCalendar;
                    const isCancelled = entry.isCancelled;
                    const isPast = entry.isPast;

                    const accentColor = isClass
                      ? '#8b5cf6'
                      : isGoogle
                        ? '#4285F4'
                        : '#007AFF';

                    const cardBg = isDark
                      ? (isCancelled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)')
                      : (isCancelled ? '#f3f4f6' : '#ffffff');
                    const titleColor = isDark
                      ? (isCancelled ? '#636366' : '#ffffff')
                      : (isCancelled ? '#9ca3af' : '#1d1d1f');
                    const subColor = isDark
                      ? 'rgba(255,255,255,0.5)'
                      : '#8e8e93';
                    const barColor = isCancelled
                      ? (isDark ? '#636366' : '#d1d5db')
                      : accentColor;

                    // Initials fallback for lesson avatar
                    const initials = (entry.title || '?')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map(w => w[0].toUpperCase())
                      .join('');

                    const thumbnail = entry.calendarClass?.thumbnail;

                    return (
                      <TouchableOpacity
                        key={entry.id}
                        style={[
                          st.timelineEventCard,
                          {
                            top,
                            height,
                            backgroundColor: cardBg,
                            opacity: isPast && !isCancelled ? 0.55 : 1,
                            zIndex: idx + 1,
                            shadowColor: isDark ? 'transparent' : '#000',
                          },
                        ]}
                        activeOpacity={0.75}
                        onPress={() => openTimelineLessonOverlay(entry)}
                      >
                        {/* Left accent bar */}
                        <View style={[st.timelineEventBar, { backgroundColor: barColor }]} />

                        {/* Class: full-bleed thumbnail */}
                        {isClass && (
                          thumbnail
                            ? <ExpoImage source={{ uri: thumbnail }} style={st.timelineEventThumb} contentFit="cover" cachePolicy="memory-disk" transition={0} />
                            : (
                              <View style={[st.timelineEventThumbPlaceholder, { backgroundColor: isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.1)' }]}>
                                <Ionicons name="people" size={18} color="#8b5cf6" />
                              </View>
                            )
                        )}

                        {/* Lesson: circular avatar */}
                        {!isClass && !isGoogle && (
                          <View style={st.timelineEventAvatarWrap}>
                            {entry.avatar
                              ? <ExpoImage source={{ uri: entry.avatar }} style={st.timelineEventAvatar} cachePolicy="memory-disk" transition={0} />
                              : (
                                <View style={[st.timelineEventAvatarFallback, { backgroundColor: accentColor }]}>
                                  <Text style={st.timelineEventAvatarInitials}>{initials}</Text>
                                </View>
                              )
                            }
                          </View>
                        )}

                        {/* Text content */}
                        <View style={st.timelineEventContent}>
                          <Text
                            style={[
                              st.timelineEventTitle,
                              { color: titleColor, textDecorationLine: isCancelled ? 'line-through' : 'none' },
                            ]}
                            numberOfLines={2}
                          >
                            {entry.title}
                          </Text>
                          {!!entry.subtitle && (
                            <Text style={[st.timelineEventSub, { color: subColor }]} numberOfLines={1}>
                              {entry.subtitle}
                            </Text>
                          )}
                          <Text style={[st.timelineEventTime, { color: subColor }]}>
                            {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* "Now" red line */}
                {nowTop >= 0 && nowTop <= gridHeight && (
                  <View
                    style={[
                      st.nowIndicator,
                      { top: nowTop, left: TIMELINE_LABEL_W + TIMELINE_LINE_GAP },
                    ]}
                  >
                    <View style={st.nowDot} />
                    <View style={st.nowLine} />
                  </View>
                )}

                {!hasEvents && (
                  <View style={[st.timelineNoEvents, { top: Math.min(80, gridHeight / 3) }]}>
                    <Text style={[st.timelineNoEventsText, { color: C.textTertiary }]}>
                      {isTutor
                        ? t('TUTOR_CALENDAR.WAITING_FOR_STUDENTS')
                        : t('TUTOR_CALENDAR.NO_EVENTS_TITLE')}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          );
        })()}
      </ScrollView>
      )}
      </Animated.View>
      </Animated.View>

      {/* FAB with Blur Overlay */}
      {isTutor && fabOpen && (
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={toggleFab}>
          <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)' }]} />
        </TouchableOpacity>
      )}

      {isTutor && (
        <View style={st.fabContainer} pointerEvents="box-none">
          {fabOpen && (
            <View style={st.fabMenuList}>
              {FAB_OPTIONS.map((opt, i) => (
                <Animated.View key={opt.key} style={{ opacity: fabAnim, transform: [{ translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
                  <TouchableOpacity style={[st.fabMenuItem, { backgroundColor: isDark ? 'rgba(40,40,40,0.95)' : 'rgba(255,255,255,0.97)' }]} onPress={() => handleFabOption(opt.key)} activeOpacity={0.8}>
                    <View style={[st.fabMenuIcon, { backgroundColor: isDark ? '#333' : '#f5f5f5' }]}>
                      <Ionicons name={opt.icon} size={20} color={isDark ? '#ddd' : '#333'} />
                    </View>
                    <Text style={[st.fabMenuLabel, { color: isDark ? '#eee' : '#222' }]}>{t(opt.labelKey)}</Text>
                    {opt.key === 'googleCal' && gcalStatus.connected && (
                      <Ionicons name="checkmark-circle" size={18} color="#4CAF50" style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </View>
          )}
          <TouchableOpacity style={[st.fab, { backgroundColor: ACCENT_BLUE }]} onPress={toggleFab} activeOpacity={0.85}>
            <Animated.View style={{ transform: [{ rotate: fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }}>
              <Ionicons name="add" size={28} color="#fff" />
            </Animated.View>
          </TouchableOpacity>
        </View>
      )}

      {/* Day Events Sheet - Pullable */}
      <Modal visible={daySheetVisible} transparent animationType="none" statusBarTranslucent onRequestClose={closeDaySheet}>
        <View style={st.dsRoot}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: daySheetBackdropOpacity }]}>
            <Pressable style={[StyleSheet.absoluteFill, st.dsBackdrop]} onPress={closeDaySheet} />
          </Animated.View>
          {/* Combined slide-in + pan offset via Animated.add */}
          <Animated.View style={[st.dsSheetSlot, {
            transform: [{ translateY: Animated.add(daySheetTranslateY, panY) }],
          }]}>
            {/* Draggable handle zone */}
            <View {...sheetPanResponder.panHandlers}>
              <View style={st.dsDateHeader}>
                <View style={[st.dsHandle, { backgroundColor: 'rgba(255,255,255,0.3)', marginVertical: 0, marginBottom: 12 }]} />
                <Text style={st.dsDateText}>
                  {daySheetDate?.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              </View>
            </View>

            {/* Scrollable content — height driven by sheetHeight state */}
            <View style={[
              st.dsCardBody,
              {
                backgroundColor: isDark ? '#1c1c1e' : '#ffffff',
                height: sheetHeight === 'expanded' ? SCREEN_H * 0.55 : SCREEN_H * 0.34,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                marginTop: -20,
              }
            ]}>
              {daySheetEntries.length === 0 ? (
                <View style={st.dsEmptyState}>
                  <Ionicons name="calendar-outline" size={32} color={C.textTertiary} style={{ marginBottom: 10 }} />
                  <Text style={[st.dsEmptyTitle, { color: C.text }]}>Nothing scheduled</Text>
                  <Text style={[st.dsEmpty, { color: C.textTertiary }]}>No lessons or classes on this day.</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
                  {daySheetEntries.map((entry, i) => (
                    <View key={entry.id}>
                      {i > 0 && <View style={[st.dsDivider, { backgroundColor: C.border }]} />}
                      <TouchableOpacity
                        style={st.dsEventRow}
                        activeOpacity={entry.type === 'gcal' ? 1 : 0.7}
                        onPress={() => {
                          if (entry.type === 'gcal') return;
                          if (entry.type === 'lesson' && entry.rawLesson) {
                            const te = {
                              id: entry.id, type: 'lesson' as const,
                              startTime: entry.startTime, endTime: entry.endTime,
                              title: entry.title, lesson: entry.rawLesson,
                            };
                            closeDaySheet();
                            setTimeout(() => openTimelineLessonOverlay(te as any), 280);
                          } else if (entry.type === 'class' && entry.rawClass) {
                            const te = {
                              id: entry.id, type: 'class' as const,
                              startTime: entry.startTime, endTime: entry.endTime,
                              title: entry.title, calendarClass: entry.rawClass,
                            };
                            closeDaySheet();
                            setTimeout(() => openTimelineLessonOverlay(te as any), 280);
                          }
                        }}
                      >
                        {/* Left: avatar or thumbnail */}
                        {entry.type === 'lesson' ? (
                          <View style={st.dsAvatarWrap}>
                            {entry.avatar
                              ? <ExpoImage source={{ uri: entry.avatar }} style={st.dsAvatarImg} cachePolicy="memory-disk" transition={0} />
                              : <View style={[st.dsAvatarImg, { backgroundColor: entry.color, alignItems: 'center', justifyContent: 'center' }]}>
                                  <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
                                    {entry.rawLesson?.studentId ? getInitials(entry.rawLesson.studentId) : '?'}
                                  </Text>
                                </View>
                            }
                          </View>
                        ) : entry.type === 'class' ? (
                          <View style={st.dsClassThumbWrap}>
                            {entry.thumbnail
                              ? <ExpoImage source={{ uri: entry.thumbnail }} style={st.dsClassThumb} cachePolicy="memory-disk" transition={0} contentFit="cover" />
                              : <View style={[st.dsClassThumb, { backgroundColor: entry.color, alignItems: 'center', justifyContent: 'center' }]}>
                                  <Ionicons name="people" size={20} color="#fff" />
                                </View>
                            }
                          </View>
                        ) : (
                          <View style={st.dsAvatarWrap}>
                            <Image source={GOOGLE_LOGO} style={[st.dsAvatarImg, { resizeMode: 'contain', backgroundColor: '#fff' }]} />
                          </View>
                        )}

                        {/* Right: title + time + going */}
                        <View style={st.dsEventBody}>
                          <Text style={[st.dsEventTitle, { color: isDark ? '#fff' : '#111' }]} numberOfLines={1}>
                            {entry.title}
                          </Text>
                          <View style={st.dsEventMeta}>
                            <Text style={[st.dsEventTime, { color: C.textSecondary }]}>
                              {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                            </Text>
                            <Text style={[st.dsEventDurText, { color: C.textTertiary }]}>·</Text>
                            <Text style={[st.dsEventDurText, { color: C.textTertiary }]}>{formatDuration(entry.durationMin)}</Text>
                          </View>
                          {entry.type === 'class' && (
                            entry.classStudents.length > 0 ? (
                              <View style={st.dsGoingSection}>
                                <Text style={[st.dsGoingLabel, { color: C.textSecondary }]}>Going</Text>
                                <View style={st.dsGoingAvatars}>
                                  {entry.classStudents.slice(0, 3).map((s, si) => (
                                    s.picture ? (
                                      <ExpoImage key={si} source={{ uri: s.picture }}
                                        style={[st.dsGoingAvatar, { marginLeft: si > 0 ? -8 : 0, zIndex: 10 - si }]}
                                        cachePolicy="memory-disk"
                                        transition={0}
                                      />
                                    ) : (
                                      <View key={si} style={[
                                        st.dsGoingAvatar,
                                        { marginLeft: si > 0 ? -8 : 0, zIndex: 10 - si, backgroundColor: entry.color, alignItems: 'center', justifyContent: 'center' }
                                      ]}>
                                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                                          {(s.name || '?').charAt(0)}
                                        </Text>
                                      </View>
                                    )
                                  ))}
                                  {entry.classStudents.length > 3 && (
                                    <View style={[st.dsGoingAvatar, { marginLeft: -8, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' }]}>
                                      <Text style={[st.dsGoingPlusText, { color: C.textSecondary }]}>
                                        +{entry.classStudents.length - 3}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              </View>
                            ) : (
                              <View style={st.dsGoingSection}>
                                <Ionicons name="people-outline" size={13} color={C.textTertiary} />
                                <Text style={[st.dsGoingLabel, { color: C.textTertiary, fontStyle: 'italic' }]}>
                                  No one signed up yet
                                </Text>
                              </View>
                            )
                          )}
                        </View>
                        {entry.type !== 'gcal' && <Ionicons name="chevron-forward" size={14} color={C.textTertiary} />}
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* View Picker — cross-platform custom sheet */}
      <Modal visible={viewPickerVisible} transparent animationType="none" onRequestClose={() => hideViewPicker()}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: vpBackdropOpacity, backgroundColor: 'rgba(0,0,0,0.45)' }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => hideViewPicker()} />
          </Animated.View>
          <Animated.View style={{ transform: [{ translateY: vpTranslateY }] }}>
            <View style={[st.vpSheet, { backgroundColor: C.card }]}>
              <View style={[st.vpHandle, { backgroundColor: C.border }]} />
              <Text style={[st.vpTitle, { color: C.textSecondary }]}>Calendar View</Text>
              {(['month', 'week'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[st.vpOption, viewMode === mode && { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                  onPress={() => hideViewPicker(mode)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={mode === 'week' ? 'calendar-outline' : 'grid-outline'}
                    size={20}
                    color={viewMode === mode ? C.accent : C.text}
                  />
                  <Text style={[st.vpOptionText, { color: viewMode === mode ? C.accent : C.text }]}>
                    {mode === 'week' ? 'Week View' : 'Month View'}
                  </Text>
                  {viewMode === mode && <Ionicons name="checkmark" size={18} color={C.accent} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Availability Detail Modal */}
      <Modal visible={availModalVisible} animationType="slide" presentationStyle="fullScreen">
        <View style={[st.modalSafe, { backgroundColor: C.surface, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <ScrollView contentContainerStyle={st.modalScrollContent} showsVerticalScrollIndicator={false}>
            {/* Hero with close button inline */}
            <View style={st.modalHeroWrap}>
              <View style={st.modalHero}>
                <View style={st.modalIconCircle}>
                  <Ionicons name="calendar" size={24} color="#fff" />
                </View>
                <Text style={[st.modalTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.YOUR_AVAILABILITY')}</Text>
                <Text style={[st.modalSubtitle, { color: C.textTertiary }]}>
                  {weekAvailSummary.totalWeekHours % 1 === 0 ? weekAvailSummary.totalWeekHours.toFixed(0) : weekAvailSummary.totalWeekHours.toFixed(1)}h {t('TUTOR_CALENDAR.AVAILABLE_SHORT')} {t('TUTOR_CALENDAR.THIS_WEEK') || 'this week'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setAvailModalVisible(false)} style={st.modalCloseBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Day rows */}
            {weekAvailSummary.days.map((day, i) => {
              const hoursLabel = day.hours % 1 === 0 ? `${day.hours.toFixed(0)}h` : `${day.hours.toFixed(1)}h`;
              return (
                <View key={i} style={st.modalDaySection}>
                  <View style={st.modalDayHeader}>
                    <Text style={[st.modalDayName, { color: C.text }]}>{day.fullDate}</Text>
                    <Text style={[st.modalDayHours, { color: day.hours > 0 ? ACCENT_BLUE : C.textTertiary }]}>{hoursLabel}</Text>
                  </View>
                  {day.slots.length === 0 ? (
                    <Text style={[st.modalDayOff, { color: C.textTertiary }]}>{t('TUTOR_CALENDAR.DAY_OFF') || 'Day off'}</Text>
                  ) : day.slots.map((slot, j) => (
                    <View
                      key={j}
                      style={[
                        st.modalSlotCard,
                        { backgroundColor: C.card, borderColor: C.border },
                      ]}
                    >
                      <View style={st.modalSlotAccent} />
                      <Text style={[st.modalSlotTime, { color: C.text }]}>{slot.label}</Text>
                      <Text style={[st.modalSlotDur, { color: C.textTertiary }]}>{slot.durationLabel}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>

          {/* Footer */}
          <View style={[st.modalFooter, { backgroundColor: C.card, borderTopColor: C.border }]}>
            <TouchableOpacity style={[st.modalCancelBtn, { borderColor: C.border }]} onPress={() => setAvailModalVisible(false)} activeOpacity={0.7}>
              <Text style={[st.modalCancelText, { color: C.text }]}>{t('COMMON.CANCEL')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.modalEditBtn} onPress={() => { setAvailModalVisible(false); navigation.navigate('AvailabilitySetup', {}); }} activeOpacity={0.85}>
              <Text style={st.modalEditText}>{t('TUTOR_CALENDAR.EDIT_AVAILABILITY')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {lessonOverlayCard ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 120, elevation: 120 }]} pointerEvents="box-none">
          <LessonDetailOverlay
            card={lessonOverlayCard}
            cardRect={calendarLessonFallbackRect}
            onCloseStart={() => {}}
            onCloseEnd={() => {
              lessonOverlayBusy.current = false;
              setLessonOverlayCard(null);
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
          setClassGoingMessage(null);
          if (result.kind === 'group') {
            navigation.navigate('Messages', { groupId: result.groupId } as never);
          } else {
            navigation.navigate('Messages', { userId: result.userId } as never);
          }
        }}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  headerTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  viewPickerText: { fontSize: 12, fontWeight: '600' },
  todayBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  todayBtnText: { fontSize: 13, fontWeight: '600' },

  weekStrip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  weekDays: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 2 },
  dayCellWrap: { alignItems: 'center', width: (SCREEN_W - 72) / 7 },
  dayLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  dateCircle: { width: DAY_CELL_SIZE, height: DAY_CELL_SIZE, borderRadius: DAY_CELL_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { fontSize: 16, fontWeight: '700' },
  dayDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 3 },

  dateBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  dateBarLeft: { flexDirection: 'row', alignItems: 'baseline' },
  dateBarDay: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  dateBarDate: { fontSize: 16, fontWeight: '400' },
  dateBarPills: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  pillText: { fontSize: 12, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 16 },

  pclCard: { borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1 },
  pclHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pclTitle: { fontSize: 14, fontWeight: '600' },
  pclBadge: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(232,137,60,0.1)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  pclBadgeText: { fontSize: 11, fontWeight: '500', color: '#e8893c' },
  pclRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
  pclRowDone: { opacity: 0.55 },
  pclLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  pclLabelDone: { textDecorationLine: 'line-through', textDecorationColor: 'rgba(0,0,0,0.2)' },

  feedbackBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, marginBottom: 10 },
  feedbackText: { fontSize: 13, fontWeight: '500', flex: 1 },

  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
  },
  /** Soft circle behind time icon — reads as “time window”, not a booking check. */
  availIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  availRowTextCol: { flex: 1, minWidth: 0 },
  availTimeText: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  availHint: { fontSize: 11, fontWeight: '500', marginTop: 2 },

  waitingText: { fontSize: 14, textAlign: 'center', marginTop: 24, marginBottom: 8 },
  timelineOuter: {
    paddingLeft: TIMELINE_LEFT_PAD,
    paddingRight: 12,
    paddingTop: 12,
    paddingBottom: 0,
  },
  timelineRow: {
    height: TIMELINE_HOUR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  /** Terminal row — just enough height to keep the midnight label visible */
  timelineRowTerminator: {
    height: 20,
  },
  timelineHourLabel: {
    width: TIMELINE_LABEL_W,
    fontSize: 10,
    fontWeight: '400',
    textAlign: 'right',
    paddingRight: 10,
    marginTop: -6,
    letterSpacing: 0.1,
  },
  timelineLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  halfHourLine: {
    position: 'absolute',
    top: TIMELINE_HOUR_HEIGHT / 2,
    left: TIMELINE_LABEL_W + TIMELINE_LINE_GAP,
    right: 0,
    height: 1,
  },
  timelineVerticalRule: {
    position: 'absolute',
    top: 0,
    width: 1,
  },
  timelineEventsLayer: {
    position: 'absolute',
    top: 0,
    left: TIMELINE_LABEL_W + TIMELINE_LINE_GAP,
    right: 0,
  },
  timelineEventCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 10,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
    marginRight: 4,
  },
  timelineEventBar: {
    width: 3,
    alignSelf: 'stretch',
  },
  /** Class thumbnail — full card height, fixed width, no border radius (card clips it) */
  timelineEventThumb: {
    width: 52,
    alignSelf: 'stretch',
  },
  timelineEventThumbPlaceholder: {
    width: 52,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Lesson avatar */
  timelineEventAvatarWrap: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
  timelineEventAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  timelineEventAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineEventAvatarInitials: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  timelineEventContent: {
    flex: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
    justifyContent: 'flex-start',
  },
  timelineEventTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    marginBottom: 1,
  },
  timelineEventSub: {
    fontSize: 11,
    fontWeight: '400',
    marginBottom: 1,
  },
  timelineEventTime: {
    fontSize: 10,
    fontWeight: '400',
    marginTop: 'auto' as any,
  },
  timelineAvailBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 0,
    borderRadius: 6,
  },
  nowIndicator: {
    position: 'absolute',
    right: 0,
    height: 2,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 100,
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E53935',
    marginLeft: -4,
  },
  nowLine: { flex: 1, height: 2, backgroundColor: '#E53935' },
  timelineNoEvents: {
    position: 'absolute',
    left: TIMELINE_LABEL_W + TIMELINE_LINE_GAP,
    right: 0,
    alignItems: 'center',
  },
  timelineNoEventsText: {
    fontSize: 13,
    fontWeight: '500',
  },

  eventRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  eventTime: { width: 52, alignItems: 'center' },
  eventTimeText: { fontSize: 13, fontWeight: '700' },
  eventDuration: { fontSize: 10, marginTop: 2 },
  eventStrip: { width: 3, height: 36, borderRadius: 2, marginHorizontal: 10 },
  eventBody: { flex: 1 },
  eventTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  eventAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  eventTitle: { fontSize: 15, fontWeight: '600' },
  eventSub: { fontSize: 12, marginTop: 1 },
  eventBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  attendeeCount: { fontSize: 11, fontWeight: '500' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyCta: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyCtaText: { fontSize: 15, fontWeight: '600' },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  monthNavTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  monthDayHeaders: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 12, paddingBottom: 6 },
  monthDayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 20 },
  monthCell: { width: MONTH_CELL_SIZE, height: MONTH_CELL_SIZE, alignItems: 'center', justifyContent: 'center' },
  monthCellCircle: { width: MONTH_CIRCLE_SIZE, height: MONTH_CIRCLE_SIZE, borderRadius: MONTH_CIRCLE_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  monthCellAvatarClip: { ...StyleSheet.absoluteFillObject, borderRadius: MONTH_CIRCLE_SIZE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  monthCellAvatar: { width: MONTH_CIRCLE_SIZE, height: MONTH_CIRCLE_SIZE, borderRadius: MONTH_CIRCLE_SIZE / 2 },
  monthCellText: { fontSize: 15, fontWeight: '500' },
  monthExtraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: '#1c1c1e',
    borderRadius: 10, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: '#fff',
  },
  monthExtraBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  monthEventIndicator: {
    position: 'absolute',
    bottom: -1,
    left: MONTH_CIRCLE_SIZE / 2 - 2,
    width: 4, height: 4, borderRadius: 2,
  },

  dsRoot: { flex: 1, justifyContent: 'flex-end' },
  dsBackdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  dsSheetSlot: { width: '100%' },
  dsDateHeader: { flexDirection: 'column', alignItems: 'center', backgroundColor: '#1c1c2e', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  dsDateText: { fontSize: 16, fontWeight: '700', color: '#ffffff', alignSelf: 'flex-start' },
  dsCard: { backgroundColor: 'transparent' },
  dsCardBody: { overflow: 'hidden' },
  dsHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 10 },
  dsEmpty: { textAlign: 'center', fontSize: 14, padding: 4 },
  dsEmptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 36, paddingHorizontal: 24 },
  dsEmptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  dsDivider: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  dsEventRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18, gap: 14 },
  // Lesson single avatar
  dsAvatarWrap: { width: SHEET_AVATAR, alignItems: 'center' },
  dsAvatarImg: { width: SHEET_AVATAR, height: SHEET_AVATAR, borderRadius: SHEET_AVATAR / 2 },
  // Class thumbnail
  dsClassThumbWrap: { width: SHEET_AVATAR, alignItems: 'center' },
  dsClassThumb: { width: SHEET_AVATAR, height: SHEET_AVATAR, borderRadius: 12, backgroundColor: '#f0f0f0' },
  // Going avatars section
  dsGoingSection: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  dsGoingLabel: { fontSize: 12, fontWeight: '500' },
  dsGoingAvatars: { flexDirection: 'row', alignItems: 'center' },
  dsGoingAvatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#fff' },
  dsGoingPlusText: { fontSize: 10, fontWeight: '600' },
  // Content
  dsEventBody: { flex: 1 },
  dsEventTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  dsEventMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dsEventTime: { fontSize: 13, fontWeight: '400' },
  dsEventDurPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  dsEventDurText: { fontSize: 12, fontWeight: '500' },
  vpSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, paddingHorizontal: 16, paddingTop: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 12 },
  vpHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  vpTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8, paddingHorizontal: 4 },
  vpOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4 },
  vpOptionText: { fontSize: 16, fontWeight: '500' },

  fabContainer: { position: 'absolute', right: 20, bottom: 24, alignItems: 'flex-end', zIndex: 100 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 8 },
  fabMenuList: { marginBottom: 12, gap: 8 },
  fabMenuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 26, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  fabMenuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  fabMenuLabel: { fontSize: 15, fontWeight: '600', paddingRight: 4 },

  modalSafe: { flex: 1 },
  modalScrollContent: { paddingHorizontal: 20, paddingBottom: 20 },
  modalHeroWrap: { position: 'relative', paddingTop: 20, paddingBottom: 16 },
  modalHero: { alignItems: 'center' },
  modalCloseBtn: { position: 'absolute', top: 20, right: 0 },
  modalIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: ACCENT_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, fontWeight: '500' },
  modalDaySection: { marginBottom: 16 },
  modalDayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalDayName: { fontSize: 15, fontWeight: '700' },
  modalDayHours: { fontSize: 14, fontWeight: '600' },
  modalDayOff: { fontSize: 13, marginLeft: 2, marginTop: 2 },
  modalSlotCard: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 10, borderWidth: 1, overflow: 'hidden', marginBottom: 6 },
  modalSlotAccent: { width: 3, backgroundColor: ACCENT_BLUE },
  modalSlotTime: { flex: 1, fontSize: 14, fontWeight: '500', paddingVertical: 12, paddingLeft: 12 },
  modalSlotDur: { fontSize: 13, fontWeight: '500', paddingVertical: 12, paddingRight: 14 },
  modalFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  modalCancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600' },
  modalEditBtn: { flex: 1.4, height: 48, borderRadius: 12, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  modalEditText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
