import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';
import { useOnboardingForm } from '../OnboardingFormContext';
import { OnboardingChrome } from '../components/OnboardingChrome';
import { TutorOnboardingSuccessRoute } from '../components/OnboardingSuccessScreen';
import { OnboardingWelcomeAnimated } from '../components/OnboardingWelcomeAnimated';
import { CountryPickerModal } from '../components/CountryPickerModal';
import { COUNTRY_OPTIONS } from '../data/countries';
import { INTERFACE_LANGUAGE_OPTIONS, INTERFACE_LANG_PERSIST_WHITELIST, NATIVE_LANGUAGE_OPTIONS, TEACH_OR_LEARN_LANGUAGES } from '../data/languages';
import { TUTOR_EXPERIENCE_OPTIONS, TUTOR_SCHEDULE_OPTIONS } from '../data/tutorChoices';
import { completeTutorOnboarding, submitTutorForReview } from '../onboardingApi';
import { formatName } from '../util/formatName';
import { detectVideoType, shouldPlayIntroVideoInline, youtubeThumbnailFromVideoUrl } from '../util/videoThumb';
import { WEB_APP_BASE } from '../constants';

const MAIN_TOTAL = 10;

export type TutorStackParamList = {
  InterfaceLang: undefined;
  Welcome: undefined;
  NameCountry: undefined;
  Residence: undefined;
  NativeLang: undefined;
  TeachLang: undefined;
  Experience: undefined;
  Schedule: undefined;
  Bio: undefined;
  Rate: undefined;
  Video: undefined;
  Preview: undefined;
  Success: undefined;
};

const Stack = createNativeStackNavigator<TutorStackParamList>();

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

function TutorInterfaceLangScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;

  const confirm = () => {
    navigation.navigate('Welcome');
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome colors={colors} backLabel="" onBack={() => {}} onLogout={onLogout} hideBack showMascot />
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

function TutorWelcomeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const flag = INTERFACE_LANGUAGE_OPTIONS.find(l => l.code === state.interfaceLanguage)?.flag || '🇬🇧';
  const isDark = colors.isDark;

  const feats: { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }[] = [
    { icon: 'calendar', title: t('ONBOARDING.WELCOME_SCREEN.TUTOR_FEAT1_TITLE'), desc: t('ONBOARDING.WELCOME_SCREEN.TUTOR_FEAT1_DESC') },
    { icon: 'videocam', title: t('ONBOARDING.WELCOME_SCREEN.TUTOR_FEAT2_TITLE'), desc: t('ONBOARDING.WELCOME_SCREEN.TUTOR_FEAT2_DESC') },
    { icon: 'wallet', title: t('ONBOARDING.WELCOME_SCREEN.TUTOR_FEAT3_TITLE'), desc: t('ONBOARDING.WELCOME_SCREEN.TUTOR_FEAT3_DESC') },
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
        title={t('ONBOARDING.WELCOME_SCREEN.TUTOR_GREETING')}
        subtitle={t('ONBOARDING.WELCOME_SCREEN.TUTOR_SUBTITLE')}
        titleColor={colors.text}
        subtitleColor={colors.textSecondary}
        footerWrapStyle={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}
        renderFooter={({ interactive }) => (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222' }]}
            disabled={!interactive}
            onPress={() => navigation.navigate('NameCountry')}
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

function TutorNameCountryScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const [countryOpen, setCountryOpen] = useState(false);
  const isDark = colors.isDark;
  const canNext = state.firstName.trim() && state.lastName.trim() && !!state.country;

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
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP1_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP1_SUBTITLE')}</Text>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP1_FIRST_NAME')}</Text>
        <TextInput
          value={state.firstName}
          onChangeText={v => patch({ firstName: v })}
          placeholder={t('ONBOARDING.TUTOR_OB.STEP1_FIRST_PLACEHOLDER')}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>{t('ONBOARDING.TUTOR_OB.STEP1_LAST_NAME')}</Text>
        <TextInput
          value={state.lastName}
          onChangeText={v => patch({ lastName: v })}
          placeholder={t('ONBOARDING.TUTOR_OB.STEP1_LAST_PLACEHOLDER')}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>{t('ONBOARDING.TUTOR_OB.STEP1_COUNTRY')}</Text>
        <TouchableOpacity
          style={[styles.input, styles.pickerBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
          onPress={() => setCountryOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={{ color: state.country ? colors.text : colors.textTertiary, fontSize: 16 }}>
            {state.country || t('ONBOARDING.TUTOR_OB.STEP1_COUNTRY_PLACEHOLDER')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      <CountryPickerModal
        visible={countryOpen}
        onClose={() => setCountryOpen(false)}
        onSelect={name => patch({ country: name })}
        countries={COUNTRY_OPTIONS}
        selectedName={state.country}
        title={t('ONBOARDING.COUNTRY_MODAL.ORIGIN_TITLE')}
        subtitle={t('ONBOARDING.COUNTRY_MODAL.ORIGIN_DESC')}
        colors={colors}
      />
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Residence')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorResidenceScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const [open, setOpen] = useState(false);
  const isDark = colors.isDark;
  const canNext = !!state.residenceCountry;

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
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP2_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP2_SUBTITLE')}</Text>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP2_COUNTRY_LABEL')}</Text>
        <TouchableOpacity
          style={[styles.input, styles.pickerBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
          onPress={() => setOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={{ color: state.residenceCountry ? colors.text : colors.textTertiary, fontSize: 16 }}>
            {state.residenceCountry || t('ONBOARDING.TUTOR_OB.STEP2_COUNTRY_PLACEHOLDER')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      <CountryPickerModal
        visible={open}
        onClose={() => setOpen(false)}
        onSelect={name => patch({ residenceCountry: name })}
        countries={COUNTRY_OPTIONS}
        selectedName={state.residenceCountry}
        title={t('ONBOARDING.COUNTRY_MODAL.RESIDENCE_TITLE')}
        subtitle={t('ONBOARDING.COUNTRY_MODAL.RESIDENCE_DESC')}
        colors={colors}
      />
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

function TutorNativeLangScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
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
        stepCurrent={3}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP3_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP3_SUBTITLE')}</Text>
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
          onPress={() => navigation.navigate('TeachLang')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorTeachLangScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;

  const select = (lang: string) => {
    patch({ teachLanguages: [lang] });
  };

  const canNext = state.teachLanguages.length > 0;

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
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP4_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP4_SUBTITLE')}</Text>
        {TEACH_OR_LEARN_LANGUAGES.map(lang => {
          const sel = state.teachLanguages[0] === lang;
          return (
            <TouchableOpacity
              key={lang}
              style={[styles.optionRow, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => select(lang)}
              activeOpacity={0.85}
            >
              <Text style={[styles.optionTitle, { color: colors.text }]}>{lang}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Experience')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorExperienceScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const canNext = !!state.tutorExperience;

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
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP5_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP5_SUBTITLE')}</Text>
        {TUTOR_EXPERIENCE_OPTIONS.map(o => {
          const sel = state.tutorExperience === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.optionRow, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => patch({ tutorExperience: o.value })}
              activeOpacity={0.85}
            >
              <Text style={[styles.optionTitle, { color: colors.text }]}>{t(o.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Schedule')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorScheduleScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const canNext = !!state.tutorSchedule;

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
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP6_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP6_SUBTITLE')}</Text>
        {TUTOR_SCHEDULE_OPTIONS.map(o => {
          const sel = state.tutorSchedule === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.optionRow, { borderColor: colors.border, backgroundColor: colors.card }, sel && { borderColor: colors.text, borderWidth: 2 }]}
              onPress={() => patch({ tutorSchedule: o.value })}
              activeOpacity={0.85}
            >
              <Text style={[styles.optionTitle, { color: colors.text }]}>{t(o.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Bio')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorBioScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const canNext = state.profileBio.trim().length > 0;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={7}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP7_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP7_SUBTITLE')}</Text>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>
          {t('ONBOARDING.TUTOR_OB.STEP7_SUMMARY_LABEL')} <Text style={{ fontWeight: '400', color: colors.textSecondary }}>({t('ONBOARDING.TUTOR_OB.STEP7_SUMMARY_OPTIONAL')})</Text>
        </Text>
        <TextInput
          value={state.profileSummary}
          onChangeText={v => patch({ profileSummary: v.slice(0, 150) })}
          placeholder={t('ONBOARDING.TUTOR_OB.STEP7_SUMMARY_PLACEHOLDER')}
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={150}
          style={[styles.textarea, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <Text style={[styles.charCount, { color: colors.textSecondary }]}>{state.profileSummary.length}/150</Text>
        <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 16 }]}>{t('ONBOARDING.TUTOR_OB.STEP7_BIO_LABEL')} *</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP7_BIO_NOTE')}</Text>
        <TextInput
          value={state.profileBio}
          onChangeText={v => patch({ profileBio: v.slice(0, 200) })}
          placeholder={t('ONBOARDING.TUTOR_OB.STEP7_BIO_PLACEHOLDER')}
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={200}
          style={[styles.textarea, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <Text style={[styles.charCount, { color: colors.textSecondary }]}>{state.profileBio.length}/200</Text>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Rate')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorRateScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const canNext = state.hourlyRate >= 10;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={8}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP8_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP8_SUBTITLE')}</Text>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP8_RATE_LABEL')}</Text>
        <TextInput
          value={state.hourlyRate >= 10 ? String(state.hourlyRate) : ''}
          onChangeText={v => {
            const digits = v.replace(/\D/g, '');
            if (!digits) {
              patch({ hourlyRate: 10 });
              return;
            }
            const n = parseInt(digits, 10);
            patch({ hourlyRate: Number.isFinite(n) ? Math.max(10, n) : 10 });
          }}
          keyboardType="number-pad"
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <Text style={[styles.hint, { color: colors.textSecondary, marginTop: 8 }]}>{t('ONBOARDING.TUTOR_OB.STEP8_RATE_NOTE')}</Text>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: isDark ? '#fff' : '#222', opacity: canNext ? 1 : 0.45 }]}
          disabled={!canNext}
          onPress={() => navigation.navigate('Video')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: isDark ? '#000' : '#fff' }]}>{t('ONBOARDING.NAV.CONTINUE')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TutorIntroVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => {
    p.muted = false;
  });
  return (
    <VideoView
      player={player}
      style={styles.videoPlayer}
      contentFit="contain"
      nativeControls
      allowsFullscreen
      allowsPictureInPicture
    />
  );
}

function TutorVideoScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state, patch } = useOnboardingForm();
  const { refreshUser } = useAuth();
  const onLogout = useOnboardingLogout();
  const isDark = colors.isDark;
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const draftPending = state.videoLinkDraft.trim().length > 0;
  const canNext = !draftPending;

  const introUrl = state.introVideoUrl.trim();
  const playInline = introUrl.length > 0 && shouldPlayIntroVideoInline(introUrl, state.videoType);
  const ytThumb =
    state.videoType === 'youtube' ? youtubeThumbnailFromVideoUrl(introUrl) : null;
  const thumbUri = state.videoThumbnail?.trim() || ytThumb || '';

  const addVideo = () => {
    const url = state.videoLinkDraft.trim();
    if (!url) return;
    const vt = detectVideoType(url);
    let thumb = state.videoThumbnail;
    if (vt === 'youtube') {
      thumb = youtubeThumbnailFromVideoUrl(url) || '';
    }
    patch({
      introVideoUrl: url,
      videoType: vt,
      videoThumbnail: thumb,
      videoLinkDraft: '',
    });
  };

  const clearVideo = () => {
    patch({ introVideoUrl: '', videoThumbnail: '', videoType: 'upload', videoLinkDraft: '' });
  };

  const pickVideoFile = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to upload a video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingVideo(true);
    try {
      const fd = new FormData();
      fd.append('video', { uri: result.assets[0].uri, type: 'video/mp4', name: 'intro-video.mp4' } as any);
      const up = await api.upload<{ success: boolean; videoUrl: string }>('/users/tutor-video-upload', fd);
      if (up?.videoUrl) {
        await api.put('/users/tutor-video', {
          introductionVideo: up.videoUrl,
          videoThumbnail: '',
          videoType: 'upload',
        });
        patch({
          introVideoUrl: up.videoUrl,
          videoThumbnail: '',
          videoType: 'upload',
          videoLinkDraft: '',
        });
        await refreshUser();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('ONBOARDING.ALERTS.ERROR'), msg || t('ONBOARDING.ALERTS.SETUP_FAILED'));
    } finally {
      setUploadingVideo(false);
    }
  };

  const openExternalPreview = () => {
    if (introUrl) void WebBrowser.openBrowserAsync(introUrl);
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <OnboardingChrome
        colors={colors}
        backLabel={t('ONBOARDING.NAV.PREVIOUS')}
        onBack={() => navigation.goBack()}
        onLogout={onLogout}
        stepCurrent={9}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP9_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.STEP9_SUBTITLE')}</Text>

        {introUrl ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={[styles.fieldLabel, { color: colors.text, marginBottom: 10 }]}>
              {t('ONBOARDING.TUTOR_OB.STEP9_YOUR_VIDEO')}
            </Text>
            {playInline ? (
              <View style={styles.videoPlayerShell}>
                <TutorIntroVideoPlayer uri={introUrl} />
              </View>
            ) : (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={openExternalPreview}
                style={[styles.videoTapWrap, { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }]}
              >
                {thumbUri ? (
                  <Image source={{ uri: thumbUri }} style={styles.videoThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.videoThumb, styles.videoThumbPh, { backgroundColor: isDark ? '#2c2c2e' : '#e8e8ed' }]}>
                    <Ionicons
                      name={state.videoType === 'vimeo' ? 'logo-vimeo' : 'logo-youtube'}
                      size={40}
                      color={colors.textSecondary}
                    />
                  </View>
                )}
                <View style={styles.playOverlay}>
                  <Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.92)" />
                </View>
                <Text style={[styles.externalHint, { color: colors.textSecondary }]}>
                  {t('ONBOARDING.TUTOR_OB.STEP9_OPEN_PREVIEW')}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.videoActions}>
              <TouchableOpacity style={[styles.oBtn, { borderColor: colors.border }]} onPress={clearVideo} activeOpacity={0.7}>
                <Ionicons name="trash-outline" size={18} color={colors.text} />
                <Text style={[styles.oBtnTxt, { color: colors.text }]}>{t('PROFILE_SCREEN.REMOVE')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.oBtn, { borderColor: colors.border }]}
                onPress={() => void pickVideoFile()}
                activeOpacity={0.7}
                disabled={uploadingVideo}
              >
                {uploadingVideo ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={18} color={colors.text} />
                )}
                <Text style={[styles.oBtnTxt, { color: colors.text }]}>{t('PROFILE_SCREEN.CHANGE')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.uploadArea,
              {
                borderColor: isDark ? colors.border : '#d0d0d0',
                backgroundColor: isDark ? colors.surface : '#fafafa',
              },
            ]}
            onPress={() => void pickVideoFile()}
            activeOpacity={0.65}
            disabled={uploadingVideo}
          >
            {uploadingVideo ? (
              <ActivityIndicator size="large" color={colors.textSecondary} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={40} color={colors.textTertiary} />
                <Text style={[styles.uploadTxt, { color: colors.textSecondary }]}>{t('VIDEO_UPLOAD.UPLOAD_TITLE')}</Text>
                <Text style={[styles.uploadHint, { color: colors.textTertiary }]}>{t('PROFILE_SCREEN.VIDEO_UPLOAD_HINT')}</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text style={[styles.linkSectionLabel, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.STEP9_OR_PASTE_LINK')}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary, marginBottom: 10 }]}>{t('VIDEO_UPLOAD.PASTE_HINT')}</Text>
        <TextInput
          value={state.videoLinkDraft}
          onChangeText={v => patch({ videoLinkDraft: v })}
          placeholder={t('VIDEO_UPLOAD.PASTE_TITLE')}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
        />
        <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={addVideo} activeOpacity={0.85}>
          <Text style={[styles.secondaryBtnText, { color: colors.text }]}>{t('VIDEO_UPLOAD.ADD_VIDEO')}</Text>
        </TouchableOpacity>

        <Text style={[styles.hint, { color: colors.textSecondary, marginTop: 16 }]}>{t('ONBOARDING.TUTOR_OB.STEP9_VIDEO_NOTE')}</Text>
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

function TutorPreviewScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TutorStackParamList>>();
  const { state } = useOnboardingForm();
  const onLogout = useOnboardingLogout();
  const [busy, setBusy] = useState(false);
  const isDark = colors.isDark;

  const nativeName = NATIVE_LANGUAGE_OPTIONS.find(n => n.code === state.nativeLanguage)?.name || state.nativeLanguage;

  const submit = async () => {
    setBusy(true);
    try {
      const vt = state.introVideoUrl ? state.videoType : 'upload';
      let thumb = state.videoThumbnail;
      if (state.introVideoUrl && vt === 'youtube' && !thumb) {
        thumb = youtubeThumbnailFromVideoUrl(state.introVideoUrl) || '';
      }
      const body: Record<string, unknown> = {
        userType: 'tutor',
        firstName: formatName(state.firstName),
        lastName: formatName(state.lastName),
        country: state.country,
        residenceCountry: state.residenceCountry,
        nativeLanguage: state.nativeLanguage,
        languages: state.teachLanguages.slice(0, 1),
        experience: state.tutorExperience,
        schedule: state.tutorSchedule,
        summary: state.profileSummary.trim(),
        bio: state.profileBio.trim(),
        hourlyRate: state.hourlyRate,
        introductionVideo: state.introVideoUrl.trim(),
        videoThumbnail: thumb,
        videoType: vt,
      };
      if (INTERFACE_LANG_PERSIST_WHITELIST.has(state.interfaceLanguage)) {
        body.interfaceLanguage = state.interfaceLanguage;
      }
      await completeTutorOnboarding(body);
      try {
        await submitTutorForReview();
      } catch { /* non-fatal */ }
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
        stepCurrent={10}
        stepTotal={MAIN_TOTAL}
      />
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{t('ONBOARDING.TUTOR_OB.PREVIEW_TITLE')}</Text>
        <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{t('ONBOARDING.TUTOR_OB.PREVIEW_SUBTITLE')}</Text>
        <PreviewBlock title={t('ONBOARDING.TUTOR_OB.PREVIEW_PERSONAL')} colors={colors}>
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_NAME')} value={`${state.firstName} ${state.lastName}`.trim()} colors={colors} />
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_FROM')} value={state.country} colors={colors} />
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_RESIDES')} value={state.residenceCountry} colors={colors} />
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_NATIVE_LANG')} value={nativeName} colors={colors} />
        </PreviewBlock>
        <PreviewBlock title={t('ONBOARDING.TUTOR_OB.PREVIEW_TEACHING')} colors={colors}>
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_TEACHES')} value={state.teachLanguages.join(', ')} colors={colors} />
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_EXPERIENCE')} value={state.tutorExperience} colors={colors} />
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_AVAILABILITY')} value={state.tutorSchedule} colors={colors} />
        </PreviewBlock>
        <PreviewBlock title={t('ONBOARDING.TUTOR_OB.PREVIEW_PROFILE')} colors={colors}>
          {state.profileSummary ? <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_SUMMARY')} value={state.profileSummary} colors={colors} /> : null}
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_BIO')} value={state.profileBio} colors={colors} />
          <PreviewRow label={t('ONBOARDING.TUTOR_OB.PREVIEW_RATE')} value={`$${state.hourlyRate} ${t('ONBOARDING.TUTOR_OB.STEP8_PER_HOUR')}`} colors={colors} />
          <PreviewRow
            label={t('ONBOARDING.TUTOR_OB.PREVIEW_VIDEO')}
            value={state.introVideoUrl ? t('ONBOARDING.TUTOR_OB.PREVIEW_UPLOADED') : '—'}
            colors={colors}
          />
        </PreviewBlock>
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

function PreviewBlock({ title, children, colors }: { title: string; children: React.ReactNode; colors: ReturnType<typeof useTheme>['colors'] }) {
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
  hint: { fontSize: 13, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  pickerBtn: { justifyContent: 'center' },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: { fontSize: 12, marginTop: 6, textAlign: 'right' },
  optionRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  optionTitle: { fontSize: 16, fontWeight: '600' },
  optionSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  secondaryBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
  videoAdded: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  previewBlock: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 14 },
  previewBlockTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 12 },
  previewRow: { marginBottom: 12 },
  previewLabel: { fontSize: 13, marginBottom: 4 },
  previewValue: { fontSize: 16, fontWeight: '600' },
  videoPlayerShell: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
    aspectRatio: 16 / 9,
    maxHeight: 220,
  },
  videoPlayer: { width: '100%', height: '100%' },
  videoTapWrap: { position: 'relative' },
  videoThumb: { width: '100%', aspectRatio: 16 / 9 },
  videoThumbPh: { alignItems: 'center', justifyContent: 'center' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  externalHint: { fontSize: 13, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  videoActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  oBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  oBtnTxt: { fontSize: 15, fontWeight: '600' },
  uploadArea: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 8,
  },
  uploadTxt: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  uploadHint: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  linkSectionLabel: { fontSize: 15, fontWeight: '600', marginTop: 24, marginBottom: 4 },
});

export default function TutorOnboardingStack() {
  return (
    <Stack.Navigator initialRouteName="InterfaceLang" screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="InterfaceLang" component={TutorInterfaceLangScreen} />
      <Stack.Screen name="Welcome" component={TutorWelcomeScreen} />
      <Stack.Screen name="NameCountry" component={TutorNameCountryScreen} />
      <Stack.Screen name="Residence" component={TutorResidenceScreen} />
      <Stack.Screen name="NativeLang" component={TutorNativeLangScreen} />
      <Stack.Screen name="TeachLang" component={TutorTeachLangScreen} />
      <Stack.Screen name="Experience" component={TutorExperienceScreen} />
      <Stack.Screen name="Schedule" component={TutorScheduleScreen} />
      <Stack.Screen name="Bio" component={TutorBioScreen} />
      <Stack.Screen name="Rate" component={TutorRateScreen} />
      <Stack.Screen name="Video" component={TutorVideoScreen} />
      <Stack.Screen name="Preview" component={TutorPreviewScreen} />
      <Stack.Screen
        name="Success"
        component={TutorOnboardingSuccessRoute}
        options={{ gestureEnabled: false, animation: 'fade' }}
      />
    </Stack.Navigator>
  );
}
