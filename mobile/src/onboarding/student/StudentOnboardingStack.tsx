import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../hooks/useAuth';
import { useOnboardingForm } from '../OnboardingFormContext';
import { OnboardingChrome } from '../components/OnboardingChrome';
import { StudentOnboardingSuccessRoute } from '../components/OnboardingSuccessScreen';
import { OnboardingWelcomeAnimated } from '../components/OnboardingWelcomeAnimated';
import { INTERFACE_LANGUAGE_OPTIONS, INTERFACE_LANG_PERSIST_WHITELIST, NATIVE_LANGUAGE_OPTIONS, TEACH_OR_LEARN_LANGUAGES } from '../data/languages';
import { completeStudentOnboarding } from '../onboardingApi';
import { formatName } from '../util/formatName';
import { WEB_APP_BASE } from '../constants';

const MAIN_TOTAL = 7;

export type StudentStackParamList = {
  InterfaceLang: undefined;
  Welcome: undefined;
  Name: undefined;
  NativeLang: undefined;
  LearnLangs: undefined;
  Goal: undefined;
  Level: undefined;
  Timeline: undefined;
  Preview: undefined;
  Success: undefined;
};

const Stack = createNativeStackNavigator<StudentStackParamList>();

const GOAL_TYPES: { value: string; icon: keyof typeof Ionicons.glyphMap; labelKey: string; descKey: string }[] = [
  { value: 'conversational', icon: 'chatbubbles-outline', labelKey: 'ONBOARDING.STUDENT.GOAL_TYPE_CONV_L', descKey: 'ONBOARDING.STUDENT.GOAL_TYPE_CONV_D' },
  { value: 'exam_prep', icon: 'school-outline', labelKey: 'ONBOARDING.STUDENT.GOAL_TYPE_EXAM_L', descKey: 'ONBOARDING.STUDENT.GOAL_TYPE_EXAM_D' },
  { value: 'professional', icon: 'briefcase-outline', labelKey: 'ONBOARDING.STUDENT.GOAL_TYPE_PRO_L', descKey: 'ONBOARDING.STUDENT.GOAL_TYPE_PRO_D' },
  { value: 'travel', icon: 'airplane-outline', labelKey: 'ONBOARDING.STUDENT.GOAL_TYPE_TRAVEL_L', descKey: 'ONBOARDING.STUDENT.GOAL_TYPE_TRAVEL_D' },
  { value: 'relocation', icon: 'home-outline', labelKey: 'ONBOARDING.STUDENT.GOAL_TYPE_RELOC_L', descKey: 'ONBOARDING.STUDENT.GOAL_TYPE_RELOC_D' },
  { value: 'other', icon: 'help-circle-outline', labelKey: 'ONBOARDING.STUDENT.GOAL_TYPE_OTHER_L', descKey: 'ONBOARDING.STUDENT.GOAL_TYPE_OTHER_D' },
];

const LEVEL_OPTS: { value: string; labelKey: string; descKey: string }[] = [
  { value: 'complete_beginner', labelKey: 'ONBOARDING.STUDENT.LEVEL_CB_L', descKey: 'ONBOARDING.STUDENT.LEVEL_CB_D' },
  { value: 'some_basics', labelKey: 'ONBOARDING.STUDENT.LEVEL_SB_L', descKey: 'ONBOARDING.STUDENT.LEVEL_SB_D' },
  { value: 'simple_conversations', labelKey: 'ONBOARDING.STUDENT.LEVEL_SC_L', descKey: 'ONBOARDING.STUDENT.LEVEL_SC_D' },
  { value: 'intermediate', labelKey: 'ONBOARDING.STUDENT.LEVEL_INT_L', descKey: 'ONBOARDING.STUDENT.LEVEL_INT_D' },
  { value: 'advanced', labelKey: 'ONBOARDING.STUDENT.LEVEL_ADV_L', descKey: 'ONBOARDING.STUDENT.LEVEL_ADV_D' },
];

const TIMELINE_OPTS: { value: string; icon: keyof typeof Ionicons.glyphMap; labelKey: string }[] = [
  { value: 'specific_date', icon: 'calendar-outline', labelKey: 'ONBOARDING.STUDENT.TIMELINE_DATE_L' },
  { value: 'few_months', icon: 'time-outline', labelKey: 'ONBOARDING.STUDENT.TIMELINE_FEW_L' },
  { value: 'no_rush', icon: 'leaf-outline', labelKey: 'ONBOARDING.STUDENT.TIMELINE_NORUSH_L' },
];

