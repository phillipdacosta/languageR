import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { lessonService, buildTimelineEvents, TimelineEvent, Lesson } from '../services/lessons';
import { earningsService, EarningsBalance } from '../services/earnings';
import EarningsScreen from './EarningsScreen';

const { width: SCREEN_W } = Dimensions.get('window');

export default function HomeScreen() {
  const { user } = useAuth();
  const userId = user?._id || user?.id || '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsBalance>({ available: 0, pending: 0, lifetime: 0 });
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);

  const displayName = user?.firstName || user?.name?.split(' ')[0] || 'there';
  const nextLesson = timeline[0] || null;

  const thisWeekLessons = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
    weekEnd.setHours(23, 59, 59, 999);
    return lessons.filter(l => {
      if (l.status !== 'scheduled') return false;
      const d = new Date(l.scheduledTime);
      return d >= now && d <= weekEnd;
    });
  }, [lessons]);

  const recentStudents = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string; avatar: string | null }[] = [];
    const sorted = [...lessons]
      .filter(l => l.status === 'completed' || l.status === 'scheduled')
      .sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());

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

  useEffect(() => {
    (async () => {
      await Promise.all([fetchData(), fetchEarnings()]);
      setLoading(false);
    })();
  }, [fetchData, fetchEarnings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), fetchEarnings()]);
    setRefreshing(false);
  }, [fetchData, fetchEarnings]);

  if (showEarnings) {
    return <EarningsScreen goBack={() => setShowEarnings(false)} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Toolbar ── */}
      <Toolbar
        user={user}
        onEarningsTap={() => setShowEarnings(true)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#999" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ── */}
        <View style={styles.greeting}>
          <Text style={styles.greetingTitle}>
            {getGreeting()}, {displayName}
          </Text>
          {loading ? (
            <Skeleton width={200} height={13} />
          ) : nextLesson?.countdown ? (
            <Text style={styles.greetingSub}>Next lesson in {nextLesson.countdown}</Text>
          ) : (
            <Text style={styles.greetingSub}>Set your availability to start getting bookings.</Text>
          )}
        </View>

        {/* ── Up Next ── */}
        {loading ? (
          <UpNextSkeleton />
        ) : nextLesson ? (
          <UpNextFilled event={nextLesson} />
        ) : (
          <UpNextEmpty />
        )}

        {/* ── This Week ── */}
        {!loading && (
          <Section title="This Week">
            {thisWeekLessons.length === 0 ? (
              <Text style={styles.emptyText}>Nothing yet</Text>
            ) : (
              <TouchableOpacity style={styles.thisWeekRow} activeOpacity={0.7}>
                <View style={styles.avatarStack}>
                  {thisWeekAvatars.map((a, i) => (
                    <View key={i} style={[styles.stackAvatar, { marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i }]}>
                      {a.avatar ? (
                        <Image source={{ uri: a.avatar }} style={styles.stackAvatarImg} />
                      ) : (
                        <View style={[styles.stackAvatarImg, styles.placeholderCircle]}>
                          <Text style={styles.placeholderLetter}>{a.name.charAt(0)}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
                <Text style={styles.thisWeekCount}>
                  {thisWeekLessons.length} {thisWeekLessons.length === 1 ? 'lesson' : 'lessons'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
          </Section>
        )}

        {/* ── Quick Actions ── */}
        {!loading && (
          <Section title="Quick Actions">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsScroll}>
              <ActionChip image={require('../../assets/shared/quick-actions-classes.png')} label="Classes" />
              <ActionChip image={require('../../assets/shared/quick-actions-create-material.png')} label="Create Material" />
              <ActionChip image={require('../../assets/shared/quick-actions-forum.png')} label="Forum" />
            </ScrollView>
          </Section>
        )}

        {/* ── Coming Up ── */}
        {!loading && timeline.length > 1 && (
          <Section title="Coming Up" rightLabel="Full Schedule">
            {timeline.slice(1, 4).map(event => (
              <ComingUpRow key={event.lesson._id} event={event} />
            ))}
          </Section>
        )}

        {/* ── Recent Students ── */}
        {!loading && (
          <Section title="Recent Students">
            {recentStudents.length === 0 ? (
              <Text style={styles.emptyText}>No recent students yet</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentScroll}>
                {recentStudents.map(s => (
                  <View key={s.id} style={styles.recentItem}>
                    {s.avatar ? (
                      <Image source={{ uri: s.avatar }} style={styles.recentAvatar} />
                    ) : (
                      <View style={[styles.recentAvatar, styles.placeholderCircle]}>
                        <Text style={styles.placeholderLetterLg}>{s.name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={styles.recentName} numberOfLines={1}>{s.name}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </Section>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Toolbar ─── */

function Toolbar({ user, onEarningsTap }: { user: any; onEarningsTap: () => void }) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.toolbarLeft}>
        <Image source={require('../../assets/shared/barnabi-bird.png')} style={styles.toolbarIcon} />
        <Text style={styles.toolbarBrand}>Barnabi</Text>
      </View>
      <View style={styles.toolbarRight}>
        <TouchableOpacity style={styles.earningsPill} onPress={onEarningsTap} activeOpacity={0.7}>
          <Text style={styles.earningsPillText}>$</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.notifBtn} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={20} color="#222" />
        </TouchableOpacity>
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.toolbarAvatar} />
        ) : (
          <View style={[styles.toolbarAvatar, styles.placeholderCircle]}>
            <Text style={styles.toolbarAvatarLetter}>
              {(user?.firstName || user?.name || 'U').charAt(0)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ─── Section wrapper ─── */

function Section({ title, rightLabel, children }: { title: string; rightLabel?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {rightLabel && (
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.seeAllText}>{rightLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

/* ─── Up Next: Filled ─── */

function UpNextFilled({ event }: { event: TimelineEvent }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Up Next</Text>
      <TouchableOpacity style={styles.card} activeOpacity={0.85}>
        <View style={styles.upNextAvatarWrap}>
          {event.avatar ? (
            <Image source={{ uri: event.avatar }} style={styles.upNextAvatar} />
          ) : (
            <View style={[styles.upNextAvatar, styles.placeholderCircle]}>
              <Ionicons name="person" size={24} color="#b0b0b0" />
            </View>
          )}
        </View>

        <Text style={styles.cardTitle}>{event.name}</Text>

        {event.isTrialLesson && (
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>⭐ Trial</Text>
          </View>
        )}

        <Text style={styles.cardMeta}>
          <Text style={event.isToday ? styles.metaToday : undefined}>
            {event.isToday ? 'Today' : event.dateTag}
          </Text>
          {'  ·  '}{event.timeRange}
          {event.subject ? `  ·  ${event.subject}` : ''}
        </Text>

        {!!event.countdown && (
          <Text style={styles.cardCountdown}>Starts in {event.countdown}</Text>
        )}

        <View style={styles.ctaBtn}>
          <Text style={styles.ctaBtnText}>Join Lesson</Text>
          <Image source={require('../../assets/shared/setup-availability-arrow.png')} style={styles.ctaBtnArrowImg} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

/* ─── Up Next: Empty ─── */

function UpNextEmpty() {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Up Next</Text>
      <View style={styles.card}>
        <Image source={require('../../assets/shared/calendar-availability.png')} style={styles.emptyArtImg} />
        <Text style={styles.cardTitle}>Your schedule is clear</Text>
        <Text style={styles.cardSubtitle}>
          Set your availability so students can discover and book you.
        </Text>
        <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.85}>
          <Text style={styles.ctaBtnText}>Set Availability</Text>
          <Image source={require('../../assets/shared/setup-availability-arrow.png')} style={styles.ctaBtnArrowImg} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Up Next: Skeleton ─── */

function UpNextSkeleton() {
  return (
    <View style={styles.section}>
      <Skeleton width={80} height={15} style={{ marginBottom: 14 }} />
      <View style={styles.card}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#f0f0f0', marginBottom: 12 }} />
        <Skeleton width={140} height={15} style={{ marginBottom: 8 }} />
        <Skeleton width={210} height={12} style={{ marginBottom: 8 }} />
        <Skeleton width={100} height={12} />
      </View>
    </View>
  );
}

/* ─── Coming Up Row ─── */

function ComingUpRow({ event }: { event: TimelineEvent }) {
  return (
    <TouchableOpacity style={styles.comingUpRow} activeOpacity={0.7}>
      <View style={styles.cuLeft}>
        <Text style={styles.cuDate}>{event.date}</Text>
        <Text style={styles.cuTime}>{event.time}</Text>
        <Text style={styles.cuDuration}>{event.duration} min</Text>
      </View>
      <View style={styles.cuCenter}>
        {event.avatar ? (
          <Image source={{ uri: event.avatar }} style={styles.cuAvatar} />
        ) : (
          <View style={[styles.cuAvatar, styles.placeholderCircle]}>
            <Text style={styles.placeholderLetter}>{event.name.charAt(0)}</Text>
          </View>
        )}
        <Text style={styles.cuName} numberOfLines={1}>{event.name}</Text>
      </View>
      <View style={[styles.cuBadge, event.isTrialLesson && styles.cuBadgeTrial]}>
        <Text style={[styles.cuBadgeText, event.isTrialLesson && styles.cuBadgeTextTrial]}>
          {event.statusLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ─── Action Chip ─── */

function ActionChip({ image, label }: { image: any; label: string }) {
  return (
    <TouchableOpacity style={styles.actionChip} activeOpacity={0.7}>
      <Image source={image} style={styles.actionChipImg} />
      <Text style={styles.actionChipLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ─── Skeleton ─── */

function Skeleton({ width, height, style }: { width: number; height: number; style?: any }) {
  return <View style={[{ width, height, borderRadius: height / 2, backgroundColor: '#f0f0f0' }, style]} />;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
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
  greetingSub: { fontSize: 14, color: '#717171', marginTop: 4, lineHeight: 20 },

  // Section
  section: { marginBottom: 22 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  seeAllText: { fontSize: 13, fontWeight: '600', color: '#717171' },
  emptyText: { fontSize: 14, color: '#999' },

  // Card (shared)
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 22,
    padding: 24,
    paddingTop: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
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
  emptyArtImg: { width: 120, height: 120, resizeMode: 'contain', marginBottom: 4 },

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

  // Up Next avatar
  upNextAvatarWrap: { marginBottom: 10 },
  upNextAvatar: { width: 56, height: 56, borderRadius: 28 },

  // Trial badge
  trialBadge: {
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 100,
    marginBottom: 6,
  },
  trialBadgeText: { fontSize: 10, fontWeight: '700', color: '#F5A623', letterSpacing: 0.3, textTransform: 'uppercase' },

  // This Week
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
  actionsScroll: { gap: 10 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 50,
    paddingHorizontal: 18,
    paddingVertical: 11,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  actionChipImg: { width: 28, height: 28, resizeMode: 'contain' },
  actionChipLabel: { fontSize: 13, fontWeight: '600', color: '#222' },

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

  // Recent Students
  recentScroll: { gap: 14 },
  recentItem: { alignItems: 'center', width: 60 },
  recentAvatar: { width: 48, height: 48, borderRadius: 24, marginBottom: 6 },
  recentName: { fontSize: 11, color: '#717171', textAlign: 'center' },

  // Shared placeholder
  placeholderCircle: { backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
  placeholderLetter: { fontSize: 13, fontWeight: '600', color: '#999' },
  placeholderLetterLg: { fontSize: 18, fontWeight: '600', color: '#999' },
});
