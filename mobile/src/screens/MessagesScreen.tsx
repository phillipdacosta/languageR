import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { messagingService, Conversation } from '../services/messaging';
import { socketService } from '../services/socket';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';
import StaggerRow from '../components/StaggerRow';
import ChatScreen from './ChatScreen';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Filter = 'all' | 'unread';

export default function MessagesScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = user?.auth0Id || user?._id || user?.id || '';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Conversation | null>(null);
  const navigation = useNavigation();
  const route = useRoute();
  const { shellMotion, listGateMotion } = useScreenEntranceAnimations(loading);

  // Deep link params — e.g., coming back from ClassGoingMessageModal via
  // navigation.navigate('Messages', { groupId } | { userId }).
  const routeGroupId = (route.params as { groupId?: string } | undefined)?.groupId;
  const routeUserId = (route.params as { userId?: string } | undefined)?.userId;

  useLayoutEffect(() => {
    navigation.setOptions({
      tabBarStyle: selected
        ? { display: 'none' as const }
        : {
            backgroundColor: colors.tabBar,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.tabBarBorder,
            height: 88,
            paddingTop: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 5,
          },
    });
  }, [selected, navigation, colors]);

  /**
   * Fetch conversations and pre-compute avatar cluster fields for groups so the
   * list row can stay function-free when we render stacked avatars.
   */
  const fetchConversations = useCallback(async () => {
    const data = await messagingService.getConversations();
    const decorated = data.map((c) => {
      if (!c.isGroup) return c;
      const all = Array.isArray(c.participants) ? c.participants : [];
      // Put "me" last so other people show first in the cluster.
      const others = all.filter((p) => p.auth0Id !== userId);
      const me = all.filter((p) => p.auth0Id === userId);
      const ordered = [...others, ...me];
      if (ordered.length > 4) {
        return { ...c, displayParticipants: ordered.slice(0, 3), extraCount: ordered.length - 3 };
      }
      return { ...c, displayParticipants: ordered, extraCount: 0 };
    });
    setConversations(decorated);
    return decorated;
  }, [userId]);

  useEffect(() => {
    (async () => { await fetchConversations(); setLoading(false); })();
  }, [fetchConversations]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  /**
   * Realtime: bump the matching conversation (last message + unread count)
   * when a `new_message` arrives. If the user is currently inside that
   * thread (`selected`), we leave `unreadCount` alone because `ChatScreen`
   * will mark it read anyway. Unknown conversations trigger a refetch so
   * the list self-heals when the backend creates a new thread we haven't
   * seen yet (e.g. first message in a brand-new group).
   */
  useEffect(() => {
    const selectedConvKey = selected
      ? (selected.isGroup ? `g:${selected.groupId || ''}` : `c:${selected.conversationId || ''}`)
      : null;

    const applyIncoming = (msg: any, incrementUnread: boolean) => {
      if (!msg) return;
      const isGroup = !!msg.isGroup;
      const matchKey = isGroup ? `g:${msg.groupId || ''}` : `c:${msg.conversationId || ''}`;
      if (!matchKey || matchKey === 'c:' || matchKey === 'g:') return;

      const preview = typeof msg.content === 'string' ? msg.content : '';
      const createdAt = msg.createdAt || new Date().toISOString();
      const sameAsOpen = selectedConvKey === matchKey;

      setConversations((prev) => {
        let matched = false;
        const next = prev.map((c) => {
          const key = c.isGroup ? `g:${c.groupId || ''}` : `c:${c.conversationId || ''}`;
          if (key !== matchKey) return c;
          matched = true;
          return {
            ...c,
            lastMessage: {
              content: preview,
              senderId: msg.senderId || c.lastMessage?.senderId || '',
              createdAt,
              type: msg.type || 'text',
            },
            updatedAt: createdAt,
            unreadCount:
              incrementUnread && !sameAsOpen
                ? Math.max(0, (c.unreadCount || 0) + 1)
                : (c.unreadCount || 0),
          };
        });
        if (matched) {
          next.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime(),
          );
          return next;
        }
        return prev;
      });

      if (!sameAsOpen) {
        void fetchConversations();
      }
    };

    const offNew = socketService.on('new_message', (msg) => applyIncoming(msg, true));
    const offSent = socketService.on('message_sent', (msg) => applyIncoming(msg, false));
    return () => {
      offNew();
      offSent();
    };
  }, [selected, fetchConversations]);

  /**
   * Auto-select a conversation when the screen is opened with `{ groupId }` or
   * `{ userId }` deep-link params (e.g. after sending a class broadcast).
   *
   * MessagesScreen lives inside the bottom tab navigator and stays mounted
   * between tab switches, so the `conversations` list we captured on first
   * load is often stale by the time a deep-link arrives (e.g. the user just
   * sent the first message in a brand-new class thread from Home). If we
   * can't match against the current snapshot, we refetch once and retry —
   * that guarantees newly-created threads (`grp_class_<classId>`) surface
   * instead of silently dropping the user into the inbox as if it were a
   * "new" thread.
   */
  useEffect(() => {
    if (!routeGroupId && !routeUserId) return;

    const findMatch = (list: Conversation[]) =>
      list.find((c) => {
        if (routeGroupId) return c.isGroup && c.groupId === routeGroupId;
        if (routeUserId) {
          return !c.isGroup && (c.otherUser?.auth0Id === routeUserId || c.otherUser?.id === routeUserId);
        }
        return false;
      });

    let cancelled = false;

    const run = async () => {
      if (loading) return;
      let match = findMatch(conversations);
      if (!match) {
        const fresh = await fetchConversations();
        if (cancelled) return;
        match = findMatch(fresh);
      }
      if (cancelled) return;
      if (match) {
        setSelected(match);
        navigation.setParams?.({ groupId: undefined, userId: undefined } as any);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loading, conversations, routeGroupId, routeUserId, navigation, fetchConversations]);

  const filtered = useMemo(() => {
    let list = conversations;
    if (filter === 'unread') list = list.filter(c => c.unreadCount > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => {
        const label = c.isGroup
          ? (c.groupName || (c.participants || []).map((p) => p.name).join(', '))
          : (c.otherUser?.name || '');
        return label.toLowerCase().includes(q);
      });
    }
    return list;
  }, [conversations, filter, search]);

  const totalUnread = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);

  const setFilterSmooth = (f: Filter) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFilter(f);
  };

  const handleSelect = useCallback((conv: Conversation) => {
    setSelected(conv);
    if (conv.unreadCount > 0) {
      if (conv.isGroup && conv.groupId) {
        messagingService.markGroupRead(conv.groupId);
      } else {
        const authId = conv.otherUser?.auth0Id || conv.otherUser?.id;
        if (authId) messagingService.markRead(authId);
      }
      setConversations(prev => prev.map(c =>
        c.conversationId === conv.conversationId ? { ...c, unreadCount: 0 } : c
      ));
    }
  }, []);

  const handleBack = useCallback(() => {
    setSelected(null);
    fetchConversations();
  }, [fetchConversations]);

  if (selected) {
    return (
      <ChatScreen
        conversation={selected}
        currentUserId={userId}
        currentUserName={user?.name || user?.firstName || 'You'}
        currentUserPicture={user?.picture}
        goBack={handleBack}
      />
    );
  }

  return (
    <View style={[s.safe, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Animated.View style={shellMotion}>
      {/* Header */}
      <View style={s.header}>
        <Text style={[s.headerTitle, { color: colors.text }]}>{t('MESSAGES.TITLE')}</Text>
      </View>

      {/* Search */}
      <View style={[s.searchWrap, { backgroundColor: colors.inputBg }]}>
        <Ionicons name="search-outline" size={16} color={colors.textTertiary} style={s.searchIcon} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder={t('MESSAGES.SEARCH_BY_NAME')}
          placeholderTextColor={colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter pills */}
      <View style={s.filterRow}>
        <TouchableOpacity
          style={[s.filterPill, { backgroundColor: colors.inputBg }, filter === 'all' && { backgroundColor: colors.accent }]}
          onPress={() => setFilterSmooth('all')}
          activeOpacity={0.7}
        >
          <Text style={[s.filterPillText, { color: colors.textSecondary }, filter === 'all' && { color: colors.background }]}>{t('MESSAGES.ALL')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.filterPill, { backgroundColor: colors.inputBg }, filter === 'unread' && { backgroundColor: colors.accent }]}
          onPress={() => setFilterSmooth('unread')}
          activeOpacity={0.7}
        >
          <Text style={[s.filterPillText, { color: colors.textSecondary }, filter === 'unread' && { color: colors.background }]}>
            {t('MESSAGES.UNREAD')}{totalUnread > 0 ? ` (${totalUnread})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
      </Animated.View>

      {/* List */}
      <Animated.View style={[{ flex: 1 }, listGateMotion]}>
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.textSecondary} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name={search ? 'search-outline' : 'chatbubbles-outline'} size={48} color={colors.border} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>
            {search ? t('MESSAGES.SEARCH_EMPTY_TITLE') : t('MESSAGES.NO_CONVERSATIONS_YET')}
          </Text>
          <Text style={[s.emptySub, { color: colors.textSecondary }]}>
            {search ? t('MESSAGES.SEARCH_EMPTY_HINT') : t('MESSAGES.EMPTY_STATE_STUDENT_MOBILE')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.conversationId}
          renderItem={({ item, index }) => (
            <StaggerRow index={index}>
              <ConversationRow
                conversation={item}
                currentUserId={userId}
                onPress={() => handleSelect(item)}
                colors={colors}
              />
            </StaggerRow>
          )}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
      </Animated.View>
    </View>
  );
}

/* ── Conversation Row ── */

function ConversationRow({
  conversation: c,
  currentUserId,
  onPress,
  colors,
}: {
  conversation: Conversation;
  currentUserId: string;
  onPress: () => void;
  colors: any;
}) {
  const isSystem = c.lastMessage?.isSystemMessage || c.lastMessage?.type === 'system';
  const isMine = c.lastMessage?.senderId === currentUserId;
  const hasUnread = c.unreadCount > 0;

  let preview = c.lastMessage?.content || '';
  if (c.lastMessage?.type === 'image') preview = '📷';
  else if (c.lastMessage?.type === 'file') preview = '📄';
  else if (c.lastMessage?.type === 'voice') preview = '🎤';

  // Display label for group vs 1:1
  const displayName = c.isGroup
    ? c.groupName || (c.participants || []).map((p) => p.name).filter(Boolean).join(', ') || 'Group'
    : c.otherUser?.name || '?';

  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.6}>
      {/* Avatar — group cluster unless last message is system (Barnabi, same as web). */}
      {c.isGroup && !isSystem ? (
        <GroupAvatarCluster conversation={c} />
      ) : isSystem ? (
        <Image source={require('../../assets/shared/barnabi-bird.png')} style={s.avatar} />
      ) : c.otherUser?.picture ? (
        <Image source={{ uri: c.otherUser.picture }} style={s.avatar} />
      ) : (
        <View style={[s.avatar, s.avatarFallback]}>
          <Text style={s.avatarLetter}>{(c.otherUser?.name || '?').charAt(0)}</Text>
        </View>
      )}

      {/* Info */}
      <View style={s.rowInfo}>
        <View style={s.rowTop}>
          <Text style={[s.rowName, { color: colors.text }, hasUnread && s.rowNameUnread]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[s.rowTime, { color: colors.textTertiary }, hasUnread && s.rowTimeUnread]}>
            {formatRelativeTime(c.lastMessage?.createdAt)}
          </Text>
        </View>
        <View style={s.rowBottom}>
          <Text style={[s.rowPreview, { color: colors.textSecondary }, hasUnread && { color: colors.text, fontWeight: '500' }]} numberOfLines={1}>
            {isMine && !isSystem ? 'You: ' : ''}{preview}
          </Text>
          {hasUnread && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Stacked avatar cluster used in the conversations list for group threads.
 * Uses `conversation.displayParticipants` / `extraCount` pre-computed in
 * `fetchConversations`, so the render stays function-free.
 *
 * Layout: 2×2 grid inside a 52×52 footprint. When >4 real participants, we
 * show 3 avatars + a "+N" chip in the 4th slot.
 */
function GroupAvatarCluster({ conversation: c }: { conversation: Conversation }) {
  const list = c.displayParticipants || [];
  const extra = c.extraCount || 0;
  // Build up to 4 cells: [avatar...][+N]? Match the web treatment.
  const cells: Array<{ key: string; label: string; picture?: string | null; isMore?: boolean }> = list.map((p, i) => ({
    key: `p-${i}`,
    label: (p.name || '?').charAt(0).toUpperCase(),
    picture: p.picture ?? undefined,
  }));
  if (extra > 0) {
    cells.push({ key: 'more', label: `+${extra}`, isMore: true });
  }

  return (
    <View style={s.cluster}>
      {cells.slice(0, 4).map((cell, i) => {
        // 2x2 slots: [0]=TL, [1]=TR, [2]=BL, [3]=BR
        const row = i < 2 ? 0 : 1;
        const col = i % 2;
        return (
          <View
            key={cell.key}
            style={[
              s.clusterCell,
              {
                top: row * 26,
                left: col * 26,
              },
              cell.isMore && s.clusterCellMore,
            ]}
          >
            {cell.picture && !cell.isMore ? (
              <Image source={{ uri: cell.picture }} style={s.clusterImg} />
            ) : (
              <Text style={[s.clusterLetter, cell.isMore && s.clusterMoreText]}>{cell.label}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Styles ── */

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#222', letterSpacing: -0.5 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#222', paddingVertical: 0 },

  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
  },
  filterPillActive: { backgroundColor: '#222' },
  filterPillText: { fontSize: 13, fontWeight: '600', color: '#717171' },
  filterPillTextActive: { color: '#fff' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#222', marginTop: 8 },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },

  listContent: { paddingBottom: 20 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, marginRight: 14 },
  avatarFallback: { backgroundColor: '#4298d3', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 20, fontWeight: '700', color: '#fff' },

  // Group avatar cluster — 52x52 footprint, 2x2 grid of 24x24 cells (24+24+4
  // gap = 52). Each cell is positioned absolutely; `GroupAvatarCluster` fills
  // it with up to 3 participant avatars + a "+N" overflow chip.
  cluster: {
    width: 52,
    height: 52,
    marginRight: 14,
    position: 'relative' as const,
  },
  clusterCell: {
    position: 'absolute' as const,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#e8e8e8',
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  clusterCellMore: { backgroundColor: '#f0f0f0' },
  clusterImg: { width: '100%' as any, height: '100%' as any },
  clusterLetter: { fontSize: 10, fontWeight: '700', color: '#4298d3' },
  clusterMoreText: { color: '#717171' },

  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowName: { fontSize: 16, fontWeight: '500', color: '#222', flex: 1, marginRight: 8 },
  rowNameUnread: { fontWeight: '700' },
  rowTime: { fontSize: 12, color: '#b0b0b0' },
  rowTimeUnread: { color: '#4298d3', fontWeight: '600' },

  rowBottom: { flexDirection: 'row', alignItems: 'center' },
  rowPreview: { flex: 1, fontSize: 14, color: '#999', marginRight: 8 },
  rowPreviewUnread: { color: '#222', fontWeight: '500' },

  badge: {
    backgroundColor: '#ff3b30',
    borderRadius: 11,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
});
