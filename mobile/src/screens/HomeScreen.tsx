import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useHomeTabBarOverlay } from '../contexts/HomeTabBarOverlayContext';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import {
  lessonService,
  buildTimelineEvents,
  TimelineEvent,
  Lesson,
  getLessonStart,
} from '../services/lessons';
import { earningsService, EarningsBalance } from '../services/earnings';
import { calendarService } from '../services/calendar';
import EarningsScreen from './EarningsScreen';
import MaterialsScreen from './MaterialsScreen';
import { preloadMaterials } from '../services/materials';

const { width: SCREEN_W } = Dimensions.get('window');
const CTA_DARK_BLUE = '#3a7bc8';
/** Match web `.upnext-filled-avatar` (80×80 @ 20px radius → 0.25 of side). */
const UP_NEXT_AVATAR_SIZE = 56;
const UP_NEXT_AVATAR_RADIUS = Math.round(UP_NEXT_AVATAR_SIZE * 0.25);
/**
 * Shared min height for Up Next filled + empty cards so the home stack (“This Week”, etc.)
 * shifts by the same amount. Empty state content (120px art + copy + CTA) is taller than
 * filled (avatar + meta + CTA); without this, filled stayed at 268px while empty grew past it.
 */
const UP_NEXT_CARD_MIN_HEIGHT = 328;

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
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { setHomeOverlayCoversTabBar } = useHomeTabBarOverlay();
  const userId = user?._id || user?.id || '';
  const isTutor = user?.userType === 'tutor';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsBalance>({ available: 0, pending: 0, lifetime: 0 });
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [materialsVisible, setMaterialsVisible] = useState(false);
  const materialsOverlayOpacity = useRef(new Animated.Value(0)).current;
  const [hasAvailability, setHasAvailability] = useState(false);

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

  const thisWeekAvatars = useMemo(() => {
    const seen = new Set<string>();
    return thisWeekLessons
      .map(l => l.studentId)
      .filter((s): s is NonNullable<typeof s> => !!s && !seen.has(s._id) && (seen.add(s._id), true))
      .slice(0, 4)
      .map(s => ({
        name: s.firstName || s.name || '',
        avatar: s.picture || null,
      }));
  }, [thisWeekLessons]);

  const fetchData = useCallback(async () => {
    const allLessons = await lessonService.getMyLessons();
    setLessons(allLessons);
    setTimeline(buildTimelineEvents(allLessons, userId));
  }, [userId]);

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

  useEffect(() => {
    (async () => {
      await Promise.all([fetchData(), fetchEarnings(), fetchAvailability()]);
      setLoading(false);
    })();
    if (isTutor) preloadMaterials();
  }, [fetchData, fetchEarnings, fetchAvailability, isTutor]);

  const openMaterials = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowMaterials(true);
    setMaterialsVisible(true);
    materialsOverlayOpacity.setValue(0);
    Animated.timing(materialsOverlayOpacity, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [materialsOverlayOpacity]);

  const closeMaterials = useCallback(() => {
    Animated.timing(materialsOverlayOpacity, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setShowMaterials(false);
      setMaterialsVisible(false);
    });
  }, [materialsOverlayOpacity]);

  useEffect(() => {
    setHomeOverlayCoversTabBar((showMaterials || showEarnings) && isFocused);
  }, [showMaterials, showEarnings, isFocused, setHomeOverlayCoversTabBar]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), fetchEarnings(), fetchAvailability()]);
    setRefreshing(false);
  }, [fetchData, fetchEarnings, fetchAvailability]);

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
    if (nextLesson?.countdown) return t('HOME.STARTS_IN_TIME', { time: nextLesson.countdown });
    if (!isTutor) return '';
    if (!hasAvailability) return t('HOME.WELCOME_SET_AVAILABILITY');
    if (hadLessonsToday) return t('HOME.WELCOME_GREAT_WORK');
    return t('HOME.WELCOME_OPEN_SCHEDULE');
  }, [nextLesson, isTutor, hasAvailability, hadLessonsToday, t]);

  return (
    <View style={{ flex: 1 }}>
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ── Toolbar ── */}
      <Toolbar
        user={user}
        onEarningsTap={() => setShowEarnings(true)}
        colors={colors}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ── */}
        <View style={styles.greeting}>
          <Text style={[styles.greetingTitle, { color: colors.text }]}>
            {getGreeting(t, displayName)}
          </Text>
          {loading ? (
            <Skeleton width={200} height={13} colors={colors} />
          ) : greetingSub ? (
            <Text style={[styles.greetingSub, { color: colors.textSecondary }]}>{greetingSub}</Text>
          ) : null}
        </View>

        {/* ── Up Next ── */}
        {loading ? (
          <UpNextSkeleton colors={colors} />
        ) : nextLesson ? (
          <UpNextFilled
            event={nextLesson}
            colors={colors}
            t={t}
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
              <TouchableOpacity style={[styles.thisWeekRow, { backgroundColor: colors.card, shadowOpacity: colors.isDark ? 0 : 0.04 }]} activeOpacity={0.7}>
                <View style={styles.avatarStack}>
                  {thisWeekAvatars.map((a, i) => (
                    <View key={i} style={[styles.stackAvatar, { marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i }]}>
                      {a.avatar ? (
                        <Image source={{ uri: a.avatar }} style={[styles.stackAvatarImg, { borderColor: colors.card }]} />
                      ) : (
                        <View style={[styles.stackAvatarImg, { backgroundColor: colors.isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center', borderColor: colors.card }]}>
                          <Text style={[styles.placeholderLetter, { color: colors.isDark ? '#ccc' : '#999' }]}>{a.name.charAt(0)}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
                <Text style={[styles.thisWeekCount, { color: colors.text }]}>
                  {thisWeekLessons.length} {thisWeekLessons.length === 1 ? t('HOME.LESSON_SINGULAR') : t('HOME.LESSON_PLURAL')}
                </Text>
                <Text style={[styles.chevron, { color: colors.isDark ? '#555' : '#ccc' }]}>›</Text>
              </TouchableOpacity>
            )}
          </Section>
          </View>
        )}

        {/* ── Quick Actions ── */}
        {!loading && (
          <View style={styles.quickActionsSectionWrap}>
          <Section title={t('HOME.QUICK_ACTIONS')} colors={colors}>
            <View style={styles.actionsRow}>
              <ActionChip image={require('../../assets/shared/classroom.png')} label={t('HOME.CLASSES')} colors={colors} />
              <ActionChip image={require('../../assets/shared/quick-actions-create-material.png')} label={t('HOME.CREATE_MATERIAL')} colors={colors} onPress={openMaterials} />
              <ActionChip image={require('../../assets/shared/quick-actions-forum.png')} label={t('HOME.FORUM')} colors={colors} />
            </View>
          </Section>
          </View>
        )}

        {/* ── Coming Up ── */}
        {!loading && timeline.length > 1 && (
          <Section title={t('HOME.COMING_UP')} rightLabel={t('HOME.FULL_SCHEDULE')} colors={colors}>
            {timeline.slice(1, 4).map(event => (
              <ComingUpRow key={event.lesson._id} event={event} colors={colors} t={t} />
            ))}
          </Section>
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
                      <Image source={{ uri: s.avatar }} style={styles.recentAvatar} />
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
    </SafeAreaView>
    {showEarnings && (
      <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
        <EarningsScreen goBack={() => setShowEarnings(false)} />
      </View>
    )}
    {materialsVisible && (
      <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50, opacity: materialsOverlayOpacity }]}>
        <MaterialsScreen goBack={closeMaterials} />
      </Animated.View>
    )}
    </View>
  );
}

/* ─── Toolbar ─── */

function Toolbar({ user, onEarningsTap, colors }: { user: any; onEarningsTap: () => void; colors: any }) {
  const isDark = colors.isDark;
  return (
    <View style={[styles.toolbar, { backgroundColor: colors.background }]}>
      <View style={styles.toolbarLeft}>
        <Image source={require('../../assets/shared/barnabi-bird.png')} style={styles.toolbarIcon} />
        <Text style={[styles.toolbarBrand, { color: colors.text }]}>Barnabi</Text>
      </View>
      <View style={styles.toolbarRight}>
        <TouchableOpacity style={[styles.earningsPill, { backgroundColor: isDark ? '#2a2a2a' : '#f2f2f7' }]} onPress={onEarningsTap} activeOpacity={0.7}>
          <Text style={[styles.earningsPillText, { color: colors.text }]}>$</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.notifBtn} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
        </TouchableOpacity>
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.toolbarAvatar} />
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
  onJoin,
}: {
  event: TimelineEvent;
  colors: any;
  t: any;
  onJoin: () => void;
}) {
  const isDark = colors.isDark;
  return (
    <View style={[styles.section, styles.upNextSectionSpacing]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('HOME.UP_NEXT')}</Text>
      <TouchableOpacity
        style={[
          styles.upNextCardSurface,
          styles.upNextCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowOpacity: isDark ? 0 : Platform.OS === 'ios' ? 0.16 : 0.12,
            elevation: isDark ? 0 : Platform.OS === 'android' ? 14 : 0,
          },
        ]}
        activeOpacity={0.85}
        onPress={onJoin}
      >
        <View style={styles.upNextAvatarWrap}>
          {event.avatar ? (
            <Image source={{ uri: event.avatar }} style={styles.upNextAvatarImage} />
          ) : (
            <View
              style={[
                styles.upNextAvatarImage,
                { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
              ]}
            >
              <Ionicons name="person" size={24} color={colors.textTertiary} />
            </View>
          )}
        </View>

        <Text style={[styles.cardTitle, { color: colors.text }]}>{event.name}</Text>

        {event.isTrialLesson && <UpNextTrialBadge label={t('HOME.STATUS_TRIAL')} />}

        <View style={styles.upNextFilledMetaWrap}>
          <Text style={[styles.cardMeta, styles.upNextFilledMeta, { color: colors.textSecondary }]}>
            <Text style={event.isToday ? styles.metaToday : undefined}>
              {event.isToday ? t('HOME.TODAY') : event.dateTag}
            </Text>
            {'  ·  '}{event.timeRange}
            {event.subject ? `  ·  ${event.subject}` : ''}
          </Text>

          {!!event.countdown && (
            <Text style={[styles.cardCountdown, styles.upNextFilledCountdown, { color: colors.textSecondary }]}>
              {t('HOME.STARTS_IN_TIME', { time: event.countdown })}
            </Text>
          )}
        </View>

        <View style={[styles.ctaBtn, styles.upNextCardCtaWide, styles.upNextFilledCta, { backgroundColor: isDark ? CTA_DARK_BLUE : '#000000' }]}>
          <Text style={styles.ctaBtnText}>{t('HOME.JOIN_LESSON')}</Text>
          <Image source={require('../../assets/shared/setup-availability-arrow.png')} style={styles.ctaBtnArrowImg} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

/* ─── Up Next: Empty ─── */

function UpNextEmpty({ colors, title, message, ctaLabel, onCta }: {
  colors: any; title: string; message: string; ctaLabel: string; onCta: () => void;
}) {
  const isDark = colors.isDark;
  const { t } = useTranslation();
  return (
    <View style={[styles.section, styles.upNextSectionSpacing]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('HOME.UP_NEXT')}</Text>
      <View
        style={[
          styles.upNextCardSurface,
          styles.upNextCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowOpacity: isDark ? 0 : Platform.OS === 'ios' ? 0.16 : 0.12,
            elevation: isDark ? 0 : Platform.OS === 'android' ? 14 : 0,
          },
        ]}
      >
        <Image source={require('../../assets/shared/calendar-mobile.png')} style={styles.emptyArtImg} />
        <Text
          style={[styles.cardTitle, styles.upNextEmptyTitleShift, { color: colors.text }]}
        >
          {title}
        </Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          {message}
        </Text>
        <TouchableOpacity
          style={[styles.ctaBtn, styles.upNextCardCtaWide, { backgroundColor: isDark ? CTA_DARK_BLUE : '#000000' }]}
          activeOpacity={0.85}
          onPress={onCta}
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
    <View style={[styles.section, styles.upNextSectionSpacing]}>
      <Skeleton width={80} height={15} style={{ marginBottom: 14 }} colors={colors} />
      <View
        style={[
          styles.upNextCardSurface,
          styles.upNextCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowOpacity: colors.isDark ? 0 : Platform.OS === 'ios' ? 0.16 : 0.12,
            elevation: colors.isDark ? 0 : Platform.OS === 'android' ? 14 : 0,
          },
        ]}
      >
        <View
          style={{
            width: UP_NEXT_AVATAR_SIZE,
            height: UP_NEXT_AVATAR_SIZE,
            borderRadius: UP_NEXT_AVATAR_RADIUS,
            backgroundColor: colors.skeleton,
            marginBottom: 12,
          }}
        />
        <Skeleton width={140} height={15} style={{ marginBottom: 8 }} colors={colors} />
        <Skeleton width={210} height={12} style={{ marginBottom: 8 }} colors={colors} />
        <Skeleton width={100} height={12} colors={colors} />
      </View>
    </View>
  );
}

/* ─── Coming Up Row ─── */

function ComingUpRow({ event, colors, t }: { event: TimelineEvent; colors: any; t: any }) {
  const isDark = colors.isDark;
  return (
    <TouchableOpacity style={[styles.comingUpRow, { backgroundColor: colors.card, shadowOpacity: isDark ? 0 : 0.04 }]} activeOpacity={0.7}>
      <View style={styles.cuLeft}>
        <Text style={[styles.cuDate, { color: colors.text }]}>{event.date}</Text>
        <Text style={[styles.cuTime, { color: colors.textSecondary }]}>{event.time}</Text>
        <Text style={[styles.cuDuration, { color: colors.textTertiary }]}>{event.duration} {t('HOME.MINS')}</Text>
      </View>
      <View style={styles.cuCenter}>
        {event.avatar ? (
          <Image source={{ uri: event.avatar }} style={styles.cuAvatar} />
        ) : (
          <View style={[styles.cuAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[styles.placeholderLetter, { color: isDark ? '#ccc' : '#999' }]}>{event.name.charAt(0)}</Text>
          </View>
        )}
        <Text style={[styles.cuName, { color: colors.text }]} numberOfLines={1}>{event.name}</Text>
      </View>
      <View style={[
        styles.cuBadge,
        { backgroundColor: isDark ? (event.isTrialLesson ? 'rgba(245,166,35,0.15)' : 'rgba(46,125,50,0.15)') : (event.isTrialLesson ? '#FFF8E1' : '#E8F5E9') },
      ]}>
        <Text style={[
          styles.cuBadgeText,
          { color: event.isTrialLesson ? (isDark ? '#fbbf24' : '#F5A623') : (isDark ? '#4ade80' : '#2E7D32') },
        ]}>
          {event.statusLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ─── Action Chip ─── */

function ActionChip({ image, label, colors, onPress }: { image: any; label: string; colors: any; onPress?: () => void }) {
  const isDark = colors.isDark;
  const lift = !isDark;
  return (
    <TouchableOpacity
      style={[
        styles.actionChip,
        {
          backgroundColor: isDark ? '#1c1c1e' : '#fff',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          shadowOpacity: lift ? (Platform.OS === 'ios' ? 0.045 : 0) : 0,
          elevation: lift && Platform.OS === 'android' ? 2 : 0,
        },
      ]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={styles.actionChipIconWrap}>
        <Image source={image} style={styles.actionChipImg} />
      </View>
      <Text style={[styles.actionChipLabel, { color: isDark ? colors.text : '#222' }]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ─── Skeleton ─── */

function Skeleton({ width, height, style, colors }: { width: number; height: number; style?: any; colors?: any }) {
  return <View style={[{ width, height, borderRadius: height / 2, backgroundColor: colors?.skeleton || '#f0f0f0' }, style]} />;
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
  content: { paddingHorizontal: 20, paddingBottom: 32 },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#f7f7f7',
  },
  toolbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolbarIcon: { width: 28, height: 28, borderRadius: 14 },
  toolbarBrand: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  toolbarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  earningsPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  earningsPillText: { fontSize: 15, fontWeight: '700', color: '#222' },
  notifBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  section: { marginBottom: 22 },
  /** Extra space below Up Next (card → This Week); overrides section marginBottom when combined. */
  upNextSectionSpacing: { marginBottom: 32 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 12, },
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
    padding: 24,
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
    paddingTop: 24,
    paddingBottom: 44,
    minHeight: UP_NEXT_CARD_MIN_HEIGHT,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    marginBottom: 4,
    textAlign: 'center',
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
    marginBottom: 8,
  },
  upNextFilledMeta: { marginBottom: 0 },
  upNextFilledCountdown: { marginTop: 6, marginBottom: 0 },
  /** Full width of card (parent uses horizontal padding); centers label + arrow. */
  upNextCardCtaWide: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  /** Space between meta block and Join on filled card (same card shell as empty; centered column). */
  upNextFilledCta: { marginTop: 28 },
  emptyArtImg: { width: 120, height: 120, resizeMode: 'contain', marginBottom: 4 },
  /** Up Next empty: nudge title toward art without shrinking layout (transform, not negative margins). */
  upNextEmptyTitleShift: { transform: [{ translateY: -14 }] },

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
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  upNextAvatarImage: { width: '100%', height: '100%' },

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

  // This Week (extra space below Up Next card)
  thisWeekSectionWrap: { marginTop: 22 },
  thisWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  avatarStack: { flexDirection: 'row', marginRight: 12 },
  stackAvatar: {},
  stackAvatarImg: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#fff' },
  thisWeekCount: { flex: 1, fontSize: 15, fontWeight: '600', color: '#222' },
  chevron: { fontSize: 22, color: '#ccc', fontWeight: '300' },

  // Quick Actions
  quickActionsSectionWrap: { marginTop: 16 },
  /** Compact row — lighter than Up Next hero card */
  actionsRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  actionChip: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 5,
  },
  actionChipIconWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionChipImg: { width: 56, height: 56, resizeMode: 'contain' },
  actionChipLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 13,
    letterSpacing: -0.15,
    paddingHorizontal: 2,
  },

  // Coming Up
  comingUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cuLeft: { width: 76 },
  cuDate: { fontSize: 12, fontWeight: '600', color: '#222' },
  cuTime: { fontSize: 11, color: '#717171', marginTop: 2 },
  cuDuration: { fontSize: 10, color: '#999', marginTop: 2 },
  cuCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 8 },
  cuAvatar: { width: 30, height: 30, borderRadius: 15 },
  cuName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222' },
  cuBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  cuBadgeTrial: { backgroundColor: '#FFF8E1' },
  cuBadgeText: { fontSize: 11, fontWeight: '600', color: '#2E7D32' },
  cuBadgeTextTrial: { color: '#F5A623' },

  // Recent Students (paddingTop so space isn’t lost to margin collapse with section above)
  recentStudentsSectionWrap: { paddingTop: 22 },
  recentScroll: { gap: 14 },
  recentItem: { alignItems: 'center', width: 60 },
  recentAvatar: { width: 48, height: 48, borderRadius: 24, marginBottom: 6 },
  recentName: { fontSize: 11, color: '#717171', textAlign: 'center' },

  // Shared placeholder
  placeholderCircle: { backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
  placeholderLetter: { fontSize: 13, fontWeight: '600', color: '#999' },
  placeholderLetterLg: { fontSize: 18, fontWeight: '600', color: '#999' },
});
