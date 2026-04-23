import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { attendeeStackInitials } from '../constants/mockClassAttendeesPreview';
import { messagingService } from '../services/messaging';

export type GoingAttendee = {
  firstName?: string;
  lastName?: string;
  name?: string;
  picture?: string;
  profilePicture?: string;
  auth0Id?: string;
  _id?: string;
  id?: string;
};

/**
 * Result dispatched to the parent after the modal successfully sends.
 * - `direct` → 1:1 DM with `userId` (student → tutor or tutor → single student).
 * - `group`  → multi-recipient broadcast resolved to a deterministic `groupId`.
 */
export type ClassGoingMessageSentResult =
  | { kind: 'direct'; userId: string }
  | { kind: 'group'; groupId: string; participantIds: string[] };

/**
 * Open payload from `LessonDetailOverlay` — parent hosts `Modal` at screen root.
 * Exactly one of `receiverId` (student → tutor) or `receiverIds` (tutor →
 * students) should be populated; the modal will pick 1:1 vs group accordingly.
 */
export type ClassGoingMessageRequest = {
  attendees: GoingAttendee[];
  receiverId?: string;
  receiverIds?: string[];
  className?: string;
  /**
   * Optional class anchor. When provided, the multi-recipient path opens
   * the stable class-broadcast thread (membership follows enrollment)
   * instead of creating a hash-keyed ad-hoc group.
   */
  classId?: string;
};

type Props = {
  visible: boolean;
  attendees: GoingAttendee[];
  receiverId?: string;
  receiverIds?: string[];
  className?: string;
  classId?: string;
  minChars?: number;
  maxChars?: number;
  onClose: () => void;
  onSent?: (result: ClassGoingMessageSentResult) => void;
};

const DEFAULT_MIN = 20;
const DEFAULT_MAX = 2000;

