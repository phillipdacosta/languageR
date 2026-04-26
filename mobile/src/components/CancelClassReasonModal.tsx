import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import type { Lesson } from '../services/lessons';

export type ClassCancellationReason = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  requiresNote?: boolean;
};

type Props = {
  visible: boolean;
  className: string;
  /** Cover image (class thumbnail) */
  thumbnailUrl?: string;
  startTime?: string;
  durationMinutes?: number;
  userTimezone?: string;
  submitting?: boolean;
  onClose: () => void;
  /** Receives the chosen reason; `label` is the final text (other = custom) */
  onContinue: (reason: { id: string; label: string; originalLabel: string }) => void;
  onRescheduleInstead?: () => void;
};

function ymdInZone(d: Date, timeZone?: string): { y: number; m: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return { y, m, day };
}

function sameCalendarDayInZone(a: Date, b: Date, timeZone?: string): boolean {
  const A = ymdInZone(a, timeZone);
  const B = ymdInZone(b, timeZone);
  return A.y === B.y && A.m === B.m && A.day === B.day;
}

function formatLessonDateTimeForDisplay(date: Date, tz?: string): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const optsBase: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  const opts: Intl.DateTimeFormatOptions = tz
    ? { ...optsBase, timeZone: tz }
    : optsBase;

  let dayLabel: string;
  if (sameCalendarDayInZone(date, now, tz)) {
    dayLabel = 'Today';
  } else if (sameCalendarDayInZone(date, tomorrow, tz)) {
    dayLabel = 'Tomorrow';
  } else {
    dayLabel = date.toLocaleDateString(undefined, opts);
  }

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
  return `${dayLabel} at ${timeStr}`;
}

function formatDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

const TUTOR_CLASS_REASONS: ClassCancellationReason[] = [
  { id: 'schedule_conflict', label: "Schedule conflict / I'm busy", icon: 'calendar-outline' },
  { id: 'technical_issues', label: 'Technical issues / internet problems', icon: 'wifi-outline' },
  { id: 'other', label: 'Other reason', icon: 'ellipsis-horizontal-outline', requiresNote: true },
];

