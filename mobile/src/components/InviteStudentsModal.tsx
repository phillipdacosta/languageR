import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { SolidToolbarWithBlur } from './SolidToolbarWithBlur';
import { useTheme } from '../contexts/ThemeContext';
import {
  getClass,
  inviteStudentsToClass,
  removeStudentFromClass,
  type MyClassRecord,
} from '../services/classes';
import { lessonService, type Lesson } from '../services/lessons';
import { ApiError } from '../services/api';

type InvitationStatus = 'pending' | 'accepted' | 'declined' | null;

type RowStudent = {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  invitationStatus: InvitationStatus;
};

function invitedStudentId(inv: { studentId: unknown }): string {
  const sid = inv.studentId as { _id?: string } | string | undefined;
  if (sid && typeof sid === 'object' && sid._id) return String(sid._id);
  return String(sid || '');
}

function capitalize(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatStudentDisplayName(studentOrName: unknown, fallback: string): string {
  if (typeof studentOrName === 'object' && studentOrName) {
    const o = studentOrName as {
      firstName?: string;
      lastName?: string;
      name?: string;
      email?: string;
    };
    if (o.firstName && o.lastName) {
      return `${capitalize(o.firstName)} ${o.lastName.charAt(0).toUpperCase()}.`;
    }
    if (o.firstName) return capitalize(o.firstName);
    const rawName = o.name || o.email;
    if (!rawName) return fallback;
    return formatStudentDisplayName(rawName, fallback);
  }
  const rawName = String(studentOrName || '').trim();
  if (!rawName) return fallback;
  if (rawName.includes('@')) {
    const base = rawName.split('@')[0];
    if (!base) return fallback;
    const parts = base.split(/[.\s_]+/).filter(Boolean);
    const first = parts[0];
    const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return lastInitial ? `${capitalize(first)} ${lastInitial.toUpperCase()}.` : capitalize(first);
  }
  const parts = rawName.split(' ').filter(Boolean);
  if (parts.length === 1) return capitalize(parts[0]);
  const first = capitalize(parts[0]);
  const last = parts[parts.length - 1];
  const lastInitial = last ? last[0].toUpperCase() : '';
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

function buildStudentsFromLessons(lessons: Lesson[], classDetail: MyClassRecord | null, fallbackName: string): RowStudent[] {
  const invited = classDetail?.invitedStudents || [];
  const map = new Map<string, RowStudent>();
  for (const lesson of lessons) {
    const sd = lesson.studentId as
      | { _id?: string; name?: string; email?: string; picture?: string; firstName?: string; lastName?: string }
      | undefined;
    if (!sd || typeof sd !== 'object' || !sd._id) continue;
    const id = String(sd._id);
    let invitationStatus: InvitationStatus = null;
    for (const inv of invited) {
      if (invitedStudentId(inv) === id) {
        const st = String(inv.status || '').toLowerCase();
        if (st === 'pending' || st === 'accepted' || st === 'declined') invitationStatus = st as InvitationStatus;
        break;
      }
    }
    map.set(id, {
      _id: id,
      name: formatStudentDisplayName(sd, fallbackName),
      email: sd.email || '',
      picture: sd.picture,
      invitationStatus,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export type InviteStudentsModalProps = {
  visible: boolean;
  classId: string;
  className: string;
  onClose: () => void;
  onInvitesSent?: () => void;
};

export function InviteStudentsModal({
  visible,
  classId,
  className,
  onClose,
  onInvitesSent,
}: InviteStudentsModalProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDark = colors.isDark;
  const insets = useSafeAreaInsets();
  const fb = t('HOME.INVITE_FALLBACK_NAME');

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<RowStudent[]>([]);
  const [classDetail, setClassDetail] = useState<MyClassRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemoval, setShowRemoval] = useState(false);
  const [studentToRemove, setStudentToRemove] = useState<RowStudent | null>(null);
  const [removalStatusKey, setRemovalStatusKey] = useState<'HOME.INVITE_REMOVAL_STATUS_INVITED' | 'HOME.INVITE_REMOVAL_STATUS_ACCEPTED'>(
    'HOME.INVITE_REMOVAL_STATUS_INVITED',
  );
  const [removalActionKey, setRemovalActionKey] = useState<'HOME.INVITE_REMOVAL_ACTION_CANCEL_INVITE' | 'HOME.INVITE_REMOVAL_ACTION_REMOVE'>(
    'HOME.INVITE_REMOVAL_ACTION_CANCEL_INVITE',
  );

  const load = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    try {
      const [cls, lessons] = await Promise.all([getClass(classId), lessonService.getMyLessons()]);
      setClassDetail(cls);
      const list = buildStudentsFromLessons(lessons, cls, fb);
      setStudents(list);
      setSelectedStudents(
        list.filter(s => s.invitationStatus === 'pending' || s.invitationStatus === 'accepted').map(s => s._id),
      );
    } catch {
      Alert.alert('', t('HOME.INVITE_TOAST_LOAD_FAILED'));
    } finally {
      setLoading(false);
    }
  }, [classId, fb, t]);

  useEffect(() => {
    if (!visible || !classId) return;
    setSearchTerm('');
    setShowRemoval(false);
    setStudentToRemove(null);
    void load();
  }, [visible, classId, load]);

  const filteredStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [students, searchTerm]);

  const newInvitesCount = useMemo(() => {
    return selectedStudents.filter(id => {
      const s = students.find(x => x._id === id);
      return s && !s.invitationStatus;
    }).length;
  }, [selectedStudents, students]);

  const acceptedCount = useMemo(() => {
    return selectedStudents.filter(id => students.find(s => s._id === id)?.invitationStatus === 'accepted').length;
  }, [selectedStudents, students]);

  const pendingCount = useMemo(() => {
    return selectedStudents.filter(id => students.find(s => s._id === id)?.invitationStatus === 'pending').length;
  }, [selectedStudents, students]);

  const inviteFooterLabel = useMemo(() => {
    if (acceptedCount > 0 && newInvitesCount === 0 && pendingCount === 0) {
      return t('HOME.INVITE_BTN_ALL_CONFIRMED', { count: acceptedCount });
    }
    if (newInvitesCount > 0) {
      return newInvitesCount === 1
        ? t('HOME.INVITE_BTN_SEND_ONE')
        : t('HOME.INVITE_BTN_SEND_MANY', { count: newInvitesCount });
    }
    return t('HOME.INVITE_BTN_SEND');
  }, [acceptedCount, newInvitesCount, pendingCount, t]);

  const inviteDisabled =
    newInvitesCount === 0 || inviting || selectedStudents.length === 0 || loading;

  const toggleSelection = useCallback((studentId: string) => {
    const st = students.find(s => s._id === studentId);
    if (st?.invitationStatus === 'accepted') return;
    setSelectedStudents(prev => {
      const i = prev.indexOf(studentId);
      if (i === -1) return [...prev, studentId];
      return prev.filter(id => id !== studentId);
    });
  }, [students]);

  const isSelected = useCallback((id: string) => selectedStudents.includes(id), [selectedStudents]);

  const openRemove = useCallback((student: RowStudent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRemovalStatusKey(
      student.invitationStatus === 'accepted'
        ? 'HOME.INVITE_REMOVAL_STATUS_ACCEPTED'
        : 'HOME.INVITE_REMOVAL_STATUS_INVITED',
    );
    setRemovalActionKey(
      student.invitationStatus === 'accepted'
        ? 'HOME.INVITE_REMOVAL_ACTION_REMOVE'
        : 'HOME.INVITE_REMOVAL_ACTION_CANCEL_INVITE',
    );
    setStudentToRemove(student);
    setShowRemoval(true);
  }, []);

  const cancelRemoval = useCallback(() => {
    setShowRemoval(false);
    setStudentToRemove(null);
  }, []);

  const confirmRemoval = useCallback(async () => {
    if (!studentToRemove || !classId || removing) return;
    setRemoving(true);
    try {
      const res = await removeStudentFromClass(classId, studentToRemove._id);
      if (res.success) {
        Alert.alert('', t('HOME.INVITE_TOAST_REMOVED', { name: studentToRemove.name }));
        setShowRemoval(false);
        setStudentToRemove(null);
        await load();
        onInvitesSent?.();
      }
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : t('HOME.INVITE_TOAST_FAILED_REMOVE');
      Alert.alert('', msg);
    } finally {
      setRemoving(false);
    }
  }, [studentToRemove, classId, removing, t, load, onInvitesSent]);

  const sendInvites = useCallback(async () => {
    if (inviteDisabled || !classId) return;
    const toSend = selectedStudents.filter(id => {
      const s = students.find(x => x._id === id);
      return s && !s.invitationStatus;
    });
    if (toSend.length === 0) {
      Alert.alert('', t('HOME.INVITE_TOAST_NO_NEW'));
      return;
    }
    setInviting(true);
    try {
      const res = await inviteStudentsToClass(classId, toSend);
      if (res.success) {
        const n = res.newInvitationsCount ?? toSend.length;
        Alert.alert(
          '',
          res.message || (n === 1 ? t('HOME.INVITE_TOAST_INVITED_ONE') : t('HOME.INVITE_TOAST_INVITED_MANY', { count: n })),
        );
        setStudents(prev =>
          prev.map(s => (toSend.includes(s._id) ? { ...s, invitationStatus: 'pending' as const } : s)),
        );
        onInvitesSent?.();
        await load();
      }
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : t('HOME.INVITE_TOAST_FAILED_INVITE');
      Alert.alert('', msg);
    } finally {
      setInviting(false);
    }
  }, [inviteDisabled, classId, selectedStudents, students, t, onInvitesSent, load]);

  const displayTitle = className || classDetail?.name || t('HOME.INVITE_STUDENT');

  if (!visible || !classId) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View
        style={[
          styles.safe,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.column}>
        <SolidToolbarWithBlur isDark={isDark}>
          <View style={styles.toolbarRow}>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={showRemoval ? cancelRemoval : onClose}
              style={({ pressed }) => [styles.toolbarBtn, pressed && { opacity: 0.55 }]}
            >
              <Ionicons name={showRemoval ? 'chevron-back' : 'close'} size={24} color={colors.text} />
            </Pressable>
            <Text style={[styles.toolbarTitle, { color: colors.text }]} numberOfLines={1}>
              {t('HOME.INVITE_STUDENT')}
            </Text>
            <View style={{ width: 40 }} />
          </View>
        </SolidToolbarWithBlur>

        {!showRemoval ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Image
                source={require('../../assets/shared/invite-student-modal-hero.png')}
                style={styles.heroImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <Text style={[styles.heroTitle, { color: colors.text }]}>{displayTitle}</Text>
              <Text style={[styles.heroSub, { color: colors.textSecondary }]}>{t('HOME.INVITE_STUDENT_MODAL_SUBTITLE')}</Text>
              <Text style={[styles.heroHint, { color: colors.textTertiary }]}>{t('HOME.INVITE_STUDENT_LIST_SCOPE')}</Text>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.textSecondary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{t('HOME.INVITE_LOADING_STUDENTS')}</Text>
              </View>
            ) : students.length > 0 ? (
              <>
                <TextInput
                  value={searchTerm}
                  onChangeText={setSearchTerm}
                  placeholder={t('HOME.INVITE_SEARCH_PLACEHOLDER')}
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.search,
                    { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border },
                  ]}
                />
                {filteredStudents.length === 0 ? (
                  <Text style={[styles.empty, { color: colors.textSecondary }]}>
                    {t('HOME.INVITE_EMPTY_NO_SEARCH_MATCH', { term: searchTerm })}
                  </Text>
                ) : (
                  filteredStudents.map(s => {
                    const sel = isSelected(s._id);
                    const accepted = s.invitationStatus === 'accepted';
                    return (
                      <View
                        key={s._id}
                        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }, accepted && { opacity: 0.85 }]}
                      >
                        <TouchableOpacity
                          activeOpacity={0.88}
                          disabled={accepted}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            toggleSelection(s._id);
                          }}
                          style={styles.rowMain}
                        >
                          {s.picture ? (
                            <Image source={{ uri: s.picture }} style={styles.avatar} />
                          ) : (
                            <View style={[styles.avatar, styles.avatarPh, { backgroundColor: colors.inputBg }]}>
                              <Text style={[styles.avatarLetter, { color: colors.textSecondary }]}>
                                {s.name.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={styles.rowText}>
                            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                              {s.name}
                            </Text>
                            {!s.invitationStatus ? (
                              <Text style={[styles.role, { color: colors.textTertiary }]}>{t('HOME.INVITE_ROLE_STUDENT')}</Text>
                            ) : accepted ? (
                              <Text style={[styles.badgeOk, { color: colors.success }]}>{t('HOME.INVITE_LABEL_ACCEPTED')}</Text>
                            ) : s.invitationStatus === 'pending' ? (
                              <Text style={[styles.badgePen, { color: colors.warning }]}>{t('HOME.INVITE_LABEL_PENDING')}</Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                        <View style={styles.rowTrail}>
                          {s.invitationStatus ? (
                            <TouchableOpacity
                              accessibilityLabel={t('HOME.INVITE_REMOVE_TITLE_ATTR')}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              onPress={() => openRemove(s)}
                            >
                              <Ionicons name="close-circle" size={26} color={colors.textSecondary} />
                            </TouchableOpacity>
                          ) : (
                            <View
                              style={[
                                styles.checkbox,
                                { borderColor: colors.border },
                                sel && { backgroundColor: colors.joinCtaBackground, borderColor: colors.joinCtaBackground },
                              ]}
                            >
                              {sel ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            ) : (
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
                <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('HOME.INVITE_EMPTY_NO_STUDENTS')}</Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.removalPad, { paddingBottom: 32 }]}
          >
            {studentToRemove ? (
              <>
                <Text style={[styles.removalTitle, { color: colors.text }]}>{t('HOME.INVITE_REMOVAL_TITLE')}</Text>
                <Text style={[styles.removalSub, { color: colors.textSecondary }]}>{t('HOME.INVITE_REMOVAL_SUBTITLE')}</Text>
                <View style={[styles.removalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {studentToRemove.picture ? (
                    <Image source={{ uri: studentToRemove.picture }} style={styles.removalAv} />
                  ) : (
                    <View style={[styles.removalAv, styles.avatarPh, { backgroundColor: colors.inputBg }]}>
                      <Text style={[styles.avatarLetter, { color: colors.textSecondary }]}>
                        {studentToRemove.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.removalName, { color: colors.text }]}>{studentToRemove.name}</Text>
                  <Text style={[styles.removalStatus, { color: colors.textSecondary }]}>{t(removalStatusKey)}</Text>
                </View>
                <Text style={[styles.removalQ, { color: colors.text }]}>
                  {t('HOME.INVITE_REMOVAL_Q_PREFIX')} {t(removalActionKey).toLowerCase()}?
                </Text>
                <Text style={[styles.removalNotify, { color: colors.textTertiary }]}>{t('HOME.INVITE_REMOVAL_NOTIFY')}</Text>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  onPress={cancelRemoval}
                  activeOpacity={0.88}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.text }]}>{t('HOME.INVITE_REMOVAL_BACK')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dangerBtn, { backgroundColor: colors.danger }]}
                  onPress={() => void confirmRemoval()}
                  disabled={removing}
                  activeOpacity={0.88}
                >
                  {removing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.dangerBtnText}>{t('HOME.INVITE_REMOVAL_CONFIRM_BTN')}</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        )}

        {!showRemoval && !loading && students.length > 0 ? (
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[
                styles.cta,
                { backgroundColor: colors.joinCtaBackground },
                inviteDisabled && { opacity: 0.38 },
              ]}
              disabled={inviteDisabled}
              activeOpacity={0.88}
              onPress={() => void sendInvites()}
            >
              {inviting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>{inviteFooterLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  column: { flex: 1 },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    minHeight: 44,
  },
  toolbarBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  heroImage: {
    width: 64,
    height: 64,
    marginBottom: 12,
  },
  heroTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  heroSub: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  heroHint: { fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingLeft: 12 },
  rowTrail: { paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', minWidth: 48 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '600' },
  rowText: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  role: { fontSize: 12, marginTop: 2 },
  badgeOk: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  badgePen: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 16, lineHeight: 22 },
  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  footer: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  cta: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  ctaText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  removalPad: { paddingHorizontal: 20, paddingTop: 8 },
  removalTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  removalSub: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  removalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  removalAv: { width: 56, height: 56, borderRadius: 28, marginBottom: 10 },
  removalName: { fontSize: 18, fontWeight: '700' },
  removalStatus: { fontSize: 14, marginTop: 4 },
  removalQ: { fontSize: 16, lineHeight: 24, marginBottom: 8 },
  removalNotify: { fontSize: 14, lineHeight: 20, marginBottom: 24 },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
  dangerBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  dangerBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
