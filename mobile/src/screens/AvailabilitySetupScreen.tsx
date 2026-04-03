import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  Animated,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { calendarService } from '../services/calendar';
import { AvailabilityBlock } from '../types/calendar';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_W } = Dimensions.get('window');
const SLOTS_PER_DAY = 48;
const TIME_LABEL_W = 60;
const VISIBLE_DAYS = 4;
const SLOT_HEIGHT = 28;
const SLOT_GAP = 2;
const DATE_CIRCLE = 32;
const SLOT_COLOR = '#08a0e8';

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

function slotToTime(index: number): string {
  const h = Math.floor(index / 2);
  const m = (index % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
}

function formatTimeLabel(index: number, use24h: boolean): string {
  const h = Math.floor(index / 2);
  const m = (index % 2) * 30;
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'AM' : 'PM';
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:30 ${ampm}`;
}

function getTodayStartIdx(weekDays: { date: Date }[]): number {
  const today = new Date();
  const todayIdx = weekDays.findIndex(d => isSameDay(d.date, today));
  if (todayIdx < 0) return 0;
  return Math.max(0, Math.min(todayIdx - 1, 7 - VISIBLE_DAYS));
}

function countSlotHours(slots: Set<string>): number {
  return slots.size * 0.5;
}

interface WeekDay {
  date: Date;
  dateKey: string;
  weekdayLabel: string;
  isToday: boolean;
  isPast: boolean;
}

export default function AvailabilitySetupScreen() {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const userId = user?._id || user?.id || '';
  const use24h = user?.profile?.calendarTimeFormat === '24h';

  const targetDate = route.params?.date ? new Date(route.params.date + 'T00:00:00') : null;
  const isSingleDay = !!targetDate;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weekStart, setWeekStart] = useState(() => targetDate ? getMonday(targetDate) : getMonday(new Date()));
  const [mobileStartIdx, setMobileStartIdx] = useState(-1);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [initialSlots, setInitialSlots] = useState<Set<string>>(new Set());
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const saveBarAnim = useRef(new Animated.Value(0)).current;
  const hasScrolledToNow = useRef(false);
  const justSaved = useRef(false);

  const allWeekDays: WeekDay[] = useMemo(() => {
    const today = new Date();
    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push({
        date: d,
        dateKey: formatDateKey(d),
        weekdayLabel: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase(),
        isToday: isSameDay(d, today),
        isPast: d < new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      });
    }
    return days;
  }, [weekStart]);

  useEffect(() => {
    if (mobileStartIdx === -1) setMobileStartIdx(getTodayStartIdx(allWeekDays));
  }, [allWeekDays, mobileStartIdx]);

  const displayedDays: WeekDay[] = useMemo(() => {
    if (isSingleDay && targetDate) return allWeekDays.filter(d => isSameDay(d.date, targetDate));
    const startIdx = mobileStartIdx === -1 ? getTodayStartIdx(allWeekDays) : mobileStartIdx;
    return allWeekDays.slice(startIdx, startIdx + VISIBLE_DAYS);
  }, [allWeekDays, mobileStartIdx, isSingleDay, targetDate]);

  const colWidth = useMemo(() => (SCREEN_W - 16 - TIME_LABEL_W) / displayedDays.length, [displayedDays.length]);

  const hasChanges = isDirty;

  const hoursDelta = useMemo(() => countSlotHours(selectedSlots) - countSlotHours(initialSlots), [selectedSlots, initialSlots]);
  const totalWeekHours = useMemo(() => countSlotHours(selectedSlots), [selectedSlots]);

  const weekRangeLabel = useMemo(() => {
    const mon = allWeekDays[0]?.date;
    const sun = allWeekDays[6]?.date;
    if (!mon || !sun) return '';
    return `${mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${sun.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }, [allWeekDays]);

  const nowSlotIdx = useMemo(() => {
    const now = new Date();
    return now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  }, []);

  // Animate save bar in/out
  useEffect(() => {
    Animated.spring(saveBarAnim, {
      toValue: hasChanges ? 1 : 0,
      useNativeDriver: true,
      friction: 10,
      tension: 60,
    }).start();
  }, [hasChanges, saveBarAnim]);

  // Auto-scroll to now indicator after load
  useEffect(() => {
    if (!loading && !hasScrolledToNow.current && displayedDays.some(d => d.isToday)) {
      hasScrolledToNow.current = true;
      const scrollTarget = Math.max(0, (nowSlotIdx - 4) * (SLOT_HEIGHT + SLOT_GAP));
      setTimeout(() => scrollRef.current?.scrollTo({ y: scrollTarget, animated: true }), 300);
    }
  }, [loading, displayedDays, nowSlotIdx]);

  // Hide tab bar on mount, restore on unmount
  useEffect(() => {
    const parent = navigation.getParent?.();
    if (parent) {
      parent.setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        parent.setOptions({ tabBarStyle: undefined });
      };
    }
  }, [navigation, colors]);

  // Prompt save on back if unsaved
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasChanges || justSaved.current) return;
      e.preventDefault();
      Alert.alert(
        t('TUTOR_CALENDAR.UNSAVED_TITLE') || 'Unsaved Changes',
        t('TUTOR_CALENDAR.UNSAVED_DESC') || 'You have unsaved availability changes. Would you like to save before leaving?',
        [
          { text: t('TUTOR_CALENDAR.DISCARD') || 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
          { text: t('TUTOR_CALENDAR.SAVE_AVAILABILITY'), onPress: async () => {
            setSaving(true);
            try {
              await calendarService.updateAvailability(convertSlotsToBlocks(), getEditedDates());
              navigation.dispatch(e.data.action);
            } catch (err: any) {
              Alert.alert(t('COMMON.ERROR') || 'Error', err.message || t('TUTOR_CALENDAR.SAVE_FAILED'));
            } finally { setSaving(false); }
          }},
          { text: t('COMMON.CANCEL'), style: 'cancel' },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, hasChanges, selectedSlots]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [blocks, lessons] = await Promise.all([
      calendarService.getAvailability(),
      calendarService.getTutorLessons(userId, allWeekDays[0]?.date, allWeekDays[6]?.date),
    ]);

    const slots = new Set<string>();
    blocks.forEach(b => {
      if (b.type === 'class') return;
      allWeekDays.forEach(wd => {
        const matches = b.absoluteStart ? isSameDay(new Date(b.absoluteStart), wd.date) : b.day === wd.date.getDay();
        if (!matches) return;
        const startIdx = timeToSlotIndex(b.startTime);
        const endIdx = timeToSlotIndex(b.endTime);
        for (let si = startIdx; si < endIdx; si++) slots.add(`${wd.dateKey}-${si}`);
      });
    });
    setSelectedSlots(new Set(slots));
    setInitialSlots(new Set(slots));
    setIsDirty(false);

    const booked = new Set<string>();
    lessons.forEach(l => {
      if (l.status === 'cancelled') return;
      const start = new Date(l.startTime);
      const end = new Date(l.endTime || start.getTime() + (l.duration || 30) * 60000);
      allWeekDays.forEach(wd => {
        if (!isSameDay(start, wd.date)) return;
        const si0 = start.getHours() * 2 + (start.getMinutes() >= 30 ? 1 : 0);
        const si1 = end.getHours() * 2 + (end.getMinutes() >= 30 ? 1 : 0);
        for (let si = si0; si < si1; si++) booked.add(`${wd.dateKey}-${si}`);
      });
    });
    setBookedSlots(booked);
    setLoading(false);
  }, [userId, allWeekDays]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleSlot = (dateKey: string, slotIdx: number) => {
    const key = `${dateKey}-${slotIdx}`;
    if (bookedSlots.has(key)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsDirty(true);
    setSelectedSlots(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const convertSlotsToBlocks = (): AvailabilityBlock[] => {
    const dayMap = new Map<string, number[]>();
    selectedSlots.forEach(key => {
      const parts = key.split('-');
      const dateKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
      const idx = parseInt(parts[3], 10);
      if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
      dayMap.get(dateKey)!.push(idx);
    });
    const blocks: AvailabilityBlock[] = [];
    dayMap.forEach((indices, dateKey) => {
      indices.sort((a, b) => a - b);
      let runStart = indices[0];
      let prev = indices[0];
      for (let i = 1; i <= indices.length; i++) {
        if (i < indices.length && indices[i] === prev + 1) { prev = indices[i]; continue; }
        const startTime = slotToTime(runStart);
        const endTime = slotToTime(prev + 1);
        const dayDate = new Date(dateKey + 'T00:00:00');
        blocks.push({
          id: `${dateKey}-${runStart}-${prev}`, day: dayDate.getDay(), startTime, endTime,
          absoluteStart: new Date(dateKey + 'T' + startTime + ':00').toISOString(),
          absoluteEnd: new Date(dateKey + 'T' + endTime + ':00').toISOString(),
          type: 'available', title: 'Available', color: '#007bff',
        });
        if (i < indices.length) { runStart = indices[i]; prev = indices[i]; }
      }
    });
    return blocks;
  };

  const getEditedDates = (): string[] => isSingleDay ? displayedDays.map(d => d.dateKey) : allWeekDays.map(d => d.dateKey);

  const handleSave = async () => {
    setSaving(true);
    try {
      await calendarService.updateAvailability(convertSlotsToBlocks(), getEditedDates());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      justSaved.current = true;
      setIsDirty(false);
      setInitialSlots(new Set(selectedSlots));
      Alert.alert(t('TUTOR_CALENDAR.SAVED_TITLE'), t('TUTOR_CALENDAR.SAVED_DESC'));
      navigation.goBack();
    } catch (e: any) {
      Alert.alert(t('COMMON.ERROR') || 'Error', e.message || t('TUTOR_CALENDAR.SAVE_FAILED'));
    } finally { setSaving(false); }
  };

  const handleClearAll = () => {
    Alert.alert(t('TUTOR_CALENDAR.CLEAR_ALL'), t('TUTOR_CALENDAR.CLEAR_ALL_CONFIRM'), [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('TUTOR_CALENDAR.CLEAR'), onPress: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsDirty(true);
        const cleared = new Set<string>();
        bookedSlots.forEach(k => { if (selectedSlots.has(k)) cleared.add(k); });
        setSelectedSlots(cleared);
      }},
    ]);
  };

  const handleBusinessHours = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsDirty(true);
    const next = new Set(selectedSlots);
    allWeekDays.forEach(wd => {
      const dow = wd.date.getDay();
      if (dow === 0 || dow === 6) return;
      for (let si = 18; si < 36; si++) {
        const key = `${wd.dateKey}-${si}`;
        if (!bookedSlots.has(key)) next.add(key);
      }
    });
    setSelectedSlots(next);
  };

  const navigateDays = (dir: number) => {
    if (isSingleDay) {
      const next = new Date(targetDate!);
      next.setDate(next.getDate() + dir);
      navigation.setParams({ date: formatDateKey(next) });
      return;
    }
    const newIdx = mobileStartIdx + dir * VISIBLE_DAYS;
    if (newIdx >= 0 && newIdx + VISIBLE_DAYS <= 7) {
      setMobileStartIdx(newIdx);
    } else {
      const next = new Date(weekStart);
      next.setDate(next.getDate() + dir * 7);
      setWeekStart(next);
      setMobileStartIdx(dir > 0 ? 0 : 7 - VISIBLE_DAYS);
    }
  };

  const C = colors;
  const saveBarTranslateY = saveBarAnim.interpolate({ inputRange: [0, 1], outputRange: [100, 0] });

  if (loading) return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      <View style={st.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.accent} />
          <Text style={[st.backText, { color: C.accent }]}>{t('TABS.CALENDAR')}</Text>
        </TouchableOpacity>
        <Text style={[st.headerTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.SET_AVAILABILITY')}</Text>
        <View style={{ width: 80 }} />
      </View>
      <View style={st.loadWrap}><ActivityIndicator size="large" color={C.textSecondary} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      {/* Header */}
      <View style={[st.headerRow, { borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.accent} />
          <Text style={[st.backText, { color: C.accent }]}>{t('TABS.CALENDAR')}</Text>
        </TouchableOpacity>
        <Text style={[st.headerTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.SET_AVAILABILITY')}</Text>
        <TouchableOpacity onPress={handleClearAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[st.clearText, { color: C.danger }]}>{t('TUTOR_CALENDAR.CLEAR')}</Text>
        </TouchableOpacity>
      </View>

      {/* Day Navigation + Sticky Day Headers */}
      <View style={[st.dayNav, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <View style={st.dayNavRow}>
          <TouchableOpacity onPress={() => navigateDays(-1)} style={[st.roundArrow, { borderColor: C.border }]}>
            <Ionicons name="chevron-back" size={14} color={C.textSecondary} />
          </TouchableOpacity>
          <View style={st.dayHeaders}>
            {displayedDays.map(d => (
              <View key={d.dateKey} style={[st.dayHeaderCol, { width: colWidth }]}>
                <Text style={[st.dayWeekday, { color: d.isToday ? SLOT_COLOR : C.textSecondary }]}>{d.weekdayLabel}</Text>
                <View style={[st.dateCircle, d.isToday && { backgroundColor: SLOT_COLOR }]}>
                  <Text style={[st.dayDateNum, { color: d.isToday ? '#fff' : C.text }]}>{d.date.getDate()}</Text>
                </View>
              </View>
            ))}
          </View>
          <TouchableOpacity onPress={() => navigateDays(1)} style={[st.roundArrow, { borderColor: C.border }]}>
            <Ionicons name="chevron-forward" size={14} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Time Grid */}
      <ScrollView ref={scrollRef} style={st.gridScroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {Array.from({ length: SLOTS_PER_DAY }, (_, slotIdx) => {
          const showLabel = slotIdx % 2 === 0;
          const isNowRow = displayedDays.some(d => d.isToday) && nowSlotIdx === slotIdx;

          return (
            <View key={slotIdx} style={st.slotRow}>
              <View style={st.timeLabelWrap}>
                {showLabel && <Text style={[st.timeLabelText, { color: C.textTertiary }]}>{formatTimeLabel(slotIdx, use24h)}</Text>}
              </View>

              {displayedDays.map(day => {
                const key = `${day.dateKey}-${slotIdx}`;
                const isSelected = selectedSlots.has(key);
                const isBooked = bookedSlots.has(key);
                const isPast = day.isPast && !day.isToday;
                const showNowLine = day.isToday && isNowRow;

                return (
                  <TouchableOpacity
                    key={key}
                    style={[st.slotCell, { width: colWidth }]}
                    onPress={() => !isPast && !isBooked && toggleSlot(day.dateKey, slotIdx)}
                    activeOpacity={isBooked || isPast ? 1 : 0.6}
                    disabled={isBooked || isPast}
                  >
                    <View style={[st.gridLine, { backgroundColor: C.border }, slotIdx % 2 !== 0 && st.gridLineHalf]} />

                    {isSelected && !isBooked ? (
                      <View style={[st.slotBar, { backgroundColor: SLOT_COLOR }]}>
                        <View style={st.slotDot} />
                      </View>
                    ) : isBooked ? (
                      <View style={[st.slotBarBooked, { backgroundColor: isDark ? '#3a3a3a' : '#e8e8e8' }]}>
                        <Ionicons name="lock-closed" size={10} color={isDark ? '#888' : '#aaa'} />
                      </View>
                    ) : (
                      <View style={[st.slotBarEmpty, { backgroundColor: isPast ? (isDark ? '#1a1a1a' : '#f7f7f7') : (isDark ? '#2a2a2a' : '#eef0f2') }]} />
                    )}

                    {showNowLine && (
                      <View style={st.nowIndicator}>
                        <View style={st.nowDot} />
                        <View style={st.nowLine} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* Save Bar - slides in from bottom */}
      <Animated.View style={[st.saveBar, { backgroundColor: C.card, borderTopColor: C.border, paddingBottom: Math.max(insets.bottom, 16), transform: [{ translateY: saveBarTranslateY }] }]}>
        <View style={st.saveBarInner}>
          <View style={st.saveInfoCol}>
            <Text style={[st.saveDelta, { color: hoursDelta >= 0 ? '#2E7D32' : C.danger }]}>
              {hoursDelta >= 0 ? '+' : ''}{hoursDelta} {hoursDelta === 1 || hoursDelta === -1 ? 'hour' : 'hours'}
            </Text>
            <Text style={[st.saveWeekInfo, { color: C.textSecondary }]}>{totalWeekHours} hours {weekRangeLabel}</Text>
          </View>
          <TouchableOpacity
            style={[st.saveBtn, saving && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving || !hasChanges}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={st.saveBtnText}>{t('TUTOR_CALENDAR.SAVE_AVAILABILITY')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  clearText: { fontSize: 14, fontWeight: '600' },

  dayNav: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
  dayNavRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  roundArrow: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayHeaders: { flex: 1, flexDirection: 'row', justifyContent: 'center', marginLeft: TIME_LABEL_W - 28 },
  dayHeaderCol: { alignItems: 'center', paddingTop: 8 },
  dayWeekday: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  dateCircle: { width: DATE_CIRCLE, height: DATE_CIRCLE, borderRadius: DATE_CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
  dayDateNum: { fontSize: 15, fontWeight: '700' },

  gridScroll: { flex: 1, paddingLeft: 8 },

  slotRow: { flexDirection: 'row', height: SLOT_HEIGHT + SLOT_GAP },
  timeLabelWrap: { width: TIME_LABEL_W, justifyContent: 'flex-start', alignItems: 'flex-end', paddingRight: 6 },
  timeLabelText: { fontSize: 10, fontWeight: '500', marginTop: -5 },

  slotCell: { height: SLOT_HEIGHT + SLOT_GAP, paddingHorizontal: 2, paddingVertical: SLOT_GAP / 2, position: 'relative' },
  gridLine: { position: 'absolute', top: 0, left: 2, right: 2, height: 1 },
  gridLineHalf: { opacity: 0.5 },

  slotBar: { flex: 1, borderRadius: 6, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 6 },
  slotDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  slotBarBooked: { flex: 1, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  slotBarEmpty: { flex: 1, borderRadius: 6 },

  nowIndicator: { position: 'absolute', top: '50%', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  nowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E53935', marginLeft: -4 },
  nowLine: { flex: 1, height: 2, backgroundColor: '#E53935' },

  saveBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  saveBarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  saveInfoCol: { flex: 1, marginRight: 12 },
  saveDelta: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  saveWeekInfo: { fontSize: 12, fontWeight: '500' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#222', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
