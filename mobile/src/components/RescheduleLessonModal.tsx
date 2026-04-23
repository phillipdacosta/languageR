import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { SolidToolbarWithBlur } from './SolidToolbarWithBlur';
import { useTheme } from '../contexts/ThemeContext';
import {
  getLessonEnd,
  getLessonStart,
  lessonService,
  type Lesson,
} from '../services/lessons';
import { calendarService } from '../services/calendar';
import { updateClass } from '../services/classes';
import type { AvailabilityBlock, CalendarClass, CalendarLesson } from '../types/calendar';

const SLOT_STEP_MS = 30 * 60 * 1000;
const RANGE_DAYS = 28;
const DAY_CELL_SIZE = 40;
const ACCENT_BLUE = '#08a0e8';

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay();
  out.setDate(out.getDate() - dow);
  return out;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Extract the "YYYY-MM-DD" date a block targets, if any. One-off blocks encode
 * the date as the prefix of `id` (matches tutor wall date) and optionally set
 * `absoluteStart`. Pure recurring blocks return null so we fall back to `day`.
 */
function blockDateKey(b: AvailabilityBlock): string | null {
  if (typeof b.id === 'string') {
    const m = b.id.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (b.absoluteStart) {
    const d = new Date(b.absoluteStart);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${da}`;
    }
  }
  return null;
}

function intervalsForDay(day: Date, blocks: AvailabilityBlock[]): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const targetKey = dayKey(day);

  for (const b of blocks) {
    if (b.type !== 'available') continue;

    const bKey = blockDateKey(b);
    if (bKey) {
      if (bKey !== targetKey) continue;
    } else if (Number(b.day) !== day.getDay()) {
      continue;
    }

    const [sh, sm] = (b.startTime || '0:0').split(':').map(Number);
    const [eh, em] = (b.endTime || '0:0').split(':').map(Number);
    if ([sh, sm, eh, em].some(n => Number.isNaN(n))) continue;

    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);
    if (end.getTime() > start.getTime()) out.push({ start, end });
  }
  return out;
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

function buildSlotsForDay(
  day: Date,
  blocks: AvailabilityBlock[],
  durationMs: number,
  studentLessons: Lesson[],
  tutorLessons: CalendarLesson[],
  tutorClasses: CalendarClass[],
  now: Date,
): Date[] {
  const intervals = intervalsForDay(day, blocks);
  const slots: Date[] = [];
  const nowMs = now.getTime();

  const busy: { s: number; e: number }[] = [];
  for (const l of studentLessons) {
    const st = String(l.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'completed') continue;
    const s = getLessonStart(l).getTime();
    const e = getLessonEnd(l).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    busy.push({ s, e });
  }
  for (const l of tutorLessons) {
    const st = String(l.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'completed') continue;
    const s = new Date(l.startTime).getTime();
    const e = l.endTime ? new Date(l.endTime).getTime() : s + (l.duration || 30) * 60000;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    busy.push({ s, e });
  }
  for (const c of tutorClasses) {
    const st = String(c.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'completed') continue;
    const s = new Date(c.startTime).getTime();
    const e = c.endTime ? new Date(c.endTime).getTime() : s + (c.duration || 30) * 60000;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    busy.push({ s, e });
  }

  for (const { start, end } of intervals) {
    let t = start.getTime();
    const endMs = end.getTime();
    while (t + durationMs <= endMs) {
      if (t < nowMs) {
        t += SLOT_STEP_MS;
        continue;
      }
      const candEnd = t + durationMs;
      let ok = true;
      for (const o of busy) {
        if (rangesOverlap(t, candEnd, o.s, o.e)) {
          ok = false;
          break;
        }
      }
      if (ok) slots.push(new Date(t));
      t += SLOT_STEP_MS;
    }
  }
  return slots;
}

function formatParticipant(lesson: Lesson, isTutor: boolean): { name: string; picture: string | null } {
  const other = isTutor ? lesson.studentId : lesson.tutorId;
  const picture = other?.picture || other?.profilePicture || null;
  let name = '—';
  if (other?.firstName) {
    const li = other.lastName?.charAt(0);
    name = li ? `${other.firstName} ${li.toUpperCase()}.` : other.firstName;
  } else if (other?.name) {
    const parts = other.name.trim().split(/\s+/);
    name = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : parts[0];
  }
  return { name, picture };
}

export type RescheduleLessonModalProps = {
  visible: boolean;
  lesson: Lesson | null;
  isTutor: boolean;
  currentUserId: string;
  onClose: () => void;
  onSuccess: () => void;
};

export function RescheduleLessonModal({
  visible,
  lesson,
  isTutor,
  currentUserId,
  onClose,
  onSuccess,
}: RescheduleLessonModalProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDark = colors.isDark;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>([]);
  const [studentLessons, setStudentLessons] = useState<Lesson[]>([]);
  const [tutorLessons, setTutorLessons] = useState<CalendarLesson[]>([]);
  const [tutorClasses, setTutorClasses] = useState<CalendarClass[]>([]);
  const [acceptingBookings, setAcceptingBookings] = useState(true);
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);

  const tutorId =
    typeof lesson?.tutorId === 'string'
      ? (lesson.tutorId as unknown as string)
      : lesson?.tutorId?._id || '';
  const studentId =
    typeof lesson?.studentId === 'string'
      ? (lesson.studentId as unknown as string)
      : lesson?.studentId?._id || '';

  const durationMs = useMemo(() => {
    if (!lesson) return 30 * 60000;
    const s = getLessonStart(lesson).getTime();
    const e = getLessonEnd(lesson).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return (lesson.duration || 30) * 60000;
    return e - s;
  }, [lesson]);

  const originalTimeLabel = useMemo(() => {
    if (!lesson) return '';
    const d = getLessonStart(lesson);
    if (Number.isNaN(d.getTime())) return '';
    const dateStr = d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${dateStr} at ${timeStr}`;
  }, [lesson]);

  const dayStrip = useMemo(() => {
    const days: Date[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < RANGE_DAYS; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      days.push(d);
    }
    return days;
  }, []);

  const slotsByDay = useMemo(() => {
    if (!lesson || !availabilityBlocks.length) return new Map<string, Date[]>();
    const map = new Map<string, Date[]>();
    const now = new Date();
    for (const d of dayStrip) {
      const slots = buildSlotsForDay(
        d,
        availabilityBlocks,
        durationMs,
        studentLessons,
        tutorLessons,
        tutorClasses,
        now,
      );
      map.set(dayKey(d), slots);
    }
    return map;
  }, [
    lesson,
    availabilityBlocks,
    durationMs,
    studentLessons,
    tutorLessons,
    tutorClasses,
    dayStrip,
  ]);

  const slotsForSelectedDay = useMemo(() => {
    return slotsByDay.get(dayKey(selectedDay)) || [];
  }, [slotsByDay, selectedDay]);

  const weekCells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cells: {
      date: Date;
      dayLabel: string;
      dateLabel: string;
      isSelected: boolean;
      isToday: boolean;
      isPast: boolean;
      hasSlots: boolean;
    }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      cells.push({
        date: d,
        dayLabel: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase(),
        dateLabel: String(d.getDate()),
        isSelected: isSameDay(d, selectedDay),
        isToday: isSameDay(d, today),
        isPast: d.getTime() < today.getTime(),
        hasSlots: (slotsByDay.get(dayKey(d)) || []).length > 0,
      });
    }
    return cells;
  }, [weekStart, selectedDay, slotsByDay]);

  const weekRangeLabel = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(weekStart.getDate() + 6);
    const sameMonth = weekStart.getMonth() === end.getMonth();
    const sameYear = weekStart.getFullYear() === end.getFullYear();
    const fmtMonthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const fmtMonth = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
    if (sameMonth) return fmtMonthYear(weekStart);
    if (sameYear) return `${fmtMonth(weekStart)} – ${fmtMonth(end)} ${end.getFullYear()}`;
    return `${fmtMonth(weekStart)} ${weekStart.getFullYear()} – ${fmtMonth(end)} ${end.getFullYear()}`;
  }, [weekStart]);

  const shiftWeek = useCallback((days: number) => {
    void Haptics.selectionAsync();
    setWeekStart(prev => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + days);
      return next;
    });
  }, []);

  const canShiftPrevWeek = useMemo(() => {
    const currentWeekStart = startOfWeek(new Date());
    return weekStart.getTime() > currentWeekStart.getTime();
  }, [weekStart]);

  const canShiftNextWeek = useMemo(() => {
    const maxStart = startOfWeek(new Date());
    maxStart.setDate(maxStart.getDate() + (RANGE_DAYS - 7));
    return weekStart.getTime() < maxStart.getTime();
  }, [weekStart]);

  useEffect(() => {
    if (!visible || !lesson) {
      return;
    }
    setStep('pick');
    setSelectedSlot(null);
    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const rangeStart = new Date();
        rangeStart.setDate(rangeStart.getDate() - 1);
        const rangeEnd = new Date();
        rangeEnd.setDate(rangeEnd.getDate() + RANGE_DAYS + 7);

        const availP =
          isTutor && tutorId === currentUserId
            ? calendarService.getAvailability().then(a => ({ availability: a, acceptingBookings: true }))
            : tutorId
              ? calendarService.getTutorAvailabilityByUserId(tutorId)
              : Promise.resolve({ availability: [], acceptingBookings: false });

        const studentP =
          studentId && !lesson.isClass
            ? lessonService.getLessonsByStudent(studentId, false)
            : Promise.resolve([]);

        const tutorLessonsP = tutorId
          ? calendarService.getTutorLessons(tutorId, rangeStart, rangeEnd)
          : Promise.resolve([]);

        const tutorClassesP = tutorId
          ? calendarService.getTutorClasses(tutorId, rangeStart, rangeEnd)
          : Promise.resolve([]);

        const [availWrap, stLessons, tlLessons, tcClasses] = await Promise.all([
          availP,
          studentP,
          tutorLessonsP,
          tutorClassesP,
        ]);
        if (cancelled) return;
        setAvailabilityBlocks(availWrap.availability || []);
        setAcceptingBookings(availWrap.acceptingBookings !== false);
        setStudentLessons(stLessons);
        setTutorLessons(tlLessons);
        setTutorClasses(tcClasses);

        const now = new Date();
        const map = new Map<string, Date[]>();
        const blocks = availWrap.availability || [];
        for (const d of dayStrip) {
          const slots = buildSlotsForDay(
            d,
            blocks,
            durationMs,
            stLessons,
            tlLessons,
            tcClasses,
            now,
          );
          map.set(dayKey(d), slots);
        }
        let firstWith: Date | null = null;
        for (const d of dayStrip) {
          const sl = map.get(dayKey(d));
          if (sl && sl.length) {
            firstWith = d;
            break;
          }
        }
        const landingDay = firstWith || dayStrip[0] || new Date();
        setSelectedDay(landingDay);
        setWeekStart(startOfWeek(landingDay));
      } catch {
        if (!cancelled) {
          Alert.alert('', t('HOME.RESCHEDULE_LOAD_FAILED'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    visible,
    lesson?._id,
    isTutor,
    tutorId,
    studentId,
    currentUserId,
    durationMs,
    dayStrip,
    lesson?.isClass,
    t,
  ]);

  const participant = lesson ? formatParticipant(lesson, isTutor) : { name: '', picture: null as string | null };

  const onPickSlot = useCallback(
    (d: Date) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedSlot(d);
      setStep('confirm');
    },
    [],
  );

  const goBackToPick = useCallback(() => {
    setStep('pick');
    setSelectedSlot(null);
  }, []);

  const submitReschedule = useCallback(async () => {
    if (!lesson || !selectedSlot) return;
    const start = selectedSlot;
    const end = new Date(start.getTime() + durationMs);
    setSubmitting(true);
    try {
      if (lesson.isClass) {
        const res = await updateClass(lesson._id, {
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
        if (res.success) {
          Alert.alert('', t('HOME.RESCHEDULE_CLASS_SUCCESS'), [{ text: t('COMMON.OK'), onPress: onSuccess }]);
        } else {
          Alert.alert('', res.message || t('HOME.RESCHEDULE_FAILED'));
        }
      } else {
        const res = await lessonService.proposeReschedule(lesson._id, start.toISOString(), end.toISOString());
        if (res.success) {
          Alert.alert('', t('HOME.RESCHEDULE_SUCCESS'), [{ text: t('COMMON.OK'), onPress: onSuccess }]);
        } else {
          Alert.alert('', res.message || t('HOME.RESCHEDULE_FAILED'));
        }
      }
    } catch (e: any) {
      Alert.alert('', e?.message || t('HOME.RESCHEDULE_FAILED'));
    } finally {
      setSubmitting(false);
    }
  }, [lesson, selectedSlot, durationMs, t, onSuccess]);

  const confirmReschedule = useCallback(() => {
    if (!selectedSlot || !lesson) return;
    const dateStr = selectedSlot.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const timeStr = selectedSlot.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    if (lesson.isClass) {
      Alert.alert(
        t('HOME.RESCHEDULE_CLASS_CONFIRM_TITLE'),
        t('HOME.RESCHEDULE_CLASS_CONFIRM_MSG', { date: dateStr, time: timeStr }),
        [
          { text: t('COMMON.CANCEL'), style: 'cancel' },
          { text: t('HOME.RESCHEDULE_CLASS_CTA'), style: 'destructive', onPress: () => void submitReschedule() },
        ],
      );
      return;
    }

    Alert.alert(
      t('HOME.RESCHEDULE_CONFIRM_TITLE'),
      t('HOME.RESCHEDULE_CONFIRM_MSG', { date: dateStr, time: timeStr }),
      [
        { text: t('COMMON.CANCEL'), style: 'cancel' },
        { text: t('HOME.RESCHEDULE_PROPOSE_CTA'), style: 'default', onPress: () => void submitReschedule() },
      ],
    );
  }, [selectedSlot, lesson, t, submitReschedule]);

  if (!visible || !lesson) return null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.safe,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <SolidToolbarWithBlur isDark={isDark}>
          <View style={styles.toolbarRow}>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => {
                if (step === 'confirm') goBackToPick();
                else onClose();
              }}
              style={({ pressed }) => [styles.toolbarBtn, pressed && { opacity: 0.55 }]}
            >
              <Ionicons name={step === 'confirm' ? 'chevron-back' : 'close'} size={24} color={colors.text} />
            </Pressable>
            <Text style={[styles.toolbarTitle, { color: colors.text }]} numberOfLines={1}>
              {t('HOME.RESCHEDULE')}
            </Text>
            <View style={{ width: 40 }} />
          </View>
        </SolidToolbarWithBlur>

        {!acceptingBookings && !isTutor ? (
          <View style={[styles.banner, { backgroundColor: colors.warning + '22' }]}>
            <Text style={[styles.bannerText, { color: colors.text }]}>{t('HOME.RESCHEDULE_BOOKINGS_PAUSED')}</Text>
          </View>
        ) : null}

        {!lesson.isClass ? (
          <View style={styles.heroRow}>
            {participant.picture ? (
              <Image source={{ uri: participant.picture }} style={styles.heroAvatar} />
            ) : (
              <View style={[styles.heroAvatar, styles.heroAvatarPh, { backgroundColor: colors.inputBg }]}>
                <Ionicons name="person" size={18} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.heroTextWrap}>
              <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={1}>
                {participant.name}
              </Text>
              <Text style={[styles.heroSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {t('HOME.RESCHEDULE_WITH')}
              </Text>
            </View>
          </View>
        ) : null}

        {originalTimeLabel ? (
          <View style={[styles.currentTimeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.currentTimeIconWrap, { backgroundColor: colors.inputBg }]}>
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.currentTimeTextWrap}>
              <Text style={[styles.currentTimeLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                {lesson.isClass ? t('HOME.RESCHEDULE_CURRENT_CLASS_TIME') : t('HOME.RESCHEDULE_CURRENT_LESSON_TIME')}
              </Text>
              <Text style={[styles.currentTimeValue, { color: colors.text }]} numberOfLines={1}>
                {originalTimeLabel}
              </Text>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color={colors.textSecondary} />
            <Text style={[styles.loadingCap, { color: colors.textSecondary }]}>{t('HOME.RESCHEDULE_LOADING')}</Text>
          </View>
        ) : step === 'pick' ? (
          <View style={styles.pickBody}>
            <View style={[styles.weekHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.weekTitle, { color: colors.text }]} numberOfLines={1}>
                {weekRangeLabel}
              </Text>
              <View style={styles.weekNav}>
                <TouchableOpacity
                  disabled={!canShiftPrevWeek}
                  onPress={() => shiftWeek(-7)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={[styles.weekNavBtn, !canShiftPrevWeek && { opacity: 0.35 }]}
                >
                  <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={!canShiftNextWeek}
                  onPress={() => shiftWeek(7)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={[styles.weekNavBtn, !canShiftNextWeek && { opacity: 0.35 }]}
                >
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.weekStrip, { borderBottomColor: colors.border }]}>
              {weekCells.map((cell, i) => {
                const disabled = cell.isPast && !cell.isToday;
                return (
                  <TouchableOpacity
                    key={i}
                    style={styles.dayCellWrap}
                    onPress={() => {
                      if (disabled) return;
                      void Haptics.selectionAsync();
                      setSelectedDay(cell.date);
                    }}
                    activeOpacity={0.7}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.dayCellLabel,
                        {
                          color: disabled
                            ? colors.textTertiary
                            : cell.isSelected || cell.isToday
                              ? ACCENT_BLUE
                              : colors.textSecondary,
                        },
                      ]}
                    >
                      {cell.dayLabel}
                    </Text>
                    <View
                      style={[
                        styles.dateCircle,
                        cell.isSelected && { backgroundColor: ACCENT_BLUE },
                        cell.isToday && !cell.isSelected && { borderWidth: 2, borderColor: ACCENT_BLUE },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dateCircleText,
                          {
                            color: cell.isSelected
                              ? '#fff'
                              : cell.isToday
                                ? ACCENT_BLUE
                                : disabled
                                  ? colors.textTertiary
                                  : colors.text,
                          },
                        ]}
                      >
                        {cell.dateLabel}
                      </Text>
                    </View>
                    {cell.hasSlots && !cell.isSelected ? (
                      <View style={[styles.weekDayDot, { backgroundColor: colors.accent }]} />
                    ) : (
                      <View style={styles.weekDayDotPlaceholder} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('HOME.RESCHEDULE_PICK_TIME')}</Text>
            {slotsForSelectedDay.length === 0 ? (
              <Text style={[styles.emptySlots, { color: colors.textSecondary }]}>{t('HOME.RESCHEDULE_NO_SLOTS')}</Text>
            ) : (
              <ScrollView
                style={styles.slotScroll}
                contentContainerStyle={styles.slotList}
                showsVerticalScrollIndicator={false}
              >
                {slotsForSelectedDay.map(slot => (
                  <TouchableOpacity
                    key={slot.getTime()}
                    activeOpacity={0.85}
                    onPress={() => onPickSlot(slot)}
                    style={[styles.slotTile, { borderColor: colors.border, backgroundColor: colors.card }]}
                  >
                    <Text style={[styles.slotTileText, { color: colors.text }]}>
                      {slot.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={styles.confirmBody}>
            <Text style={[styles.confirmDate, { color: colors.text }]}>
              {selectedSlot?.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
            <Text style={[styles.confirmTime, { color: colors.textSecondary }]}>
              {selectedSlot?.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              {' · '}
              {Math.round(durationMs / 60000)} {t('HOME.MINS')}
            </Text>
            <Text style={[styles.confirmHint, { color: colors.textTertiary }]}>
              {lesson.isClass ? t('HOME.RESCHEDULE_CLASS_CONFIRM_HINT') : t('HOME.RESCHEDULE_CONFIRM_HINT')}
            </Text>
          </View>
        )}

        {step === 'confirm' ? (
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <TouchableOpacity
              activeOpacity={0.88}
              disabled={submitting}
              onPress={confirmReschedule}
              style={[
                styles.primaryCta,
                { backgroundColor: colors.joinCtaBackground },
                submitting && { opacity: 0.5 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryCtaText}>
                  {lesson.isClass ? t('HOME.RESCHEDULE_CLASS_CTA') : t('HOME.RESCHEDULE_PROPOSE_CTA')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    minHeight: 44,
  },
  toolbarBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  banner: { marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 12 },
  bannerText: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  currentTimeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  currentTimeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  currentTimeTextWrap: { flex: 1, minWidth: 0 },
  currentTimeLabel: { fontSize: 12, marginBottom: 2 },
  currentTimeValue: { fontSize: 15, fontWeight: '600' },
  heroAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 12 },
  heroAvatarPh: { alignItems: 'center', justifyContent: 'center' },
  heroTextWrap: { flex: 1, minWidth: 0 },
  heroName: { fontSize: 15, fontWeight: '700' },
  heroSub: { fontSize: 12, marginTop: 2 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingCap: { marginTop: 14, fontSize: 14 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginLeft: 20,
    marginTop: 16,
    marginBottom: 10,
  },
  pickBody: { flex: 1 },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
  },
  weekTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  weekNav: { flexDirection: 'row', alignItems: 'center' },
  weekNavBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  weekStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayCellWrap: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  dayCellLabel: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  dateCircle: {
    width: DAY_CELL_SIZE,
    height: DAY_CELL_SIZE,
    borderRadius: DAY_CELL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCircleText: { fontSize: 16, fontWeight: '700' },
  weekDayDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 6 },
  weekDayDotPlaceholder: { width: 5, height: 5, marginTop: 6 },
  emptySlots: { marginHorizontal: 20, fontSize: 15, lineHeight: 22 },
  slotScroll: { flex: 1 },
  slotList: {
    paddingHorizontal: 48,
    paddingBottom: 32,
    gap: 12,
  },
  slotTile: {
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotTileText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  confirmBody: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  confirmDate: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  confirmTime: { fontSize: 16, textAlign: 'center', marginTop: 8 },
  confirmHint: { fontSize: 14, textAlign: 'center', marginTop: 20, lineHeight: 20 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryCta: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryCtaText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