export function ClassGoingMessageModal({
  visible,
  attendees,
  receiverId,
  receiverIds,
  className,
  classId,
  minChars = DEFAULT_MIN,
  maxChars = DEFAULT_MAX,
  onClose,
  onSent,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDark = colors.isDark;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

  // Resolve the final recipient set — `receiverIds` (multi) takes priority, then
  // `receiverId` (single). Both paths are de-duped and emptied of falsy ids.
  const recipients = useMemo(() => {
    const ids = receiverIds && receiverIds.length > 0 ? receiverIds : receiverId ? [receiverId] : [];
    return Array.from(new Set(ids.map((id) => (id || '').trim()).filter(Boolean)));
  }, [receiverId, receiverIds]);

  const hasRecipients = recipients.length > 0;
  const count = text.length;
  const canSend = count >= minChars && count <= maxChars && hasRecipients && !sending;

  const displayRows = useMemo(() => {
    const list = attendees.slice(0, 5);
    return list.map((a) => ({
      pic: a.picture || a.profilePicture,
      initials: attendeeStackInitials(a),
    }));
  }, [attendees]);

  const extra = Math.max(0, attendees.length - 5);

  useEffect(() => {
    if (visible) {
      setText('');
      setSending(false);
      backdropOpacity.setValue(0);
      scale.setValue(0.96);
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 9, tension: 100 }),
      ]).start();
    } else {
      backdropOpacity.setValue(0);
    }
  }, [visible, backdropOpacity, scale]);

  const runClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.96, duration: 160, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [backdropOpacity, scale, onClose]);

  const onRequestClose = useCallback(() => {
    if (sending) return;
    runClose();
  }, [sending, runClose]);

  const onSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    const body = className ? `[${className}] ${text.trim()}` : text.trim();

    try {
      // 1:1 path — keep existing direct-conversation flow.
      if (recipients.length === 1) {
        const res = await messagingService.sendMessage(recipients[0], body, 'text');
        if (!res) throw new Error('sendMessage returned null');
        onSent?.({ kind: 'direct', userId: recipients[0] });
        runClose();
        return;
      }

      // Multi-recipient — route to the class-broadcast thread if we have a
      // classId (stable across roster changes); otherwise fall back to the
      // ad-hoc hash-keyed group path.
      const group = await messagingService.createOrGetGroup(recipients, className || undefined, classId);
      if (!group?.groupId) throw new Error('Could not resolve groupId');

      const sent = await messagingService.sendGroupMessage(group.groupId, body, {
        participantIds: group.participantIds,
        name: className || group.name || '',
      });
      if (!sent) throw new Error('sendGroupMessage returned null');

      onSent?.({ kind: 'group', groupId: group.groupId, participantIds: group.participantIds });
      runClose();
    } catch (e) {
      Alert.alert('Could not send', 'Please try again.');
    } finally {
      setSending(false);
    }
  }, [canSend, className, classId, text, recipients, onSent, runClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        style={st.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.45)' },
            ]}
            onPress={onRequestClose}
          />
        </Animated.View>

        <View style={st.center} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ scale }], width: '100%', maxWidth: 420, paddingHorizontal: 20 }}>
            <View
              style={[
                st.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={st.topRow}>
                <View style={{ flex: 1 }} />
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  onPress={onRequestClose}
                  disabled={sending}
                >
                  <Ionicons name="close" size={26} color={colors.textSecondary} />
                </Pressable>
              </View>

              <Text style={[st.heading, { color: colors.text }]} numberOfLines={2}>
                {t('LESSONS_PAGE.IN_THIS_CONVERSATION')}
              </Text>

              {displayRows.length > 0 ? (
                <View style={st.avatarRow}>
                  {displayRows.map((row, i) => (
                    <View
                      key={`a-${i}`}
                      style={[
                        st.av,
                        {
                          marginLeft: i > 0 ? -10 : 0,
                          zIndex: 10 - i,
                          borderColor: colors.card,
                          backgroundColor: isDark ? '#2c2c2e' : '#e8e8e8',
                        },
                      ]}
                    >
                      {row.pic ? (
                        <View style={st.avClip}>
                          <Image source={{ uri: row.pic }} style={st.avImg} />
                        </View>
                      ) : (
                        <Text style={[st.ini, { color: colors.textSecondary }]}>{row.initials}</Text>
                      )}
                    </View>
                  ))}
                  {extra > 0 ? (
                    <View
                      style={[
                        st.av,
                        st.avMore,
                        { marginLeft: 10, borderColor: colors.card, backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' },
                      ]}
                    >
                      <Text style={[st.ini, { color: colors.textSecondary }]}>+{extra}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Text style={[st.sub, { color: colors.textSecondary }]}>{t('LESSONS_PAGE.GOING_MESSAGE_SUBTITLE')}</Text>

              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('LESSONS_PAGE.GOING_MESSAGE_PLACEHOLDER')}
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={maxChars}
                textAlignVertical="top"
                style={[
                  st.input,
                  {
                    color: colors.text,
                    borderColor: isDark ? '#3a3a3c' : '#ddd',
                    backgroundColor: isDark ? '#1c1c1e' : '#fafafa',
                  },
                ]}
              />
              <Text style={[st.counter, { color: colors.textTertiary }]}>
                {count}/{minChars} {t('LESSONS_PAGE.GOING_MESSAGE_REQUIRED_HINT')}
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={onSend}
                disabled={!canSend}
                style={({ pressed }) => [
                  st.sendBtn,
                  // Match global CTA: black in light mode, blue in dark
                  // (`ThemeColors.joinCtaBackground`).
                  { backgroundColor: colors.joinCtaBackground },
                  !canSend && { opacity: 0.4 },
                  pressed && canSend && { opacity: 0.9 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={st.sendLabel}>{t('LESSONS_PAGE.SEND_MESSAGE')}</Text>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, minHeight: 40 },
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, marginBottom: 12, textAlign: 'center' },
  sub: { fontSize: 14, lineHeight: 20, marginTop: 12, marginBottom: 14, textAlign: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  av: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avMore: { borderWidth: 0 },
  avClip: { width: '100%', height: '100%' },
  avImg: { width: '100%', height: '100%' },
  ini: { fontSize: 12, fontWeight: '700' },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  counter: { fontSize: 12, marginTop: 8, marginBottom: 16 },
  sendBtn: { borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  sendLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
