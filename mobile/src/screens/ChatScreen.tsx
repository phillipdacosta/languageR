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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { messagingService, Conversation, Message } from '../services/messaging';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  currentUserName?: string;
  currentUserPicture?: string;
  goBack: () => void;
}

const HEADER_HEIGHT = 56;
const GROUP_GAP_MS = 120000;
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

export default function ChatScreen({ conversation, currentUserId, currentUserName: propName, currentUserPicture, goBack }: Props) {
  const insets = useSafeAreaInsets();
  const { colors: C, isDark } = useTheme();
  const otherUser = conversation.otherUser;
  const otherUserId = otherUser?.auth0Id || otherUser?.id || '';

  const myName = propName || 'You';
  const myPicture = currentUserPicture || null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
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

  useEffect(() => {
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
  }, [otherUser?.timezone]);

  useEffect(() => { return () => { soundRef.current?.unloadAsync(); }; }, []);

  const fetchMessages = useCallback(async () => {
    const data = await messagingService.getMessages(otherUserId, 50);
    const sorted = [...data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    setMessages(sorted);
    setHasMore(data.length >= 50);
    setLoading(false);
    messagingService.markRead(otherUserId);
    isInitialLoad.current = true;
    shouldAutoScroll.current = true;
  }, [otherUserId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

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
    const older = await messagingService.getMessages(otherUserId, 50, oldest.id);
    if (older.length < 50) setHasMore(false);
    if (older.length > 0) {
      const sorted = [...older].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setMessages(prev => [...sorted, ...prev]);
    }
    setLoadingOlder(false);
  }, [loadingOlder, hasMore, messages, otherUserId]);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;
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
      senderId: currentUserId, receiverId: otherUserId,
      content, type: 'text', read: false,
      createdAt: new Date().toISOString(), replyTo: replyPayload,
    };
    shouldAutoScroll.current = true;
    setMessages(prev => [...prev, optimistic]);
    const sent = await messagingService.sendMessage(otherUserId, content, 'text', replyPayload);
    if (sent) setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...sent, createdAt: sent.createdAt || optimistic.createdAt } : m));
    setSending(false);
  }, [text, sending, conversation.conversationId, currentUserId, otherUserId, replyTo, otherUser?.name]);

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
      setUploading(true);
      const sent = await messagingService.uploadFile(otherUserId, uri, `voice-${Date.now()}.m4a`, 'audio/m4a', 'voice');
      if (sent) { shouldAutoScroll.current = true; setMessages(prev => [...prev, sent]); }
      setUploading(false);
    } catch (err) { console.warn('[Chat] stopRecording error:', err); setIsRecording(false); setUploading(false); }
  }, [otherUserId, recordingTime]);

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
      const asset = result.assets[0];
      setUploading(true);
      const converted = await manipulateAsync(asset.uri, [], { compress: 0.8, format: SaveFormat.JPEG });
      const fileName = (asset.fileName || `photo-${Date.now()}`).replace(/\.(heic|heif|png|webp)$/i, '') + '.jpg';
      const sent = await messagingService.uploadFile(otherUserId, converted.uri, fileName, 'image/jpeg', 'image');
      if (sent) { shouldAutoScroll.current = true; setMessages(prev => [...prev, sent]); }
      setUploading(false);
    } catch (err) { console.warn('[Chat] pickImage error:', err); setUploading(false); }
  }, [otherUserId]);

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
    return formatDisplayName(otherUser?.name || msg.sender?.name || 'User');
  };

  const getSenderInitial = (msg: Message) => getSenderName(msg).charAt(0).toUpperCase();

  const getSenderPicture = (msg: Message) => {
    if (msg.senderId === currentUserId) return myPicture || msg.sender?.picture || null;
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
    <SafeAreaView style={[s.safe, { backgroundColor: C.background }]} edges={['top', 'bottom']}>
      <View style={[s.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={goBack} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: C.text }]} numberOfLines={1}>{otherUser?.name || 'Chat'}</Text>
        <View style={s.headerRight} />
      </View>

      <KeyboardAvoidingView
        style={s.kavContainer}
        behavior="padding"
        keyboardVerticalOffset={insets.bottom}
      >
        <View style={[s.chatBody, { backgroundColor: C.background }]}>
          {loading ? (
            <View style={s.loadingWrap}><ActivityIndicator size="large" color={C.textTertiary} /></View>
          ) : messages.length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={C.textTertiary} />
              <Text style={[s.emptyTitle, { color: C.text }]}>No messages yet</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>Start a conversation with {otherUser?.name?.split(' ')[0] || 'them'}.</Text>
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
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
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

          {otherUserTime !== '' && (
            <View style={[s.theirTimeRow, { backgroundColor: C.background }]}>
              <Text style={[s.theirTimeText, { color: C.textTertiary }]}>It's {otherUserTime.toLowerCase()} for them</Text>
            </View>
          )}

          {isRecording ? (
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
                style={[s.textInput, { color: C.text, backgroundColor: isDark ? '#1c1c1e' : '#f2f2f7' }]}
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
    </SafeAreaView>

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
    flexDirection: 'row', alignItems: 'center', height: HEADER_HEIGHT,
    paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', backgroundColor: '#fff',
  },
  backBtn: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: '#111', textAlign: 'center', marginRight: 40 },
  headerRight: { width: 40 },

  chatBody: { flex: 1, backgroundColor: '#fff' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#222' },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },

  messagesContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },

  olderLoader: { alignItems: 'center', paddingVertical: 16 },
  loadOlderBtn: { fontSize: 13, fontWeight: '600', color: '#4298d3' },

  dateSep: { alignItems: 'center', paddingVertical: 16 },
  dateSepText: { fontSize: 13, fontWeight: '600', color: '#717171' },

  systemRow: { alignItems: 'center', paddingVertical: 10 },
  systemText: { fontSize: 13, color: '#999', textAlign: 'center', fontStyle: 'italic' },

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
});
