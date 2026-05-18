import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { useTheme, ThemeColors } from '../contexts/ThemeContext';
import {
  ReviewDeckItem,
  ReviewQuality,
  getDueItems,
  getStats,
  markReviewed,
  toggleMastered,
} from '../services/reviewDeck';

/**
 * PracticeScreen — student-facing spaced-repetition practice.
 *
 * Flow:
 *   1. On open, fetch the next batch of due items + stats.
 *   2. Show one card at a time (front: mistake, back: correction).
 *   3. Student grades themselves: Again / Good / Easy.
 *      Grading drives the SRS interval server-side.
 *   4. When the queue is empty, show an "all caught up" empty state with
 *      stats so they know what to come back to tomorrow.
 *
 * No inline functions in JSX outside event handlers — values are
 * precomputed in `displayCard` / `progressLabel` / etc.
 */

const BATCH_SIZE = 25;

type Stats = {
  total: number;
  mastered: number;
  notMastered: number;
  needsReview: number;
};

export default function PracticeScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [queue, setQueue] = useState<ReviewDeckItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [grading, setGrading] = useState(false);

  const flipAnim = useState(new Animated.Value(0))[0];

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [itemsRes, statsRes] = await Promise.all([
        getDueItems({ limit: BATCH_SIZE }),
        getStats(),
      ]);
      setQueue(itemsRes.items || []);
      setStats({
        total: statsRes.total,
        mastered: statsRes.mastered,
        notMastered: statsRes.notMastered,
        needsReview: statsRes.needsReview,
      });
      setShowAnswer(false);
      flipAnim.setValue(0);
    } catch (err) {
      console.warn('[Practice] Failed to load queue:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [flipAnim]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadQueue(true);
  }, [loadQueue]);

  const onFlip = useCallback(() => {
    const next = !showAnswer;
    Animated.timing(flipAnim, {
      toValue: next ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setShowAnswer(next);
  }, [showAnswer, flipAnim]);

  const onGrade = useCallback(async (quality: ReviewQuality) => {
    if (queue.length === 0 || grading) return;
    const card = queue[0];
    setGrading(true);
    try {
      await markReviewed(card._id, quality);
      const remaining = queue.slice(1);
      setQueue(remaining);
      setShowAnswer(false);
      flipAnim.setValue(0);
      if (stats) {
        setStats({ ...stats, needsReview: Math.max(0, stats.needsReview - 1) });
      }
      // If we drained the local batch, see if there are more queued items
      // server-side (defensive — usually not needed for a 25-card batch).
      if (remaining.length === 0) {
        try {
          const more = await getDueItems({ limit: BATCH_SIZE });
          if (more.items?.length) setQueue(more.items);
        } catch {
          /* non-fatal */
        }
      }
    } catch (err) {
      console.warn('[Practice] Failed to grade card:', err);
    } finally {
      setGrading(false);
    }
  }, [queue, grading, stats, flipAnim]);

  const onMarkMastered = useCallback(async () => {
    if (queue.length === 0 || grading) return;
    const card = queue[0];
    setGrading(true);
    try {
      await toggleMastered(card._id);
      setQueue(queue.slice(1));
      setShowAnswer(false);
      flipAnim.setValue(0);
      if (stats) {
        setStats({
          ...stats,
          needsReview: Math.max(0, stats.needsReview - 1),
          mastered: stats.mastered + 1,
        });
      }
    } catch (err) {
      console.warn('[Practice] Failed to mark mastered:', err);
    } finally {
      setGrading(false);
    }
  }, [queue, grading, stats, flipAnim]);

  const card = queue[0];
  const progressLabel =
    queue.length > 0 ? `${queue.length} ${t('PRACTICE.QUEUE_REMAINING')}` : '';
  const statsLine = stats
    ? `${stats.mastered}/${stats.total} ${t('PRACTICE.MASTERED_LABEL')}`
    : '';

  const frontRotation = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotation = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });
  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('COMMON.BACK') as string}
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('PRACTICE.TITLE')}</Text>
          {!!progressLabel && (
            <Text style={styles.headerSub}>{progressLabel}</Text>
          )}
        </View>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      ) : queue.length === 0 ? (
        <FlatList
          data={[]}
          renderItem={null as any}
          keyExtractor={() => ''}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="checkmark-done" size={36} color={colors.text} />
              </View>
              <Text style={styles.emptyTitle}>{t('PRACTICE.EMPTY_TITLE')}</Text>
              <Text style={styles.emptyBody}>
                {stats?.total
                  ? t('PRACTICE.EMPTY_BODY_HAS_DECK', { count: stats.total })
                  : t('PRACTICE.EMPTY_BODY_NO_DECK')}
              </Text>
              {!!statsLine && <Text style={styles.emptyStat}>{statsLine}</Text>}
            </View>
          }
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.text}
            />
          }
        />
      ) : (
        <View style={styles.cardArea}>
          <Pressable onPress={onFlip} style={styles.cardWrap}>
            {/* FRONT — the mistake */}
            <Animated.View
              pointerEvents={showAnswer ? 'none' : 'auto'}
              style={[
                styles.card,
                styles.cardFront,
                {
                  transform: [{ rotateY: frontRotation }],
                  opacity: frontOpacity,
                },
              ]}
            >
              <Text style={styles.cardEyebrow}>
                {t('PRACTICE.FRONT_EYEBROW')}
              </Text>
              <Text style={styles.cardOriginal}>{card.original}</Text>
              {!!card.context && (
                <Text style={styles.cardContext}>“{card.context}”</Text>
              )}
              <Text style={styles.cardHint}>{t('PRACTICE.TAP_TO_REVEAL')}</Text>
            </Animated.View>

            {/* BACK — the correction */}
            <Animated.View
              pointerEvents={showAnswer ? 'auto' : 'none'}
              style={[
                styles.card,
                styles.cardBack,
                {
                  transform: [{ rotateY: backRotation }],
                  opacity: backOpacity,
                },
              ]}
            >
              <Text style={styles.cardEyebrow}>
                {t('PRACTICE.BACK_EYEBROW')}
              </Text>
              <Text style={styles.cardCorrected}>{card.corrected}</Text>
              {!!card.explanation && (
                <Text style={styles.cardExplanation}>{card.explanation}</Text>
              )}
            </Animated.View>
          </Pressable>

          {showAnswer ? (
            <View style={styles.gradeRow}>
              <GradeButton
                label={t('PRACTICE.GRADE_AGAIN') as string}
                sub={t('PRACTICE.GRADE_AGAIN_SUB') as string}
                onPress={() => onGrade('again')}
                disabled={grading}
                colors={colors}
                tone="again"
              />
              <GradeButton
                label={t('PRACTICE.GRADE_GOOD') as string}
                sub={t('PRACTICE.GRADE_GOOD_SUB') as string}
                onPress={() => onGrade('good')}
                disabled={grading}
                colors={colors}
                tone="good"
              />
              <GradeButton
                label={t('PRACTICE.GRADE_EASY') as string}
                sub={t('PRACTICE.GRADE_EASY_SUB') as string}
                onPress={() => onGrade('easy')}
                disabled={grading}
                colors={colors}
                tone="easy"
              />
            </View>
          ) : (
            <TouchableOpacity
              onPress={onFlip}
              style={styles.revealCta}
              accessibilityLabel={t('PRACTICE.SHOW_ANSWER') as string}
            >
              <Text style={styles.revealCtaText}>
                {t('PRACTICE.SHOW_ANSWER')}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onMarkMastered} style={styles.masteredBtn}>
            <Ionicons
              name="checkmark-circle-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text style={styles.masteredBtnText}>
              {t('PRACTICE.MARK_MASTERED')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

type GradeTone = 'again' | 'good' | 'easy';

function GradeButton({
  label,
  sub,
  onPress,
  disabled,
  colors,
  tone,
}: {
  label: string;
  sub: string;
  onPress: () => void;
  disabled: boolean;
  colors: ThemeColors;
  tone: GradeTone;
}) {
  const bg =
    tone === 'again'
      ? colors.isDark ? 'rgba(255,77,109,0.15)' : '#fff0f3'
      : tone === 'easy'
      ? colors.isDark ? 'rgba(52,211,153,0.15)' : '#ecfdf5'
      : colors.isDark ? 'rgba(255,255,255,0.08)' : '#f5f5f5';
  const fg =
    tone === 'again' ? colors.danger : tone === 'easy' ? colors.success : colors.text;

  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', marginBottom: 2, color: fg }}>{label}</Text>
      <Text style={{ fontSize: 11, fontWeight: '500', color: colors.textSecondary }}>{sub}</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },

    header: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    headerSub: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      marginTop: 2,
    },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    emptyContainer: { flexGrow: 1 },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingVertical: 64,
    },
    emptyIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    emptyTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    emptyBody: {
      fontSize: 15,
      fontWeight: '400',
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 12,
    },
    emptyStat: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textTertiary,
    },

    cardArea: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 24,
    },
    cardWrap: {
      flex: 1,
      marginBottom: 16,
    },
    card: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 28,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backfaceVisibility: 'hidden',
      // Soft elevation so the card lifts off the canvas.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
      elevation: 3,
    },
    cardFront: {},
    cardBack: {},

    cardEyebrow: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textTertiary,
      marginBottom: 16,
    },
    cardOriginal: {
      fontSize: 26,
      lineHeight: 34,
      fontWeight: '600',
      color: colors.text,
      textDecorationLine: 'line-through',
      textDecorationColor: colors.textTertiary,
    },
    cardCorrected: {
      fontSize: 26,
      lineHeight: 34,
      fontWeight: '700',
      color: colors.text,
    },
    cardContext: {
      marginTop: 16,
      fontSize: 14,
      fontStyle: 'italic',
      color: colors.textSecondary,
      lineHeight: 20,
    },
    cardExplanation: {
      marginTop: 16,
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    cardHint: {
      position: 'absolute',
      bottom: 18,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 12,
      fontWeight: '500',
      color: colors.textTertiary,
    },

    revealCta: {
      backgroundColor: colors.text,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 12,
    },
    revealCtaText: {
      color: colors.background,
      fontSize: 15,
      fontWeight: '700',
    },

    gradeRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12,
    },

    masteredBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    masteredBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
  });
