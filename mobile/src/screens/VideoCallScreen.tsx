import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Alert,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RtcSurfaceView, VideoMirrorModeType, type IRtcEngine } from 'react-native-agora';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';

import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../hooks/useAuth';
import { lessonService, Lesson, clearDetailCache } from '../services/lessons';
import { agoraService, type VbMode } from '../services/agora';
import { messagingService, type Message } from '../services/messaging';

const INTENT_DISPLAY: Record<string, { emoji: string; labelKey: string; hintKey: string }> = {
  easy: { emoji: '😌', labelKey: 'VIDEO_CALL.STUDENT_INTENT_EASY', hintKey: 'VIDEO_CALL.INTENT_HINT_EASY' },
  conversational: { emoji: '💬', labelKey: 'VIDEO_CALL.STUDENT_INTENT_CONVERSATIONAL', hintKey: 'VIDEO_CALL.INTENT_HINT_CONVERSATIONAL' },
  focused: { emoji: '🎯', labelKey: 'VIDEO_CALL.STUDENT_INTENT_FOCUSED', hintKey: 'VIDEO_CALL.INTENT_HINT_FOCUSED' },
  challenge: { emoji: '🔥', labelKey: 'VIDEO_CALL.STUDENT_INTENT_CHALLENGE', hintKey: 'VIDEO_CALL.INTENT_HINT_CHALLENGE' },
};

const BG_MAIN = '#1a1a1a';
const BG_CONTROLS = '#1a1a1a';
const TILE_BG = '#2a2a2a';
const TILE_BORDER = '#2d3354';
const ACCENT_PRIMARY = 'rgba(33, 150, 243, 0.85)';
const ACCENT_DANGER = 'rgba(255, 59, 48, 0.85)';

type Props = NativeStackScreenProps<RootStackParamList, 'VideoCall'>;

function otherPartyName(lesson: Lesson | null, isTutor: boolean, t: (k: string) => string): string {
  const other = isTutor ? lesson?.studentId : lesson?.tutorId;
  if (!other) return t('VIDEO_CALL.PARTICIPANT');
  if (other.firstName && other.lastName) return `${other.firstName} ${other.lastName}`;
  if (other.firstName) return other.firstName;
  return other.name || t('VIDEO_CALL.PARTICIPANT');
}

function otherPartyPicture(lesson: Lesson | null, isTutor: boolean): string | null {
  const other = isTutor ? lesson?.studentId : lesson?.tutorId;
  return other?.picture || null;
}

function otherPartyId(lesson: Lesson | null, isTutor: boolean): string | null {
  const other = isTutor ? lesson?.studentId : lesson?.tutorId;
  return other?._id || null;
}

