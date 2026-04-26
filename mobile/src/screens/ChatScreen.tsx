import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Image,
  TextInput,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  Clipboard,
  Animated,
  Easing,
  ScrollView,
  Linking,
  ActionSheetIOS,
  Dimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { messagingService, Conversation, GroupParticipantSummary, Message } from '../services/messaging';
import { socketService } from '../services/socket';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  currentUserName?: string;
  currentUserPicture?: string;
  goBack: () => void;
}

const HEADER_HEIGHT = 56;
const GROUP_GAP_MS = 120000;
/** Barnabi — same role as `assets/icons-app-bird-2.png` on web system messages. */
const BARNABI_MASCOT = require('../../assets/shared/barnabi-bird.png');
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👎', '‼️', '❓', '🤔', '🔥', '🎉', '💯', '🥺'];
const EXTENDED_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊',
  '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛', '😜', '🤪',
  '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑',
  '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '😴', '😷',
  '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠',
  '🥳', '🥺', '😢', '😭', '😤', '😡', '🤬', '😈', '👿', '💀',
  '👍', '👎', '👊', '✊', '🤛', '🤜', '🤝', '🙏', '✌️', '🤟',
  '🤘', '👌', '🤌', '👋', '💪', '❤️', '🧡', '💛', '💚', '💙',
  '💜', '🖤', '🤍', '💔', '❣️', '💕', '💯', '✨', '🔥', '⭐',
  '🌟', '💫', '‼️', '❓', '❗', '🎉', '🎊', '🎈', '🎁', '🏆',
];

const isEmojiOnly = (text: string): boolean => {
  const stripped = text.replace(/\s/g, '');
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?)+$/u;
  return emojiRegex.test(stripped) && stripped.length <= 12;
};

/** 40px cluster, positions aligned with web `.chat-avatar--group` (tab1 messages). */
function headerClusterCellStyle(n: number, i: number): ViewStyle {
  const base: ViewStyle = { position: 'absolute', backgroundColor: '#eef0f4' };
  if (n === 1) {
    return { ...base, width: 20, height: 20, borderRadius: 10, top: 0, left: 0 };
  }
  if (n === 2) {
    if (i === 0) {
      return { ...base, width: 26, height: 26, borderRadius: 13, top: 1, left: 0 };
    }
    return { ...base, width: 26, height: 26, borderRadius: 13, bottom: 1, right: 0 };
  }
  if (n === 3) {
    if (i === 0) {
      return { ...base, width: 22, height: 22, borderRadius: 11, top: 0, left: 9 };
    }
    if (i === 1) {
      return { ...base, width: 22, height: 22, borderRadius: 11, bottom: 0, left: 0 };
    }
    return { ...base, width: 22, height: 22, borderRadius: 11, bottom: 0, right: 0 };
  }
  const w = 20;
  const r = 10;
  if (i === 0) {
    return { ...base, width: w, height: w, borderRadius: r, top: 0, left: 0 };
  }
  if (i === 1) {
    return { ...base, width: w, height: w, borderRadius: r, top: 0, right: 0 };
  }
  if (i === 2) {
    return { ...base, width: w, height: w, borderRadius: r, bottom: 0, left: 0 };
  }
  return { ...base, width: w, height: w, borderRadius: r, bottom: 0, right: 0 };
}

