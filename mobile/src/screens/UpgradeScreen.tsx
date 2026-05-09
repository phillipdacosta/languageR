import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';

import { useTheme, ThemeColors } from '../contexts/ThemeContext';
import {
  SubscriptionSummary,
  getMySubscription,
  startCheckout,
  openPortal,
} from '../services/subscription';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';

/**
 * UpgradeScreen — premium plan presentation + management.
 *
 *  - Free user → "Start Premium" button → opens Stripe Checkout in the
 *    in-app browser. On dismiss we re-fetch the subscription so the UI
 *    flips automatically once the webhook updates the user.
 *  - Premium user → "Manage plan" button → opens Stripe Customer Portal.
 *
 * Native IAP is intentionally not used yet (separate compliance work).
 */
export default function UpgradeScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { user, refreshUser } = useAuth();

  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiTogglePending, setAiTogglePending] = useState(false);

  const isPremium = summary?.tier === 'premium' && summary?.status !== 'canceled';
  const aiAnalysisEnabled = (user as any)?.profile?.aiAnalysisEnabled !== false;
  // Show the "you're not getting what you're paying for" banner only
  // when premium *and* AI analysis is currently disabled.
  const showAiOffBanner = isPremium && !aiAnalysisEnabled;

  const loadSummary = useCallback(async () => {
    try {
      const res = await getMySubscription();
      setSummary(res?.subscription || null);
    } catch (err) {
      console.warn('[UpgradeScreen] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleEnableAi = useCallback(async () => {
    if (aiTogglePending) return;
    setAiTogglePending(true);
    try {
      await api.put('/users/profile', { aiAnalysisEnabled: true });
      await refreshUser?.();
      Alert.alert(t('UPGRADE.AI_ON_TOAST'));
    } catch (err) {
      Alert.alert(t('UPGRADE.AI_ON_FAILED'));
    } finally {
      setAiTogglePending(false);
    }
  }, [aiTogglePending, refreshUser, t]);

  // Re-check subscription state every time the screen regains focus
  // (e.g. after the in-app browser closes following Stripe Checkout).
  useFocusEffect(
    useCallback(() => {
      loadSummary();
    }, [loadSummary]),
  );

  const handleStartCheckout = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await startCheckout();
      if (!res?.url) {
        Alert.alert(t('UPGRADE.CHECKOUT_ERROR'));
        return;
      }
      const result = await WebBrowser.openBrowserAsync(res.url);
      // Whatever the result is (cancel/success), re-pull state from server.
      await loadSummary();
      if (result?.type === 'cancel') {
        // No-op — user backed out.
      }
    } catch (err) {
      console.error('[UpgradeScreen] checkout failed:', err);
      Alert.alert(t('UPGRADE.CHECKOUT_ERROR'));
    } finally {
      setBusy(false);
    }
  }, [busy, loadSummary, t]);

  const handleOpenPortal = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await openPortal();
      if (!res?.url) {
        Alert.alert(t('UPGRADE.PORTAL_ERROR'));
        return;
      }
      await WebBrowser.openBrowserAsync(res.url);
      await loadSummary();
    } catch (err) {
      console.error('[UpgradeScreen] portal failed:', err);
      Alert.alert(t('UPGRADE.PORTAL_ERROR'));
    } finally {
      setBusy(false);
    }
  }, [busy, loadSummary, t]);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const freePerks = useMemo(
    () => [
      t('UPGRADE.FREE_PERK_1'),
      t('UPGRADE.FREE_PERK_2'),
      t('UPGRADE.FREE_PERK_3'),
      t('UPGRADE.FREE_PERK_4'),
    ],
    [t],
  );
  const premiumPerks = useMemo(
    () => [
      t('UPGRADE.PREMIUM_PERK_1'),
      t('UPGRADE.PREMIUM_PERK_2'),
      t('UPGRADE.PREMIUM_PERK_3'),
      t('UPGRADE.PREMIUM_PERK_4'),
    ],
    [t],
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleClose} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{t('UPGRADE.TITLE')}</Text>
        <View style={styles.closeBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>

          {/* AI-off banner — only when premium AND AI is currently disabled */}
          {showAiOffBanner && (
            <View style={styles.aiBanner}>
              <View style={styles.aiBannerIcon}>
                <Ionicons name="bulb-outline" size={20} color={colors.text} />
              </View>
              <View style={styles.aiBannerText}>
                <Text style={styles.aiBannerTitle}>{t('UPGRADE.AI_OFF_BANNER_TITLE')}</Text>
                <Text style={styles.aiBannerBody}>{t('UPGRADE.AI_OFF_BANNER_BODY')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.aiBannerCta, aiTogglePending && { opacity: 0.6 }]}
                disabled={aiTogglePending}
                onPress={handleEnableAi}>
                {aiTogglePending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.aiBannerCtaText}>{t('UPGRADE.AI_OFF_BANNER_CTA')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.eyebrowChip}>
              <Ionicons name="sparkles-outline" size={12} color="#fff" />
              <Text style={styles.eyebrowText}>{t('UPGRADE.EYEBROW')}</Text>
            </View>
            <Text style={styles.heroTitle}>{t('UPGRADE.HERO_TITLE')}</Text>
            <Text style={styles.heroSub}>{t('UPGRADE.HERO_SUB')}</Text>
          </View>

          {/* Free card */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{t('UPGRADE.FREE_TAG')}</Text>
              </View>
              <Text style={styles.planName}>{t('UPGRADE.FREE_NAME')}</Text>
              <Text style={styles.priceText}>
                $0<Text style={styles.priceUnit}>/mo</Text>
              </Text>
            </View>
            {freePerks.map((perk, i) => (
              <View key={`free-${i}`} style={styles.perkRow}>
                <Ionicons name="checkmark-outline" size={16} color={colors.text} />
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}
          </View>

          {/* Premium card */}
          <View style={[styles.card, styles.cardPremium]}>
            <View style={styles.cardHead}>
              <View style={[styles.tag, styles.tagPremium]}>
                <Ionicons name="sparkles-outline" size={11} color="#fff" />
                <Text style={[styles.tagText, styles.tagTextPremium]}>
                  {t('UPGRADE.PREMIUM_TAG')}
                </Text>
              </View>
              <Text style={styles.planName}>{t('UPGRADE.PREMIUM_NAME')}</Text>
              <Text style={styles.priceText}>
                $9<Text style={styles.priceUnit}>/mo</Text>
              </Text>
            </View>
            {premiumPerks.map((perk, i) => (
              <View key={`prem-${i}`} style={styles.perkRow}>
                <Ionicons name="checkmark-outline" size={16} color={colors.text} />
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}

            {/* CTA */}
            {!isPremium ? (
              <Pressable
                onPress={handleStartCheckout}
                disabled={busy}
                style={({ pressed }) => [
                  styles.cta,
                  pressed && styles.ctaPressed,
                  busy && styles.ctaDisabled,
                ]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.ctaText}>{t('UPGRADE.START_CHECKOUT')}</Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                onPress={handleOpenPortal}
                disabled={busy}
                style={({ pressed }) => [
                  styles.ctaGhost,
                  pressed && styles.ctaPressed,
                  busy && styles.ctaDisabled,
                ]}>
                {busy ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.ctaGhostText}>{t('UPGRADE.MANAGE_PLAN')}</Text>
                )}
              </Pressable>
            )}

            <Text style={styles.fineprint}>{t('UPGRADE.FINEPRINT')}</Text>
          </View>

          {/* Status block (when premium) */}
          {isPremium && summary && (
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>{t('UPGRADE.STATUS_LABEL')}</Text>
                <Text style={styles.statusValue}>{summary.status}</Text>
              </View>
              {summary.renewsAt && (
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>{t('UPGRADE.RENEWS_LABEL')}</Text>
                  <Text style={styles.statusValue}>
                    {new Date(summary.renewsAt).toLocaleDateString()}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    topBarTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    content: { padding: 20, paddingBottom: 60 },

    aiBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.text,
      borderRadius: 14,
      backgroundColor: colors.card,
      marginBottom: 16,
    },
    aiBannerIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    aiBannerText: { flex: 1 },
    aiBannerTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    aiBannerBody: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    aiBannerCta: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.text,
      minWidth: 92,
      alignItems: 'center',
    },
    aiBannerCtaText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 13,
    },
    hero: { alignItems: 'center', marginBottom: 24 },
    eyebrowChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.text,
      gap: 4,
    },
    eyebrowText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    heroTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.text,
      marginTop: 12,
      textAlign: 'center',
    },
    heroSub: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      marginTop: 6,
      textAlign: 'center',
      maxWidth: 480,
    },

    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 18,
      marginBottom: 14,
    },
    cardPremium: {
      borderColor: colors.text,
    },
    cardHead: { gap: 6, marginBottom: 12 },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 9,
      paddingVertical: 3,
      backgroundColor: colors.surface,
      borderRadius: 999,
      gap: 4,
    },
    tagText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    tagPremium: { backgroundColor: colors.text },
    tagTextPremium: { color: '#fff' },

    planName: { fontSize: 17, fontWeight: '700', color: colors.text },
    priceText: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
    priceUnit: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },

    perkRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginBottom: 8,
    },
    perkText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },

    cta: {
      marginTop: 14,
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    ctaGhost: {
      marginTop: 14,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.text,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaGhostText: { color: colors.text, fontSize: 15, fontWeight: '700' },
    ctaPressed: { opacity: 0.85 },
    ctaDisabled: { opacity: 0.6 },

    fineprint: {
      marginTop: 8,
      fontSize: 12,
      color: colors.textTertiary,
      textAlign: 'center',
    },

    statusCard: {
      marginTop: 8,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
    },
    statusRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    statusLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    statusValue: { fontSize: 13, color: colors.text, fontWeight: '700' },
  });
}
