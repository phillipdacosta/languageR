import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
  findNodeHandle,
  UIManager,
  Animated as RNAnimated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
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
import { LessonDateHeaderCenter } from '../components/LessonDateHeaderCenter';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allLessons, setAllLessons] = useState<Lesson[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [overlayCard, setOverlayCard] = useState<ProcessedLessonCard | null>(null);
  const [overlayRect, setOverlayRect] = useState<CardRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [overlayClosing, setOverlayClosing] = useState(false);
  const cardRefs = useRef<Record<string, View | null>>({});

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

  const counts = useMemo(() => {
    const now = new Date();
    const upcoming = allLessons.filter(
      l =>
        (l.status === 'scheduled' || l.status === 'in_progress' || l.status === 'pending_reschedule') &&
        getLessonEnd(l) >= now,
    ).length;
    return {
      total: allLessons.length,
      upcoming,
      completed: allLessons.filter(l => l.status === 'completed').length,
      cancelled: allLessons.filter(l => l.status === 'cancelled').length,
    };
  }, [allLessons]);

  const filtered = useMemo(() => {
    const f = filterLessonsByStatus(allLessons, statusFilter);
    return sortLessonsNewestFirst(f);
  }, [allLessons, statusFilter]);

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

    const mocks: ProcessedLessonCard[] = [
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
        statusLabel: t('LESSONS_PAGE.STATUS_SCHEDULED'),
        cardDescMode: 'schedule',
        cardDescText: t('LESSONS_PAGE.LAST_SESSION_PREFIX') + 'Great progress with past tense conjugations — keep practicing irregular verbs.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$30', label: pri },
          { value: t('LESSONS_PAGE.STATUS_SCHEDULED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
      },
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
      },
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
      },
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
      },
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
      },
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
        statusLabel: t('LESSONS_PAGE.STATUS_SCHEDULED'),
        cardDescMode: 'schedule',
        cardDescText: t('LESSONS_PAGE.LAST_SESSION_PREFIX') + 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$0', label: rec },
          { value: t('LESSONS_PAGE.STATUS_SCHEDULED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
      },
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
        cardDescText: t('LESSONS_PAGE.TUTOR_FEEDBACK_NEEDED'),
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$20', label: rec },
          { value: t('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isCancelled: false,
      },
    ];
    // Only show mocks matching the logged-in user's account type
    const showRole = user?.userType === 'tutor' ? 'tutor' : 'student';
    const filteredMocks = mocks.filter(p => p.role === showRole);
    cards.unshift(...filteredMocks);
    // ── END MOCK ──

    return cards;
  }, [filtered, user, t, userTz]);

  const statItems: { key: 'total' | 'upcoming' | 'completed' | 'cancelled'; count: number }[] = [
    { key: 'total', count: counts.total },
    { key: 'upcoming', count: counts.upcoming },
    { key: 'completed', count: counts.completed },
    { key: 'cancelled', count: counts.cancelled },
  ];

  const statLabel = (k: (typeof statItems)[number]['key']) => {
    switch (k) {
      case 'total':
        return t('LESSONS_PAGE.STAT_TOTAL');
      case 'upcoming':
        return t('LESSONS_PAGE.STAT_UPCOMING');
      case 'completed':
        return t('LESSONS_PAGE.STAT_COMPLETED');
      case 'cancelled':
        return t('LESSONS_PAGE.STAT_CANCELLED');
      default:
        return k;
    }
  };

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

  const activeFilterCount = statusFilter !== 'all' ? 1 : 0;

  const openDetail = useCallback((pl: ProcessedLessonCard) => {
    const ref = cardRefs.current[pl.id];
    if (!ref) return;
    const handle = findNodeHandle(ref);
    if (!handle) return;
    UIManager.measure(handle, (_x, _y, w, h, px, py) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setOverlayRect({ x: px, y: py, width: w, height: h });
      setOverlayCard(pl);
      setLessonOverlayCoversTabBar(true);
    });
  }, [setLessonOverlayCoversTabBar]);

  const applyStatusFilter = (next: StatusFilter) => {
    setStatusFilter(next);
    setFiltersOpen(false);
  };

  const renderCard = ({ item: pl }: { item: ProcessedLessonCard }) => {
    const C = colors;
    const isHidden = overlayCard?.id === pl.id && !overlayClosing;
    return (
      <TouchableOpacity
        ref={(r) => { cardRefs.current[pl.id] = r as unknown as View; }}
        style={[
          styles.card,
          {
            backgroundColor: C.card,
            borderColor: C.border,
            opacity: isHidden ? 0 : pl.isCancelled ? 0.65 : 1,
            shadowOpacity: isHidden ? 0 : isDark ? 0 : Platform.OS === 'ios' ? 0.16 : 0.12,
            elevation: isHidden ? 0 : isDark ? 0 : Platform.OS === 'android' ? 14 : 0,
          },
        ]}
        activeOpacity={0.85}
        onPress={() => openDetail(pl)}
      >
        {pl.isClass && pl.classCoverUrl ? (
          <Image source={{ uri: pl.classCoverUrl }} style={styles.classCoverTop} resizeMode="cover" />
        ) : null}
        <View style={styles.avatarBlock}>
          {!pl.isClass ? (
            <View style={[styles.avatar, isDark && { backgroundColor: '#3a3a3c' }]}>
              {pl.otherPicture ? (
                <Image source={{ uri: pl.otherPicture }} style={styles.avatarImg} />
              ) : (
                <Text style={[styles.avatarInitials, { color: C.textSecondary }]}>{pl.otherInitials}</Text>
              )}
            </View>
          ) : pl.classAttendees.length > 1 ? (
            <View style={styles.stackRow}>
              {pl.classAttendees.map((att, i) => (
                <View
                  key={i}
                  style={[
                    styles.stackAv,
                    { marginLeft: i === 0 ? 0 : -12, borderColor: C.card, zIndex: 3 - i },
                  ]}
                >
                  {att.picture ? (
                    <Image source={{ uri: att.picture }} style={styles.stackImg} />
                  ) : (
                    <Text style={styles.stackIni}>{att.initials}</Text>
                  )}
                </View>
              ))}
              {pl.classAttendeesOverflow > 0 && (
                <Text style={[styles.stackMore, { color: C.textTertiary }]}>+{pl.classAttendeesOverflow}</Text>
              )}
            </View>
          ) : (
            <View style={[styles.avatar, isDark && { backgroundColor: '#3a3a3c' }]}>
              {pl.classAttendees.length === 1 && pl.classAttendees[0].picture ? (
                <Image source={{ uri: pl.classAttendees[0].picture }} style={styles.avatarImg} />
              ) : pl.classAttendees.length === 1 ? (
                <Text style={[styles.avatarInitials, { color: C.textSecondary }]}>
                  {pl.classAttendees[0].initials}
                </Text>
              ) : (
                <Ionicons name="people-outline" size={28} color={C.textTertiary} />
              )}
            </View>
          )}
        </View>

        <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>
          {pl.isClass ? pl.className || pl.lesson.subject : pl.otherName}
        </Text>
        {pl.isClass && pl.classEnrollmentLine ? (
          <Text style={[styles.classEnrollmentMeta, { color: C.textSecondary }]} numberOfLines={1}>
            {pl.classEnrollmentLine}
          </Text>
        ) : null}
        <View style={styles.dateTimeBlockOuter}>
          <LessonDateHeaderCenter
            dateBadgeMonth={pl.dateBadgeMonth}
            dateBadgeDay={pl.dateBadgeDay}
            timeLine={
              pl.isClass ? `${t('LESSONS_PAGE.CLASS')} · ${pl.formattedTime}` : pl.formattedTime
            }
            isDark={isDark}
            textPrimary={C.text}
            textSecondary={C.textSecondary}
          />
        </View>

        {(pl.isTrial || pl.tipSent) && (
          <View style={styles.badgesRow}>
            {pl.isTrial && (
              <View
                style={[
                  styles.trialPill,
                  isDark
                    ? { backgroundColor: 'rgba(255, 159, 10, 0.12)', borderColor: 'rgba(255, 159, 10, 0.22)' }
                    : { backgroundColor: 'rgba(255, 149, 0, 0.08)', borderColor: 'rgba(255, 149, 0, 0.2)' },
                ]}
              >
                <Text
                  style={[
                    styles.trialPillText,
                    { color: isDark ? '#FFB340' : '#9A3412' },
                  ]}
                >
                  {t('LESSONS_PAGE.TRIAL_BADGE')}
                </Text>
              </View>
            )}
            {pl.tipSent && (
              <View
                style={[
                  styles.tipPill,
                  { backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : '#ecfdf5' },
                ]}
              >
                <Text style={[styles.tipPillText, { color: '#047857' }]}>
                  {pl.role === 'tutor' ? t('LESSONS_PAGE.TIP_RECEIVED') : t('LESSONS_PAGE.TIP_SENT')}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.descBlock}>
          {pl.cardDescMode === 'analysis_generating' && (
            <AiGeneratingSpinner />
          )}
          {pl.cardDescMode === 'analysis_empty' && (
            <Text style={[styles.descText, { color: C.textSecondary }]}>
              {t('LESSONS_PAGE.CARD_DESC_EMPTY')}
            </Text>
          )}
          {(pl.cardDescMode === 'analysis' || pl.cardDescMode === 'schedule') && !!pl.cardDescText && (
            <Text style={[styles.descText, { color: C.textSecondary }]}>
              {pl.cardDescText}
            </Text>
          )}
        </View>

        <View style={[styles.sep, { borderTopColor: isDark ? C.border : '#EBEBEB' }]} />

        <View style={styles.cardFooterStats}>
          {pl.cardStats.map((st, i) => (
            <View key={i} style={styles.cardFooterStatCol}>
              <Text style={[styles.cardFooterStatVal, { color: C.text }]} numberOfLines={1}>
                {st.value}
              </Text>
              <Text style={[styles.cardFooterStatLbl, { color: C.textTertiary }]} numberOfLines={1}>
                {st.label}
              </Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  const showInitialLoading = loading && allLessons.length === 0;

  const listHeader = (
    <View>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('LESSONS_PAGE.PAGE_TITLE')}</Text>

      <View style={styles.summaryRow}>
        {statItems.map(({ key, count }, i) => {
          const numStr = showInitialLoading ? '–' : String(count);
          const dotColor =
            key === 'upcoming' ? '#34C759' :
            key === 'completed' ? (isDark ? '#a78bfa' : '#7c3aed') :
            key === 'cancelled' ? '#FF385C' :
            colors.textTertiary;
          const numColor =
            key === 'cancelled' && !showInitialLoading && count > 0 ? '#FF385C' : colors.text;
          return (
            <React.Fragment key={key}>
              {i > 0 && <View style={[styles.statDivider, { backgroundColor: colors.border }]} />}
              <View style={styles.statCell}>
                <Text style={[styles.summaryNumber, { color: numColor }]} numberOfLines={1}>
                  {numStr}
                </Text>
                <View style={styles.statLabelRow}>
                  <View style={[styles.statDot, { backgroundColor: dotColor }]} />
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                    {statLabel(key)}
                  </Text>
                </View>
              </View>
            </React.Fragment>
          );
        })}
      </View>

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
            <Ionicons name="options-outline" size={20} color={colors.text} />
            <Text style={[styles.filtersBtnText, { color: colors.text }]}>{t('LESSONS_PAGE.FILTERS')}</Text>
          </TouchableOpacity>
          {activeFilterCount > 0 && (
            <View style={[styles.filtersBadge, { backgroundColor: colors.text }]}>
              <Text style={[styles.filtersBadgeText, { color: colors.background }]}>{activeFilterCount}</Text>
            </View>
          )}
        </View>

        {statusFilter !== 'all' && (
          <>
            <View style={[styles.filterPreviewChip, { backgroundColor: colors.inputBg }]}>
              <Text style={[styles.filterPreviewText, { color: colors.text }]} numberOfLines={1}>
                {filterModalLabel(statusFilter)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setStatusFilter('all')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.clearAll, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.CLEAR_ALL')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  const statusModalOptions: StatusFilter[] = ['all', 'upcoming', 'completed', 'cancelled'];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <FlatList
        data={processed}
        keyExtractor={item => item.id}
        renderItem={renderCard}
        ListHeaderComponent={listHeader}
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

      <Modal
        visible={filtersOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFiltersOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setFiltersOpen(false)} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.modalGrab, { backgroundColor: colors.border }]} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('LESSONS_PAGE.MODAL_FILTERS_TITLE')}</Text>
            <Text style={[styles.modalSection, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.STATUS')}</Text>
            <View style={styles.modalOptions}>
              {statusModalOptions.map(opt => {
                const selected = statusFilter === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.modalOption,
                      {
                        backgroundColor: selected ? colors.text : colors.inputBg,
                        borderColor: selected ? colors.text : colors.border,
                      },
                    ]}
                    onPress={() => applyStatusFilter(opt)}
                    activeOpacity={0.9}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: selected ? colors.background : colors.text },
                      ]}
                    >
                      {filterModalLabel(opt)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.modalCloseRow} onPress={() => setFiltersOpen(false)}>
              <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.CLOSE')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {overlayCard && (
        <LessonDetailOverlay
          card={overlayCard}
          cardRect={overlayRect}
          onCloseStart={() => setOverlayClosing(true)}
          onCloseEnd={() => {
            setOverlayCard(null);
            setOverlayClosing(false);
            setLessonOverlayCoversTabBar(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    paddingHorizontal: CONTENT_PAD,
    marginBottom: 24,
    letterSpacing: -0.5,
  },

  // ── Stats row ──
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: CONTENT_PAD,
    marginBottom: 28,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    opacity: 0.5,
  },
  summaryNumber: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  summaryLabel: { fontSize: 12, fontWeight: '500' },

  // ── Filters bar ──
  filtersBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    rowGap: 10,
    paddingHorizontal: CONTENT_PAD,
    marginTop: 8,
    marginBottom: 20,
  },
  filtersBtnWrap: { position: 'relative', alignSelf: 'flex-start' },
  filtersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  filtersBtnText: { fontSize: 14, fontWeight: '600' },
  filtersBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  filtersBadgeText: { fontSize: 12, fontWeight: '600' },
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

  // ── List ──
  listContent: { paddingHorizontal: CONTENT_PAD, paddingBottom: 32 },
  listEmpty: { flexGrow: 1 },

  // ── Card — copy of HomeScreen upNextCardSurface ──
  // Single View, overflow visible so shadow renders on iOS.
  // Content (text, avatars with own clip) doesn't bleed past radius.
  classCoverTop: {
    alignSelf: 'stretch',
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: '#e8e8ea',
  },
  classEnrollmentMeta: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 6,
    marginTop: -2,
    paddingHorizontal: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 28,
    padding: 24,
    paddingTop: 32,
    paddingBottom: 28,
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 28,
    shadowOpacity: 0.14,
    elevation: 14,
    marginBottom: 24,
    marginHorizontal: 12,
  },

  avatarBlock: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 14,
  },
  dateTimeBlockOuter: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8e8',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: { fontSize: 26, fontWeight: '600' },
  stackRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  stackAv: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: '#e8e8e8',
  },
  stackImg: { width: '100%', height: '100%' },
  stackIni: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 44, backgroundColor: '#222', color: '#fff' },
  stackMore: { marginLeft: 10, fontSize: 14, fontWeight: '600' },

  // ── Title / date + time ──
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3, marginBottom: 6 },

  // ── Badges ──
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 8 },
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
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  descText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
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
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