export default function ChatScreen({ conversation, currentUserId, currentUserName: propName, currentUserPicture, goBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: C, isDark } = useTheme();
  const otherUser = conversation.otherUser;
  const otherUserId = otherUser?.auth0Id || otherUser?.id || '';

  // Group-thread mode — messages, sends and read receipts all route through the
  // `/groups/:groupId/...` endpoints instead of the 1:1 `/conversations/:id/...`
  // set. We keep `otherUserId` for back-compat with 1:1 helpers below.
  const isGroup = !!conversation.isGroup;
  const groupId = conversation.groupId || '';
  const groupParticipants = conversation.participants || [];
  /** Group class chat (broadcast or legacy with classId) — no single "their" time. */
  const isClassConversation = !!conversation.classId || conversation.type === 'class-broadcast';

  /**
   * Quick lookup for sender metadata keyed by auth0Id — used when rendering
   * per-message avatars/names in a group thread. Falls back gracefully when a
   * participant leaves between send-time and render-time.
   */
  const participantById = useMemo(() => {
    const map: Record<string, { name: string; picture?: string | null }> = {};
    for (const p of groupParticipants) {
      if (p.auth0Id) map[p.auth0Id] = { name: p.name || 'Member', picture: p.picture };
      if (p.id) map[p.id] = { name: p.name || 'Member', picture: p.picture };
    }
    return map;
  }, [groupParticipants]);

  const myName = propName || 'You';
  const myPicture = currentUserPicture || null;

  const headerTitle = isGroup
    ? (conversation.groupName
        || conversation.otherUser?.name
        || groupParticipants.map((p) => p.name).filter(Boolean).join(', ')
        || 'Group')
    : (otherUser?.name || 'Chat');

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  /**
   * True when the current user is no longer an active member of this group
   * thread (e.g. they left or were removed from the class). The backend
   * reports this on every group messages fetch; we mirror it here so the
   * composer can be replaced with a read-only banner.
   */
  const [archived, setArchived] = useState<boolean>(!!conversation.archived);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const shouldAutoScroll = useRef(true);
  const isInitialLoad = useRef(true);

  const [contextMsg, setContextMsg] = useState<Message | null>(null);
  const [contextVisible, setContextVisible] = useState(false);
  const [emojiDrawerOpen, setEmojiDrawerOpen] = useState(false);
  const contextAnim = useRef(new Animated.Value(0)).current;
  const emojiItemAnims = useRef(Array.from({ length: QUICK_REACTIONS.length + 1 }, () => new Animated.Value(0))).current;
  const msgPreviewAnim = useRef(new Animated.Value(0)).current;
  const msgSlideAnim = useRef(new Animated.Value(0)).current;
  const actionCardAnim = useRef(new Animated.Value(0)).current;
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const pressOriginY = useRef(0);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  /**
   * Class roster bottom sheet: built from `groupParticipants`, ordered like
   * the header cluster (others first, "me" last). `mounted` drives the Modal
   * visibility; `rosterAnim` runs the backdrop fade + sheet slide-up so we
   * don't rely on the RN Modal's default `slide` (which animates the backdrop
   * and the sheet together and reads as "the whole chat wipes up").
   */
  const [rosterMounted, setRosterMounted] = useState(false);
  const [rosterData, setRosterData] = useState<{
    title: string;
    empty: boolean;
    rows: Array<{ id: string; name: string; picture?: string | null; isSelf: boolean }>;
  } | null>(null);
  const rosterAnim = useRef(new Animated.Value(0)).current;
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightAnim = useRef(new Animated.Value(0)).current;

  const [otherUserTime, setOtherUserTime] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [uploading, setUploading] = useState(false);

  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const { listGateMotion } = useScreenEntranceAnimations(loading);

  /**
   * Header avatar cluster for group threads (same ordering as web
   * `decorateGroupAvatarCluster`: others first, "me" last; >4 → 3 faces + +N).
   * Used only for display — not called from JSX as a function.
   */
  const headerGroupCluster = useMemo(() => {
    if (!isGroup) {
      return null;
    }
    const all = groupParticipants;
    const self = currentUserId;
    const others = all.filter((p) => p.auth0Id && p.auth0Id !== self);
    const me = all.filter((p) => p.auth0Id && p.auth0Id === self);
    const ordered = [...others, ...me];
    if (ordered.length === 0) {
      return { cells: [] as Array<{ p?: GroupParticipantSummary; isMore?: boolean; n?: string }>, a11yLabel: '', layoutN: 0 };
    }
    const a11yLabel = ordered
      .map((p) => (p.auth0Id === self ? 'You' : (p.name || '').trim()))
      .filter((n) => !!n)
      .join(', ');
    let display: GroupParticipantSummary[];
    let extra: number;
    if (ordered.length > 4) {
      display = ordered.slice(0, 3);
      extra = ordered.length - 3;
    } else {
      display = ordered;
      extra = 0;
    }
    const cells: Array<{ p?: GroupParticipantSummary; isMore?: boolean; n?: string }> = display.map((p) => ({ p }));
    if (extra > 0) {
      cells.push({ isMore: true, n: `+${extra}` });
    }
    const sliced = cells.slice(0, 4);
    const layoutN = Math.min(sliced.length, 4) as 1 | 2 | 3 | 4;
    return { cells: sliced, a11yLabel, layoutN: layoutN || 1 };
  }, [isGroup, groupParticipants, currentUserId]);

  const closeClassRosterSheet = useCallback(() => {
    Animated.timing(rosterAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setRosterMounted(false);
        setRosterData(null);
      }
    });
  }, [rosterAnim]);

  /** Class-broadcast threads: roster in a bottom sheet (same order as header cluster). */
  const showClassRosterActionSheet = useCallback(() => {
    if (!isClassConversation) {
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const self = currentUserId;
    const others = groupParticipants.filter((p) => p.auth0Id && p.auth0Id !== self);
    const me = groupParticipants.filter((p) => p.auth0Id && p.auth0Id === self);
    const ordered = [...others, ...me];
    const rows = ordered.map((p, i) => ({
      id: p.auth0Id || p.id || `row-${i}`,
      name: p.auth0Id === self ? t('MESSAGES.YOU') : (p.name || '').trim() || '—',
      picture: p.picture || null,
      isSelf: p.auth0Id === self,
    }));
    const count = rows.length;
    const title = t('MESSAGES.CLASS_ROSTER_TITLE', { count });
    setRosterData({ title, empty: count === 0, rows });
    setRosterMounted(true);
    rosterAnim.setValue(0);
    Animated.timing(rosterAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isClassConversation, currentUserId, groupParticipants, t, rosterAnim]);

  useEffect(() => {
    if (isClassConversation) {
      setOtherUserTime('');
      return;
    }
    if (!otherUser?.timezone) return;
    const update = () => {
      try {
        setOtherUserTime(new Date().toLocaleTimeString('en-US', {
          timeZone: otherUser.timezone!, hour: 'numeric', minute: '2-digit', hour12: true,
        }));
      } catch { setOtherUserTime(''); }
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, [isClassConversation, otherUser?.timezone]);

  useEffect(() => { return () => { soundRef.current?.unloadAsync(); }; }, []);

  const fetchMessages = useCallback(async () => {
    // Group threads use the `/groups/:id/messages` endpoint; 1:1 threads keep
    // their existing `/conversations/:otherUserId/messages` behavior.
    // For groups we use the *WithMeta* variant so we also learn whether the
    // current user is still an active member (archived=false) or has left
    // (archived=true), which controls the read-only banner below.
    let data: Message[] = [];
    if (isGroup) {
      const meta = await messagingService.getGroupMessagesWithMeta(groupId, 50);
      data = meta?.messages || [];
      setArchived(!!meta?.archived);
    } else {
      data = await messagingService.getMessages(otherUserId, 50);
    }
    const sorted = [...data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    setMessages(sorted);
    setHasMore(data.length >= 50);
    setLoading(false);
    if (isGroup) {
      if (groupId) messagingService.markGroupRead(groupId);
    } else if (otherUserId) {
      messagingService.markRead(otherUserId);
    }
    isInitialLoad.current = true;
    shouldAutoScroll.current = true;
  }, [isGroup, groupId, otherUserId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  /**
   * Realtime: append new messages for the open thread, dedupe against
   * optimistic sends (temp ids) by id, and mark the thread read so the
   * inbox badge doesn't grow while the user is looking at it. Also wipes
   * deleted messages and applies reaction updates so the UI stays in
   * sync across devices without a refetch.
   */
  useEffect(() => {
    const matches = (m: any) => {
      if (!m) return false;
      if (isGroup) return !!m.isGroup && m.groupId === groupId;
      if (m.isGroup) return false;
      return m.conversationId === conversation.conversationId;
    };

    const applyIncoming = (raw: any) => {
      if (!matches(raw)) return;
      const incoming: Message = {
        id: raw.id || raw._id || `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conversationId: raw.conversationId || conversation.conversationId,
        senderId: raw.senderId || '',
        receiverId: raw.receiverId || '',
        content: raw.content || '',
        type: raw.type || 'text',
        read: !!raw.read,
        createdAt: raw.createdAt || new Date().toISOString(),
        fileUrl: raw.fileUrl,
        fileName: raw.fileName,
        fileType: raw.fileType,
        fileSize: raw.fileSize,
        thumbnailUrl: raw.thumbnailUrl,
        duration: raw.duration,
        sender: raw.sender,
        replyTo: raw.replyTo,
        isSystemMessage: raw.isSystemMessage,
        reactions: raw.reactions,
      };
      if (!incoming.id) return;

      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        const temp = prev.find(
          (m) =>
            m.id.startsWith('temp-') &&
            m.senderId === incoming.senderId &&
            m.content === incoming.content &&
            m.type === incoming.type,
        );
        if (temp) {
          return prev.map((m) => (m.id === temp.id ? incoming : m));
        }
        shouldAutoScroll.current = true;
        return [...prev, incoming];
      });

      if (incoming.senderId && incoming.senderId !== currentUserId) {
        if (isGroup) {
          if (groupId) void messagingService.markGroupRead(groupId);
        } else if (otherUserId) {
          void messagingService.markRead(otherUserId);
        }
      }
    };

    const applyDeleted = (raw: any) => {
      if (!matches(raw)) return;
      const id = raw.id || raw._id || raw.messageId;
      if (!id) return;
      setMessages((prev) => prev.filter((m) => m.id !== id));
    };

    const applyReaction = (raw: any) => {
      if (!matches(raw)) return;
      const id = raw.id || raw._id || raw.messageId;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, reactions: raw.reactions || m.reactions } : m)),
      );
    };

    const offNew = socketService.on('new_message', applyIncoming);
    const offSent = socketService.on('message_sent', applyIncoming);
    const offDeleted = socketService.on('message_deleted', applyDeleted);
    const offReaction = socketService.on('reaction_updated', applyReaction);

    return () => {
      offNew();
      offSent();
      offDeleted();
      offReaction();
    };
  }, [isGroup, groupId, conversation.conversationId, otherUserId, currentUserId]);

  const handleContentSizeChange = useCallback(() => {
    if (shouldAutoScroll.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: !isInitialLoad.current });
      if (isInitialLoad.current) setTimeout(() => { isInitialLoad.current = false; }, 300);
      shouldAutoScroll.current = false;
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0];
    const older = isGroup
      ? await messagingService.getGroupMessages(groupId, 50, oldest.id)
      : await messagingService.getMessages(otherUserId, 50, oldest.id);
    if (older.length < 50) setHasMore(false);
    if (older.length > 0) {
      const sorted = [...older].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setMessages(prev => [...sorted, ...prev]);
    }
    setLoadingOlder(false);
  }, [loadingOlder, hasMore, messages, isGroup, groupId, otherUserId]);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;
    // Archived group threads are read-only; the composer should already be
    // hidden, but we double-check in case of stale state/races.
    if (isGroup && archived) return;
    setSending(true);
    setText('');
    const replyPayload = replyTo ? {
      messageId: replyTo.id, content: replyTo.content, senderId: replyTo.senderId,
      senderName: replyTo.senderId === currentUserId ? 'You' : (otherUser?.name || 'User'),
      type: replyTo.type,
    } : undefined;
    setReplyTo(null);
    const optimistic: Message = {
      id: `temp-${Date.now()}`, conversationId: conversation.conversationId,
      senderId: currentUserId, receiverId: isGroup ? '' : otherUserId,
      content, type: 'text', read: false,
      createdAt: new Date().toISOString(), replyTo: replyPayload,
    };
    shouldAutoScroll.current = true;
    setMessages(prev => [...prev, optimistic]);
    // Group threads fan out via the dedicated group endpoint; on first send
    // the backend requires `participantIds` so it can verify the group id hash.
    const sent = isGroup
      ? await messagingService.sendGroupMessage(groupId, content, {
          type: 'text',
          participantIds: groupParticipants.map((p) => p.auth0Id).filter(Boolean),
          name: conversation.groupName || '',
          replyTo: replyPayload,
        })
      : await messagingService.sendMessage(otherUserId, content, 'text', replyPayload);
    if (sent) setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...sent, createdAt: sent.createdAt || optimistic.createdAt } : m));
    setSending(false);
  }, [
    text, sending, conversation.conversationId, conversation.groupName,
    currentUserId, otherUserId, replyTo, otherUser?.name,
    isGroup, groupId, groupParticipants, archived,
  ]);

  const openContextMenu = useCallback((msg: Message, pageY: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const screenH = Dimensions.get('window').height;
    const originOffset = pageY - screenH * 0.45;
    pressOriginY.current = originOffset;

    setContextMsg(msg);
    setContextVisible(true);

    contextAnim.setValue(0);
    emojiItemAnims.forEach(a => a.setValue(0));
    msgPreviewAnim.setValue(0);
    msgSlideAnim.setValue(originOffset);
    actionCardAnim.setValue(0);

    Animated.timing(contextAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();

    Animated.stagger(25,
      emojiItemAnims.map(a => Animated.spring(a, { toValue: 1, useNativeDriver: true, tension: 180, friction: 10 })),
    ).start();

    Animated.parallel([
      Animated.spring(msgPreviewAnim, { toValue: 1, useNativeDriver: true, tension: 120, friction: 12 }),
      Animated.spring(msgSlideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
    ]).start();

    Animated.sequence([
      Animated.delay(120),
      Animated.spring(actionCardAnim, { toValue: 1, useNativeDriver: true, tension: 100, friction: 10 }),
    ]).start();
  }, [contextAnim, emojiItemAnims, msgPreviewAnim, msgSlideAnim, actionCardAnim]);

  const closeContextMenu = useCallback(() => {
    const closeDuration = 220;
    Animated.parallel([
      Animated.timing(contextAnim, { toValue: 0, duration: closeDuration, useNativeDriver: true }),
      Animated.timing(msgPreviewAnim, { toValue: 0, duration: closeDuration - 20, useNativeDriver: true }),
      Animated.timing(msgSlideAnim, { toValue: pressOriginY.current, duration: closeDuration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(actionCardAnim, { toValue: 0, duration: closeDuration - 60, useNativeDriver: true }),
      ...emojiItemAnims.map(a => Animated.timing(a, { toValue: 0, duration: 80, useNativeDriver: true })),
    ]).start(() => {
      setContextVisible(false);
      setEmojiDrawerOpen(false);
      drawerAnim.setValue(0);
    });
  }, [contextAnim, emojiItemAnims, msgPreviewAnim, msgSlideAnim, actionCardAnim, drawerAnim]);

  const toggleEmojiDrawer = useCallback(() => {
    if (emojiDrawerOpen) {
      Animated.timing(drawerAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => setEmojiDrawerOpen(false));
    } else {
      setEmojiDrawerOpen(true);
      drawerAnim.setValue(0);
      Animated.spring(drawerAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
    }
  }, [emojiDrawerOpen, drawerAnim]);

  const handleReaction = useCallback(async (emoji: string) => {
    if (!contextMsg) return;
    const msgId = contextMsg.id;
    closeContextMenu();
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const existing = (m.reactions || []).filter(r => r.userId === currentUserId);
      let newReactions: Message['reactions'];
      if (existing.length > 0 && existing[0].emoji === emoji) {
        newReactions = (m.reactions || []).filter(r => r.userId !== currentUserId);
      } else {
        newReactions = [...(m.reactions || []).filter(r => r.userId !== currentUserId), { emoji, userId: currentUserId, userName: 'You' }];
      }
      return { ...m, reactions: newReactions };
    }));
    await messagingService.addReaction(msgId, emoji);
  }, [contextMsg, currentUserId, closeContextMenu]);

  const handleReply = useCallback(() => {
    if (!contextMsg) return;
    const msg = contextMsg;
    setContextVisible(false);
    setContextMsg(null);
    contextAnim.setValue(0);
    setReplyTo(msg);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [contextMsg, contextAnim]);

  const handleCopy = useCallback(() => {
    if (!contextMsg || contextMsg.type !== 'text') return;
    Clipboard.setString(contextMsg.content);
    closeContextMenu();
  }, [contextMsg, closeContextMenu]);

  const handleDelete = useCallback(() => {
    if (!contextMsg) return;
    const id = contextMsg.id;
    closeContextMenu();
    Alert.alert('Delete Message', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setMessages(prev => prev.filter(m => m.id !== id));
        await messagingService.deleteMessage(id);
      }},
    ]);
  }, [contextMsg, closeContextMenu]);

  const scrollToMessage = useCallback((messageId: string) => {
    const idx = invertedMessages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    setHighlightedId(messageId);
    highlightAnim.setValue(0);
    Animated.sequence([
      Animated.timing(highlightAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.delay(1200),
      Animated.timing(highlightAnim, { toValue: 0, duration: 400, useNativeDriver: false }),
    ]).start(() => setHighlightedId(null));
  }, [invertedMessages, highlightAnim]);

  const playAudio = useCallback(async (msg: Message) => {
    if (!msg.fileUrl) return;
    const url = msg.fileUrl.toLowerCase();
    if (url.endsWith('.webm') || url.endsWith('.ogg') || url.includes('audio/webm')) {
      Alert.alert('Unsupported Format', 'This voice note was recorded on the web in a format iOS cannot play. Future recordings from the app will work.');
      return;
    }
    try {
      if (playingId === msg.id) { await soundRef.current?.stopAsync(); await soundRef.current?.unloadAsync(); setPlayingId(null); return; }
      if (soundRef.current) { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: msg.fileUrl });
      soundRef.current = sound;
      setPlayingId(msg.id);
      sound.setOnPlaybackStatusUpdate(status => { if (status.isLoaded && status.didJustFinish) { setPlayingId(null); sound.unloadAsync(); } });
      await sound.playAsync();
    } catch (err: any) {
      console.warn('[Chat] playAudio error:', err);
      if (err?.message?.includes('not supported') || err?.message?.includes('-11828')) {
        Alert.alert('Unsupported Format', 'This audio format is not supported on iOS.');
      }
      setPlayingId(null);
    }
  }, [playingId]);

  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Microphone access is required.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true); setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err) { console.warn('[Chat] startRecording error:', err); }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (!uri || recordingTime < 1) return;
      // Voice uploads currently only route through the DM endpoint; keep
      // groups text-only until we add a matching group-upload route.
      if (isGroup) {
        Alert.alert('Not available', 'Voice notes aren\'t supported in group chats yet.');
        return;
      }
      setUploading(true);
      const sent = await messagingService.uploadFile(otherUserId, uri, `voice-${Date.now()}.m4a`, 'audio/m4a', 'voice');
      if (sent) { shouldAutoScroll.current = true; setMessages(prev => [...prev, sent]); }
      setUploading(false);
    } catch (err) { console.warn('[Chat] stopRecording error:', err); setIsRecording(false); setUploading(false); }
  }, [otherUserId, recordingTime, isGroup]);

  const pickAttachment = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Photo Library', 'Take Photo'], cancelButtonIndex: 0 },
        (idx) => { if (idx === 1) pickImage('library'); else if (idx === 2) pickImage('camera'); },
      );
    } else { pickImage('library'); }
  }, []);

  const pickImage = useCallback(async (source: 'library' | 'camera') => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return; }
        result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      }
      if (result.canceled || !result.assets?.[0]) return;
      // Image uploads only go through the DM endpoint today; skip with an
      // in-app alert for group threads rather than silently dropping.
      if (isGroup) {
        Alert.alert('Not available', 'Photo sharing isn\'t supported in group chats yet.');
        return;
      }
      const asset = result.assets[0];
      setUploading(true);
      const converted = await manipulateAsync(asset.uri, [], { compress: 0.8, format: SaveFormat.JPEG });
      const fileName = (asset.fileName || `photo-${Date.now()}`).replace(/\.(heic|heif|png|webp)$/i, '') + '.jpg';
      const sent = await messagingService.uploadFile(otherUserId, converted.uri, fileName, 'image/jpeg', 'image');
      if (sent) { shouldAutoScroll.current = true; setMessages(prev => [...prev, sent]); }
      setUploading(false);
    } catch (err) { console.warn('[Chat] pickImage error:', err); setUploading(false); }
  }, [otherUserId, isGroup]);

  const formatTime = (d: string) =>
    new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const formatDateSep = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (date.toDateString() === now.toDateString()) return 'Today';
    if (diff < 2 * 86400000) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const getReplyPreview = (msg: Message) => {
    if (msg.type === 'image') return '📷 Photo';
    if (msg.type === 'voice') return '🎤 Voice message';
    if (msg.type === 'file') return `📎 ${msg.fileName || 'File'}`;
    return msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content;
  };

  const highlightBg = highlightAnim.interpolate({
    inputRange: [0, 1], outputRange: ['transparent', 'rgba(66, 152, 211, 0.08)'],
  });

  const formatDisplayName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return fullName;
    return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
  };

  const getSenderName = (msg: Message) => {
    if (msg.senderId === currentUserId) return formatDisplayName(myName);
    // In a group thread, resolve from the participants map so each row shows
    // the actual sender (not the generic "other user"). Fall back to whatever
    // the server attached as `sender` for safety.
    if (isGroup) {
      const p = participantById[msg.senderId];
      return formatDisplayName(p?.name || msg.sender?.name || 'Member');
    }
    return formatDisplayName(otherUser?.name || msg.sender?.name || 'User');
  };

  const getSenderInitial = (msg: Message) => getSenderName(msg).charAt(0).toUpperCase();

  const getSenderPicture = (msg: Message) => {
    if (msg.senderId === currentUserId) return myPicture || msg.sender?.picture || null;
    if (isGroup) {
      const p = participantById[msg.senderId];
      return p?.picture || msg.sender?.picture || null;
    }
    return otherUser?.picture || msg.sender?.picture || null;
  };

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.senderId === currentUserId;
    const isSystem = item.type === 'system' || item.isSystemMessage;
    const above = index < invertedMessages.length - 1 ? invertedMessages[index + 1] : null;
    const showDate = !above || new Date(item.createdAt).toDateString() !== new Date(above.createdAt).toDateString();
    const isFirstInGroup = !above || above.senderId !== item.senderId || isSystem || (above.type === 'system' || above.isSystemMessage) ||
      (Math.abs(new Date(item.createdAt).getTime() - new Date(above.createdAt).getTime()) >= GROUP_GAP_MS) || showDate ||
      item.type === 'image' || above.type === 'image';

    const emojiOnly = item.type === 'text' && isEmojiOnly(item.content);
    const isHighlighted = highlightedId === item.id;
    const reactions = item.reactions || [];
    const isPlaying = playingId === item.id;
    const pic = getSenderPicture(item);

    return (
      <View>
        {showDate && (
          <View style={s.dateSep}>
            <Text style={[s.dateSepText, { color: C.textSecondary }]}>{formatDateSep(item.createdAt)}</Text>
          </View>
        )}

        {isSystem ? (
          <View style={s.systemRow}>
            <Image
              source={BARNABI_MASCOT}
              style={s.systemMascot}
              resizeMode="cover"
              accessibilityRole="image"
              accessibilityLabel="Barnabi"
            />
            <Text style={[s.systemText, { color: C.textSecondary }]}>{item.content}</Text>
          </View>
        ) : (
          <Animated.View style={[
            s.msgContainer,
            isFirstInGroup ? s.msgContainerFirst : s.msgContainerCont,
            isHighlighted && { backgroundColor: highlightBg, borderRadius: 8 },
          ]}>
            {isFirstInGroup && (
              <View style={s.senderRow}>
                {pic ? (
                  <Image source={{ uri: pic }} style={s.senderAvatar} />
                ) : (
                  <View style={[s.senderAvatar, s.senderAvatarFB, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8' }]}>
                    <Text style={[s.senderAvatarLetter, { color: isDark ? '#ccc' : '#717171' }]}>{getSenderInitial(item)}</Text>
                  </View>
                )}
                <Text style={[s.senderName, { color: C.text }]}>{getSenderName(item)}</Text>
                <Text style={[s.senderDot, { color: C.textTertiary }]}> · </Text>
                <Text style={[s.senderTime, { color: C.textSecondary }]}>{formatTime(item.createdAt)}</Text>
              </View>
            )}

            <Pressable
              onLongPress={(e) => openContextMenu(item, e.nativeEvent.pageY)}
              delayLongPress={350}
              style={({ pressed }) => [s.msgBody, isFirstInGroup ? s.msgBodyFirst : s.msgBodyCont, pressed && { opacity: 0.7 }]}
            >
              {item.replyTo && (
                <TouchableOpacity
                  style={[s.replyPreview, { backgroundColor: isDark ? '#1c1c1e' : '#f5f5f5' }]}
                  onPress={() => item.replyTo?.messageId && scrollToMessage(item.replyTo.messageId)}
                  activeOpacity={0.7}
                >
                  <View style={s.replyAccent} />
                  <View style={s.replyInner}>
                    <Text style={s.replySender}>
                      {item.replyTo.senderId === currentUserId ? 'You' : (item.replyTo.senderName || otherUser?.name || 'User')}
                    </Text>
                    <Text style={[s.replyText, { color: C.textSecondary }]} numberOfLines={1}>
                      {item.replyTo.type === 'image' ? '📷 Photo' : item.replyTo.type === 'voice' ? '🎤 Voice' : item.replyTo.content}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              {item.type === 'text' && (
                emojiOnly ? (
                  <Text style={s.emojiOnlyText}>{item.content}</Text>
                ) : (
                  <Text style={[s.msgText, { color: C.text }]}>{item.content}</Text>
                )
              )}

              {item.type === 'image' && item.fileUrl && (
                <TouchableOpacity onPress={() => setImageViewerUrl(item.fileUrl!)} activeOpacity={0.9}>
                  <Image source={{ uri: item.fileUrl }} style={s.msgImage} resizeMode="cover" />
                </TouchableOpacity>
              )}

              {item.type === 'file' && (
                <TouchableOpacity style={[s.fileRow, { backgroundColor: isDark ? '#1c1c1e' : '#f7f7f7' }]} onPress={() => item.fileUrl && Linking.openURL(item.fileUrl)} activeOpacity={0.7}>
                  <View style={s.fileIcon}>
                    <Ionicons name="document-text" size={16} color="#4298d3" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.fileName, { color: C.text }]} numberOfLines={1}>{item.fileName || 'File'}</Text>
                    {item.fileSize != null && <Text style={[s.fileSize, { color: C.textSecondary }]}>{(item.fileSize / 1024).toFixed(0)} KB</Text>}
                  </View>
                  <Ionicons name="arrow-down-circle-outline" size={20} color={C.textTertiary} />
                </TouchableOpacity>
              )}

              {item.type === 'voice' && (
                <TouchableOpacity style={[s.voiceRow, { backgroundColor: isDark ? '#1c1c1e' : '#f7f7f7' }]} onPress={() => playAudio(item)} activeOpacity={0.7}>
                  <View style={s.playBtn}>
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={14} color="#4298d3" />
                  </View>
                  <View style={s.voiceWave}>
                    {[0.3, 0.6, 1, 0.5, 0.8, 0.4, 0.9, 0.3, 0.7, 0.5, 0.8, 0.4, 0.6, 0.3].map((h, i) => (
                      <View key={i} style={[s.waveBar, { height: h * 16, backgroundColor: isDark ? 'rgba(66,152,211,0.5)' : 'rgba(66,152,211,0.3)' }]} />
                    ))}
                  </View>
                  <Text style={[s.voiceDur, { color: C.textSecondary }]}>
                    {item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}` : '0:00'}
                  </Text>
                </TouchableOpacity>
              )}

              {!isFirstInGroup && !emojiOnly && (
                <Text style={[s.inlineTime, { color: C.textTertiary }]}>{formatTime(item.createdAt)}</Text>
              )}
            </Pressable>

            {reactions.length > 0 && (
              <View style={s.reactionsRow}>
                {reactions.map((r, i) => (
                  <TouchableOpacity
                    key={`${r.emoji}-${r.userId}-${i}`}
                    style={[s.reactionPill, { backgroundColor: isDark ? '#2a2a2a' : '#e8e8e8' }, r.userId === currentUserId && { backgroundColor: isDark ? '#1a3050' : '#d4e8f5' }]}
                    onPress={() => openContextMenu(item, Dimensions.get('window').height * 0.45)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.reactionEmoji}>{r.emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </Animated.View>
        )}
      </View>
    );
  };

  const isMineCtx = contextMsg ? contextMsg.senderId === currentUserId : false;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
    <View style={[s.safe, { backgroundColor: C.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[s.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={goBack} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>

        {!isGroup ? (
          <View style={s.headerSingleAvatarWrap}>
            {otherUser?.picture ? (
              <Image source={{ uri: otherUser.picture }} style={s.headerAvatarImg} />
            ) : (
              <View style={[s.headerAvatarImg, s.headerAvatarFB]}>
                <Text style={s.headerAvatarLetter}>
                  {(otherUser?.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        ) : headerGroupCluster && headerGroupCluster.cells.length > 0 ? (
          <Pressable
            onPress={isClassConversation ? showClassRosterActionSheet : undefined}
            style={({ pressed }) => [
              s.headerClusterWrap,
              isClassConversation && pressed && { opacity: 0.86 },
            ]}
            accessible
            accessibilityRole={isClassConversation ? 'button' : 'image'}
            accessibilityLabel={
              isClassConversation
                ? t('MESSAGES.CLASS_ROSTER_SHEET_HINT')
                : headerGroupCluster.a11yLabel || headerTitle
            }
          >
            <View style={s.headerClusterBox} pointerEvents="box-none">
              {headerGroupCluster.cells.map((c, i) => {
                const n = headerGroupCluster.layoutN;
                if (c.isMore) {
                  return (
                    <View key="more" style={[headerClusterCellStyle(n, i), s.hcMore]}>
                      <Text style={s.hcMoreText} numberOfLines={1}>{c.n}</Text>
                    </View>
                  );
                }
                const p = c.p!;
                return (
                  <View
                    key={`${p.auth0Id || p.id}-${i}`}
                    style={[headerClusterCellStyle(n, i), s.hcRing, { borderColor: isDark ? '#1c1c1e' : '#fff' }]}
                  >
                    {p.picture ? (
                      <Image source={{ uri: p.picture }} style={s.hcCellFill} />
                    ) : (
                      <View style={[s.hcCellFill, s.hcFallback]}>
                        <Text style={s.hcCellLetter}>{(p.name || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={isClassConversation ? showClassRosterActionSheet : undefined}
            style={({ pressed }) => [
              s.headerClusterWrap,
              isClassConversation && pressed && { opacity: 0.86 },
            ]}
            accessible
            accessibilityLabel={isClassConversation ? t('MESSAGES.CLASS_ROSTER_SHEET_HINT') : headerTitle}
            accessibilityRole={isClassConversation ? 'button' : 'image'}
          >
            <View style={[s.headerGroupPlaceholder, { backgroundColor: isDark ? '#2c2c2e' : '#eef0f4' }]} pointerEvents="none">
              <Ionicons name="people" size={22} color={C.textSecondary} />
            </View>
          </Pressable>
        )}

        <View style={s.headerTitleWrap}>
          <Text style={[s.headerTitle, { color: C.text }]} numberOfLines={1}>
            {headerTitle}
          </Text>
        </View>
        <View style={s.headerRight} />
      </View>

      <KeyboardAvoidingView
        style={s.kavContainer}
        behavior="padding"
        keyboardVerticalOffset={insets.bottom}
      >
        <Animated.View style={[{ flex: 1 }, listGateMotion]}>
        <View style={[s.chatBody, { backgroundColor: C.background }]}>
          {loading ? (
            <View style={s.loadingWrap}><ActivityIndicator size="large" color={C.textTertiary} /></View>
          ) : messages.length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={C.textTertiary} />
              <Text style={[s.emptyTitle, { color: C.text }]}>No messages yet</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>
                {isGroup
                  ? `Start the conversation with ${groupParticipants.length} people.`
                  : `Start a conversation with ${otherUser?.name?.split(' ')[0] || 'them'}.`}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={invertedMessages}
              inverted
              keyExtractor={m => m.id}
              renderItem={renderItem}
              contentContainerStyle={s.messagesContent}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={handleContentSizeChange}
              onScrollBeginDrag={() => { shouldAutoScroll.current = false; }}
              ListFooterComponent={loadingOlder ? (
                <View style={s.olderLoader}><ActivityIndicator size="small" color={C.textTertiary} /></View>
              ) : hasMore && messages.length >= 50 ? (
                <TouchableOpacity style={s.olderLoader} onPress={loadOlder}>
                  <Text style={[s.loadOlderBtn, { color: '#4298d3' }]}>Load earlier messages</Text>
                </TouchableOpacity>
              ) : null}
            />
          )}
        </View>
        </Animated.View>

        <View style={[s.bottomArea, { backgroundColor: C.background }]}>
          {uploading && (
            <View style={[s.uploadBar, { backgroundColor: C.card }]}>
              <ActivityIndicator size="small" color="#4298d3" />
              <Text style={[s.uploadText, { color: C.textSecondary }]}>Sending...</Text>
            </View>
          )}

          {replyTo && (
            <View style={[s.replyBar, { backgroundColor: C.card }]}>
              <View style={s.replyBarAccent} />
              <View style={s.replyBarContent}>
                <Text style={s.replyBarLabel}>
                  Replying to {replyTo.senderId === currentUserId ? getSenderName(replyTo) : formatDisplayName(otherUser?.name || 'User')}
                </Text>
                <Text style={[s.replyBarText, { color: C.textSecondary }]} numberOfLines={1}>{getReplyPreview(replyTo)}</Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={18} color={C.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          {otherUserTime !== '' && !isClassConversation && (
            <View style={[s.theirTimeRow, { backgroundColor: C.background }]}>
              <Text style={[s.theirTimeText, { color: C.textTertiary }]}>It's {otherUserTime.toLowerCase()} for them</Text>
            </View>
          )}

          {isGroup && archived ? (
            <View style={[s.archivedBanner, { backgroundColor: C.inputBg, borderTopColor: C.border }]}>
              <Ionicons name="lock-closed-outline" size={14} color={C.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[s.archivedBannerText, { color: C.textSecondary }]}>
                You're no longer a member of this class conversation. History is read-only.
              </Text>
            </View>
          ) : isRecording ? (
            <View style={[s.inputBar, { backgroundColor: C.background, borderTopColor: C.border }]}>
              <View style={s.recordingPulse} />
              <Text style={[s.recordingLabel, { color: C.text }]}>{Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); setIsRecording(false); recordingRef.current?.stopAndUnloadAsync(); recordingRef.current = null; }}>
                <Text style={[s.recordingCancelText, { color: C.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.sendBtnActive, { backgroundColor: C.accent }]} onPress={stopRecording} activeOpacity={0.7}>
                <Ionicons name="send" size={16} color={C.background} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[s.inputBar, { backgroundColor: C.background, borderTopColor: C.border }]}>
              <TouchableOpacity onPress={pickAttachment} activeOpacity={0.6} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="attach" size={24} color={C.textSecondary} style={{ transform: [{ rotate: '-45deg' }] }} />
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                style={[s.textInput, { color: C.text, backgroundColor: C.inputBg }]}
                placeholder="Your message"
                placeholderTextColor={C.textTertiary}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={2000}
              />
              {text.trim() ? (
                <TouchableOpacity style={[s.sendBtnActive, { backgroundColor: C.accent }]} onPress={handleSend} disabled={sending} activeOpacity={0.7}>
                  {sending ? <ActivityIndicator size="small" color={C.background} /> : <Ionicons name="send" size={16} color={C.background} />}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={startRecording} activeOpacity={0.6} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="mic-outline" size={24} color={C.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!imageViewerUrl} transparent animationType="fade" onRequestClose={() => setImageViewerUrl(null)}>
        <View style={s.imgViewerBg}>
          <View style={[s.imgViewerHeader, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={() => setImageViewerUrl(null)} style={s.imgCloseBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          {imageViewerUrl && <Image source={{ uri: imageViewerUrl }} style={s.imgViewerImage} resizeMode="contain" />}
          <View style={{ height: insets.bottom }} />
        </View>
      </Modal>

      {/*
        Roster bottom sheet.
        - animationType="none" + our own Animated values so the backdrop fades
          independently of the sheet slide-up (RN's default `slide` moves
          everything together and reads as "the whole chat wipes away").
        - statusBarTranslucent avoids the gap under the status bar on Android.
      */}
      <Modal
        visible={rosterMounted}
        transparent
        animationType="none"
        onRequestClose={closeClassRosterSheet}
        statusBarTranslucent
      >
        <View style={s.classRosterRoot}>
          <Animated.View
            style={[
              s.classRosterBackdrop,
              {
                backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)',
                opacity: rosterAnim,
              },
            ]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeClassRosterSheet} />
          </Animated.View>
          <Animated.View
            style={[
              s.classRosterSheet,
              {
                backgroundColor: C.card,
                borderTopColor: C.border,
                paddingBottom: Math.max(insets.bottom, 12) + 8,
                transform: [{
                  translateY: rosterAnim.interpolate({ inputRange: [0, 1], outputRange: [480, 0] }),
                }],
              },
            ]}
          >
            <View style={[s.classRosterHandle, { backgroundColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)' }]} />
            {rosterData && (
              <>
                <Text style={[s.classRosterTitle, { color: C.text }]}>{rosterData.title}</Text>
                <Text style={[s.classRosterHint, { color: C.textSecondary }]} numberOfLines={2}>
                  {t('MESSAGES.CLASS_ROSTER_SHEET_HINT')}
                </Text>
                {rosterData.empty ? (
                  <View style={s.classRosterEmptyWrap}>
                    <Text style={[s.classRosterEmptyText, { color: C.textSecondary }]}>
                      {t('MESSAGES.CLASS_ROSTER_EMPTY')}
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={s.classRosterScroll}
                    contentContainerStyle={s.classRosterScrollContent}
                    showsVerticalScrollIndicator
                    bounces
                    keyboardShouldPersistTaps="handled"
                  >
                    {rosterData.rows.map((row, i) => {
                      const isLast = i === rosterData.rows.length - 1;
                      const initial = (row.name || '?').trim().charAt(0).toUpperCase() || '?';
                      return (
                        <View
                          key={row.id}
                          style={[
                            s.classRosterRow,
                            !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
                          ]}
                        >
                          {row.picture ? (
                            <Image source={{ uri: row.picture }} style={s.classRosterAvatar} />
                          ) : (
                            <View style={[s.classRosterAvatar, s.classRosterAvatarFB]}>
                              <Text style={s.classRosterAvatarLetter}>{initial}</Text>
                            </View>
                          )}
                          <Text
                            style={[
                              s.classRosterName,
                              { color: C.text },
                              row.isSelf && { fontWeight: '600' },
                            ]}
                            numberOfLines={1}
                          >
                            {row.name}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
                <TouchableOpacity
                  style={[s.classRosterDone, { backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' }]}
                  onPress={closeClassRosterSheet}
                  activeOpacity={0.7}
                >
                  <Text style={[s.classRosterDoneText, { color: C.accent }]}>{t('COMMON.OK')}</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      </Modal>

    </View>

    <View style={StyleSheet.absoluteFill} pointerEvents={contextVisible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: contextAnim }]}>
        <BlurView tint="dark" intensity={contextVisible ? 30 : 0} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {contextVisible && <Pressable style={StyleSheet.absoluteFill} onPress={closeContextMenu} />}
      <Animated.View style={[s.ctxCenter, { opacity: contextAnim }]} pointerEvents={contextVisible ? 'box-none' : 'none'}>
        <View style={s.ctxSheet}>
          <Animated.View style={[s.ctxEmojiCard, {
            opacity: emojiItemAnims[0],
            backgroundColor: isDark ? '#2c2c2e' : '#fff',
          }]}>
            <View style={s.ctxEmojiRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.ctxEmojiScroll} style={{ flex: 1 }}>
                {QUICK_REACTIONS.map((emoji, index) => {
                  const hasIt = contextMsg && (contextMsg.reactions || []).some(
                    r => r.userId === currentUserId && r.emoji === emoji,
                  );
                  return (
                    <Animated.View
                      key={emoji}
                      style={{
                        opacity: emojiItemAnims[index],
                        transform: [
                          { scale: emojiItemAnims[index].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                          { translateY: emojiItemAnims[index].interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                        ],
                      }}
                    >
                      <TouchableOpacity
                        style={[s.ctxEmojiBtn, hasIt && s.ctxEmojiBtnActive]}
                        onPress={() => handleReaction(emoji)}
                        activeOpacity={0.6}
                      >
                        <Text style={s.ctxEmoji}>{emoji}</Text>
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </ScrollView>
              <View style={[s.ctxEmojiPlusDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]} />
              <Animated.View style={{
                opacity: emojiItemAnims[QUICK_REACTIONS.length],
                transform: [
                  { scale: emojiItemAnims[QUICK_REACTIONS.length].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                ],
              }}>
                <TouchableOpacity style={[s.ctxEmojiPlusBtn, { backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' }]} onPress={toggleEmojiDrawer} activeOpacity={0.6}>
                  <Ionicons name={emojiDrawerOpen ? 'close' : 'add'} size={20} color={isDark ? '#ccc' : '#888'} />
                </TouchableOpacity>
              </Animated.View>
            </View>

            {emojiDrawerOpen && (
              <Animated.View style={{
                height: drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 240] }),
                overflow: 'hidden' as const,
              }}>
                <View style={[s.ctxDrawerDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]} />
                <ScrollView contentContainerStyle={s.ctxDrawerGrid} showsVerticalScrollIndicator={false}>
                  {EXTENDED_EMOJIS.map((emoji, i) => (
                    <TouchableOpacity
                      key={`${emoji}-${i}`}
                      style={s.ctxDrawerCell}
                      onPress={() => handleReaction(emoji)}
                      activeOpacity={0.6}
                    >
                      <Text style={s.ctxDrawerEmoji}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </Animated.View>
            )}
          </Animated.View>

          <Animated.View style={[s.ctxMsgWrap, {
            opacity: msgPreviewAnim,
            transform: [
              { translateY: msgSlideAnim },
              { scale: msgPreviewAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            ],
          }]}>
            <View style={[s.ctxMsgPreview, { backgroundColor: isDark ? '#2c2c2e' : '#fff' }]}>
              {contextMsg?.type === 'text' && (
                <Text style={[s.ctxMsgText, { color: C.text }]} numberOfLines={6}>{contextMsg.content}</Text>
              )}
              {contextMsg?.type === 'image' && contextMsg.fileUrl && (
                <Image source={{ uri: contextMsg.fileUrl }} style={s.ctxMsgImage} resizeMode="cover" />
              )}
              {contextMsg?.type === 'voice' && (
                <View style={s.ctxMsgMeta}>
                  <Ionicons name="mic" size={18} color="#4298d3" />
                  <Text style={[s.ctxMsgMetaText, { color: C.textSecondary }]}>Voice message</Text>
                </View>
              )}
              {contextMsg?.type === 'file' && (
                <View style={s.ctxMsgMeta}>
                  <Ionicons name="document-text" size={18} color="#4298d3" />
                  <Text style={[s.ctxMsgMetaText, { color: C.textSecondary }]} numberOfLines={1}>{contextMsg.fileName || 'File'}</Text>
                </View>
              )}
              {contextMsg && (
                <Text style={[s.ctxMsgTime, { color: C.textSecondary }]}>{formatTime(contextMsg.createdAt)}</Text>
              )}
            </View>
            <View style={[s.ctxMsgTail, { backgroundColor: isDark ? '#2c2c2e' : '#fff' }]} />
          </Animated.View>

          <Animated.View style={[s.ctxActionCard, {
            opacity: actionCardAnim,
            backgroundColor: isDark ? '#2c2c2e' : '#fff',
            transform: [
              { translateY: actionCardAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          }]}>
            <TouchableOpacity style={s.ctxAction} onPress={handleReply} activeOpacity={0.6}>
              <Text style={[s.ctxActionText, { color: C.text }]}>Reply</Text>
              <Ionicons name="arrow-undo-outline" size={20} color={C.textSecondary} />
            </TouchableOpacity>
            {contextMsg?.type === 'text' && (
              <>
                <View style={[s.ctxActionDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                <TouchableOpacity style={s.ctxAction} onPress={handleCopy} activeOpacity={0.6}>
                  <Text style={[s.ctxActionText, { color: C.text }]}>Copy</Text>
                  <Ionicons name="copy-outline" size={20} color={C.textSecondary} />
                </TouchableOpacity>
              </>
            )}
            {isMineCtx && (
              <>
                <View style={[s.ctxActionDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                <TouchableOpacity style={s.ctxAction} onPress={handleDelete} activeOpacity={0.6}>
                  <Text style={[s.ctxActionText, { color: '#ff3b30' }]}>Delete</Text>
                  <Ionicons name="trash-outline" size={20} color="#ff3b30" />
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      </Animated.View>
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  kavContainer: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HEADER_HEIGHT,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    backgroundColor: '#fff',
  },
  backBtn: { padding: 8 },
  /** Single 1:1 + stacked group avatars to the right of the back chevron (matches web). */
  headerSingleAvatarWrap: { marginLeft: 2, marginRight: 2, justifyContent: 'center' },
  headerAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8e8e8',
    overflow: 'hidden',
  },
  headerAvatarFB: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4298d3',
  },
  headerAvatarLetter: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerClusterWrap: { marginLeft: 2, marginRight: 2, justifyContent: 'center' },
  headerClusterBox: { width: 40, height: 40, position: 'relative' },
  headerGroupPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hcRing: {
    borderWidth: 2,
    overflow: 'hidden',
  },
  hcCellFill: { width: '100%' as any, height: '100%' as any },
  hcFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#4298d3' },
  hcCellLetter: { fontSize: 10, fontWeight: '700', color: '#fff' },
  hcMore: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2f2f33',
  },
  hcMoreText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  headerTitleWrap: { flex: 1, minWidth: 0, marginLeft: 4, paddingRight: 4, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', textAlign: 'left' },
  headerRight: { width: 40, flexShrink: 0 },

  chatBody: { flex: 1, backgroundColor: '#fff' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#222' },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },

  /**
   * Inverted chat: `flexGrow` + `justifyContent: 'flex-end'` keeps a short
   * thread from floating mid-screen with a large gap under the header; it
   * pins the message block to the end of the flex column (the input side
   * in an inverted list, i.e. content reads top→bottom like a normal chat).
   * `maintainVisibleContentPosition` was removed — it often adds extra top
   * padding on first paint for inverted lists.
   */
  messagesContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },

  olderLoader: { alignItems: 'center', paddingVertical: 16 },
  loadOlderBtn: { fontSize: 13, fontWeight: '600', color: '#4298d3' },

  dateSep: { alignItems: 'center', paddingVertical: 16 },
  dateSepText: { fontSize: 13, fontWeight: '600', color: '#717171' },

  systemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  systemMascot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    flexShrink: 0,
    marginRight: 10,
  },
  systemText: {
    flex: 1,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
  },

  msgContainer: { paddingVertical: 1 },
  msgContainerFirst: { marginTop: 16 },
  msgContainerCont: { marginTop: 2 },

  senderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  senderAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  senderAvatarFB: { backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
  senderAvatarLetter: { fontSize: 12, fontWeight: '700', color: '#717171' },
  senderName: { fontSize: 14, fontWeight: '600', color: '#111' },
  senderDot: { fontSize: 12, color: '#ccc' },
  senderTime: { fontSize: 12, color: '#999' },

  msgBody: {},
  msgBodyFirst: { paddingLeft: 36 },
  msgBodyCont: { paddingLeft: 36 },

  msgText: { fontSize: 15, lineHeight: 22, color: '#222', letterSpacing: -0.1 },
  emojiOnlyText: { fontSize: 40, lineHeight: 48 },

  inlineTime: { fontSize: 11, color: '#b0b0b0', marginTop: 2 },

  msgImage: { width: 180, height: 140, borderRadius: 12, marginTop: 4 },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f7f7f7', borderRadius: 12 },
  fileIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(66,152,211,0.1)', alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 14, fontWeight: '500', color: '#111' },
  fileSize: { fontSize: 11, color: '#999', marginTop: 1 },

  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f7f7f7', borderRadius: 12, minWidth: 180 },
  playBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(66,152,211,0.12)', alignItems: 'center', justifyContent: 'center' },
  voiceWave: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  waveBar: { width: 2, borderRadius: 1.5, backgroundColor: 'rgba(66,152,211,0.3)' },
  voiceDur: { fontSize: 12, color: '#717171', minWidth: 32, textAlign: 'right' },

  replyPreview: { flexDirection: 'row', marginBottom: 4, borderRadius: 8, backgroundColor: '#f5f5f5', padding: 8, gap: 8 },
  replyAccent: { width: 3, borderRadius: 2, backgroundColor: '#4298d3' },
  replyInner: { flex: 1 },
  replySender: { fontSize: 11, fontWeight: '600', color: '#4298d3', marginBottom: 1 },
  replyText: { fontSize: 12, color: '#717171' },

  reactionsRow: { flexDirection: 'row', paddingLeft: 36, marginTop: 4, gap: 4 },
  reactionPill: {
    backgroundColor: '#e8e8e8', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3,
  },
  reactionPillMine: { backgroundColor: '#d4e8f5' },
  reactionEmoji: { fontSize: 14 },

  bottomArea: { backgroundColor: '#fff' },

  uploadBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 6, backgroundColor: '#fafafa',
  },
  uploadText: { fontSize: 13, color: '#999' },

  replyBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fafafa', gap: 10,
  },
  replyBarAccent: { width: 3, height: 32, borderRadius: 2, backgroundColor: '#4298d3' },
  replyBarContent: { flex: 1 },
  replyBarLabel: { fontSize: 12, fontWeight: '600', color: '#4298d3' },
  replyBarText: { fontSize: 13, color: '#717171', marginTop: 1 },

  theirTimeRow: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 2, backgroundColor: '#fff' },
  theirTimeText: { fontSize: 12, color: '#b0b0b0', textAlign: 'center' },

  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e5e5', backgroundColor: '#fff',
  },
  archivedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e5e5',
    backgroundColor: '#f5f5f7',
  },
  archivedBannerText: {
    fontSize: 13, fontWeight: '500', color: '#6a6a6a', textAlign: 'center', letterSpacing: -0.1,
  },
  textInput: {
    flex: 1, fontSize: 15, color: '#111', maxHeight: 100, minHeight: 36,
    paddingTop: 8, paddingBottom: 8, paddingHorizontal: 14, letterSpacing: -0.1,
    borderRadius: 20,
  },
  sendBtnActive: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#222',
    alignItems: 'center', justifyContent: 'center',
  },

  recordingPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff3b30' },
  recordingLabel: { fontSize: 16, fontWeight: '500', color: '#111', fontVariant: ['tabular-nums'] },
  recordingCancelText: { fontSize: 15, color: '#717171', fontWeight: '500', marginRight: 12 },

  ctxCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  ctxSheet: {
    width: '100%',
    maxWidth: 320,
    gap: 6,
    alignItems: 'flex-start',
  },
  ctxEmojiCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  ctxEmojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ctxEmojiScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  ctxEmojiBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctxEmojiBtnActive: { backgroundColor: 'rgba(66,152,211,0.15)' },
  ctxEmoji: { fontSize: 28 },
  ctxEmojiPlusDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginVertical: 'auto' as any,
  },
  ctxEmojiPlusBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  ctxDrawerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginHorizontal: 8,
  },
  ctxDrawerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  ctxDrawerCell: {
    width: '14.28%' as any,
    paddingVertical: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  ctxDrawerEmoji: { fontSize: 28 },
  ctxMsgWrap: {
    alignSelf: 'flex-start',
    maxWidth: '85%' as any,
  },
  ctxMsgPreview: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  ctxMsgTail: {
    width: 10,
    height: 10,
    backgroundColor: '#fff',
    borderBottomRightRadius: 10,
    marginTop: -4,
    marginLeft: 0,
  },
  ctxMsgText: { fontSize: 15, lineHeight: 22, color: '#222' },
  ctxMsgTime: { fontSize: 12, color: '#999', textAlign: 'right', marginTop: 6 },
  ctxMsgImage: { width: '100%' as any, height: 180, borderRadius: 10 },
  ctxMsgMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctxMsgMetaText: { fontSize: 14, color: '#717171', flex: 1 },
  ctxActionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  ctxAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  ctxActionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  ctxActionText: { fontSize: 16, color: '#1c1c1e' },

  imgViewerBg: { flex: 1, backgroundColor: '#000' },
  imgViewerHeader: { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 16, paddingBottom: 12 },
  imgCloseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  imgViewerImage: { flex: 1, width: '100%' },

  /**
   * Class roster bottom sheet — bottom-anchored card with a drag handle,
   * avatar + name rows, and a "Done" button. The sheet and backdrop animate
   * independently (see `rosterAnim` in the component body).
   */
  classRosterRoot: { flex: 1, justifyContent: 'flex-end' },
  classRosterBackdrop: { ...StyleSheet.absoluteFillObject },
  classRosterSheet: {
    maxHeight: '88%' as any,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  classRosterHandle: { width: 40, height: 5, borderRadius: 2.5, alignSelf: 'center', marginBottom: 12 },
  classRosterTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  classRosterHint: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 12, lineHeight: 18, paddingHorizontal: 8 },
  classRosterScroll: { maxHeight: Dimensions.get('window').height * 0.46 },
  classRosterScrollContent: { paddingBottom: 8 },
  classRosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  classRosterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e8e8e8',
    overflow: 'hidden',
  },
  classRosterAvatarFB: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4298d3',
  },
  classRosterAvatarLetter: { fontSize: 14, fontWeight: '700', color: '#fff' },
  classRosterName: { flex: 1, fontSize: 16, lineHeight: 22 },
  classRosterEmptyWrap: { paddingVertical: 24, alignItems: 'center' },
  classRosterEmptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  classRosterDone: { marginTop: 8, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  classRosterDoneText: { fontSize: 17, fontWeight: '600' },
});
