import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { messagingService, Conversation, Message } from '../services/messaging';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  goBack: () => void;
}

export default function ChatScreen({ conversation, currentUserId, goBack }: Props) {
  const otherUser = conversation.otherUser;
  const otherUserId = otherUser?.auth0Id || otherUser?.id || '';

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const fetchMessages = useCallback(async () => {
    const data = await messagingService.getMessages(otherUserId, 50);
    setMessages(data.reverse());
    setHasMore(data.length >= 50);
    setLoading(false);
  }, [otherUserId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0];
    const older = await messagingService.getMessages(otherUserId, 50, oldest.id);
    if (older.length < 50) setHasMore(false);
    if (older.length > 0) {
      setMessages(prev => [...older.reverse(), ...prev]);
    }
    setLoadingOlder(false);
  }, [loadingOlder, hasMore, messages, otherUserId]);

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText('');

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversationId: conversation.conversationId,
      senderId: currentUserId,
      receiverId: otherUserId,
      content,
      type: 'text',
      read: false,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    const sent = await messagingService.sendMessage(otherUserId, content);
    if (sent) {
      setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...sent, createdAt: sent.createdAt || optimistic.createdAt } : m));
    }
    setSending(false);
  }, [text, sending, conversation.conversationId, currentUserId, otherUserId]);

  const shouldShowDate = (msg: Message, prev?: Message): boolean => {
    if (!prev) return true;
    const d1 = new Date(msg.createdAt).toDateString();
    const d2 = new Date(prev.createdAt).toDateString();
    return d1 !== d2;
  };

  const formatMessageTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatDateSeparator = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (diff < 2 * 86400000) return 'Yesterday';
    if (diff < 7 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  };

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const prev = index > 0 ? messages[index - 1] : undefined;
    const isMine = item.senderId === currentUserId;
    const isSystem = item.type === 'system' || item.isSystemMessage;
    const showDate = shouldShowDate(item, prev);

    return (
      <View>
        {showDate && (
          <View style={s.dateSep}>
            <Text style={s.dateSepText}>{formatDateSeparator(item.createdAt)}</Text>
          </View>
        )}

        {isSystem ? (
          <View style={s.systemRow}>
            <Image source={require('../../assets/shared/barnabi-bird.png')} style={s.systemAvatar} />
            <View style={s.systemBubble}>
              <Text style={s.systemText}>{item.content}</Text>
              <Text style={s.systemTime}>{formatMessageTime(item.createdAt)}</Text>
            </View>
          </View>
        ) : (
          <View style={[s.bubbleRow, isMine ? s.bubbleRowSent : s.bubbleRowReceived]}>
            <View style={[s.bubble, isMine ? s.bubbleSent : s.bubbleReceived]}>
              {item.replyTo && (
                <View style={s.replyPreview}>
                  <View style={s.replyLine} />
                  <View style={s.replyContent}>
                    <Text style={s.replySender}>{item.replyTo.senderName || 'User'}</Text>
                    <Text style={s.replyText} numberOfLines={1}>
                      {item.replyTo.type === 'image' ? '📷 Photo' : item.replyTo.type === 'voice' ? '🎤 Voice' : item.replyTo.content}
                    </Text>
                  </View>
                </View>
              )}

              {item.type === 'text' && (
                <Text style={[s.msgText, isMine ? s.msgTextSent : s.msgTextReceived]}>{item.content}</Text>
              )}
              {item.type === 'image' && item.fileUrl && (
                <Image source={{ uri: item.fileUrl }} style={s.msgImage} resizeMode="cover" />
              )}
              {item.type === 'file' && (
                <View style={s.fileRow}>
                  <Ionicons name="document-outline" size={20} color={isMine ? '#fff' : '#4298d3'} />
                  <Text style={[s.fileName, isMine && { color: '#fff' }]} numberOfLines={1}>{item.fileName || 'File'}</Text>
                </View>
              )}
              {item.type === 'voice' && (
                <View style={s.voiceRow}>
                  <Ionicons name="mic" size={18} color={isMine ? '#fff' : '#4298d3'} />
                  <Text style={[s.voiceDur, isMine && { color: 'rgba(255,255,255,0.8)' }]}>{item.duration ? `${item.duration}s` : 'Voice'}</Text>
                </View>
              )}

              <Text style={[s.msgTime, isMine ? s.msgTimeSent : s.msgTimeReceived]}>
                {formatMessageTime(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Chat Header */}
      <View style={s.chatHeader}>
        <TouchableOpacity onPress={goBack} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#222" />
        </TouchableOpacity>
        {otherUser?.picture ? (
          <Image source={{ uri: otherUser.picture }} style={s.headerAvatar} />
        ) : (
          <View style={[s.headerAvatar, s.headerAvatarFB]}>
            <Text style={s.headerAvatarLetter}>{(otherUser?.name || '?').charAt(0)}</Text>
          </View>
        )}
        <View style={s.headerInfo}>
          <Text style={s.headerName} numberOfLines={1}>{otherUser?.name || 'Unknown'}</Text>
          <Text style={s.headerSub}>{otherUser?.userType === 'tutor' ? 'Tutor' : otherUser?.userType || 'User'}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={s.kavContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {loading ? (
          <View style={s.loadingWrap}><ActivityIndicator size="large" color="#999" /></View>
        ) : messages.length === 0 ? (
          <View style={s.emptyWrap}>
            <Ionicons name="chatbubbles-outline" size={48} color="#ddd" />
            <Text style={s.emptyTitle}>No messages yet</Text>
            <Text style={s.emptySub}>Say hello to start the conversation.</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderItem}
            contentContainerStyle={s.messagesContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onEndReachedThreshold={0.1}
            ListHeaderComponent={
              loadingOlder ? (
                <View style={s.olderLoader}><ActivityIndicator size="small" color="#999" /><Text style={s.olderText}>Loading older messages...</Text></View>
              ) : hasMore && messages.length >= 50 ? (
                <TouchableOpacity style={s.olderLoader} onPress={loadOlder}><Text style={s.loadOlderBtn}>Load older messages</Text></TouchableOpacity>
              ) : null
            }
          />
        )}

        {/* Input */}
        <SafeAreaView edges={['bottom']} style={s.inputSafe}>
          <View style={s.inputBar}>
            <TextInput
              ref={inputRef}
              style={s.textInput}
              placeholder="Type a message..."
              placeholderTextColor="#b0b0b0"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
              activeOpacity={0.7}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const SENT_BG = '#4298d3';
const RECEIVED_BG = '#f0f0f0';

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  kavContainer: { flex: 1 },

  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    backgroundColor: '#fff',
  },
  backBtn: { padding: 6 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, marginLeft: 4, marginRight: 10 },
  headerAvatarFB: { backgroundColor: '#4298d3', alignItems: 'center', justifyContent: 'center' },
  headerAvatarLetter: { fontSize: 15, fontWeight: '700', color: '#fff' },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '700', color: '#222' },
  headerSub: { fontSize: 12, color: '#999', marginTop: 1 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#222', marginTop: 8 },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center' },

  messagesContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },

  olderLoader: { alignItems: 'center', paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  olderText: { fontSize: 12, color: '#999' },
  loadOlderBtn: { fontSize: 13, fontWeight: '600', color: '#4298d3' },

  dateSep: { alignItems: 'center', paddingVertical: 12 },
  dateSepText: { fontSize: 12, fontWeight: '600', color: '#b0b0b0', backgroundColor: '#fff', paddingHorizontal: 12 },

  systemRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, paddingRight: 50 },
  systemAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  systemBubble: { backgroundColor: '#f7f7f7', borderRadius: 16, borderBottomLeftRadius: 4, padding: 12, maxWidth: '80%' },
  systemText: { fontSize: 14, color: '#555', lineHeight: 20 },
  systemTime: { fontSize: 10, color: '#b0b0b0', marginTop: 4 },

  bubbleRow: { marginBottom: 4 },
  bubbleRowSent: { alignItems: 'flex-end' },
  bubbleRowReceived: { alignItems: 'flex-start' },

  bubble: { maxWidth: '78%', borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  bubbleSent: { backgroundColor: SENT_BG, borderBottomRightRadius: 4 },
  bubbleReceived: { backgroundColor: RECEIVED_BG, borderBottomLeftRadius: 4 },

  msgText: { fontSize: 15, lineHeight: 21 },
  msgTextSent: { color: '#fff' },
  msgTextReceived: { color: '#222' },

  msgTime: { fontSize: 10, marginTop: 4 },
  msgTimeSent: { color: 'rgba(255,255,255,0.65)', textAlign: 'right' },
  msgTimeReceived: { color: '#b0b0b0' },

  msgImage: { width: 200, height: 200, borderRadius: 12, marginBottom: 4 },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileName: { fontSize: 13, fontWeight: '600', color: '#4298d3', flex: 1 },

  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  voiceDur: { fontSize: 13, color: '#717171' },

  replyPreview: { flexDirection: 'row', marginBottom: 6, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.06)', padding: 8, gap: 8 },
  replyLine: { width: 3, borderRadius: 2, backgroundColor: '#4298d3' },
  replyContent: { flex: 1 },
  replySender: { fontSize: 11, fontWeight: '700', color: '#4298d3', marginBottom: 2 },
  replyText: { fontSize: 12, color: '#717171' },

  inputSafe: { backgroundColor: '#fff' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    backgroundColor: '#fff',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: '#222',
    maxHeight: 100,
    minHeight: 40,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#4298d3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#d0d0d0' },
});
