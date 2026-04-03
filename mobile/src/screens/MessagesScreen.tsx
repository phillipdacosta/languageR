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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { messagingService, Conversation } from '../services/messaging';
import ChatScreen from './ChatScreen';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Filter = 'all' | 'unread';

export default function MessagesScreen() {
  const { user } = useAuth();
  const userId = user?.auth0Id || user?._id || user?.id || '';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Conversation | null>(null);
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      tabBarStyle: selected
        ? { display: 'none' as const }
        : {
            backgroundColor: '#fff',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: '#e5e5e5',
            height: 88,
            paddingTop: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 5,
          },
    });
  }, [selected, navigation]);

  const fetchConversations = useCallback(async () => {
    const data = await messagingService.getConversations();
    setConversations(data);
  }, []);

  useEffect(() => {
    (async () => { await fetchConversations(); setLoading(false); })();
  }, [fetchConversations]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  const filtered = useMemo(() => {
    let list = conversations;
    if (filter === 'unread') list = list.filter(c => c.unreadCount > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => (c.otherUser?.name || '').toLowerCase().includes(q));
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
    const authId = conv.otherUser?.auth0Id || conv.otherUser?.id;
    if (conv.unreadCount > 0 && authId) {
      messagingService.markRead(authId);
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
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Messages</Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#999" style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          placeholder="Search by name"
          placeholderTextColor="#b0b0b0"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color="#ccc" />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter pills */}
      <View style={s.filterRow}>
        <TouchableOpacity
          style={[s.filterPill, filter === 'all' && s.filterPillActive]}
          onPress={() => setFilterSmooth('all')}
          activeOpacity={0.7}
        >
          <Text style={[s.filterPillText, filter === 'all' && s.filterPillTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.filterPill, filter === 'unread' && s.filterPillActive]}
          onPress={() => setFilterSmooth('unread')}
          activeOpacity={0.7}
        >
          <Text style={[s.filterPillText, filter === 'unread' && s.filterPillTextActive]}>
            Unread{totalUnread > 0 ? ` (${totalUnread})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#999" /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name={search ? 'search-outline' : 'chatbubbles-outline'} size={48} color="#ddd" />
          <Text style={s.emptyTitle}>
            {search ? 'No results found' : 'No conversations yet'}
          </Text>
          <Text style={s.emptySub}>
            {search ? 'Try a different search.' : 'Start a conversation with a student or tutor.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.conversationId}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              currentUserId={userId}
              onPress={() => handleSelect(item)}
            />
          )}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </SafeAreaView>
  );
}

/* ── Conversation Row ── */

function ConversationRow({
  conversation: c,
  currentUserId,
  onPress,
}: {
  conversation: Conversation;
  currentUserId: string;
  onPress: () => void;
}) {
  const isSystem = c.lastMessage?.isSystemMessage || c.lastMessage?.type === 'system';
  const isMine = c.lastMessage?.senderId === currentUserId;
  const hasUnread = c.unreadCount > 0;

  let preview = c.lastMessage?.content || '';
  if (c.lastMessage?.type === 'image') preview = '📷 Photo';
  else if (c.lastMessage?.type === 'file') preview = '📄 File';
  else if (c.lastMessage?.type === 'voice') preview = '🎤 Voice message';

  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.6}>
      {/* Avatar */}
      {isSystem ? (
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
          <Text style={[s.rowName, hasUnread && s.rowNameUnread]} numberOfLines={1}>
            {c.otherUser?.name || 'Unknown User'}
          </Text>
          <Text style={[s.rowTime, hasUnread && s.rowTimeUnread]}>
            {formatRelativeTime(c.lastMessage?.createdAt)}
          </Text>
        </View>
        <View style={s.rowBottom}>
          <Text style={[s.rowPreview, hasUnread && s.rowPreviewUnread]} numberOfLines={1}>
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
