import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
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
  Dimensions,
  Keyboard,
  Pressable,
  Alert,
  ActionSheetIOS,
  AppState,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing as REasing,
  interpolate,
  interpolateColor,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { messagingService, Conversation } from '../services/messaging';
import { socketService } from '../services/socket';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';
import { useHomeTabBarOverlay } from '../contexts/HomeTabBarOverlayContext';
import StaggerRow from '../components/StaggerRow';
import ChatScreen from './ChatScreen';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Filter = 'all' | 'unread' | 'archived';

export default function MessagesScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = user?.auth0Id || user?._id || user?.id || '';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFilterSwitching, setIsFilterSwitching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const filterRef = useRef<Filter>('all');
  filterRef.current = filter;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Conversation | null>(null);
  const navigation = useNavigation();
  const route = useRoute();
  const { setScreenHidesTabBar } = useHomeTabBarOverlay();
  const { shellMotion, listGateMotion } = useScreenEntranceAnimations(loading);

  // Search bar collapse/expand — Reanimated runs the interpolation on the UI
  // thread, so the pill expansion stays smooth even during list scrolling.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchProgress = useSharedValue(0);
  const searchInputRef = useRef<TextInput>(null);

  const SEARCH_CLOSE_EASING = REasing.bezier(0.32, 0.72, 0, 1);

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Spring on the UI thread — feels more natural than a fixed-duration timing.
    // Focus is deferred to the spring's completion callback so the keyboard
    // doesn't interrupt the layout animation mid-flight.
    searchProgress.value = withSpring(
      1,
      { damping: 24, stiffness: 240, mass: 0.9, overshootClamping: true },
      (finished) => {
        if (finished) runOnJS(focusSearchInput)();
      },
    );
  }, [searchProgress, focusSearchInput]);

  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearch('');
    searchProgress.value = withTiming(
      0,
      { duration: 340, easing: SEARCH_CLOSE_EASING },
      (finished) => {
        if (finished) runOnJS(setSearchOpen)(false);
      },
    );
  }, [searchProgress]);

  // Deep link params — e.g., coming back from ClassGoingMessageModal via
  // navigation.navigate('Messages', { groupId } | { userId }).
  const routeGroupId = (route.params as { groupId?: string } | undefined)?.groupId;
  const routeUserId = (route.params as { userId?: string } | undefined)?.userId;

  useEffect(() => {
    setScreenHidesTabBar(!!selected);
    return () => {
      setScreenHidesTabBar(false);
    };
  }, [selected, setScreenHidesTabBar]);

  /**
   * Fetch conversations and pre-compute avatar cluster fields for groups so the
   * list row can stay function-free when we render stacked avatars.
   */
  const fetchConversations = useCallback(async (f?: Filter) => {
    const useFilter = f ?? filterRef.current;
    const serverFilter = useFilter === 'archived' ? 'archived' : 'all';
    const data = await messagingService.getConversations(serverFilter);
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
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- filterRef is a ref, stable

  // Initial load
  useEffect(() => {
    (async () => { await fetchConversations('all'); setLoading(false); })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional one-time mount

  // Re-fetch when filter changes (skipped during initial load)
  useEffect(() => {
    if (loading) return;
    setIsFilterSwitching(true);
    fetchConversations(filter).finally(() => setIsFilterSwitching(false));
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when the app returns to the foreground so stale archive/inbox
  // state from actions taken on another device (or the web) is resolved.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        fetchConversations(filterRef.current);
      }
    });
    return () => sub.remove();
  }, [fetchConversations]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations(filterRef.current);
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

    // Sync archive/unarchive performed on another device (web ↔ RN)
    const offArchived = socketService.on('conversation_archived', ({ conversationId }: { conversationId: string }) => {
      if (filterRef.current !== 'archived') {
        // Remove from active inbox
        setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
        setSelected((s) => (s?.conversationId === conversationId ? null : s));
      } else {
        // We're in archive view — refetch so the newly archived item appears
        fetchConversations('archived');
      }
    });

    const offUnarchived = socketService.on('conversation_unarchived', ({ conversationId }: { conversationId: string }) => {
      if (filterRef.current === 'archived') {
        // Remove from archive view
        setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
        setSelected((s) => (s?.conversationId === conversationId ? null : s));
      } else {
        // Item returns to inbox — refetch
        fetchConversations('all');
      }
    });

    return () => {
      offNew();
      offSent();
      offArchived();
      offUnarchived();
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
        // 1:1 conversation — match the other user's name
        if ((c.otherUser?.name || '').toLowerCase().includes(q)) return true;
        // Group conversation — match group name
        if ((c.groupName || '').toLowerCase().includes(q)) return true;
        // Group — match any participant's name
        if (c.participants?.some((p) => (p.name || '').toLowerCase().includes(q))) return true;
        // Last message preview text (skip system messages)
        const isSystem = c.lastMessage?.isSystemMessage || c.lastMessage?.type === 'system';
        const content = c.lastMessage?.content || '';
        if (!isSystem && content.toLowerCase().includes(q)) return true;
        return false;
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
    fetchConversations(filterRef.current);
  }, [fetchConversations]);

  const handleArchiveAction = useCallback((conv: Conversation) => {
    const isArchived = filterRef.current === 'archived';
    if (isArchived) {
      messagingService.unarchiveConversation(conv.conversationId).then((ok) => {
        if (ok) setConversations((prev) => prev.filter((c) => c.conversationId !== conv.conversationId));
      });
    } else {
      messagingService.archiveConversation(conv.conversationId).then((ok) => {
        if (ok) setConversations((prev) => prev.filter((c) => c.conversationId !== conv.conversationId));
      });
    }
  }, []);

  const handleDeleteAction = useCallback((conv: Conversation) => {
    Alert.alert(
      t('MESSAGES.DELETE_CONVERSATION'),
      t('MESSAGES.DELETE_CONVERSATION_CONFIRM'),
      [
        { text: t('MESSAGES.CANCEL'), style: 'cancel' },
        {
          text: t('MESSAGES.DELETE'),
          style: 'destructive',
          onPress: () => {
            messagingService.deleteConversation(conv.conversationId).then((ok) => {
              if (ok) setConversations((prev) => prev.filter((c) => c.conversationId !== conv.conversationId));
            });
          },
        },
      ],
    );
  }, [t]);

  // Search bar geometry — pill anchors to the right and expands leftward.
  // These constants and hooks must live ABOVE any early return so React always
  // sees the same number of hooks on every render.
  const screenW = Dimensions.get('window').width;
  const HEADER_PAD = 20;
  const PILL_SIZE = 36;
  const PILL_GAP = 6;
  const CANCEL_W = 64;
  const CANCEL_GAP = 12;
  const closedPillRight = HEADER_PAD + PILL_SIZE + PILL_GAP;
  const openPillRight = HEADER_PAD + CANCEL_W + CANCEL_GAP;
  const openPillWidth = screenW - HEADER_PAD - openPillRight;
  const searchBorderOpen = colors.text;

  const pillStyle = useAnimatedStyle(() => {
    const p = searchProgress.value;
    return {
      right: interpolate(p, [0, 1], [closedPillRight, openPillRight], Extrapolation.CLAMP),
      width: interpolate(p, [0, 1], [PILL_SIZE, openPillWidth], Extrapolation.CLAMP),
      borderColor: interpolateColor(
        p,
        [0, 0.6, 1],
        ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', searchBorderOpen],
      ),
    };
  }, [searchBorderOpen]);
  // Opening:  title fades OUT in [0.0 → 0.35], cancel fades IN  in [0.55 → 1.0]
  // Closing:  cancel fades OUT in [1.0 → 0.6],  title fades IN  in [0.3 → 0.0]
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchProgress.value, [0, 0.35], [1, 0], Extrapolation.CLAMP),
  }));
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchProgress.value, [0.55, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(searchProgress.value, [0.55, 1], [16, 0], Extrapolation.CLAMP) },
    ],
  }));

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
      {/* Header — Airbnb-style: title left, search + compose pills right.
          The search pill expands right→left when tapped, mirroring the web flow. */}
      <View style={s.header}>
        <Reanimated.Text
          style={[s.headerTitle, { color: colors.text }, titleStyle]}
          numberOfLines={1}
        >
          {t('MESSAGES.TITLE')}
        </Reanimated.Text>

        {/* Compose pill (placeholder, mirrors web) */}
        <Reanimated.View
          style={[s.composePill, { backgroundColor: colors.inputBg }, titleStyle]}
          pointerEvents={searchOpen ? 'none' : 'auto'}
        >
          <TouchableOpacity
            style={s.pillTouchable}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </Reanimated.View>

        {/* Search pill — width + right animation, smoothed via spring */}
        <Reanimated.View
          collapsable={false}
          style={[s.searchPill, { backgroundColor: colors.inputBg }, pillStyle]}
        >
          <Pressable
            style={s.pillIconHit}
            onPress={searchOpen ? undefined : openSearch}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
          </Pressable>
          <TextInput
            ref={searchInputRef}
            style={[s.searchInput, { color: colors.text }]}
            placeholder={t('MESSAGES.SEARCH_ALL_MESSAGES')}
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            editable={searchOpen}
            pointerEvents={searchOpen ? 'auto' : 'none'}
          />
          {searchOpen && search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 10 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </Reanimated.View>

        {/* Cancel button */}
        <Reanimated.View
          style={[s.cancelBtn, cancelStyle]}
          pointerEvents={searchOpen ? 'auto' : 'none'}
        >
          <TouchableOpacity onPress={closeSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[s.cancelText, { color: colors.text }]}>{t('MESSAGES.CANCEL')}</Text>
          </TouchableOpacity>
        </Reanimated.View>
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
        <TouchableOpacity
          style={[s.filterPill, { backgroundColor: colors.inputBg }, filter === 'archived' && { backgroundColor: colors.accent }]}
          onPress={() => setFilterSmooth('archived')}
          activeOpacity={0.7}
        >
          <Text style={[s.filterPillText, { color: colors.textSecondary }, filter === 'archived' && { color: colors.background }]}>
            {t('MESSAGES.ARCHIVED')}
          </Text>
        </TouchableOpacity>
      </View>
      </Animated.View>

      {/* List */}
      <Animated.View style={[{ flex: 1 }, listGateMotion]}>
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.textSecondary} /></View>
      ) : filtered.length === 0 && !isFilterSwitching ? (
        <View style={s.center}>
          <Ionicons
            name={filter === 'archived' ? 'archive-outline' : search ? 'search-outline' : 'chatbubbles-outline'}
            size={48}
            color={colors.border}
          />
          <Text style={[s.emptyTitle, { color: colors.text }]}>
            {filter === 'archived'
              ? t('MESSAGES.NO_ARCHIVED_CONVERSATIONS')
              : search
              ? t('MESSAGES.SEARCH_EMPTY_TITLE')
              : t('MESSAGES.NO_CONVERSATIONS_YET')}
          </Text>
          <Text style={[s.emptySub, { color: colors.textSecondary }]}>
            {filter === 'archived'
              ? t('MESSAGES.ARCHIVED_EMPTY_HINT')
              : search
              ? t('MESSAGES.SEARCH_EMPTY_HINT')
              : t('MESSAGES.EMPTY_STATE_STUDENT_MOBILE')}
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
                searchQuery={search}
                onPress={() => handleSelect(item)}
                onArchive={() => handleArchiveAction(item)}
                onDelete={() => handleDeleteAction(item)}
                isArchived={filter === 'archived'}
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

/* ── Search highlight ── */

function HighlightText({
  text,
  query,
  style,
  highlightStyle,
  numberOfLines,
}: {
  text: string;
  query: string;
  style?: any;
  highlightStyle?: any;
  numberOfLines?: number;
}) {
  if (!query || !query.trim()) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <Text key={i} style={[style, s.highlight, highlightStyle]}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

/* ── Conversation Row ── */

function ConversationRow({
  conversation: c,
  currentUserId,
  searchQuery,
  onPress,
  onLongPress,
  onArchive,
  onDelete,
  isArchived,
  colors,
}: {
  conversation: Conversation;
  currentUserId: string;
  searchQuery: string;
  onPress: () => void;
  onLongPress?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  isArchived?: boolean;
  colors: any;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const isSystem = c.lastMessage?.isSystemMessage || c.lastMessage?.type === 'system';
  const isMine = c.lastMessage?.senderId === currentUserId;
  const hasUnread = c.unreadCount > 0;

  let preview = c.lastMessage?.content || '';
  if (c.lastMessage?.type === 'image') preview = '📷';
  else if (c.lastMessage?.type === 'file') preview = '📄';
  else if (c.lastMessage?.type === 'voice') preview = '🎤';

  const displayName = c.isGroup
    ? c.groupName || (c.participants || []).map((p) => p.name).filter(Boolean).join(', ') || 'Group'
    : c.otherUser?.name || '?';

  const renderRightActions = useCallback(() => (
    <TouchableOpacity
      style={s.swipeLeft}
      onPress={() => { swipeRef.current?.close(); onArchive?.(); }}
      activeOpacity={0.8}
    >
      <Ionicons name={isArchived ? 'arrow-undo-outline' : 'archive-outline'} size={22} color="#fff" />
      <Text style={s.swipeLabel}>{isArchived ? 'Inbox' : 'Archive'}</Text>
    </TouchableOpacity>
  ), [onArchive, isArchived]);

  const renderLeftActions = useCallback(() => (
    <TouchableOpacity
      style={s.swipeRight}
      onPress={() => { swipeRef.current?.close(); onDelete?.(); }}
      activeOpacity={0.8}
    >
      <Ionicons name="trash-outline" size={22} color="#fff" />
      <Text style={s.swipeLabel}>Delete</Text>
    </TouchableOpacity>
  ), [onDelete]);

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      friction={2}
      overshootRight={false}
      overshootLeft={false}
      rightThreshold={60}
      leftThreshold={60}
    >
      <TouchableOpacity style={[s.row, { backgroundColor: colors.background }]} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.6} delayLongPress={400}>
        {/* Avatar */}
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
            <HighlightText
              text={displayName}
              query={searchQuery}
              style={[s.rowName, { color: colors.text }, hasUnread && s.rowNameUnread]}
              numberOfLines={1}
            />
            <Text style={[s.rowTime, { color: colors.textTertiary }, hasUnread && s.rowTimeUnread]}>
              {formatRelativeTime(c.lastMessage?.createdAt)}
            </Text>
          </View>
          <View style={s.rowBottom}>
            <HighlightText
              text={(isMine && !isSystem ? 'You: ' : '') + preview}
              query={searchQuery}
              style={[s.rowPreview, { color: colors.textSecondary }, hasUnread && { color: colors.text, fontWeight: '500' }]}
              numberOfLines={1}
            />
            {hasUnread && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
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
  // Header is the row that holds the title + the two pills + Cancel.
  // It's `position: relative` so the absolute children (search pill, Cancel)
  // can anchor to the right edge as the pill expands.
  header: {
    height: 56,
    paddingHorizontal: 20,
    justifyContent: 'center',
    position: 'relative',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#222',
    letterSpacing: -0.5,
    // Leave room for the two pills (40+6+40 ≈ 86) on the right
    paddingRight: 92,
  },

  // Compose pill — fixed at the far right, hidden when search opens
  composePill: {
    position: 'absolute',
    right: 20,
    top: '50%',
    width: 36,
    height: 36,
    marginTop: -18,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Search pill — animates `right` and `width` to expand right→left
  searchPill: {
    position: 'absolute',
    top: '50%',
    height: 36,
    marginTop: -18,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  pillTouchable: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pillIconHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, fontSize: 15, color: '#222', paddingVertical: 0, paddingRight: 8 },

  cancelBtn: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -10,
    height: 20,
    justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#222' },

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

  // Swipe action panels
  swipeLeft: {
    backgroundColor: '#FF9500',
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    gap: 4,
  },
  swipeRight: {
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    gap: 4,
  },
  swipeLabel: { fontSize: 12, fontWeight: '600', color: '#fff' },

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

  highlight: {
    backgroundColor: 'rgba(255, 112, 0, 0.34)',
    fontWeight: '700',
    borderRadius: 3,
    overflow: 'hidden',
  },
});
