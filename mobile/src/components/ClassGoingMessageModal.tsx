import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { SolidToolbarWithBlur } from './SolidToolbarWithBlur';
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
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

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
    }
  }, [visible]);

  const onRequestClose = useCallback(() => {
    if (sending) return;
    onClose();
  }, [sending, onClose]);

  const onSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    const body = text.trim();

    try {
      if (recipients.length === 1 && !classId) {
        const res = await messagingService.sendMessage(recipients[0], body, 'text');
        if (!res) throw new Error('sendMessage returned null');
        onSent?.({ kind: 'direct', userId: recipients[0] });
        onClose();
        return;
      }

      const group = await messagingService.createOrGetGroup(recipients, className || undefined, classId);
      if (!group?.groupId) throw new Error('Could not resolve groupId');

      const sent = await messagingService.sendGroupMessage(group.groupId, body, {
        participantIds: group.participantIds,
        name: className || group.name || '',
      });
      if (!sent) throw new Error('sendGroupMessage returned null');

      onSent?.({ kind: 'group', groupId: group.groupId, participantIds: group.participantIds });
      onClose();
    } catch (e) {
      Alert.alert('Could not send', 'Please try again.');
    } finally {
      setSending(false);
    }
  }, [canSend, className, classId, text, recipients, onSent, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onRequestClose}
    >
      <View
        style={[
          st.root,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={st.column}>
          <SolidToolbarWithBlur isDark={isDark}>
            <View style={st.toolbarRow}>
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={onRequestClose}
                disabled={sending}
                style={({ pressed }) => [st.toolbarBtn, pressed && { opacity: 0.55 }]}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
              <Text style={[st.toolbarTitle, { color: colors.text }]} numberOfLines={1}>
                {t('LESSONS_PAGE.IN_THIS_CONVERSATION')}
              </Text>
              <View style={{ width: 40 }} />
            </View>
          </SolidToolbarWithBlur>

          <KeyboardAvoidingView
            style={st.kav}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
          >
            <ScrollView
              style={st.scroll}
              contentContainerStyle={st.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
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
                          borderColor: colors.background,
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
                        { marginLeft: 10, borderColor: colors.background, backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' },
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
                // Android: default multiline underline + system cursor color can look like
                // a green bar on the bottom edge; hide the underline and align colors.
                underlineColorAndroid="transparent"
                cursorColor={isDark ? colors.joinCtaBackground : colors.text}
                selectionColor="rgba(73, 174, 234, 0.3)"
                style={[
                  st.input,
                  {
                    color: colors.text,
                    borderColor: isDark ? '#3a3a3c' : colors.border,
                    backgroundColor: isDark ? '#1c1c1e' : colors.inputBg,
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
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1 },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toolbarBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', letterSpacing: -0.3, paddingHorizontal: 8 },
  kav: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  sub: { fontSize: 15, lineHeight: 22, marginBottom: 16, textAlign: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 },
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
    minHeight: 160,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  counter: { fontSize: 12, marginTop: 8, marginBottom: 20 },
  sendBtn: { borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  sendLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