export default function VideoCallScreen({ navigation, route }: Props) {
  const { lessonId, isClass = false, micOn = true, videoOn = true } = route.params;
  const { width: winW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();

  const isTutor = user?.userType === 'tutor';
  const userId = user?._id || user?.id;

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [joining, setJoining] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [remoteVideoMuted, setRemoteVideoMuted] = useState<Record<number, boolean>>({});
  const [remoteAudioMuted, setRemoteAudioMuted] = useState<Record<number, boolean>>({});

  const [isMuted, setIsMuted] = useState(!micOn);
  const [isVideoOff, setIsVideoOff] = useState(!videoOn);
  const [showChat, setShowChat] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showVb, setShowVb] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [vbMode, setVbMode] = useState<VbMode>('none');
  const [isLeaving, setIsLeaving] = useState(false);

  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [studentIntent, setStudentIntent] = useState<string | null>(null);
  const [showIntentBanner, setShowIntentBanner] = useState(false);

  const engineRef = useRef<IRtcEngine | null>(null);
  const endedRef = useRef(false);
  const hasIntentRef = useRef(false);

  const remoteLabel = useMemo(() => otherPartyName(lesson, isTutor, t), [lesson, isTutor, t]);
  const remotePic = useMemo(() => otherPartyPicture(lesson, isTutor), [lesson, isTutor]);
  const chatPeerId = useMemo(() => otherPartyId(lesson, isTutor), [lesson, isTutor]);

  const primaryRemoteUid = remoteUids[0];
  const showRemoteMain = !isClass && primaryRemoteUid !== undefined;
  const remoteMainVideoOff = primaryRemoteUid !== undefined && !!remoteVideoMuted[primaryRemoteUid];
  const remoteMainAudioMuted = primaryRemoteUid !== undefined && !!remoteAudioMuted[primaryRemoteUid];

  const cleanupCall = useCallback(() => {
    const e = engineRef.current ?? agoraService.getEngine();
    if (e) {
      try {
        e.removeAllListeners();
      } catch {
        /* ignore */
      }
    }
    agoraService.leaveChannel();
    agoraService.destroy();
    engineRef.current = null;
  }, []);

  const endCall = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setIsLeaving(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cleanupCall();
    clearDetailCache(lessonId);
    try {
      if (isClass) await lessonService.leaveClass(lessonId);
      else await lessonService.leaveLesson(lessonId);
    } catch {
      /* non-fatal */
    }
    if (isClass) {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else if (isTutor) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'PostLessonTutor', params: { lessonId, fromVideoCall: true } }],
      });
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: 'PostLessonStudent', params: { lessonId } }],
      });
    }
  }, [cleanupCall, isClass, isTutor, lessonId, navigation]);

  const confirmEndCall = useCallback(() => {
    Alert.alert(t('VIDEO_CALL.END_TITLE'), t('VIDEO_CALL.END_MESSAGE'), [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('VIDEO_CALL.END_CONFIRM'), style: 'destructive', onPress: () => void endCall() },
    ]);
  }, [endCall, t]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const l = await lessonService.getLesson(lessonId);
      if (!alive) return;
      setLesson(l);
      if (l?.studentLessonIntent && isTutor) {
        hasIntentRef.current = true;
        setStudentIntent(l.studentLessonIntent);
        setShowIntentBanner(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lessonId, isTutor]);


  useEffect(() => {
    let alive = true;

    const setup = async () => {
      if (!userId) {
        setJoinError(t('VIDEO_CALL.JOIN_FAILED'));
        setJoining(false);
        return;
      }

      agoraService.destroy();

      const role = isTutor ? 'tutor' : 'student';
      const join = isClass
        ? await lessonService.joinClass(lessonId, role, userId)
        : await lessonService.joinLesson(lessonId, role, userId);

      if (!alive) return;

      if (!join?.agora?.channelName) {
        setJoinError(t('VIDEO_CALL.JOIN_FAILED'));
        setJoining(false);
        return;
      }

      const rawUid = join.agora.uid;
      const uidIsNumeric = typeof rawUid === 'number' && Number.isFinite(rawUid);
      const uidStr = String(rawUid ?? '');

      console.log('[VideoCall] join response', {
        channel: join.agora.channelName,
        rawUid,
        uidIsNumeric,
        uidStr,
        appId: join.agora.appId?.slice(0, 8) + '…',
        tokenLen: join.agora.token?.length ?? 0,
        userRole: (join as any).userRole ?? role,
      });

      try {
        const engine = await agoraService.initialize(join.agora.appId);
        if (!alive) return;
        engineRef.current = engine;

        engine.enableAudio();
        engine.enableVideo();

        const onJoinOk = () => {
          console.log('[VideoCall] onJoinChannelSuccess');
          if (!alive) return;
          setChannelReady(true);
          setJoining(false);
          setJoinError(null);
        };
        const onUserJoined = (_connection: unknown, uid: number) => {
          console.log('[VideoCall] remote user joined', uid);
          if (!alive) return;
          setRemoteUids(prev => (prev.includes(uid) ? prev : [...prev, uid]));
          if (isTutor && !hasIntentRef.current) {
            lessonService.getLesson(lessonId).then(l => {
              if (!alive || !l?.studentLessonIntent || hasIntentRef.current) return;
              hasIntentRef.current = true;
              setStudentIntent(l.studentLessonIntent);
              setShowIntentBanner(true);
            }).catch(() => {});
          }
        };
        const onUserOffline = (_connection: unknown, uid: number) => {
          if (!alive) return;
          setRemoteUids(prev => prev.filter(x => x !== uid));
        };
        const onUserMuteVideo = (_connection: unknown, uid: number, muted: boolean) => {
          if (!alive) return;
          setRemoteVideoMuted(prev => ({ ...prev, [uid]: muted }));
        };
        const onUserMuteAudio = (_connection: unknown, uid: number, muted: boolean) => {
          if (!alive) return;
          setRemoteAudioMuted(prev => ({ ...prev, [uid]: muted }));
        };
        const onError = (code: number, msg: string) => {
          console.error('[VideoCall] Agora error', code, msg);
        };
        const onConnectionStateChanged = (
          _connection: unknown,
          state: number,
          reason: number,
        ) => {
          console.log('[VideoCall] connection state', state, 'reason', reason);
        };

        engine.addListener('onJoinChannelSuccess', onJoinOk);
        engine.addListener('onUserJoined', onUserJoined);
        engine.addListener('onUserOffline', onUserOffline);
        engine.addListener('onUserMuteVideo', onUserMuteVideo);
        engine.addListener('onUserMuteAudio', onUserMuteAudio);
        engine.addListener('onError', onError);
        engine.addListener('onConnectionStateChanged', onConnectionStateChanged);

        const channelId = join.agora.channelName;
        const backendToken = join.agora.token ?? '';

        // The backend may return a stale temp token when running in dev
        // mode. Skip it — if the Agora project doesn't enforce App
        // Certificate auth the empty token works. When cert auth IS
        // enabled, a freshly generated token will pass through fine.
        const useToken = backendToken;

        console.log(
          '[VideoCall] token preview:',
          useToken ? useToken.slice(0, 20) + '…' : '(none)',
          'channel:', channelId,
        );

        let ret: number;
        if (uidStr && !uidIsNumeric) {
          console.log('[VideoCall] joining with userAccount:', uidStr);
          ret = agoraService.joinChannelWithUserAccount({
            token: useToken,
            channelId,
            userAccount: uidStr,
          });
        } else {
          const numericUid = uidIsNumeric ? (rawUid as number) : 0;
          console.log('[VideoCall] joining with numeric uid:', numericUid);
          ret = agoraService.joinChannel({ token: useToken, channelId, uid: numericUid });
        }

        if (ret !== 0) {
          throw new Error(`joinChannel returned error code ${ret}`);
        }

        agoraService.muteLocalAudio(isMuted);
        agoraService.muteLocalVideo(isVideoOff);
      } catch (e: unknown) {
        console.error('[VideoCall] setup error', e);
        if (!alive) return;
        agoraService.destroy();
        engineRef.current = null;
        setJoinError(t('VIDEO_CALL.JOIN_FAILED'));
        setJoining(false);
      }
    };

    void setup();

    return () => {
      alive = false;
      if (!endedRef.current) cleanupCall();
    };
  }, [cleanupCall, isClass, lessonId, t, userId]);

  useEffect(() => {
    if (!channelReady) return;
    agoraService.muteLocalAudio(isMuted);
  }, [isMuted, channelReady]);

  useEffect(() => {
    if (!channelReady) return;
    agoraService.muteLocalVideo(isVideoOff);
  }, [isVideoOff, channelReady]);

  const loadChat = useCallback(async () => {
    if (!chatPeerId) return;
    setChatLoading(true);
    const msgs = await messagingService.getMessages(chatPeerId, 50);
    setChatMessages(msgs.reverse());
    setChatLoading(false);
  }, [chatPeerId]);

  useEffect(() => {
    if (showChat && chatPeerId) void loadChat();
  }, [showChat, chatPeerId, loadChat]);

  const sendChat = useCallback(async () => {
    const text = newMessage.trim();
    if (!text || !chatPeerId || sending) return;
    setSending(true);
    const sent = await messagingService.sendMessage(chatPeerId, text, 'text');
    setSending(false);
    if (sent) {
      setNewMessage('');
      setChatMessages(prev => [...prev, sent]);
    }
  }, [chatPeerId, newMessage, sending]);

  const toggleMute = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsMuted(m => !m);
  };
  const toggleVideo = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsVideoOff(v => !v);
  };
  const toggleChat = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowMore(false);
    setShowChat(c => !c);
  };
  const toggleMore = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowMore(c => !c);
  };

  const applyVb = (mode: VbMode) => {
    setVbMode(mode);
    try {
      agoraService.setVirtualBackground(mode);
    } catch {
      /* device may not support VB */
    }
  };

  const onSharePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(t('VIDEO_CALL.SHARE'), t('VIDEO_CALL.SCREEN_SHARE_SOON'));
  };

  const galleryCount = remoteUids.length + 1;
  const galleryColumns = galleryCount <= 2 ? 2 : galleryCount <= 4 ? 2 : 3;
  const galleryTileW = Math.floor((winW - 32 - (galleryColumns - 1) * 12) / galleryColumns);

  if (joining || joinError) {
    return (
      <View style={[styles.root, styles.centered]}>
        <StatusBar style="light" />
        {joinError ? (
          <>
            <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
            <Text style={styles.errorTitle}>{joinError}</Text>
            <TouchableOpacity style={styles.errorBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.errorBtnText}>{t('COMMON.BACK')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.joiningText}>{t('VIDEO_CALL.JOINING')}</Text>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {isLeaving ? (
        <View style={styles.leavingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.leavingText}>{t('VIDEO_CALL.LEAVING')}</Text>
        </View>
      ) : null}

      <View style={[styles.wrapper, showChat && styles.wrapperChatOpen]}>
        <View style={styles.mainContent}>
          {/* Whiteboard side panel (web layout) */}
          {showWhiteboard ? (
            <View style={styles.whiteboardPanel}>
              <View style={styles.whiteboardHeader}>
                <Text style={styles.whiteboardTitle}>{t('VIDEO_CALL.WHITEBOARD_TITLE')}</Text>
                <TouchableOpacity onPress={() => setShowWhiteboard(false)} hitSlop={12}>
                  <Ionicons name="close-outline" size={24} color="rgba(255,255,255,0.9)" />
                </TouchableOpacity>
              </View>
              <View style={styles.whiteboardBody}>
                <Ionicons name="easel-outline" size={40} color="rgba(255,255,255,0.35)" />
                <Text style={styles.whiteboardHint}>{t('VIDEO_CALL.WHITEBOARD_MOBILE')}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.videoStage}>
            {!isClass ? (
              <>
                <View style={styles.mainVideo}>
                  {showRemoteMain && !remoteMainVideoOff ? (
                    <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: primaryRemoteUid }} />
                  ) : null}
                  {showRemoteMain && remoteMainVideoOff ? (
                    <View style={styles.videoPlaceholder}>
                      {remotePic ? (
                        <Image source={{ uri: remotePic }} style={styles.avatarLg} contentFit="cover" />
                      ) : (
                        <Ionicons name="person" size={72} color="rgba(255,255,255,0.35)" />
                      )}
                      <Text style={styles.placeholderTitle}>{t('VIDEO_CALL.CAMERA_OFF')}</Text>
                    </View>
                  ) : null}
                  {!showRemoteMain ? (
                    <View style={styles.videoPlaceholder}>
                      <Ionicons name="person" size={72} color="rgba(255,255,255,0.35)" />
                      <Text style={styles.placeholderTitle}>{t('VIDEO_CALL.WAITING_REMOTE')}</Text>
                    </View>
                  ) : null}
                  {showRemoteMain ? (
                    <View style={styles.remoteInfo}>
                      <View style={styles.remotePill}>
                        <Ionicons
                          name={remoteMainAudioMuted ? 'mic-off-outline' : 'mic-outline'}
                          size={18}
                          color={remoteMainAudioMuted ? '#f44336' : '#4CAF50'}
                        />
                        <Text style={styles.remotePillText}>{remoteLabel}</Text>
                      </View>
                    </View>
                  ) : null}
                  {showIntentBanner && studentIntent && INTENT_DISPLAY[studentIntent] ? (
                    <TouchableOpacity
                      style={styles.intentBanner}
                      activeOpacity={0.85}
                      onPress={() => setShowIntentBanner(false)}
                    >
                      <Text style={styles.intentBannerEmoji}>{INTENT_DISPLAY[studentIntent].emoji}</Text>
                      <View style={styles.intentBannerText}>
                        <Text style={styles.intentBannerLabel}>
                          {t('VIDEO_CALL.STUDENT_INTENT_LABEL')}{' '}
                          <Text style={styles.intentBannerValue}>{t(INTENT_DISPLAY[studentIntent].labelKey)}</Text>
                        </Text>
                        <Text style={styles.intentBannerHint}>{t(INTENT_DISPLAY[studentIntent].hintKey)}</Text>
                      </View>
                      <Ionicons name="close" size={16} color="rgba(255,255,255,0.5)" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={[styles.participantsGrid, { top: insets.top + 56 }]}>
                  <View style={[styles.participantTile, styles.tileLocal]}>
                    {!isVideoOff ? (
                      <RtcSurfaceView
                        style={StyleSheet.absoluteFill}
                        canvas={{ uid: 0, mirrorMode: VideoMirrorModeType.VideoMirrorModeEnabled }}
                      />
                    ) : null}
                    {isVideoOff ? (
                      <View style={styles.tilePlaceholder}>
                        {user?.picture ? (
                          <Image source={{ uri: user.picture }} style={styles.avatarSm} contentFit="cover" />
                        ) : (
                          <Ionicons name="person" size={32} color="rgba(255,255,255,0.4)" />
                        )}
                        <Text style={styles.tilePhText}>{t('VIDEO_CALL.CAMERA_OFF')}</Text>
                      </View>
                    ) : null}
                    <View style={styles.tileLabel}>
                      <Ionicons name={isMuted ? 'mic-off-outline' : 'mic-outline'} size={12} color="#fff" />
                      <Text style={styles.tileLabelText}>{t('VIDEO_CALL.YOU')}</Text>
                    </View>
                  </View>
                </View>
              </>
            ) : (
              <ScrollView
                contentContainerStyle={styles.galleryScroll}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.galleryRow}>
                  <View style={[styles.galleryTile, { width: galleryTileW }]}>
                    {!isVideoOff ? (
                      <RtcSurfaceView
                        style={StyleSheet.absoluteFill}
                        canvas={{ uid: 0, mirrorMode: VideoMirrorModeType.VideoMirrorModeEnabled }}
                      />
                    ) : null}
                    {isVideoOff ? (
                      <View style={styles.tilePlaceholder}>
                        <Ionicons name="person" size={36} color="rgba(255,255,255,0.4)" />
                        <Text style={styles.tilePhText}>{t('VIDEO_CALL.CAMERA_OFF')}</Text>
                      </View>
                    ) : null}
                    <View style={styles.tileLabel}>
                      <Ionicons name={isMuted ? 'mic-off-outline' : 'mic-outline'} size={12} color="#fff" />
                      <Text style={styles.tileLabelText}>{t('VIDEO_CALL.YOU')}</Text>
                    </View>
                  </View>
                  {remoteUids.map(uid => (
                    <View key={uid} style={[styles.galleryTile, { width: galleryTileW }]}>
                      {!remoteVideoMuted[uid] ? (
                        <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid }} />
                      ) : null}
                      {remoteVideoMuted[uid] ? (
                        <View style={styles.tilePlaceholder}>
                          <Ionicons name="person" size={36} color="rgba(255,255,255,0.4)" />
                          <Text style={styles.tilePhText}>{t('VIDEO_CALL.CAMERA_OFF')}</Text>
                        </View>
                      ) : null}
                      <View style={styles.tileLabel}>
                        <Ionicons
                          name={remoteAudioMuted[uid] ? 'mic-off-outline' : 'mic-outline'}
                          size={12}
                          color="#fff"
                        />
                        <Text style={styles.tileLabelText}>{remoteLabel}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            {showVb ? (
              <View style={styles.vbPanel}>
                <View style={styles.vbHeader}>
                  <Text style={styles.vbTitle}>{t('VIDEO_CALL.VB_TITLE')}</Text>
                  <TouchableOpacity onPress={() => setShowVb(false)} hitSlop={12}>
                    <Ionicons name="close-outline" size={22} color="rgba(255,255,255,0.85)" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.vbRow} onPress={() => applyVb('blur')}>
                  <Ionicons name="water-outline" size={20} color="#fff" />
                  <Text style={styles.vbRowText}>{t('VIDEO_CALL.VB_BLUR')}</Text>
                  {vbMode === 'blur' ? <Ionicons name="checkmark-circle" size={18} color="#34C759" /> : null}
                </TouchableOpacity>
                <TouchableOpacity style={styles.vbRow} onPress={() => applyVb('black')}>
                  <View style={styles.vbDot} />
                  <Text style={styles.vbRowText}>{t('VIDEO_CALL.VB_BLACK')}</Text>
                  {vbMode === 'black' ? <Ionicons name="checkmark-circle" size={18} color="#34C759" /> : null}
                </TouchableOpacity>
                <TouchableOpacity style={styles.vbRow} onPress={() => applyVb('none')}>
                  <Ionicons name="videocam-outline" size={20} color="#fff" />
                  <Text style={styles.vbRowText}>{t('VIDEO_CALL.VB_NORMAL')}</Text>
                  {vbMode === 'none' ? <Ionicons name="checkmark-circle" size={18} color="#34C759" /> : null}
                </TouchableOpacity>
                {vbMode !== 'none' ? (
                  <View style={styles.vbStatus}>
                    <Ionicons name="checkmark-circle" size={14} color="#34C759" />
                    <Text style={styles.vbStatusText}>{t('VIDEO_CALL.VB_ACTIVE')}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {showChat ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.chatPanel}
            >
              <View style={styles.chatHeader}>
                <Text style={styles.chatTitle}>{t('VIDEO_CALL.CHAT_WITH', { name: remoteLabel })}</Text>
                <TouchableOpacity onPress={() => setShowChat(false)} hitSlop={12}>
                  <Ionicons name="close-outline" size={24} color="rgba(255,255,255,0.9)" />
                </TouchableOpacity>
              </View>
              {chatLoading ? (
                <ActivityIndicator color="#fff" style={{ marginVertical: 24 }} />
              ) : (
                <FlatList
                  data={chatMessages}
                  keyExtractor={m => m.id}
                  style={styles.chatList}
                  contentContainerStyle={styles.chatListContent}
                  renderItem={({ item }) => {
                    const mine = item.senderId === userId;
                    return (
                      <View style={[styles.chatBubble, mine ? styles.chatBubbleMine : styles.chatBubbleTheirs]}>
                        <Text style={styles.chatBubbleText}>{item.content}</Text>
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={styles.chatEmpty}>{t('VIDEO_CALL.NO_MESSAGES')}</Text>
                  }
                />
              )}
              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder={t('VIDEO_CALL.MESSAGE_PLACEHOLDER')}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={newMessage}
                  onChangeText={setNewMessage}
                  onSubmitEditing={() => void sendChat()}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  style={[styles.chatSend, !newMessage.trim() && styles.chatSendDisabled]}
                  disabled={!newMessage.trim() || sending}
                  onPress={() => void sendChat()}
                >
                  <Ionicons name="send" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          ) : null}
        </View>

        {showMore ? (
          <TouchableWithoutFeedback onPress={() => setShowMore(false)}>
            <View style={styles.moreBackdrop} />
          </TouchableWithoutFeedback>
        ) : null}
        {showMore ? (
          <View style={[styles.moreMenu, { bottom: insets.bottom + 88 }]}>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setShowMore(false);
                setShowVb(true);
              }}
            >
              <View style={[styles.moreIcon, showVb && styles.moreIconOn]}>
                <Ionicons name="color-filter-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.moreLabel}>{t('VIDEO_CALL.EFFECTS')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setShowMore(false);
                setShowWhiteboard(w => !w);
              }}
            >
              <View style={[styles.moreIcon, showWhiteboard && styles.moreIconOn]}>
                <Ionicons name="easel-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.moreLabel}>{t('VIDEO_CALL.WHITEBOARD')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setShowMore(false);
                setShowVocabulary(true);
              }}
            >
              <View style={styles.moreIcon}>
                <Ionicons name="book-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.moreLabel}>{t('VIDEO_CALL.VOCABULARY')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setShowMore(false);
                setShowGoals(true);
              }}
            >
              <View style={styles.moreIcon}>
                <Ionicons name="flag-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.moreLabel}>{t('VIDEO_CALL.GOALS')}</Text>
            </TouchableOpacity>
            {isTutor ? (
              <TouchableOpacity
                style={styles.moreItem}
                onPress={() => {
                  setShowMore(false);
                  setShowNotes(true);
                }}
              >
                <View style={styles.moreIcon}>
                  <Ionicons name="document-text-outline" size={22} color="#fff" />
                </View>
                <Text style={styles.moreLabel}>{t('VIDEO_CALL.NOTES')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <SafeAreaView edges={['bottom']} style={styles.controlsSafe}>
          <View style={styles.videoControls}>
            <TouchableOpacity style={styles.ctrlItem} onPress={toggleMute} activeOpacity={0.85}>
              <View style={[styles.ctrlBtn, isMuted && styles.ctrlBtnDanger]}>
                <Ionicons name={isMuted ? 'mic-off' : 'mic-outline'} size={22} color="#fff" />
              </View>
              <Text style={[styles.ctrlLabel, isMuted && styles.ctrlLabelDanger]}>
                {isMuted ? t('VIDEO_CALL.UNMUTE') : t('VIDEO_CALL.MUTE')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlItem} onPress={toggleVideo} activeOpacity={0.85}>
              <View style={[styles.ctrlBtn, isVideoOff && styles.ctrlBtnDanger]}>
                <Ionicons name={isVideoOff ? 'videocam-off' : 'videocam-outline'} size={22} color="#fff" />
              </View>
              <Text style={[styles.ctrlLabel, isVideoOff && styles.ctrlLabelDanger]}>
                {isVideoOff ? t('VIDEO_CALL.START_VIDEO') : t('VIDEO_CALL.CAMERA')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlItem} onPress={onSharePress} activeOpacity={0.85}>
              <View style={styles.ctrlBtn}>
                <Ionicons name="desktop-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.ctrlLabel}>{t('VIDEO_CALL.SHARE')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlItem} onPress={toggleChat} activeOpacity={0.85}>
              <View style={[styles.ctrlBtn, showChat && styles.ctrlBtnPrimary]}>
                <Ionicons name="chatbubble-outline" size={22} color="#fff" />
              </View>
              <Text style={[styles.ctrlLabel, showChat && styles.ctrlLabelPrimary]}>{t('VIDEO_CALL.CHAT')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlItem} onPress={toggleMore} activeOpacity={0.85}>
              <View style={[styles.ctrlBtn, showMore && styles.ctrlBtnPrimary]}>
                <Ionicons name="grid-outline" size={22} color="#fff" />
              </View>
              <Text style={[styles.ctrlLabel, showMore && styles.ctrlLabelPrimary]}>{t('VIDEO_CALL.MORE')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ctrlItem}
              onPress={() => !isLeaving && confirmEndCall()}
              activeOpacity={0.85}
              disabled={isLeaving}
            >
              <View style={[styles.ctrlBtn, styles.ctrlBtnHangup]}>
                <Ionicons name="call" size={22} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
              </View>
              <Text style={[styles.ctrlLabel, styles.ctrlLabelHangup]}>
                {isLeaving ? t('VIDEO_CALL.LEAVING') : t('VIDEO_CALL.LEAVE')}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <Modal visible={showVocabulary} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('VIDEO_CALL.VOCABULARY')}</Text>
              <TouchableOpacity onPress={() => setShowVocabulary(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalBody}>{t('VIDEO_CALL.VOCAB_SOON')}</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={showGoals} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('VIDEO_CALL.GOALS')}</Text>
              <TouchableOpacity onPress={() => setShowGoals(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalBody}>{t('VIDEO_CALL.GOALS_SOON')}</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={showNotes} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.notesCard]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('VIDEO_CALL.NOTES_TITLE')}</Text>
              <TouchableOpacity onPress={() => setShowNotes(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.notesPrivacy}>
              <Ionicons name="eye-off-outline" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={styles.notesPrivacyText}>{t('VIDEO_CALL.NOTES_PRIVACY')}</Text>
            </View>
            <TextInput
              style={styles.notesInput}
              multiline
              placeholder={t('VIDEO_CALL.NOTES_PLACEHOLDER')}
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={notesText}
              onChangeText={setNotesText}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG_MAIN },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  joiningText: { color: 'rgba(255,255,255,0.85)', marginTop: 12, fontSize: 16 },
  errorTitle: { color: '#ef4444', fontSize: 16, textAlign: 'center' },
  errorBtn: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12 },
  errorBtnText: { color: '#fff', fontWeight: '600' },
  leavingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    zIndex: 2000,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  leavingText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  wrapper: { flex: 1 },
  wrapperChatOpen: {},
  mainContent: { flex: 1, flexDirection: 'row' },
  videoStage: { flex: 1, position: 'relative' },
  mainVideo: {
    flex: 1,
    backgroundColor: BG_MAIN,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholderTitle: { color: 'rgba(255,255,255,0.7)', marginTop: 12, fontSize: 16 },
  avatarLg: { width: 96, height: 96, borderRadius: 20 },
  remoteInfo: { position: 'absolute', top: 20, left: 20, zIndex: 10 },
  remotePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  remotePillText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  intentBanner: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.88)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 10,
  },
  intentBannerEmoji: { fontSize: 22 },
  intentBannerText: { flex: 1, gap: 2 },
  intentBannerLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500' },
  intentBannerValue: { color: '#fff', fontWeight: '700' },
  intentBannerHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '400' },
  participantsGrid: {
    position: 'absolute',
    right: 10,
    zIndex: 1000,
    gap: 12,
  },
  participantTile: {
    width: 160,
    height: 120,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: TILE_BORDER,
    overflow: 'hidden',
    backgroundColor: TILE_BG,
  },
  tileLocal: {},
  tilePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TILE_BG,
  },
  avatarSm: { width: 50, height: 50, borderRadius: 12 },
  tilePhText: { color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 4 },
  tileLabel: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tileLabelText: { color: '#fff', fontSize: 11, fontWeight: '500' },
  galleryScroll: { padding: 16, paddingBottom: 24 },
  galleryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  galleryTile: {
    aspectRatio: 4 / 3,
    minWidth: 140,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: TILE_BORDER,
    overflow: 'hidden',
    backgroundColor: TILE_BG,
    marginBottom: 4,
  },
  whiteboardPanel: {
    width: 300,
    flexShrink: 0,
    backgroundColor: '#0d0d0d',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  whiteboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  whiteboardTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  whiteboardBody: { flexGrow: 1, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 12 },
  whiteboardHint: { color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  vbPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: 'rgba(0,0,0,0.95)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 1200,
  },
  vbHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  vbTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  vbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginBottom: 8,
  },
  vbRowText: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  vbDot: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  vbStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  vbStatusText: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  chatPanel: {
    width: Math.min(380, 340),
    backgroundColor: '#111',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  chatTitle: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1, paddingRight: 8 },
  chatList: { flex: 1 },
  chatListContent: { padding: 12, paddingBottom: 8 },
  chatBubble: { maxWidth: '88%', padding: 10, borderRadius: 14, marginBottom: 8 },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: 'rgba(35, 131, 157, 0.95)' },
  chatBubbleTheirs: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)' },
  chatBubbleText: { color: '#fff', fontSize: 15 },
  chatEmpty: { color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 24 },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  chatSend: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#23839d', alignItems: 'center', justifyContent: 'center' },
  chatSendDisabled: { opacity: 0.4 },
  moreBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1300 },
  moreMenu: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(26,26,26,0.98)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 1400,
  },
  moreItem: { width: 72, alignItems: 'center', gap: 6 },
  moreIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreIconOn: { backgroundColor: ACCENT_PRIMARY },
  moreLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, textAlign: 'center' },
  controlsSafe: { backgroundColor: BG_CONTROLS },
  videoControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  ctrlItem: { alignItems: 'center', minWidth: 56, paddingVertical: 4 },
  ctrlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnDanger: { backgroundColor: ACCENT_DANGER },
  ctrlBtnPrimary: { backgroundColor: ACCENT_PRIMARY },
  ctrlBtnHangup: { backgroundColor: ACCENT_DANGER },
  ctrlLabel: { marginTop: 6, fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
  ctrlLabelDanger: { color: '#ff6961' },
  ctrlLabelPrimary: { color: '#64b5f6' },
  ctrlLabelHangup: { color: '#ff6961' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 18, maxHeight: '70%' },
  notesCard: { maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  modalBody: { color: 'rgba(255,255,255,0.7)', fontSize: 15, lineHeight: 22 },
  notesPrivacy: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  notesPrivacyText: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  notesInput: {
    minHeight: 160,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    textAlignVertical: 'top',
  },
});
