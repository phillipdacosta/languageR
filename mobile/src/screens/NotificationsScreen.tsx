import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  RefreshControl,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { stripSimpleHtml } from '../utils/stripSimpleHtml';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '../services/notifications';
import { socketService } from '../services/socket';

const PAGE = 50;

function isToday(d: string | Date): boolean {
  const t = new Date(d);
  const n = new Date();
  return t.toDateString() === n.toDateString();
}

function isYesterday(d: string | Date): boolean {
  const t = new Date(d);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return t.toDateString() === y.toDateString();
}

function formatRowTime(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffM / 60);
  if (isToday(createdAt)) {
    if (diffM < 1) return 'now';
    if (diffM < 60) return `${diffM}m`;
    if (diffH < 24) return `${diffH}h`;
  }
  if (isYesterday(createdAt)) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Section = { title: string; data: AppNotification[] };

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark: themeIsDark } = useTheme();
  const { t } = useTranslation();

  const [list, setList] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [oldestId, setOldestId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const { shellMotion, listGateMotion } = useScreenEntranceAnimations(loading);
  /**
   * Authoritative unread total from the backend (same endpoint Home uses for
   * the bell badge). The count in the sticky header must reflect the DB
   * total, NOT `list.filter(!read)` — the list is paginated (50 items), so
   * counting it locally was undercounting whenever the user had more unreads
   * than a single page, causing drift vs the Home badge.
   */
  const [totalUnread, setTotalUnread] = useState(0);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await getUnreadCount();
      if (res?.success) setTotalUnread(Math.max(0, res.count || 0));
    } catch {
      // non-fatal: header falls back to whatever we had
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    setOldestId(null);
    try {
      const [listRes] = await Promise.all([
        getNotifications(PAGE),
        refreshUnreadCount(),
      ]);
      if (listRes.success && listRes.notifications) {
        setList(listRes.notifications);
        if (listRes.notifications.length > 0) {
          setOldestId(listRes.notifications[listRes.notifications.length - 1]._id);
          setHasMore(listRes.notifications.length >= PAGE);
        } else {
          setHasMore(false);
        }
      }
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [refreshUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      void loadInitial();
    }, [loadInitial]),
  );

  /**
   * Realtime: prepend new notifications as they arrive. The backend emits
   * `new_notification` to `user:{auth0Id}` from the paths that create
   * notifications (see `backend/routes/{classes,lessons,admin,...}.js`).
   * Payload shape is tolerant — some emits send the saved `Notification`
   * document, others send a lightweight `{ type, title, message }`. We
   * upgrade any missing fields with sensible defaults so the row renders.
   */
  useEffect(() => {
    const off = socketService.on('new_notification', (raw: any) => {
      if (!raw || typeof raw !== 'object') return;
      const incoming: AppNotification = {
        _id:
          raw._id ||
          raw.id ||
          raw.notificationId ||
          `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: raw.type || 'message',
        title: raw.title || '',
        message: raw.message || '',
        data: raw.data,
        relatedUserPicture: raw.relatedUserPicture,
        read: raw.read === true,
        readAt: raw.readAt || null,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt,
      };
      if (!incoming.title && !incoming.message) return;
      let added = false;
      setList((prev) => {
        if (prev.some((n) => n._id === incoming._id)) return prev;
        added = true;
        return [incoming, ...prev];
      });
      if (added && !incoming.read) setTotalUnread((c) => c + 1);
    });
    return off;
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadInitial();
    setRefreshing(false);
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestId) return;
    setLoadingMore(true);
    try {
      const res = await getNotifications(PAGE, oldestId);
      if (res.success && res.notifications?.length) {
        setList((prev) => {
          const seen = new Set(prev.map((n) => n._id));
          const next = [...prev];
          for (const n of res.notifications) {
            if (!seen.has(n._id)) {
              seen.add(n._id);
              next.push(n);
            }
          }
          return next;
        });
        const last = res.notifications[res.notifications.length - 1];
        setOldestId(last._id);
        setHasMore(res.notifications.length >= PAGE);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, oldestId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) => {
      const title = (n.title || '').toLowerCase();
      const msg = stripSimpleHtml(n.message || '').toLowerCase();
      return title.includes(q) || msg.includes(q);
    });
  }, [list, search]);

  const sections = useMemo((): Section[] => {
    const today: AppNotification[] = [];
    const yesterday: AppNotification[] = [];
    const earlier: AppNotification[] = [];
    for (const n of filtered) {
      if (isToday(n.createdAt)) today.push(n);
      else if (isYesterday(n.createdAt)) yesterday.push(n);
      else earlier.push(n);
    }
    const out: Section[] = [];
    if (today.length) out.push({ title: t('NOTIFICATIONS.TODAY'), data: today });
    if (yesterday.length) out.push({ title: t('NOTIFICATIONS.YESTERDAY'), data: yesterday });
    if (earlier.length) out.push({ title: t('NOTIFICATIONS.EARLIER'), data: earlier });
    return out;
  }, [filtered, t]);

  const onMarkAll = useCallback(async () => {
    if (totalUnread === 0 || markingAll) return;
    setMarkingAll(true);
    const prevTotal = totalUnread;
    setTotalUnread(0);
    try {
      await markAllNotificationsRead();
      setList((prev) => prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })));
    } catch {
      setTotalUnread(prevTotal);
    } finally {
      setMarkingAll(false);
    }
  }, [totalUnread, markingAll]);

  const onPressItem = useCallback(
    async (n: AppNotification) => {
      if (n.read) return;
      const readAt = new Date().toISOString();
      const before = n;
      setList((prev) =>
        prev.map((x) => (x._id === n._id ? { ...x, read: true, readAt } : x)),
      );
      setTotalUnread((c) => Math.max(0, c - 1));
      try {
        const res = await markNotificationRead(n._id);
        if (!res.success) {
          setList((prev) => prev.map((x) => (x._id === n._id ? before : x)));
          setTotalUnread((c) => c + 1);
        }
      } catch {
        setList((prev) => prev.map((x) => (x._id === n._id ? before : x)));
        setTotalUnread((c) => c + 1);
      }
    },
    [],
  );

  const pageBg = themeIsDark ? colors.background : '#F5F5F7';
  const cardBg = themeIsDark ? colors.card : '#FFFFFF';
  const border = themeIsDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={[styles.root, { backgroundColor: pageBg }]}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Animated.View style={shellMotion}>
        <View
          style={[
            styles.stickyHeader,
            {
              backgroundColor: pageBg,
              borderBottomColor: border,
            },
          ]}
        >
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('COMMON.BACK')}
            >
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.titleWrap}>
              <Text style={[styles.pageTitle, { color: colors.text }]} numberOfLines={1}>
                {t('NOTIFICATIONS.TITLE')}
              </Text>
              {totalUnread > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
                </View>
              ) : null}
            </View>
            {totalUnread > 0 ? (
              <TouchableOpacity
                onPress={onMarkAll}
                disabled={markingAll}
                style={[
                  styles.markAllBtn,
                  {
                    backgroundColor: themeIsDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                    borderColor: themeIsDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                  },
                ]}
                activeOpacity={0.7}
              >
                {markingAll ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={[styles.markAllText, { color: colors.accent }]} numberOfLines={2}>
                    {t('NOTIFICATIONS.MARK_ALL_READ')}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.markAllPlaceholder} />
            )}
          </View>
          <View style={styles.searchOuter}>
            <View
              style={[
                styles.searchShell,
                {
                  backgroundColor: themeIsDark ? 'rgba(255,255,255,0.08)' : '#fff',
                  borderColor: themeIsDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textSecondary} style={styles.searchIcon} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('NOTIFICATIONS.SEARCH_PLACEHOLDER')}
                placeholderTextColor={colors.textTertiary}
                style={[styles.searchInput, { color: colors.text }]}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setSearch('')}
                  style={styles.searchClearBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('NOTIFICATIONS.CLEAR_SEARCH')}
                >
                  <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
        </Animated.View>

        <Animated.View style={[{ flex: 1 }, listGateMotion]}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={[styles.muted, { color: colors.textSecondary, marginTop: 12 }]}>
              {t('NOTIFICATIONS.LOADING')}
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item._id}
            renderItem={({ item, index, section }) => {
              const isLast = index === section.data.length - 1;
              const isFirst = index === 0;
              return (
                <TouchableOpacity
                  style={[
                    styles.itemRow,
                    {
                      backgroundColor: cardBg,
                      borderBottomColor: isLast ? 'transparent' : border,
                      borderTopLeftRadius: isFirst ? 12 : 0,
                      borderTopRightRadius: isFirst ? 12 : 0,
                      borderBottomLeftRadius: isLast ? 12 : 0,
                      borderBottomRightRadius: isLast ? 12 : 0,
                    },
                    !item.read && {
                      backgroundColor: themeIsDark ? 'rgba(0,122,255,0.08)' : 'rgba(0,122,255,0.05)',
                    },
                  ]}
                  onPress={() => onPressItem(item)}
                  activeOpacity={0.65}
                >
                  {item.relatedUserPicture ? (
                    <Image source={{ uri: item.relatedUserPicture }} style={styles.avatar} />
                  ) : (
                    <View
                      style={[
                        styles.avatar,
                        styles.avatarPh,
                        { backgroundColor: themeIsDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
                      ]}
                    >
                      <Ionicons name="notifications-outline" size={22} color={colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.itemBody}>
                    <View style={styles.itemTop}>
                      <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={[styles.itemTime, { color: colors.textTertiary }]}>
                        {formatRowTime(item.createdAt)}
                      </Text>
                    </View>
                    <Text style={[styles.itemMsg, { color: colors.textSecondary }]} numberOfLines={3}>
                      {stripSimpleHtml(item.message)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            renderSectionHeader={({ section: { title } }) => (
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="notifications-off-outline" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('NOTIFICATIONS.EMPTY_TITLE')}</Text>
                <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                  {search.trim() ? t('NOTIFICATIONS.EMPTY_SEARCH') : t('NOTIFICATIONS.EMPTY_DEFAULT')}
                </Text>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoad}>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 8 }}>
                    {t('NOTIFICATIONS.LOADING_MORE')}
                  </Text>
                </View>
              ) : null
            }
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: Math.max(insets.bottom, 24) + 16,
            }}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
            }
          />
        )}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  stickyHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    marginBottom: 4,
  },
  backBtn: { width: 40, justifyContent: 'center' },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 8, gap: 8, minWidth: 0 },
  pageTitle: { fontSize: 24, fontWeight: '600', letterSpacing: -0.3, flexShrink: 1 },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#007AFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 3 },
    }),
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  markAllBtn: {
    maxWidth: 132,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  markAllPlaceholder: { width: 100, minWidth: 100 },
  markAllText: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  searchOuter: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  searchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 50,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: Platform.OS === 'ios' ? 12 : 8, minHeight: 44 },
  searchClearBtn: {
    marginLeft: 6,
    justifyContent: 'center',
    alignItems: 'center',
    width: 28,
    height: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 0,
  },
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
  },
  avatar: { width: 44, height: 44, borderRadius: 12, marginRight: 12 },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  itemBody: { flex: 1, minWidth: 0 },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  itemTitle: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  itemTime: { fontSize: 12, fontWeight: '500' },
  itemMsg: { fontSize: 14, lineHeight: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  muted: { fontSize: 15 },
  empty: { paddingTop: 48, paddingHorizontal: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16, textAlign: 'center' },
  emptySub: { fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: 'center' },
  footerLoad: { paddingVertical: 20, alignItems: 'center' },
});
