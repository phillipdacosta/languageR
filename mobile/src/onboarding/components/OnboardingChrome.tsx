import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { ThemeColors } from '../../contexts/ThemeContext';

const BARNABI_MASCOT = require('../../../assets/shared/barnabi-bird.png');

interface Props {
  colors: ThemeColors;
  backLabel: string;
  onBack: () => void;
  onLogout: () => void;
  hideBack?: boolean;
  brandTitle?: string;
  showLangChip?: boolean;
  langFlag?: string;
  langCode?: string;
  onPressLang?: () => void;
  stepCurrent?: number;
  stepTotal?: number;
  /** Barnabi bird — only the interface-language step should set this */
  showMascot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function OnboardingChrome({
  colors,
  backLabel,
  onBack,
  onLogout,
  hideBack,
  brandTitle,
  showLangChip,
  langFlag,
  langCode,
  onPressLang,
  stepCurrent,
  stepTotal,
  showMascot,
  style,
}: Props) {
  const { t } = useTranslation();
  const isDark = colors.isDark;
  const showProgress = stepCurrent != null && stepTotal != null && stepTotal > 0;
  const progress = showProgress ? (stepCurrent! / stepTotal!) * 100 : 0;

  return (
    <View style={style}>
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        {hideBack ? (
          showMascot ? (
            <View style={styles.leftCluster} accessibilityRole="header" accessibilityLabel={brandTitle || 'Barnabi'}>
              <Image source={BARNABI_MASCOT} style={styles.mascot} resizeMode="contain" accessibilityIgnoresInvertColors />
              <Text style={[styles.brandTitle, { color: colors.text }]}>{brandTitle || 'Barnabi'}</Text>
            </View>
          ) : (
            <Text style={[styles.brandTitle, { color: colors.text, zIndex: 1 }]} accessibilityRole="header">
              {brandTitle || 'Barnabi'}
            </Text>
          )
        ) : (
          <TouchableOpacity onPress={onBack} style={styles.navBack} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.navBackLabel, { color: colors.text }]} numberOfLines={1}>
              {backLabel}
            </Text>
          </TouchableOpacity>
        )}
        {showProgress ? (
          <Text
            style={[styles.navStepCount, { color: colors.textSecondary }]}
            accessibilityLabel={t('ONBOARDING.STEP_INDICATOR', { current: stepCurrent, total: stepTotal })}
          >
            {t('CREATE_MATERIAL.STEP_OF', { current: stepCurrent, total: stepTotal })}
          </Text>
        ) : null}
        <View style={styles.navRight}>
          {showLangChip && onPressLang ? (
            <TouchableOpacity onPress={onPressLang} style={[styles.langChip, { borderColor: colors.border }]} activeOpacity={0.7}>
              <Text style={styles.langChipFlag}>{langFlag}</Text>
              <Text style={[styles.langChipCode, { color: colors.text }]}>{langCode?.toUpperCase()}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={onLogout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
            <Ionicons name="log-out-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
      {showProgress ? (
        <View style={styles.progressSection}>
          <View style={[styles.progressTrack, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: isDark ? '#fff' : '#222' }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
    maxWidth: '48%',
    flexShrink: 1,
  },
  mascot: {
    width: 36,
    height: 36,
    marginRight: 10,
  },
  brandTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  navBack: { flexDirection: 'row', alignItems: 'center', zIndex: 1, maxWidth: '42%', flexShrink: 1, minWidth: 0 },
  navBackLabel: { fontSize: 15, fontWeight: '500', flexShrink: 1, marginLeft: 4 },
  navStepCount: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  navRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', zIndex: 1 },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 10,
  },
  langChipFlag: { fontSize: 16, marginRight: 6 },
  langChipCode: { fontSize: 12, fontWeight: '700' },
  progressSection: { marginTop: 14, marginBottom: 20, paddingHorizontal: 20 },
  progressTrack: { height: 3, width: '100%' },
  progressFill: { height: '100%', borderRadius: 1.5 },
});
