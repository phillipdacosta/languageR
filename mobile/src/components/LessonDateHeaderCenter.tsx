import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type LessonDateHeaderCenterProps = {
  dateBadgeMonth: string;
  dateBadgeDay: string;
  isDark: boolean;
  textPrimary: string;
  textSecondary: string;
  /** Short weekday e.g. "SAT" — with `timeRange` + `durationLine` enables web-style pill row */
  weekdayShort?: string;
  /** e.g. "1:00 PM – 2:00 PM" */
  timeRange?: string;
  /** e.g. "25 MINS LESSON" — omitted for group classes */
  durationLine?: string;
  isToday?: boolean;
  /** Legacy single subtitle under badge when pill props not used */
  timeLine?: string;
  compact?: boolean;
};

/**
 * Web `/lessons` `lgc-date-time-block`: outer grey pill, inner date chip, time + duration column.
 */
export function LessonDateHeaderCenter({
  dateBadgeMonth,
  dateBadgeDay,
  isDark,
  textPrimary,
  textSecondary,
  weekdayShort,
  timeRange,
  durationLine,
  isToday,
  timeLine,
  compact,
}: LessonDateHeaderCenterProps) {
  const usePill = !!(weekdayShort && timeRange);

  if (!usePill) {
    return (
      <View style={[styles.dateTimeBlock, compact && styles.dateTimeBlockCompact]}>
        <View
          style={[
            styles.dateBadgeInline,
            {
              backgroundColor: isDark ? '#2c2c2e' : '#F2F2F7',
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          <Text style={[styles.dateBadgeMonthInline, { color: isDark ? '#FF6B8A' : '#FF385C' }]}>
            {dateBadgeMonth}
          </Text>
          <Text style={[styles.dateBadgeDayInline, { color: textPrimary }]}>{dateBadgeDay}</Text>
        </View>
        {!!(timeLine || timeRange) && (
          <Text style={[styles.subtitleUnderBadge, { color: textSecondary }]} numberOfLines={2}>
            {timeLine || timeRange}
          </Text>
        )}
      </View>
    );
  }

  const outerBg = isDark ? '#2c2c2e' : '#f7f7f9';
  const chipBg = isToday ? (isDark ? 'rgba(0,180,220,0.12)' : '#e4fbff') : isDark ? '#3a3a3c' : '#ffffff';
  const chipBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const monthColor = isToday ? '#ff3b30' : isDark ? '#FF6B8A' : '#ff3b30';
  const dayColor = isToday ? '#ff3b30' : isDark ? '#f5f5f7' : '#1d1d1f';
  const timeColor = isDark ? '#f5f5f7' : '#1d1d1f';
  const weekdayColor = isToday ? 'rgba(255, 59, 48, 0.7)' : '#8e8e93';
  const durationColor = '#8e8e93';

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View
        style={[
          styles.outerPill,
          compact && styles.outerPillCompact,
          { backgroundColor: outerBg },
        ]}
      >
        <View style={[styles.chip, { backgroundColor: chipBg, borderColor: chipBorder }]}>
          <Text style={[styles.chipMonth, { color: monthColor }]} numberOfLines={1}>
            {dateBadgeMonth}
          </Text>
          <Text style={[styles.chipDay, { color: dayColor }]} numberOfLines={1}>
            {dateBadgeDay}
          </Text>
          <Text style={[styles.chipWeekday, { color: weekdayColor }]} numberOfLines={1}>
            {weekdayShort}
          </Text>
        </View>
        <View style={styles.infoCol}>
          <Text style={[styles.timeRow, { color: timeColor }]} numberOfLines={1}>
            {timeRange}
          </Text>
          {durationLine ? (
            <Text style={[styles.durationRow, { color: durationColor }]} numberOfLines={2}>
              {durationLine}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapCompact: {
    minHeight: undefined,
  },
  outerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    gap: 14,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 18,
    borderRadius: 16,
  },
  outerPillCompact: {
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 14,
    gap: 12,
    borderRadius: 14,
  },
  chip: {
    width: 36,
    height: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chipMonth: {
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    lineHeight: 10,
    marginBottom: 1,
  },
  chipDay: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 17,
  },
  chipWeekday: {
    fontSize: 7,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    lineHeight: 10,
    marginTop: 1,
  },
  infoCol: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 3,
  },
  timeRow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 15,
  },
  durationRow: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    lineHeight: 12,
  },

  dateTimeBlock: {
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  dateTimeBlockCompact: {
    gap: 4,
    width: undefined,
    maxWidth: '100%',
  },
  dateBadgeInline: {
    minWidth: 38,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBadgeMonthInline: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  dateBadgeDayInline: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.35,
    lineHeight: 20,
  },
  subtitleUnderBadge: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 18,
    margin: 0,
  },
});

export function formatDateBadgeParts(start: Date): { month: string; day: string } {
  const month = start
    .toLocaleDateString(undefined, { month: 'short' })
    .replace(/\./g, '')
    .toUpperCase();
  const day = String(start.getDate());
  return { month, day };
}