export function CancelClassReasonModal({
  visible,
  className,
  thumbnailUrl,
  startTime,
  durationMinutes,
  userTimezone,
  submitting = false,
  onClose,
  onContinue,
  onRescheduleInstead,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDark = colors.isDark;

  const [selected, setSelected] = useState<ClassCancellationReason | null>(null);
  const [otherText, setOtherText] = useState('');

  useEffect(() => {
    if (!visible) {
      setSelected(null);
      setOtherText('');
    }
  }, [visible]);

  const displayTitle = className?.trim() || t('CANCEL_CLASS_REASON.DEFAULT_CLASS_TITLE');

  const formattedDateTime = useMemo(() => {
    if (!startTime) return '';
    const d = new Date(startTime);
    if (Number.isNaN(d.getTime())) return '';
    return formatLessonDateTimeForDisplay(d, userTimezone);
  }, [startTime, userTimezone]);

  const durationLabel = useMemo(() => {
    if (durationMinutes == null || durationMinutes <= 0) return '';
    return formatDurationLabel(durationMinutes);
  }, [durationMinutes]);

  const canContinue = useMemo(() => {
    if (!selected) return false;
    if (selected.requiresNote && !otherText.trim()) return false;
    return true;
  }, [selected, otherText]);

  const handleContinue = useCallback(() => {
    if (!canContinue || submitting) return;
    const sel = selected!;
    const finalLabel = sel.id === 'other' ? otherText.trim() : sel.label;
    onContinue({
      id: sel.id,
      label: finalLabel,
      originalLabel: sel.label,
    });
  }, [canContinue, submitting, selected, otherText, onContinue]);

  const border = isDark ? '#3a3a3c' : '#e5e5ea';
  const muted = colors.textSecondary;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
    >
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.background }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerSpacer} />
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {t('CANCEL_CLASS_REASON.TITLE_CLASS')}
            </Text>
            <Pressable
              accessibilityLabel={t('COMMON.CLOSE')}
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => {
                if (!submitting) onClose();
              }}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="close" size={28} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.classCard,
                { backgroundColor: colors.card, borderColor: border },
              ]}
            >
              <View style={styles.thumbWrap}>
                {thumbnailUrl ? (
                  <Image source={{ uri: thumbnailUrl }} style={styles.thumb} />
                ) : (
                  <View
                    style={[
                      styles.thumbPlaceholder,
                      { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' },
                    ]}
                  >
                    <Ionicons name="people-outline" size={28} color={muted} />
                  </View>
                )}
              </View>
              <View style={styles.classMeta}>
                <Text style={[styles.classTitle, { color: colors.text }]} numberOfLines={2}>
                  {displayTitle}
                </Text>
                {!!formattedDateTime && (
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={16} color={muted} />
                    <Text style={[styles.metaText, { color: muted }]}>{formattedDateTime}</Text>
                  </View>
                )}
                {!!durationLabel && (
                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={16} color={muted} />
                    <Text style={[styles.metaText, { color: muted }]}>{durationLabel}</Text>
                  </View>
                )}
              </View>
            </View>

            <Text style={[styles.selectLabel, { color: muted }]}>{t('CANCEL_CLASS_REASON.SELECT_REASON')}</Text>

            {TUTOR_CLASS_REASONS.map((r) => {
              const isSel = selected?.id === r.id;
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setSelected(r);
                    if (r.id !== 'other') setOtherText('');
                  }}
                  style={({ pressed }) => [
                    styles.reasonRow,
                    {
                      borderColor: isSel ? (isDark ? '#6b6b6b' : '#c7c7cc') : border,
                      backgroundColor: isDark ? (isSel ? '#2c2c2e' : colors.card) : isSel ? '#f9f9fb' : colors.card,
                    },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Ionicons name={r.icon} size={22} color={isSel ? colors.text : muted} style={styles.reasonIcon} />
                  <Text style={[styles.reasonLabel, { color: colors.text }]}>{r.label}</Text>
                  {isSel ? <Ionicons name="checkmark-circle" size={22} color="#34C759" /> : <View style={styles.checkSpacer} />}
                </Pressable>
              );
            })}

            {selected?.id === 'other' && (
              <View style={styles.otherWrap}>
                <TextInput
                  value={otherText}
                  onChangeText={setOtherText}
                  placeholder={t('CANCEL_CLASS_REASON.OTHER_PLACEHOLDER')}
                  placeholderTextColor={muted}
                  maxLength={300}
                  multiline
                  textAlignVertical="top"
                  style={[
                    styles.textarea,
                    { color: colors.text, borderColor: border, backgroundColor: isDark ? '#1c1c1e' : '#fafafa' },
                  ]}
                />
                <Text style={[styles.charCount, { color: muted }]}>
                  {otherText.length}/300
                </Text>
              </View>
            )}

            <View
              style={[
                styles.infoBox,
                { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7', borderColor: border },
              ]}
            >
              <Ionicons name="information-circle-outline" size={20} color={muted} style={styles.infoIcon} />
              <Text style={[styles.infoText, { color: muted }]}>{t('CANCEL_CLASS_REASON.INFO_CLASS')}</Text>
            </View>
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                borderTopColor: border,
                backgroundColor: colors.background,
              },
            ]}
          >
            <View style={styles.footerRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (submitting) return;
                  if (onRescheduleInstead) onRescheduleInstead();
                  else onClose();
                }}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.rescheduleBtn,
                  { borderColor: isDark ? '#e5e5ea' : '#1c1c1e' },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.rescheduleText, { color: colors.text }]}>
                  {t('CANCEL_CLASS_REASON.RESCHEDULE_INSTEAD')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleContinue}
                disabled={!canContinue || submitting}
                style={({ pressed }) => [
                  styles.continueTextBtn,
                  (!canContinue || submitting) && { opacity: 0.4 },
                  pressed && canContinue && !submitting && { opacity: 0.7 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.continueText, { color: colors.text }]}>
                    {t('CANCEL_CLASS_REASON.CONTINUE')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
    minHeight: 48,
  },
  headerSpacer: { width: 40 },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 8,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 4 },
  classCard: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 20,
  },
  thumbWrap: { marginRight: 12 },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#eee' },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  classMeta: { flex: 1, justifyContent: 'center' },
  classTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  metaText: { fontSize: 14, marginLeft: 6 },
  selectLabel: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  reasonIcon: { marginRight: 12 },
  reasonLabel: { flex: 1, fontSize: 16, fontWeight: '500' },
  checkSpacer: { width: 22 },
  otherWrap: { marginBottom: 16 },
  textarea: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
  },
  charCount: { fontSize: 12, alignSelf: 'flex-end', marginTop: 4 },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 4,
  },
  infoIcon: { marginRight: 10, marginTop: 2 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rescheduleBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  rescheduleText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  continueTextBtn: {
    minWidth: 100,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  continueText: { fontSize: 16, fontWeight: '600' },
});

/** Map from Home "lesson" to modal props (class branch). */
export function classLessonToCancelModalProps(lesson: Lesson | null | undefined) {
  if (!lesson) return { className: '', thumbnailUrl: undefined, startTime: undefined, durationMinutes: undefined };
  const name = (lesson.className || lesson.classData?.name || lesson.subject || '').trim();
  const thumb = lesson.classData?.thumbnail;
  const st = lesson.startTime || lesson.scheduledTime;
  return {
    className: name,
    thumbnailUrl: thumb,
    startTime: st,
    durationMinutes: lesson.duration,
  };
}
