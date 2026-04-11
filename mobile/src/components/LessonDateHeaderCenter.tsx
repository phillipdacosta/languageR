import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type LessonDateHeaderCenterProps = {
  dateBadgeMonth: string;
  dateBadgeDay: string;
  timeLine: string;
  isDark: boolean;
  textPrimary: string;
  textSecondary: string;
  /** Slightly tighter gap for toolbar vs card */
  compact?: boolean;
};

/**
 * Month/day pill + time below — matches /lessons card date treatment.
 */
export function LessonDateHeaderCenter({
  dateBadgeMonth,
  dateBadgeDay,
  timeLine,
  isDark,
  textPrimary,
  textSecondary,
  compact,
}: LessonDateHeaderCenterProps) {
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
      {!!timeLine && (
        <Text style={[styles.subtitleUnderBadge, { color: textSecondary }]} numberOfLines={2}>
          {timeLine}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
