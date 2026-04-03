import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Modal,
  Dimensions,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { calendarService, GoogleCalendarStatus, GoogleCalendarEvent } from '../services/calendar';
import {
  AvailabilityBlock,
  CalendarLesson,
  CalendarClass,
  TimelineEntry,
  DayCell,
} from '../types/calendar';

const { width: SCREEN_W } = Dimensions.get('window');
const DAY_CELL_SIZE = 40;
const ACCENT_BLUE = '#08a0e8';

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

function formatDisplayName(person: any): string {
  if (!person) return '';
  if (person.firstName) return `${person.firstName} ${(person.lastName || '').charAt(0)}.`.trim();
  if (person.name) {
    const parts = person.name.split(' ');
    return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];
  }
  return '';
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
  const userId = user?._id || user?.id || '';
  const isTutor = user?.userType === 'tutor';
  const timeFormat = user?.profile?.calendarTimeFormat || '12h';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [lessons, setLessons] = useState<CalendarLesson[]>([]);
  const [classes, setClasses] = useState<CalendarClass[]>([]);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarStatus>({ connected: false });
  const [gcalEvents, setGcalEvents] = useState<GoogleCalendarEvent[]>([]);
  const [gcalConnecting, setGcalConnecting] = useState(false);
  const gcalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      entries.push({ id: `class-${c._id}`, type: 'class', startTime: start, endTime: end, title: c.title, subtitle: c.language || '', status: c.status, isPast: end < now, isNow: start <= now && end > now, classId: c._id, duration: c.duration || Math.round((end.getTime() - start.getTime()) / 60000), attendeeCount: c.attendees?.length || 0, maxStudents: c.maxStudents, calendarClass: c });
    });

    gcalEvents.forEach(ge => {
      const startStr = ge.start.dateTime || ge.start.date;
      const endStr = ge.end.dateTime || ge.end.date;
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
  const eventEntries = timeline.filter(e => e.type !== 'availability');
  const dayLessonCount = eventEntries.filter(e => !e.isCancelled).length;
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
    const rangeStart = new Date(weekStart);
    rangeStart.setDate(rangeStart.getDate() - 14);
    const rangeEnd = new Date(weekStart);
    rangeEnd.setDate(rangeEnd.getDate() + 35);
    const [avail, lsns, cls, fb] = await Promise.all([
      calendarService.getAvailability(),
      calendarService.getTutorLessons(userId, rangeStart, rangeEnd),
      calendarService.getTutorClasses(userId, rangeStart, rangeEnd),
      isTutor ? calendarService.getPendingFeedback() : Promise.resolve({ items: [], count: 0 }),
    ]);
    setAvailability(avail); setLessons(lsns); setClasses(cls); setFeedbackCount(fb.count);
  }, [userId, weekStart, isTutor]);

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
  }, [gcalStatus.connected, weekStart]);

  const startGcalPolling = useCallback(() => {
    if (gcalPollRef.current) clearInterval(gcalPollRef.current);
    gcalPollRef.current = setInterval(() => { loadGcalEvents(); }, 120000);
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

  useEffect(() => { if (isFocused && !loading) fetchData(); }, [isFocused]);

  useEffect(() => { if (gcalStatus.connected) loadGcalEvents(); }, [weekStart, gcalStatus.connected]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const shiftWeek = (dir: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + dir);
    setWeekStart(next);
    setSelectedDate(dir > 0 ? new Date(next) : (() => { const d = new Date(next); d.setDate(d.getDate() + 6); return d; })());
  };

  const goToToday = () => { setWeekStart(getMonday(new Date())); setSelectedDate(new Date()); };

  const toggleFab = () => {
    const toValue = fabOpen ? 0 : 1;
    setFabOpen(!fabOpen);
    Animated.spring(fabAnim, { toValue, useNativeDriver: true, friction: 8 }).start();
  };

  const handleFabOption = (key: string) => {
    setFabOpen(false);
    Animated.timing(fabAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    if (key === 'availability') navigation.navigate('AvailabilitySetup', {});
    else if (key === 'blockTime') navigation.navigate('AvailabilitySetup', { date: formatDateKey(selectedDate) });
    else if (key === 'googleCal') {
      if (gcalStatus.connected) showGcalActions();
      else connectGoogleCalendar();
    }
  };

  const navigateToEventDetail = (entry: TimelineEntry) => {
    if (entry.type === 'lesson' && entry.lesson) navigation.navigate('EventDetail', { lesson: entry.lesson });
    else if (entry.type === 'class' && entry.calendarClass) navigation.navigate('EventDetail', { calendarClass: entry.calendarClass });
  };

  const formatTime = (d: Date): string => {
    if (timeFormat === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const C = colors;

  if (loading) return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      <View style={st.loadWrap}><ActivityIndicator size="large" color={C.textSecondary} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      {/* Header */}
      <View style={[st.header, { backgroundColor: C.surface }]}>
        <Text style={[st.headerTitle, { color: C.text }]}>{t('TABS.CALENDAR')}</Text>
        <TouchableOpacity onPress={goToToday} activeOpacity={0.7} style={[st.todayBtn, { backgroundColor: C.inputBg }]}>
          <Text style={[st.todayBtnText, { color: C.accent }]}>{t('HOME.TODAY')}</Text>
        </TouchableOpacity>
      </View>

      {/* Week Strip */}
      <View style={[st.weekStrip, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={() => shiftWeek(-7)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </TouchableOpacity>
        <View style={st.weekDays}>
          {dayCells.map((cell, i) => (
            <TouchableOpacity key={i} style={st.dayCellWrap} onPress={() => setSelectedDate(cell.date)} activeOpacity={0.7}>
              <Text style={[st.dayLabel, { color: cell.isSelected || cell.isToday ? ACCENT_BLUE : C.textSecondary }]}>{cell.dayLabel}</Text>
              <View style={[st.dateCircle, cell.isSelected && { backgroundColor: ACCENT_BLUE }, cell.isToday && !cell.isSelected && { borderWidth: 2, borderColor: ACCENT_BLUE }]}>
                <Text style={[st.dateLabel, { color: cell.isSelected ? '#fff' : cell.isToday ? ACCENT_BLUE : C.text }]}>{cell.dateLabel}</Text>
              </View>
              {cell.hasLessons && !cell.isSelected && <View style={[st.dayDot, { backgroundColor: C.accent }]} />}
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => shiftWeek(7)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-forward" size={20} color={C.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Date Bar */}
      <View style={[st.dateBar, { backgroundColor: C.surface }]}>
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
            <TouchableOpacity style={[st.pill, { backgroundColor: isDark ? '#1a2a3a' : '#f0f7f0' }]} onPress={() => setAvailModalVisible(true)}>
              <Ionicons name="time-outline" size={12} color={isDark ? '#7ab8e8' : '#888'} style={{ marginRight: 4 }} />
              <Text style={[st.pillText, { color: isDark ? '#7ab8e8' : '#666' }]}>{dayAvailHours % 1 === 0 ? dayAvailHours.toFixed(0) : dayAvailHours.toFixed(1)}h {t('TUTOR_CALENDAR.AVAILABLE_SHORT')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Timeline */}
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.textSecondary} />} showsVerticalScrollIndicator={false}>
        {feedbackCount > 0 && (
          <View style={[st.feedbackBanner, { backgroundColor: isDark ? '#2a2000' : '#FFF8E1' }]}>
            <Ionicons name="chatbox-ellipses-outline" size={18} color="#F5A623" />
            <Text style={[st.feedbackText, { color: isDark ? '#fbbf24' : '#92400e' }]}>{t('HOME.FEEDBACK_COUNT', { count: feedbackCount, plural: feedbackCount > 1 ? 's' : '' })}</Text>
          </View>
        )}

        {/* Availability Rows */}
        {availEntries.length > 0 && availEntries.map(e => (
          <TouchableOpacity key={e.id} style={[st.availRow, { backgroundColor: isDark ? '#1a2e1a' : '#f0faf0', borderColor: isDark ? '#2a4a2a' : '#e0f0e0' }]} onPress={() => setAvailModalVisible(true)} activeOpacity={0.7}>
            <View style={st.availCheck}><Ionicons name="checkmark-circle" size={22} color="#4CAF50" /></View>
            <Text style={[st.availTimeText, { color: C.text }]}>{formatTime(e.startTime)} – {formatTime(e.endTime)}</Text>
            <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
          </TouchableOpacity>
        ))}

        {/* Empty state: no availability AND no events */}
        {eventEntries.length === 0 && availEntries.length === 0 ? (
          <View style={st.emptyState}>
            <Ionicons name="calendar-outline" size={56} color={C.border} />
            <Text style={[st.emptyTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.NO_EVENTS_TITLE')}</Text>
            <Text style={[st.emptySub, { color: C.textSecondary }]}>{t('TUTOR_CALENDAR.NO_EVENTS_DESC')}</Text>
            {isTutor && <TouchableOpacity style={[st.emptyCta, { backgroundColor: C.accent }]} onPress={() => navigation.navigate('AvailabilitySetup', {})} activeOpacity={0.85}><Text style={[st.emptyCtaText, { color: C.background }]}>{t('TUTOR_CALENDAR.SET_AVAILABILITY')}</Text></TouchableOpacity>}
          </View>
        ) : eventEntries.length === 0 && availEntries.length > 0 ? (
          <Text style={[st.waitingText, { color: C.textTertiary }]}>{t('TUTOR_CALENDAR.WAITING_FOR_STUDENTS')}</Text>
        ) : eventEntries.map(entry => (
          <TouchableOpacity key={entry.id} style={[st.eventRow, { backgroundColor: C.card, borderColor: C.border }, entry.isNow && { borderLeftColor: C.accent, borderLeftWidth: 3 }, entry.isCancelled && { opacity: 0.5 }]} onPress={() => navigateToEventDetail(entry)} activeOpacity={0.7}>
            <View style={st.eventTime}>
              <Text style={[st.eventTimeText, { color: entry.isNow ? C.accent : C.text }]}>{formatTime(entry.startTime)}</Text>
              <Text style={[st.eventDuration, { color: C.textTertiary }]}>{entry.duration}m</Text>
            </View>
            <View style={[st.eventStrip, { backgroundColor: entry.isGoogleCalendar ? '#4285F4' : entry.type === 'class' ? '#4CAF50' : entry.isTrialLesson ? '#F5A623' : '#4298d3' }]} />
            <View style={st.eventBody}>
              <View style={st.eventTop}>
                {entry.isGoogleCalendar ? (
                  <View style={[st.eventAvatar, { backgroundColor: '#e8f0fe' }]}><Ionicons name="logo-google" size={14} color="#4285F4" /></View>
                ) : entry.avatar ? (
                  <Image source={{ uri: entry.avatar }} style={st.eventAvatar} />
                ) : (
                  <View style={[st.eventAvatar, { backgroundColor: C.inputBg }]}><Ionicons name={entry.type === 'class' ? 'people' : 'person'} size={14} color={C.textTertiary} /></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[st.eventTitle, { color: C.text }, entry.isCancelled && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{entry.title}</Text>
                  {!!entry.subtitle && <Text style={[st.eventSub, { color: C.textSecondary }]} numberOfLines={1}>{entry.subtitle}</Text>}
                </View>
              </View>
              <View style={st.eventBadges}>
                {entry.isTrialLesson && <View style={[st.badge, { backgroundColor: '#FFF8E1' }]}><Text style={[st.badgeText, { color: '#F5A623' }]}>{t('HOME.STATUS_TRIAL')}</Text></View>}
                {entry.type === 'class' && <View style={[st.badge, { backgroundColor: '#E8F5E9' }]}><Text style={[st.badgeText, { color: '#2E7D32' }]}>{t('HOME.CLASSES')}</Text></View>}
                {entry.isReschedule && <View style={[st.badge, { backgroundColor: '#FFF3E0' }]}><Text style={[st.badgeText, { color: '#E07912' }]}>{t('HOME.RESCHEDULE')}</Text></View>}
                {entry.isCancelled && <View style={[st.badge, { backgroundColor: '#FFEBEE' }]}><Text style={[st.badgeText, { color: '#C13515' }]}>{t('HOME.CANCELLED')}</Text></View>}
                {entry.type === 'class' && entry.attendeeCount !== undefined && <Text style={[st.attendeeCount, { color: C.textTertiary }]}>{entry.attendeeCount}/{entry.maxStudents}</Text>}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
          </TouchableOpacity>
        ))}
        <View style={{ height: 100 }} />
      </ScrollView>

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

      {/* Availability Detail Modal */}
      <Modal visible={availModalVisible} animationType="slide" presentationStyle="fullScreen">
        <View style={[st.modalSafe, { backgroundColor: C.surface, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <ScrollView contentContainerStyle={st.modalScrollContent} showsVerticalScrollIndicator={false}>
            {/* Hero with close button inline */}
            <View style={st.modalHeroWrap}>
              <View style={st.modalHero}>
                <View style={st.modalIconCircle}><Ionicons name="calendar" size={24} color="#fff" /></View>
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
                    <Text style={[st.modalDayHours, { color: day.hours > 0 ? '#4CAF50' : C.textTertiary }]}>{hoursLabel}</Text>
                  </View>
                  {day.slots.length === 0 ? (
                    <Text style={[st.modalDayOff, { color: C.textTertiary }]}>{t('TUTOR_CALENDAR.DAY_OFF') || 'Day off'}</Text>
                  ) : day.slots.map((slot, j) => (
                    <View key={j} style={[st.modalSlotCard, { backgroundColor: isDark ? '#1a2e1a' : '#f8fbf8', borderColor: isDark ? '#2a4a2a' : '#e8f0e8' }]}>
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
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  headerTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },

  feedbackBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, marginBottom: 10 },
  feedbackText: { fontSize: 13, fontWeight: '500', flex: 1 },

  availRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1 },
  availCheck: { marginRight: 12 },
  availTimeText: { flex: 1, fontSize: 13, fontWeight: '500' },

  waitingText: { fontSize: 14, textAlign: 'center', marginTop: 24, marginBottom: 8 },

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
  modalIconCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#4CAF50', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, fontWeight: '500' },
  modalDaySection: { marginBottom: 16 },
  modalDayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalDayName: { fontSize: 15, fontWeight: '700' },
  modalDayHours: { fontSize: 14, fontWeight: '600' },
  modalDayOff: { fontSize: 13, marginLeft: 2, marginTop: 2 },
  modalSlotCard: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 10, borderWidth: 1, overflow: 'hidden', marginBottom: 6 },
  modalSlotAccent: { width: 3, backgroundColor: '#4CAF50' },
  modalSlotTime: { flex: 1, fontSize: 14, fontWeight: '500', paddingVertical: 12, paddingLeft: 12 },
  modalSlotDur: { fontSize: 13, fontWeight: '500', paddingVertical: 12, paddingRight: 14 },
  modalFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  modalCancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600' },
  modalEditBtn: { flex: 1.4, height: 48, borderRadius: 12, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  modalEditText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
