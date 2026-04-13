import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../hooks/useAuth';
import { useOnboardingForm } from '../OnboardingFormContext';
import { OnboardingChrome } from './OnboardingChrome';
import { formatName } from '../util/formatName';

const CONFETTI = [
  { top: 24, left: '6%', size: 9, opacity: 0.85, bg: '#6366f1' },
  { top: 48, left: '22%', size: 7, opacity: 0.7, bg: '#22c55e' },
  { top: 16, left: '78%', size: 8, opacity: 0.75, bg: '#f59e0b' },
  { top: 72, left: '88%', size: 6, opacity: 0.65, bg: '#ec4899' },
  { top: 100, left: '12%', size: 7, opacity: 0.55, bg: '#3b82f6' },
  { top: 120, left: '45%', size: 8, opacity: 0.6, bg: '#a855f7' },
  { top: 56, left: '55%', size: 6, opacity: 0.5, bg: '#14b8a6' },
  { top: 88, left: '68%', size: 7, opacity: 0.7, bg: '#ef4444' },
] as const;

export type OnboardingSuccessVariant = 'tutor' | 'student';

function useOnboardingLogout() {
  const { logout } = useAuth();
  const { t } = useTranslation();
  return React.useCallback(() => {
    Alert.alert(t('ONBOARDING.ALERTS.LOGOUT'), t('ONBOARDING.ALERTS.LOGOUT_CONFIRM'), [
      { text: t('ONBOARDING.ALERTS.CANCEL'), style: 'cancel' },
      { text: t('ONBOARDING.ALERTS.LOGOUT'), style: 'destructive', onPress: () => { void logout(); } },
    ]);
  }, [logout, t]);
}

export function OnboardingSuccessScreen({ variant }: { variant: OnboardingSuccessVariant }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { state } = useOnboardingForm();
  const { refreshUser } = useAuth();
  const onLogout = useOnboardingLogout();
  const [busy, setBusy] = useState(false);
  const isDark = colors.isDark;

  const firstName = formatName(state.firstName) || state.firstName.trim() || '';

  const titleKey =
    variant === 'tutor' ? 'ONBOARDING.TUTOR_OB.SUCCESS_TITLE' : 'ONBOARDING.STUDENT.SUCCESS_TITLE';
  const subtitleKey =
    variant === 'tutor' ? 'ONBOARDING.TUTOR_OB.SUCCESS_SUBTITLE' : 'ONBOARDING.STUDENT.SUCCESS_SUBTITLE';
  const noteKey = variant === 'tutor' ? 'ONBOARDING.TUTOR_OB.SUCCESS_NOTE' : 'ONBOARDING.STUDENT.SUCCESS_NOTE';
  const ctaKey = variant === 'tutor' ? 'ONBOARDING.NAV.GO_TO_DASHBOARD' : 'ONBOARDING.NAV.START_LEARNING';

  const highlightKeys =
    variant === 'tutor'
      ? ([
          'ONBOARDING.TUTOR_OB.SUCCESS_PROFILE_CREATED',
          'ONBOARDING.TUTOR_OB.SUCCESS_READY_BOOKINGS',
          'ONBOARDING.TUTOR_OB.SUCCESS_COMMUNITY',
        ] as const)
      : ([
          'ONBOARDING.STUDENT.SUCCESS_PROFILE_CREATED',
          'ONBOARDING.STUDENT.SUCCESS_READY_BOOK',
          'ONBOARDING.STUDENT.SUCCESS_PERSONALIZED',
        ] as const);

  const goToApp = async () => {
    setBusy(true);
    try {
      await refreshUser();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('ONBOARDING.ALERTS.ERROR'), msg || t('ONBOARDING.ALERTS.SETUP_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome colors={colors} backLabel="" onBack={() => {}} onLogout={onLogout} hideBack />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.confettiWrap} pointerEvents="none">
          {CONFETTI.map((d, i) => (
            <View
              key={i}
              style={[
                styles.confettiDot,
                {
                  top: d.top,
                  left: d.left as `${number}%`,
                  width: d.size,
                  height: d.size,
                  borderRadius: d.size / 2,
                  opacity: d.opacity,
                  backgroundColor: d.bg,
                },
              ]}
            />
          ))}
        </View>

        <View style={[styles.checkRing, { backgroundColor: isDark ? '#1a3d2e' : '#dcfce7' }]}>
          <Ionicons name="checkmark-sharp" size={36} color={isDark ? '#4ade80' : '#16a34a'} />
        </View>

        <Text style={[styles.heroTitle, { color: colors.text }]}>{t(titleKey, { name: firstName })}</Text>
        <Text style={[styles.heroSub, { color: colors.textSecondary }]}>{t(subtitleKey)}</Text>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card, gap: 16 }]}>
          {highlightKeys.map(key => (
            <View key={key} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: isDark ? '#1e3a2f' : '#ecfdf5' }]}>
                <Ionicons name="checkmark-circle" size={22} color={isDark ? '#4ade80' : '#16a34a'} />
              </View>
              <Text style={[styles.rowText, { color: colors.text }]}>{t(key)}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.note, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}>
          <Ionicons name="sparkles-outline" size={20} color={colors.textSecondary} style={styles.noteIcon} />
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>{t(noteKey)}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222' }]}
          onPress={() => void goToApp()}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={isDark ? '#000' : '#fff'} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t(ctaKey)}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 120 },
  confettiWrap: { position: 'absolute', left: 0, right: 0, top: 0, height: 200, zIndex: 0 },
  confettiDot: { position: 'absolute' },
  checkRing: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 20,
    zIndex: 2,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 32,
  },
  heroSub: { fontSize: 16, lineHeight: 24, textAlign: 'center', marginBottom: 28 },
  card: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowText: { flex: 1, fontSize: 16, fontWeight: '600', lineHeight: 22 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 14,
    gap: 10,
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 17, fontWeight: '600' },
});

export function TutorOnboardingSuccessRoute() {
  return <OnboardingSuccessScreen variant="tutor" />;
}

export function StudentOnboardingSuccessRoute() {
  return <OnboardingSuccessScreen variant="student" />;
}