function mapLevelToLegacy(selfAssessedLevel: string): string {
  if (selfAssessedLevel === 'complete_beginner' || selfAssessedLevel === 'some_basics') return 'Beginner';
  if (selfAssessedLevel === 'intermediate' || selfAssessedLevel === 'simple_conversations') return 'Intermediate';
  if (selfAssessedLevel === 'advanced') return 'Advanced';
  return 'Beginner';
}

function useOnboardingLogout() {
  const { logout } = useAuth();
  const { t } = useTranslation();
  return useCallback(() => {
    Alert.alert(t('ONBOARDING.ALERTS.LOGOUT'), t('ONBOARDING.ALERTS.LOGOUT_CONFIRM'), [
      { text: t('ONBOARDING.ALERTS.CANCEL'), style: 'cancel' },
      { text: t('ONBOARDING.ALERTS.LOGOUT'), style: 'destructive', onPress: () => { void logout(); } },
    ]);
  }, [logout, t]);
}

function StudentInterfaceLangScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;

  const confirm = () => {
    navigation.navigate('Welcome');
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel=""
        onBack={() => {}}
        onLogout={onLogout}
        hideBack
        showMascot
      />
      <ScrollView contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.rotatingHint, { color: colors.textSecondary }]}>{t('ONBOARDING.LANG_SELECT.CHOOSE_SUBTITLE')}</Text>
        <View style={styles.langGrid}>
          {INTERFACE_LANGUAGE_OPTIONS.map(opt => {
            const sel = state.interfaceLanguage === opt.code;
            return (
              <TouchableOpacity
                key={opt.code}
                style={[
                  styles.langCard,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  sel && { borderColor: colors.text, borderWidth: 2 },
                ]}
                onPress={() => patch({ interfaceLanguage: opt.code })}
                activeOpacity={0.85}
              >
                <Text style={styles.langFlag}>{opt.flag}</Text>
                <Text style={[styles.langNative, { color: colors.text }]}>{opt.nativeName}</Text>
                <Text style={[styles.langEn, { color: colors.textSecondary }]}>{opt.name}</Text>
                {sel ? <Ionicons name="checkmark-circle" size={22} color={colors.success} style={styles.langCheck} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.legal, { color: colors.textSecondary }]}>
          {t('ONBOARDING.LEGAL.AGREE_PREFIX')}{' '}
          <Text style={{ color: colors.text }} onPress={() => void WebBrowser.openBrowserAsync(`${WEB_APP_BASE}/terms`)}>
            {t('ONBOARDING.LEGAL.TERMS')}
          </Text>{' '}
          {t('ONBOARDING.LEGAL.AND')}{' '}
          <Text style={{ color: colors.text }} onPress={() => void WebBrowser.openBrowserAsync(`${WEB_APP_BASE}/privacy`)}>
            {t('ONBOARDING.LEGAL.PRIVACY')}
          </Text>
        </Text>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222' }]}
          onPress={confirm}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.LANG_SELECT.CONFIRM')}</Text>
          <Ionicons name="arrow-forward" size={18} color={isDark ? '#000' : '#fff'} style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentWelcomeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const flag = INTERFACE_LANGUAGE_OPTIONS.find(l => l.code === state.interfaceLanguage)?.flag || '🇬🇧';
  const isDark = colors.isDark;

  const feats: { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }[] = [
    { icon: 'people', title: t('ONBOARDING.WELCOME_SCREEN.FEAT1_TITLE'), desc: t('ONBOARDING.WELCOME_SCREEN.FEAT1_DESC') },
    { icon: 'videocam', title: t('ONBOARDING.WELCOME_SCREEN.FEAT2_TITLE'), desc: t('ONBOARDING.WELCOME_SCREEN.FEAT2_DESC') },
    { icon: 'trending-up', title: t('ONBOARDING.WELCOME_SCREEN.FEAT3_TITLE'), desc: t('ONBOARDING.WELCOME_SCREEN.FEAT3_DESC') },
  ];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.WELCOME_SCREEN.BACK')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        showLangChip
        langFlag={flag}
        langCode={state.interfaceLanguage}
        onPressLang={() => navigation.navigate('InterfaceLang')}
      />
      <OnboardingWelcomeAnimated
        title={t('ONBOARDING.WELCOME_SCREEN.GREETING')}
        subtitle={t('ONBOARDING.WELCOME_SCREEN.SUBTITLE')}
        titleColor={colors.text}
        subtitleColor={colors.textSecondary}
        footerWrapStyle={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}
        renderFooter={({ interactive }) => (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222' }]}
            disabled={!interactive}
            onPress={() => navigation.navigate('Name')}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.WELCOME_SCREEN.CTA')}</Text>
            <Ionicons name="arrow-forward" size={18} color={isDark ? '#000' : '#fff'} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
      >
        {feats.map(f => (
          <View key={f.title} style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.featureIcon, { backgroundColor: isDark ? '#2c2c2e' : '#f0f4ff' }]}>
              <Ionicons name={f.icon} size={22} color={isDark ? '#60a5fa' : '#3b82f6'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.featureTitle, { color: colors.text }]}>{f.title}</Text>
              <Text style={[styles.featureDesc, { color: colors.textSecondary }]}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </OnboardingWelcomeAnimated>
    </SafeAreaView>
  );
}

function StudentNameScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const canNext = state.firstName.trim() && state.lastName.trim();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={1}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.STEP1_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.STEP1_SUBTITLE')}</Text>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('ONBOARDING.STUDENT.STEP1_FIRST_NAME')}</Text>
        <TextInput
          value={state.firstName}
          onChangeText={v => patch({ firstName: v })}
          placeholder={t('ONBOARDING.STUDENT.STEP1_FIRST_PLACEHOLDER')}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>{t('ONBOARDING.STUDENT.STEP1_LAST_NAME')}</Text>
        <TextInput
          value={state.lastName}
          onChangeText={v => patch({ lastName: v })}
          placeholder={t('ONBOARDING.STUDENT.STEP1_LAST_PLACEHOLDER')}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('NativeLang')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentNativeLangScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={2}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.STEP2_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.STEP2_SUBTITLE')}</Text>
        {NATIVE_LANGUAGE_OPTIONS.map(opt => {
          const sel = state.nativeLanguage === opt.code;
          return (
            <TouchableOpacity
              key={opt.code}
              style={[styles.optionRow, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => patch({ nativeLanguage: opt.code })}
              activeOpacity={0.85}
            >
              <Text style={[styles.optionTitle, { color: colors.text }]}>{opt.native}</Text>
              <Text style={[styles.optionSub, { color: colors.textSecondary }]}>{opt.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222' }]}
          onPress={() => navigation.navigate('LearnLangs')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentLearnLangsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;

  const toggle = (lang: string) => {
    const set = new Set(state.learningLanguages);
    if (set.has(lang)) set.delete(lang);
    else set.add(lang);
    patch({ learningLanguages: [...set] });
  };

  const canNext = state.learningLanguages.length > 0;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={3}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.STEP3_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.STEP3_SUBTITLE')}</Text>
        <View style={styles.chipWrap}>
          {TEACH_OR_LEARN_LANGUAGES.map(lang => {
            const on = state.learningLanguages.includes(lang);
            return (
              <TouchableOpacity
                key={lang}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: on ? (isDark ? '#2c2c2e' : '#222') : colors.card },
                ]}
                onPress={() => toggle(lang)}
                activeOpacity={0.85}
              >
                <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '600', fontSize: 14 }}>{lang}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Goal')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentGoalScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const needOther = state.learningGoalType === 'other';
  const canNext = !!state.learningGoalType && (!needOther || state.learningGoalDescription.trim().length > 0);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={4}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.GOAL_STRUCT_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.GOAL_STRUCT_SUB')}</Text>
        {GOAL_TYPES.map(g => {
          const sel = state.learningGoalType === g.value;
          return (
            <TouchableOpacity
              key={g.value}
              style={[styles.goalCard, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => patch({ learningGoalType: g.value })}
              activeOpacity={0.85}
            >
              <View style={[styles.goalIcon, { backgroundColor: isDark ? '#2c2c2e' : '#f0f4ff' }]}>
                <Ionicons name={g.icon} size={22} color={isDark ? '#60a5fa' : '#3b82f6'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.goalTitle, { color: colors.text }]}>{t(g.labelKey)}</Text>
                <Text style={[styles.goalDesc, { color: colors.textSecondary }]}>{t(g.descKey)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        {needOther ? (
          <>
            <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 12 }]}>{t('ONBOARDING.STUDENT.GOAL_OTHER_LABEL')}</Text>
            <TextInput
              value={state.learningGoalDescription}
              onChangeText={v => patch({ learningGoalDescription: v })}
              placeholder={t('ONBOARDING.STUDENT.GOAL_OTHER_PH')}
              placeholderTextColor={colors.textTertiary}
              multiline
              style={[styles.textarea, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
            />
          </>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Level')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentLevelScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const canNext = !!state.selfAssessedLevel;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={5}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.LEVEL_STRUCT_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.LEVEL_STRUCT_SUB')}</Text>
        {LEVEL_OPTS.map(o => {
          const sel = state.selfAssessedLevel === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.optionRow, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => patch({ selfAssessedLevel: o.value })}
              activeOpacity={0.85}
            >
              <Text style={[styles.optionTitle, { color: colors.text }]}>{t(o.labelKey)}</Text>
              <Text style={[styles.optionSub, { color: colors.textSecondary }]}>{t(o.descKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Timeline')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentTimelineScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const needDate = state.goalTimeline === 'specific_date';
  const canNext = !!state.goalTimeline && (!needDate || /^\d{4}-\d{2}-\d{2}$/.test(state.goalTargetDate.trim()));

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={6}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.TIMELINE_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.TIMELINE_SUB')}</Text>
        {TIMELINE_OPTS.map(o => {
          const sel = state.goalTimeline === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.timelineRow, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => patch({ goalTimeline: o.value, goalTargetDate: o.value !== 'specific_date' ? '' : state.goalTargetDate })}
              activeOpacity={0.85}
            >
              <Ionicons name={o.icon} size={22} color={colors.text} style={{ marginRight: 12 }} />
              <Text style={[styles.optionTitle, { color: colors.text, flex: 1 }]}>{t(o.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
        {needDate ? (
          <>
            <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>{t('ONBOARDING.STUDENT.TIMELINE_DATE_INPUT')}</Text>
            <TextInput
              value={state.goalTargetDate}
              onChangeText={v => patch({ goalTargetDate: v })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
            />
          </>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Preview')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StudentPreviewScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const { state } = useOnboardingForm();
  const { user } = useAuth();
  const onLogout = useOnboardingLogout();
  const [busy, setBusy] = useState(false);
  const isDark = colors.isDark;

  const nativeName = NATIVE_LANGUAGE_OPTIONS.find(n => n.code === state.nativeLanguage)?.name || state.nativeLanguage;
  const goalLabel = useMemo(() => {
    if (state.learningGoalType === 'other') return state.learningGoalDescription || t('ONBOARDING.STUDENT.GOAL_TYPE_OTHER_L');
    const g = GOAL_TYPES.find(x => x.value === state.learningGoalType);
    return g ? t(g.labelKey) : state.learningGoalType;
  }, [state.learningGoalType, state.learningGoalDescription, t]);

  const levelLabel = useMemo(() => {
    const l = LEVEL_OPTS.find(x => x.value === state.selfAssessedLevel);
    return l ? t(l.labelKey) : state.selfAssessedLevel;
  }, [state.selfAssessedLevel, t]);

  const timelineLabel = useMemo(() => {
    const tl = TIMELINE_OPTS.find(x => x.value === state.goalTimeline);
    let base = tl ? t(tl.labelKey) : '';
    if (state.goalTimeline === 'specific_date' && state.goalTargetDate) base = `${base}: ${state.goalTargetDate}`;
    return base;
  }, [state.goalTimeline, state.goalTargetDate, t]);

  const submit = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        userType: 'student',
        firstName: formatName(state.firstName),
        lastName: formatName(state.lastName),
        nativeLanguage: state.nativeLanguage,
        languages: state.learningLanguages,
        goals: [state.learningGoalType],
        experienceLevel: mapLevelToLegacy(state.selfAssessedLevel),
        preferredSchedule: 'Flexible schedule',
        picture: user?.picture,
        learningGoal: {
          type: state.learningGoalType,
          description: state.learningGoalDescription,
          targetLevel: '',
          selfAssessedLevel: state.selfAssessedLevel,
          timeline: state.goalTimeline,
          targetDate: state.goalTimeline === 'specific_date' && state.goalTargetDate ? state.goalTargetDate : null,
        },
      };
      if (INTERFACE_LANG_PERSIST_WHITELIST.has(state.interfaceLanguage)) {
        body.interfaceLanguage = state.interfaceLanguage;
      }
      await completeStudentOnboarding(body);
      navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Success' }] }));
    } catch (e: any) {
      Alert.alert(t('ONBOARDING.ALERTS.SETUP_ERROR'), e?.message || t('ONBOARDING.ALERTS.SETUP_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.GO_BACK')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={7}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.STUDENT.PREVIEW_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.STUDENT.PREVIEW_SUBTITLE')}</Text>
        <PreviewSection title={t('ONBOARDING.STUDENT.PREVIEW_ABOUT')} colors={colors}>
          <PreviewRow label={t('ONBOARDING.STUDENT.PREVIEW_NAME')} value={`${state.firstName} ${state.lastName}`.trim()} colors={colors} />
          <PreviewRow label={t('ONBOARDING.STUDENT.PREVIEW_NATIVE_LANG')} value={nativeName} colors={colors} />
        </PreviewSection>
        <PreviewSection title={t('ONBOARDING.STUDENT.PREVIEW_LEARNING_PREFS')} colors={colors}>
          <PreviewRow label={t('ONBOARDING.STUDENT.PREVIEW_LEARNING')} value={state.learningLanguages.join(', ')} colors={colors} />
          <PreviewRow label={t('ONBOARDING.STUDENT.GOAL_STRUCT_TITLE')} value={goalLabel} colors={colors} />
          <PreviewRow label={t('ONBOARDING.STUDENT.LEVEL_STRUCT_TITLE')} value={levelLabel} colors={colors} />
          <PreviewRow label={t('ONBOARDING.STUDENT.TIMELINE_TITLE')} value={timelineLabel} colors={colors} />
        </PreviewSection>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222' }]}
          onPress={() => void submit()}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? <ActivityIndicator color={isDark ? '#000' : '#fff'} /> : (
            <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.COMPLETE_SETUP')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function PreviewSection({ title, children, colors }: { title: string; children: React.ReactNode; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={[styles.previewBlock, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.previewBlockTitle, { color: colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function PreviewRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.previewRow}>
      <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.previewValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollPad: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },
  rotatingHint: { fontSize: 15, lineHeight: 22, marginBottom: 16, textAlign: 'center' },
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  langCard: {
    width: '48%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  langFlag: { fontSize: 28, marginBottom: 8 },
  langNative: { fontSize: 16, fontWeight: '700' },
  langEn: { fontSize: 13, marginTop: 2 },
  langCheck: { position: 'absolute', top: 10, right: 10 },
  legal: { fontSize: 12, lineHeight: 18, marginTop: 20, textAlign: 'center' },
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
  featureCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  featureTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  featureDesc: { fontSize: 13, lineHeight: 18 },
  stepTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', marginBottom: 8 },
  stepSub: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 28 },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  optionRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  optionTitle: { fontSize: 16, fontWeight: '600' },
  optionSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  goalCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  goalIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  goalTitle: { fontSize: 16, fontWeight: '700' },
  goalDesc: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  previewBlock: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 14 },
  previewBlockTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 12 },
  previewRow: { marginBottom: 12 },
  previewLabel: { fontSize: 13, marginBottom: 4 },
  previewValue: { fontSize: 16, fontWeight: '600' },
});

export default function StudentOnboardingStack() {
  return (
    <Stack.Navigator initialRouteName="InterfaceLang" screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="InterfaceLang" component={StudentInterfaceLangScreen} />
      <Stack.Screen name="Welcome" component={StudentWelcomeScreen} />
      <Stack.Screen name="Name" component={StudentNameScreen} />
      <Stack.Screen name="NativeLang" component={StudentNativeLangScreen} />
      <Stack.Screen name="LearnLangs" component={StudentLearnLangsScreen} />
      <Stack.Screen name="Goal" component={StudentGoalScreen} />
      <Stack.Screen name="Level" component={StudentLevelScreen} />
      <Stack.Screen name="Timeline" component={StudentTimelineScreen} />
      <Stack.Screen name="Preview" component={StudentPreviewScreen} />
      <Stack.Screen
        name="Success"
        component={StudentOnboardingSuccessRoute}
        options={{ gestureEnabled: false, animation: 'fade' }}
      />
    </Stack.Navigator>
  );
}
