import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Switch,
  RefreshControl,
  Alert,
  ActivityIndicator,
  ActionSheetIOS,
  Platform,
  Modal,
  TextInput,
  FlatList,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as WebBrowser from 'expo-web-browser';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { useTheme, ThemeColors } from '../contexts/ThemeContext';
import { api } from '../services/api';
import { useScreenEntranceAnimations } from '../hooks/useScreenEntranceAnimations';
import StaggerRow from '../components/StaggerRow';

// ─── Constants ───

interface TZOption { value: string; label: string; region: string }
const TIMEZONES: TZOption[] = [
  { value: 'America/New_York', label: 'New York (Eastern)', region: 'Americas' },
  { value: 'America/Chicago', label: 'Chicago (Central)', region: 'Americas' },
  { value: 'America/Denver', label: 'Denver (Mountain)', region: 'Americas' },
  { value: 'America/Phoenix', label: 'Phoenix (MST)', region: 'Americas' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific)', region: 'Americas' },
  { value: 'America/Anchorage', label: 'Anchorage (Alaska)', region: 'Americas' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (Hawaii)', region: 'Americas' },
  { value: 'America/Toronto', label: 'Toronto', region: 'Americas' },
  { value: 'America/Vancouver', label: 'Vancouver', region: 'Americas' },
  { value: 'America/Mexico_City', label: 'Mexico City', region: 'Americas' },
  { value: 'America/Bogota', label: 'Bogotá', region: 'Americas' },
  { value: 'America/Lima', label: 'Lima', region: 'Americas' },
  { value: 'America/Santiago', label: 'Santiago', region: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'São Paulo', region: 'Americas' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires', region: 'Americas' },
  { value: 'Europe/London', label: 'London', region: 'Europe' },
  { value: 'Europe/Dublin', label: 'Dublin', region: 'Europe' },
  { value: 'Europe/Lisbon', label: 'Lisbon', region: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris', region: 'Europe' },
  { value: 'Europe/Madrid', label: 'Madrid', region: 'Europe' },
  { value: 'Europe/Rome', label: 'Rome', region: 'Europe' },
  { value: 'Europe/Berlin', label: 'Berlin', region: 'Europe' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam', region: 'Europe' },
  { value: 'Europe/Brussels', label: 'Brussels', region: 'Europe' },
  { value: 'Europe/Vienna', label: 'Vienna', region: 'Europe' },
  { value: 'Europe/Zurich', label: 'Zurich', region: 'Europe' },
  { value: 'Europe/Stockholm', label: 'Stockholm', region: 'Europe' },
  { value: 'Europe/Copenhagen', label: 'Copenhagen', region: 'Europe' },
  { value: 'Europe/Oslo', label: 'Oslo', region: 'Europe' },
  { value: 'Europe/Helsinki', label: 'Helsinki', region: 'Europe' },
  { value: 'Europe/Warsaw', label: 'Warsaw', region: 'Europe' },
  { value: 'Europe/Prague', label: 'Prague', region: 'Europe' },
  { value: 'Europe/Budapest', label: 'Budapest', region: 'Europe' },
  { value: 'Europe/Athens', label: 'Athens', region: 'Europe' },
  { value: 'Europe/Istanbul', label: 'Istanbul', region: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow', region: 'Europe' },
  { value: 'Asia/Dubai', label: 'Dubai', region: 'Asia' },
  { value: 'Asia/Karachi', label: 'Karachi', region: 'Asia' },
  { value: 'Asia/Kolkata', label: 'Kolkata', region: 'Asia' },
  { value: 'Asia/Dhaka', label: 'Dhaka', region: 'Asia' },
  { value: 'Asia/Bangkok', label: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Singapore', label: 'Singapore', region: 'Asia' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong', region: 'Asia' },
  { value: 'Asia/Shanghai', label: 'Shanghai', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Tokyo', region: 'Asia' },
  { value: 'Asia/Seoul', label: 'Seoul', region: 'Asia' },
  { value: 'Asia/Manila', label: 'Manila', region: 'Asia' },
  { value: 'Asia/Jakarta', label: 'Jakarta', region: 'Asia' },
  { value: 'Asia/Jerusalem', label: 'Jerusalem', region: 'Asia' },
  { value: 'Africa/Cairo', label: 'Cairo', region: 'Africa' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg', region: 'Africa' },
  { value: 'Africa/Lagos', label: 'Lagos', region: 'Africa' },
  { value: 'Africa/Nairobi', label: 'Nairobi', region: 'Africa' },
  { value: 'Australia/Sydney', label: 'Sydney', region: 'Oceania' },
  { value: 'Australia/Melbourne', label: 'Melbourne', region: 'Oceania' },
  { value: 'Australia/Brisbane', label: 'Brisbane', region: 'Oceania' },
  { value: 'Australia/Perth', label: 'Perth', region: 'Oceania' },
  { value: 'Pacific/Auckland', label: 'Auckland', region: 'Oceania' },
];

interface LangOption { code: string; name: string; nativeName: string; flag: string }
const LANGUAGES: LangOption[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷' },
];

const LANG_FLAGS: Record<string, string> = {
  English: '🇬🇧', Spanish: '🇪🇸', French: '🇫🇷', Portuguese: '🇧🇷', German: '🇩🇪',
  Italian: '🇮🇹', Russian: '🇷🇺', Chinese: '🇨🇳', Japanese: '🇯🇵', Korean: '🇰🇷',
  Arabic: '🇸🇦', Hindi: '🇮🇳', Dutch: '🇳🇱', Polish: '🇵🇱', Turkish: '🇹🇷',
  Swedish: '🇸🇪', Norwegian: '🇳🇴', Danish: '🇩🇰', Finnish: '🇫🇮', Greek: '🇬🇷',
  Czech: '🇨🇿', Romanian: '🇷🇴', Ukrainian: '🇺🇦', Vietnamese: '🇻🇳', Thai: '🇹🇭',
  Indonesian: '🇮🇩', Malay: '🇲🇾', Hebrew: '🇮🇱', Persian: '🇮🇷',
};

function getTimezoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const offset = parts.find(p => p.type === 'timeZoneName')?.value.replace('GMT', 'UTC') || 'UTC';
    const city = tz.split('/').pop()?.replace(/_/g, ' ') || tz;
    return `${city} (${offset})`;
  } catch { return tz; }
}

// ─── Main Component ───

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { colors, isDark, setDarkMode } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [refreshing, setRefreshing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  const [payoutLoaded, setPayoutLoaded] = useState(false);
  const [hasPayoutSetup, setHasPayoutSetup] = useState(false);
  const [payoutProvider, setPayoutProvider] = useState('none');
  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);

  const [tzModalVisible, setTzModalVisible] = useState(false);
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [langSearch, setLangSearch] = useState('');

  const isTutor = user?.userType === 'tutor';
  const isStudent = user?.userType === 'student';
  const displayName = user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.name || 'User';
  const initials = displayName.split(' ').map((w: string) => w.charAt(0)).join('').substring(0, 2).toUpperCase();
  const discoverableName = user?.firstName ? `${user.firstName} ${user.lastName?.charAt(0) || ''}.` : displayName.split(' ')[0];
  const hasCustomPicture = !!user?.picture && user.picture.includes('storage.googleapis.com') && user.picture.includes('profile-pictures');
  const timezoneRaw = user?.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneLabel = user?.profile?.timezone ? getTimezoneLabel(user.profile.timezone) : 'Auto-detected';
  const timeFormat: '12h' | '24h' = (user?.profile?.calendarTimeFormat as any) || '12h';
  const remindersEnabled = user?.profile?.remindersEnabled === true;
  const showWalletBalance = user?.profile?.showWalletBalance ?? true;
  const aiAnalysisEnabled = user?.profile?.aiAnalysisEnabled !== false;
  const interfaceLang = user?.interfaceLanguage || 'en';
  const currentLangObj = LANGUAGES.find(l => l.code === interfaceLang) || LANGUAGES[0];

  const od = user?.onboardingData;
  const hasPendingVideoFile = !!od?.pendingVideo;
  const hasApprovedVideo = !!od?.introductionVideo;
  const isVideoApproved = user?.tutorOnboarding?.videoApproved === true;
  const hasPendingVideo = !isVideoApproved && (hasPendingVideoFile || hasApprovedVideo);

  let tutorVideoUrl = '';
  let tutorVideoThumb = '';
  let tutorVideoType: string = 'upload';
  if (hasPendingVideoFile) { tutorVideoUrl = od?.pendingVideo || ''; tutorVideoThumb = od?.pendingVideoThumbnail || ''; tutorVideoType = od?.pendingVideoType || 'upload'; }
  else if (hasApprovedVideo) { tutorVideoUrl = od?.introductionVideo || ''; tutorVideoThumb = od?.videoThumbnail || ''; tutorVideoType = od?.videoType || 'upload'; }

  const payoutProviderName = payoutProvider === 'stripe' ? 'Stripe' : payoutProvider === 'paypal' ? 'PayPal' : payoutProvider === 'manual' ? 'Manual Transfer' : '';

  const visibility = useMemo(() => {
    if (!isTutor || !user) return { visible: true, loaded: false, missing: [] as string[] };
    const missing: string[] = [];
    if (!user.onboardingCompleted) missing.push(t('HOME.BANNER_COMPLETE_SETUP'));
    const hasCustomPhoto = !!(user.picture && (
      user.picture.includes('storage.googleapis.com') ||
      (user.auth0Picture && user.picture !== user.auth0Picture)
    ));
    if (!hasCustomPhoto) missing.push(t('HOME.BANNER_UPLOAD_PHOTO'));
    if (!user.tutorApproved) {
      const videoOk = user.tutorOnboarding?.videoApproved === true;
      if (!videoOk) { const hasAny = !!(od?.introductionVideo || od?.pendingVideo); missing.push(hasAny ? t('HOME.BANNER_VIDEO_PENDING') : t('HOME.BANNER_UPLOAD_VIDEO')); }
      const creds = user.tutorCredentials;
      const govIdOk = creds?.governmentId?.status === 'approved';
      const certsOk = !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved'));
      if (!govIdOk || !certsOk) {
        const govUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
        const certsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
        missing.push(govUploaded && certsUploaded ? t('HOME.BANNER_CREDENTIALS_PENDING') : t('HOME.BANNER_UPLOAD_CREDENTIALS'));
      }
    }
    if (!hasPayoutSetup && payoutLoaded) missing.push(t('HOME.BANNER_CONNECT_BANK'));
    if (pendingFeedbackCount > 0) missing.push(`${pendingFeedbackCount} ${t('HOME.FEEDBACK_NEEDED')}`);
    const isVisible = !!user.onboardingCompleted && hasCustomPhoto && !!user.tutorApproved && hasPayoutSetup && pendingFeedbackCount === 0;
    return { visible: isVisible, loaded: payoutLoaded, missing };
  }, [isTutor, user, hasPayoutSetup, payoutLoaded, pendingFeedbackCount, od, t]);

  const visFadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visibility.loaded) {
      Animated.timing(visFadeAnim, { toValue: 1, duration: 350, useNativeDriver: false }).start();
    }
  }, [visibility.loaded]);

  const learningGoal = useMemo(() => {
    if (!isStudent || !od?.learningGoal) return null;
    const goal = od.learningGoal;
    const icons: Record<string, string> = { travel: 'airplane', career: 'briefcase', education: 'school', social: 'people', culture: 'earth' };
    return { display: goal.charAt(0).toUpperCase() + goal.slice(1).replace(/_/g, ' '), icon: icons[goal] || 'flag' };
  }, [isStudent, od]);

  // ─── Effects ───
  useEffect(() => { if (isTutor) { loadPayoutStatus(); loadFeedbackCount(); } }, [isTutor]);

  const loadPayoutStatus = useCallback(async () => {
    try { const res = await api.get<any>('/payments/payout-options'); const p = res?.currentProvider || user?.payoutProvider || 'none'; setPayoutProvider(p); setHasPayoutSetup(p !== 'none'); }
    catch { setHasPayoutSetup(false); setPayoutProvider('none'); }
    finally { setPayoutLoaded(true); }
  }, [user]);

  const loadFeedbackCount = useCallback(async () => {
    try { const res = await api.get<any>('/feedback/pending'); setPendingFeedbackCount(res?.count || res?.pendingFeedback?.length || 0); } catch {}
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshUser();
    if (isTutor) { await loadPayoutStatus(); await loadFeedbackCount(); }
    setRefreshing(false);
  }, [refreshUser, isTutor, loadPayoutStatus, loadFeedbackCount]);

  const updateProfile = useCallback(async (updates: Record<string, any>) => {
    try { await api.put<any>('/users/profile', updates); await refreshUser(); }
    catch (e: any) { Alert.alert(t('ERRORS.GENERIC_TITLE') || 'Error', e.message || t('ERRORS.GENERIC_MESSAGE') || 'Failed to update'); }
  }, [refreshUser, t]);

  // ─── Photo ───
  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission Needed', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingPhoto(true);
    try {
      const m = await manipulateAsync(result.assets[0].uri, [], { compress: 0.8, format: SaveFormat.JPEG });
      const fd = new FormData();
      fd.append('image', { uri: m.uri, type: 'image/jpeg', name: 'profile.jpg' } as any);
      const up = await api.upload<{ success: boolean; imageUrl: string }>('/users/profile-picture-upload', fd);
      if (up?.imageUrl) { await api.put('/users/profile-picture', { imageUrl: up.imageUrl }); await refreshUser(); }
    } catch (e: any) { Alert.alert('Upload Failed', e.message || 'Could not upload photo.'); }
    finally { setUploadingPhoto(false); }
  }, [refreshUser]);

  const editExistingPhoto = useCallback(async () => {
    if (!user?.picture) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingPhoto(true);
    try {
      const m = await manipulateAsync(result.assets[0].uri, [], { compress: 0.8, format: SaveFormat.JPEG });
      const fd = new FormData();
      fd.append('image', { uri: m.uri, type: 'image/jpeg', name: 'profile.jpg' } as any);
      const up = await api.upload<{ success: boolean; imageUrl: string }>('/users/profile-picture-upload', fd);
      if (up?.imageUrl) { await api.put('/users/profile-picture', { imageUrl: up.imageUrl }); await refreshUser(); }
    } catch (e: any) { Alert.alert('Upload Failed', e.message || 'Could not upload photo.'); }
    finally { setUploadingPhoto(false); }
  }, [user, refreshUser]);

  const removePhoto = useCallback(() => {
    Alert.alert(t('PROFILE_SCREEN.REMOVE'), t('COMMON.DELETE') + '?', [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('COMMON.DELETE'), style: 'destructive', onPress: async () => { try { await api.delete('/users/profile-picture'); await refreshUser(); } catch (e: any) { Alert.alert('Error', e.message); } } },
    ]);
  }, [refreshUser, t]);

  const handlePhotoAction = useCallback(() => {
    if (Platform.OS === 'ios') {
      const opts = hasCustomPicture ? [t('PROFILE_SCREEN.CHANGE_PICTURE'), t('COMMON.EDIT'), t('PROFILE_SCREEN.REMOVE'), t('COMMON.CANCEL')] : [t('PROFILE_SCREEN.CHANGE_PICTURE'), t('COMMON.CANCEL')];
      ActionSheetIOS.showActionSheetWithOptions(
        { options: opts, cancelButtonIndex: opts.length - 1, destructiveButtonIndex: hasCustomPicture ? 2 : undefined },
        idx => { if (hasCustomPicture) { if (idx === 0) pickPhoto(); if (idx === 1) editExistingPhoto(); if (idx === 2) removePhoto(); } else { if (idx === 0) pickPhoto(); } },
      );
    } else { pickPhoto(); }
  }, [hasCustomPicture, pickPhoto, editExistingPhoto, removePhoto, t]);

  // ─── Payout ───
  const handlePayoutSetup = useCallback(async () => {
    setStripeLoading(true);
    try { const res = await api.post<any>('/payments/stripe-connect/onboard', {}); const url = res?.onboardingUrl || res?.url; if (url) await WebBrowser.openBrowserAsync(url); await loadPayoutStatus(); await refreshUser(); }
    catch (e: any) { Alert.alert('Error', e.message || 'Could not start payout setup.'); }
    finally { setStripeLoading(false); }
  }, [loadPayoutStatus, refreshUser]);

  const handlePayoutEdit = useCallback(async () => {
    setStripeLoading(true);
    try { const res = await api.post<any>('/payments/stripe-connect/dashboard', {}); if (res?.dashboardUrl) await WebBrowser.openBrowserAsync(res.dashboardUrl); }
    catch (e: any) { Alert.alert('Error', e.message || 'Could not open payout settings.'); }
    finally { setStripeLoading(false); }
  }, []);

  // ─── Video ───
  const pickVideo = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission Needed', 'Please allow media access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingVideo(true);
    try {
      const fd = new FormData();
      fd.append('video', { uri: result.assets[0].uri, type: 'video/mp4', name: 'intro-video.mp4' } as any);
      const up = await api.upload<{ success: boolean; videoUrl: string }>('/users/tutor-video-upload', fd);
      if (up?.videoUrl) { await api.put('/users/tutor-video', { introductionVideo: up.videoUrl, videoThumbnail: '', videoType: 'upload' }); await refreshUser(); }
    } catch (e: any) { Alert.alert('Upload Failed', e.message || 'Could not upload video.'); }
    finally { setUploadingVideo(false); }
  }, [refreshUser]);

  const removeVideo = useCallback(() => {
    Alert.alert(t('PROFILE_SCREEN.REMOVE'), t('PROFILE_SCREEN.INTRO_VIDEO_DESC'), [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('COMMON.DELETE'), style: 'destructive', onPress: async () => { try { await api.put('/users/tutor-video', { introductionVideo: '', videoThumbnail: '', videoType: 'upload' }); await refreshUser(); } catch (e: any) { Alert.alert('Error', e.message); } } },
    ]);
  }, [refreshUser, t]);

  // ─── Settings ───
  const handleTimeFormat = useCallback((fmt: '12h' | '24h') => { if (fmt !== timeFormat) updateProfile({ calendarTimeFormat: fmt }); }, [updateProfile, timeFormat]);
  const handleToggleReminders = useCallback((v: boolean) => updateProfile({ remindersEnabled: v }), [updateProfile]);
  const handleToggleWallet = useCallback((v: boolean) => updateProfile({ showWalletBalance: v }), [updateProfile]);
  // Premium students who turn AI **off** get a confirmation sheet first —
  // most of what they pay for (per-lesson plan updates, smarter focus,
  // AI-rewritten roadmaps) silently degrades when AI is off.
  const isPremiumUser = (user as any)?.subscription?.tier === 'premium';
  const handleToggleAI = useCallback((v: boolean) => {
    if (!v && isPremiumUser) {
      Alert.alert(
        t('PROFILE.AI_OFF_WARN_TITLE'),
        t('PROFILE.AI_OFF_WARN_BODY'),
        [
          { text: t('COMMON.CANCEL'), style: 'cancel' },
          {
            text: t('PROFILE.AI_OFF_WARN_CONFIRM'),
            style: 'destructive',
            onPress: () => updateProfile({ aiAnalysisEnabled: false })
          }
        ]
      );
      return;
    }
    updateProfile({ aiAnalysisEnabled: v });
  }, [updateProfile, isPremiumUser, t]);
  const handleSelectTimezone = useCallback((tz: string) => { setTzModalVisible(false); setTzSearch(''); updateProfile({ timezone: tz }); }, [updateProfile]);

  const handleSelectLanguage = useCallback((code: string) => {
    setLangModalVisible(false);
    setLangSearch('');
    i18n.changeLanguage(code);
    updateProfile({ interfaceLanguage: code });
  }, [updateProfile]);

  const handleDarkMode = useCallback((val: boolean) => { setDarkMode(val); }, [setDarkMode]);

  const handleLogout = useCallback(() => {
    Alert.alert(t('PROFILE_SCREEN.SIGN_OUT'), t('COMMON.CANCEL') + '?', [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('PROFILE_SCREEN.SIGN_OUT'), style: 'destructive', onPress: logout },
    ]);
  }, [logout, t]);

  const filteredTZ = TIMEZONES.filter(tz => tz.label.toLowerCase().includes(tzSearch.toLowerCase()) || tz.value.toLowerCase().includes(tzSearch.toLowerCase()));
  const filteredLang = LANGUAGES.filter(l => l.name.toLowerCase().includes(langSearch.toLowerCase()) || l.nativeName.toLowerCase().includes(langSearch.toLowerCase()));

  const C = colors;
  const { shellMotion } = useScreenEntranceAnimations(false);

  // ─── Skeleton ───
  if (!user) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: C.background }]} edges={['top']}>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={[s.section, { borderBottomColor: C.border }]}>
            <View style={s.skelBlock}><View style={[s.skelCircle, { backgroundColor: C.skeleton }]} /><View style={{ flex: 1, gap: 8 }}><View style={[s.skelLine, { width: 160, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { width: 200, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { width: 100, backgroundColor: C.skeleton }]} /></View></View>
          </View>
          <View style={[s.section, { borderBottomColor: C.border }]}><View style={[s.skelLine, { width: 140, marginBottom: 16, backgroundColor: C.skeleton }]} /><View style={{ flexDirection: 'row', gap: 20 }}><View style={[s.skelLine, { width: 60, height: 40, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { width: 60, height: 40, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { width: 60, height: 40, backgroundColor: C.skeleton }]} /></View></View>
          <View style={[s.section, { borderBottomColor: C.border }]}><View style={[s.skelLine, { width: 100, marginBottom: 12, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { height: 44, marginBottom: 8, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { height: 44, marginBottom: 8, backgroundColor: C.skeleton }]} /><View style={[s.skelLine, { height: 44, backgroundColor: C.skeleton }]} /></View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text} />}>

        <Animated.View style={shellMotion}>
        {/* ═══ Profile Header ═══ */}
        <View style={[s.section, { borderBottomColor: C.border }]}>
          <Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE_SCREEN.PROFILE')}</Text>
          <View style={s.profileHeader}>
            <TouchableOpacity onPress={handlePhotoAction} activeOpacity={0.7}>
              {uploadingPhoto ? (
                <View style={[s.avatar, s.avatarFB, { backgroundColor: C.accent }]}><ActivityIndicator color={C.background} /></View>
              ) : user.picture ? (
                <Image source={{ uri: user.picture }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFB, { backgroundColor: C.accent }]}><Text style={[s.avatarInit, { color: C.background }]}>{initials}</Text></View>
              )}
            </TouchableOpacity>
            <View style={s.profileInfo}>
              <Text style={[s.profileName, { color: C.text }]}>{displayName}</Text>
              <Text style={[s.profileSub, { color: C.textSecondary }]}>{isTutor ? t('PROFILE_SCREEN.DISCOVERABLE_STUDENTS') : t('PROFILE_SCREEN.DISCOVERABLE_TUTORS')} <Text style={{ color: C.text, fontWeight: '500' }}>{discoverableName}</Text></Text>
              {isTutor && visibility.loaded && (
                <Animated.View style={{ opacity: visFadeAnim, maxHeight: visFadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }) }}>
                  <View style={[s.visBadge, visibility.visible ? { backgroundColor: C.success } : { backgroundColor: C.warning }]}>
                    <Ionicons name={visibility.visible ? 'eye' : 'eye-off'} size={12} color="#fff" />
                    <Text style={s.visBadgeTxt}>{visibility.visible ? t('PROFILE_SCREEN.VISIBLE_TO_STUDENTS') : t('PROFILE_SCREEN.HIDDEN_FROM_STUDENTS')}</Text>
                  </View>
                  {!visibility.visible && visibility.missing.length > 0 && (
                    <Text style={[s.visMissing, { color: C.textSecondary }]}>{visibility.missing.join(' · ')}</Text>
                  )}
                </Animated.View>
              )}
              {isTutor && user.languages && user.languages.length > 0 && (
                <View style={s.langRow}><Ionicons name="language-outline" size={16} color={C.textSecondary} /><Text style={[s.langTxt, { color: C.textSecondary }]}>{user.languages.map(l => `${l} ${LANG_FLAGS[l] || ''}`).join(', ')}</Text></View>
              )}
              {isStudent && user.languagesLearning && user.languagesLearning.length > 0 && (
                <View style={s.langRow}><Ionicons name="school-outline" size={16} color={C.textSecondary} /><Text style={[s.langTxt, { color: C.textSecondary }]}>Learning: {user.languagesLearning.map(l => `${l} ${LANG_FLAGS[l] || ''}`).join(', ')}</Text></View>
              )}
              {user.emailVerified && (
                <View style={[s.chipGreen, { backgroundColor: C.success }]}><Ionicons name="checkmark-circle" size={14} color="#fff" /><Text style={s.chipTxt}>{t('PROFILE_SCREEN.VERIFIED')}</Text></View>
              )}
            </View>
          </View>
          {isTutor && pendingFeedbackCount > 0 && (
            <TouchableOpacity style={[s.feedbackBtn, { backgroundColor: C.accent }]} activeOpacity={0.7}>
              <Ionicons name="clipboard-outline" size={16} color={C.background} /><Text style={[s.feedbackBtnTxt, { color: C.background }]}>{t('HOME.FEEDBACK_NEEDED')} ({pendingFeedbackCount})</Text>
            </TouchableOpacity>
          )}
          <View style={s.photoRow}>
            <TouchableOpacity style={[s.oBtn, { borderColor: C.border }]} onPress={pickPhoto} activeOpacity={0.6}>
              <Ionicons name="camera-outline" size={16} color={C.text} /><Text style={[s.oBtnTxt, { color: C.text }]}>{hasCustomPicture ? t('PROFILE_SCREEN.CHANGE_PICTURE') : t('PROFILE_SCREEN.ADD_PHOTO')}</Text>
            </TouchableOpacity>
            {hasCustomPicture && (
              <TouchableOpacity style={[s.oBtn, { borderColor: C.border }]} onPress={editExistingPhoto} activeOpacity={0.6}>
                <Ionicons name="create-outline" size={16} color={C.text} /><Text style={[s.oBtnTxt, { color: C.text }]}>{t('COMMON.EDIT')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        </Animated.View>

        {/* ═══ Payment Warning ═══ */}
        {isTutor && payoutLoaded && !hasPayoutSetup && (
          <StaggerRow index={0}>
          <View style={[s.warnCard, { backgroundColor: isDark ? '#2a2000' : '#fffbeb', borderColor: isDark ? '#534000' : '#fde68a' }]}>
            <Ionicons name="warning" size={22} color={C.warning} />
            <View style={{ flex: 1 }}><Text style={[s.warnCardTitle, { color: C.text }]}>{t('PROFILE_SCREEN.PAYMENT_REQUIRED')}</Text><Text style={[s.warnCardDesc, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.PAYMENT_REQUIRED_DESC')}</Text></View>
          </View>
          </StaggerRow>
        )}

        {/* ═══ Payouts (tutor) ═══ */}
        {isTutor && (
          <StaggerRow index={1}>
          <View style={[s.section, { borderBottomColor: C.border }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE_SCREEN.PAYOUTS')}</Text>
            {!payoutLoaded ? (
              <View style={s.row}><ActivityIndicator size="small" color={C.textSecondary} /><Text style={[s.mutedTxt, { color: C.textSecondary }]}>{t('COMMON.LOADING')}</Text></View>
            ) : hasPayoutSetup ? (
              <>
                <View style={s.row}><Ionicons name="checkmark-circle" size={28} color={C.success} /><View style={{ flex: 1, marginLeft: 12 }}><Text style={[s.rowTitle, { color: C.text }]}>{t('PROFILE_SCREEN.PAYOUTS_ENABLED')} ({payoutProviderName})</Text><Text style={[s.rowDesc, { color: C.textSecondary }]}>{payoutProvider === 'paypal' ? t('PROFILE_SCREEN.PAYOUTS_EARNINGS_PAYPAL') : t('PROFILE_SCREEN.PAYOUTS_EARNINGS_BANK')}</Text></View></View>
                <TouchableOpacity style={[s.oBtn, { borderColor: C.border }]} onPress={payoutProvider === 'stripe' ? handlePayoutEdit : handlePayoutSetup} activeOpacity={0.6} disabled={stripeLoading}>
                  {stripeLoading ? <ActivityIndicator size="small" color={C.text} /> : <Ionicons name="create-outline" size={16} color={C.text} />}
                  <Text style={[s.oBtnTxt, { color: C.text }]}>{payoutProvider === 'stripe' ? t('PROFILE_SCREEN.EDIT_PAYOUT_SETTINGS') : t('PROFILE_SCREEN.CHANGE_PAYOUT_METHOD')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={s.row}><Ionicons name="wallet-outline" size={28} color={C.textSecondary} /><View style={{ flex: 1, marginLeft: 12 }}><Text style={[s.rowTitle, { color: C.text }]}>{t('PROFILE_SCREEN.PAYOUTS_SETUP')}</Text><Text style={[s.rowDesc, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.PAYOUTS_CONNECT')}</Text></View></View>
                <TouchableOpacity style={[s.pBtn, { backgroundColor: C.accent }]} onPress={handlePayoutSetup} activeOpacity={0.7} disabled={stripeLoading}>
                  {stripeLoading ? <ActivityIndicator color={C.background} /> : <Text style={[s.pBtnTxt, { color: C.background }]}>{t('PROFILE_SCREEN.PAYOUTS_SETUP')}</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
          </StaggerRow>
        )}

        {/* ═══ Stats ═══ */}
        <StaggerRow index={2}>
        <View style={[s.section, { borderBottomColor: C.border }]}>
          <Text style={[s.sectionTitle, { color: C.text }]}>{isTutor ? t('PROFILE_SCREEN.TEACHING_STATS') : t('PROFILE_SCREEN.LEARNING_PROGRESS')}</Text>
          <View style={s.statsGrid}>
            <View style={s.statItem}><Text style={[s.statNum, { color: C.text }]}>{user.stats?.totalLessons || 0}</Text><Text style={[s.statLbl, { color: C.textSecondary }]}>{isTutor ? t('PROFILE_SCREEN.LESSONS_TAUGHT') : t('PROFILE_SCREEN.LESSONS_COMPLETED')}</Text></View>
            <View style={[s.statItem, { borderLeftColor: C.border, borderRightColor: C.border, borderLeftWidth: 1, borderRightWidth: 1 }]}><Text style={[s.statNum, { color: C.text }]}>{user.stats?.totalHours || 0}h</Text><Text style={[s.statLbl, { color: C.textSecondary }]}>{isTutor ? t('PROFILE_SCREEN.HOURS_TAUGHT') : t('PROFILE_SCREEN.TOTAL_STUDY_TIME')}</Text></View>
            <View style={s.statItem}>
              {isTutor
                ? <><Text style={[s.statNum, { color: C.text }]}>{user.stats?.rating || '5.0'}</Text><Text style={[s.statLbl, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.RATING')}</Text></>
                : <><Text style={[s.statNum, { color: C.text }]}>{user.stats?.streak || 0}</Text><Text style={[s.statLbl, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.DAY_STREAK')}</Text></>}
            </View>
          </View>
        </View>
        </StaggerRow>

        {/* ═══ Introduction Video (tutor) ═══ */}
        {isTutor && (
          <StaggerRow index={3}>
          <View style={[s.section, { borderBottomColor: C.border }]}>
            <Text style={[s.overline, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.INTRO_VIDEO_SUBTITLE').toUpperCase()}</Text>
            <Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE_SCREEN.INTRO_VIDEO')}</Text>
            <Text style={[s.desc, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.INTRO_VIDEO_DESC')}</Text>
            {hasPendingVideo && (
              <View style={[s.warnBanner, { backgroundColor: isDark ? '#2a2000' : '#fff7ed' }]}><Ionicons name="hourglass-outline" size={18} color={C.warning} /><Text style={[s.warnBannerTxt, { color: isDark ? '#fbbf24' : '#92400e' }]}>{t('PROFILE_SCREEN.VIDEO_PENDING')}</Text></View>
            )}
            {tutorVideoUrl ? (
              <View>
                <TouchableOpacity onPress={() => setVideoModalVisible(true)} activeOpacity={0.8} style={s.videoWrap}>
                  {tutorVideoThumb ? <Image source={{ uri: tutorVideoThumb }} style={s.videoThumb} /> : <View style={[s.videoThumb, s.videoThumbPH]}><Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.85)" /></View>}
                  <View style={s.playOverlay}><Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.85)" /></View>
                </TouchableOpacity>
                <View style={s.photoRow}>
                  <TouchableOpacity style={[s.oBtn, { borderColor: C.border }]} onPress={removeVideo} activeOpacity={0.6}><Ionicons name="trash-outline" size={16} color={C.text} /><Text style={[s.oBtnTxt, { color: C.text }]}>{t('PROFILE_SCREEN.REMOVE')}</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.oBtn, { borderColor: C.border }]} onPress={pickVideo} activeOpacity={0.6}><Ionicons name="swap-horizontal-outline" size={16} color={C.text} /><Text style={[s.oBtnTxt, { color: C.text }]}>{t('PROFILE_SCREEN.CHANGE')}</Text></TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={[s.uploadArea, { borderColor: isDark ? C.border : '#d0d0d0', backgroundColor: isDark ? C.surface : '#fafafa' }]} onPress={pickVideo} activeOpacity={0.6} disabled={uploadingVideo}>
                {uploadingVideo ? <ActivityIndicator size="large" color={C.textSecondary} /> : <><Ionicons name="cloud-upload-outline" size={36} color={C.textTertiary} /><Text style={[s.uploadTxt, { color: C.textSecondary }]}>{t('VIDEO_UPLOAD.UPLOAD_TITLE')}</Text><Text style={[s.uploadHint, { color: C.textTertiary }]}>{t('PROFILE_SCREEN.VIDEO_UPLOAD_HINT')}</Text></>}
              </TouchableOpacity>
            )}
          </View>
          </StaggerRow>
        )}

        {/* ═══ About ═══ */}
        {(user.bio || user.profile?.bio || user.onboardingData?.bio) ? (
          <StaggerRow index={4}>
          <View style={[s.section, { borderBottomColor: C.border }]}><Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE.ABOUT')}</Text><Text style={[s.bio, { color: C.textSecondary }]}>{user.bio || user.profile?.bio || user.onboardingData?.bio}</Text></View>
          </StaggerRow>
        ) : null}

        {/* ═══ Experience (tutor) ═══ */}
        {isTutor && user.experience ? (
          <StaggerRow index={5}>
          <View style={[s.section, { borderBottomColor: C.border }]}><Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE.EXPERIENCE')}</Text><Text style={[s.bio, { color: C.textSecondary }]}>{user.experience}</Text></View>
          </StaggerRow>
        ) : null}

        {/* ═══ Learning Goal (student) ═══ */}
        {isStudent && learningGoal && (
          <StaggerRow index={4}>
          <View style={[s.section, { borderBottomColor: C.border }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE_SCREEN.MY_LEARNING_GOAL')}</Text>
            <View style={s.goalRow}><View style={[s.goalIcon, { backgroundColor: C.inputBg }]}><Ionicons name={(learningGoal.icon || 'flag') as any} size={22} color={C.text} /></View><View style={{ flex: 1 }}><Text style={[s.goalType, { color: C.text }]}>{learningGoal.display}</Text></View></View>
          </View>
          </StaggerRow>
        )}

        {/* ═══ Plan (student) ═══ */}
        {isStudent && (
          <StaggerRow index={5}>
          <View style={[s.section, { borderBottomColor: C.border }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE_SCREEN.PLAN')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Upgrade' as never)} activeOpacity={0.6}>
              <View style={[s.setRow, { borderBottomColor: C.border }]}>
                <View style={[s.tzIconWrap, { backgroundColor: C.inputBg }]}>
                  <Ionicons name="sparkles-outline" size={20} color={C.text} />
                </View>
                <View style={s.setLblWrap}>
                  <Text style={[s.setLbl, { color: C.text }]}>{t('PROFILE_SCREEN.PLAN_ROW_LABEL')}</Text>
                  <Text style={[s.setHint, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.PLAN_ROW_HINT')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
              </View>
            </TouchableOpacity>
          </View>
          </StaggerRow>
        )}

        {/* ═══ Settings ═══ */}
        <StaggerRow index={6}>
        <View style={[s.section, { borderBottomColor: C.border }]}>
          <Text style={[s.sectionTitle, { color: C.text }]}>{t('PROFILE_SCREEN.SETTINGS')}</Text>

          <SettingsToggle icon="notifications-outline" label={t('PROFILE_SCREEN.NOTIFICATIONS')} value={remindersEnabled} onToggle={handleToggleReminders} colors={C} />

          <TouchableOpacity onPress={() => setTzModalVisible(true)} activeOpacity={0.6}>
            <View style={[s.setRow, { borderBottomColor: C.border }]}>
              <View style={[s.tzIconWrap, { backgroundColor: C.inputBg }]}><Ionicons name="globe-outline" size={20} color={C.text} /></View>
              <View style={s.setLblWrap}><Text style={[s.setOverline, { color: C.textSecondary }]}>{t('PROFILE_SCREEN.TIMEZONE').toUpperCase()}</Text><Text style={[s.setLbl, { color: C.text }]}>{timezoneLabel}</Text></View>
              <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
            </View>
          </TouchableOpacity>

          <View style={[s.setRow, { borderBottomColor: C.border }]}>
            <Ionicons name="time-outline" size={20} color={C.text} style={s.setIcon} />
            <View style={s.setLblWrap}><Text style={[s.setLbl, { color: C.text }]}>{t('PROFILE_SCREEN.TIME_FORMAT')}</Text><Text style={[s.setHint, { color: C.textSecondary }]}>{timeFormat === '12h' ? 'e.g. 2:30 PM' : 'e.g. 14:30'}</Text></View>
            <View style={[s.tToggle, { backgroundColor: C.borderLight }]}>
              <TouchableOpacity style={[s.tBtn, timeFormat === '12h' && [s.tBtnOn, { backgroundColor: C.accent }]]} onPress={() => handleTimeFormat('12h')} activeOpacity={0.7}><Text style={[s.tBtnTxt, { color: C.textSecondary }, timeFormat === '12h' && { color: C.background }]}>12h</Text></TouchableOpacity>
              <TouchableOpacity style={[s.tBtn, timeFormat === '24h' && [s.tBtnOn, { backgroundColor: C.accent }]]} onPress={() => handleTimeFormat('24h')} activeOpacity={0.7}><Text style={[s.tBtnTxt, { color: C.textSecondary }, timeFormat === '24h' && { color: C.background }]}>24h</Text></TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={() => setLangModalVisible(true)} activeOpacity={0.6}>
            <View style={[s.setRow, { borderBottomColor: C.border }]}>
              <Ionicons name="language-outline" size={20} color={C.text} style={s.setIcon} />
              <View style={s.setLblWrap}><Text style={[s.setLbl, { color: C.text }]}>{t('PROFILE_SCREEN.INTERFACE_LANGUAGE')}</Text></View>
              <Text style={[s.setVal, { color: C.text }]}>{currentLangObj.flag} {currentLangObj.nativeName}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </TouchableOpacity>

          <SettingsToggle icon="moon-outline" label={t('PROFILE_SCREEN.DARK_MODE')} value={isDark} onToggle={handleDarkMode} colors={C} />
          <SettingsToggle icon="alarm-outline" label={t('PROFILE_SCREEN.LESSON_REMINDERS')} value={remindersEnabled} onToggle={handleToggleReminders} colors={C} />
          {isTutor && <SettingsToggle icon="wallet-outline" label={t('PROFILE_SCREEN.SHOW_WALLET_BALANCE')} value={showWalletBalance} onToggle={handleToggleWallet} colors={C} />}
          {isStudent && <SettingsToggle icon="analytics-outline" label={t('PROFILE_SCREEN.AI_LESSON_REVIEW')} sublabel={t('PROFILE_SCREEN.AI_LESSON_REVIEW_DESC')} value={aiAnalysisEnabled} onToggle={handleToggleAI} colors={C} />}
          <SettingsRow icon="help-circle-outline" label={t('PROFILE_SCREEN.HELP_SUPPORT')} chevron colors={C} />
        </View>
        </StaggerRow>

        {/* ═══ Sign Out ═══ */}
        <StaggerRow index={7}>
        <TouchableOpacity style={[s.signOut, { borderColor: C.border }]} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={18} color={C.danger} /><Text style={[s.signOutTxt, { color: C.danger }]}>{t('PROFILE_SCREEN.SIGN_OUT')}</Text>
        </TouchableOpacity>
        </StaggerRow>
        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ═══ Timezone Modal ═══ */}
      <Modal visible={tzModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[s.modalSafe, { backgroundColor: C.background }]}>
          <View style={[s.modalHeader, { borderBottomColor: C.border }]}><Text style={[s.modalTitle, { color: C.text }]}>{t('PROFILE_SCREEN.TIMEZONE')}</Text><TouchableOpacity onPress={() => { setTzModalVisible(false); setTzSearch(''); }}><Ionicons name="close" size={24} color={C.text} /></TouchableOpacity></View>
          <View style={[s.searchWrap, { backgroundColor: C.inputBg }]}><Ionicons name="search" size={18} color={C.textTertiary} /><TextInput style={[s.searchInput, { color: C.text }]} placeholder={t('COMMON.SEARCH') + '...'} placeholderTextColor={C.textTertiary} value={tzSearch} onChangeText={setTzSearch} autoCorrect={false} /></View>
          <FlatList data={filteredTZ} keyExtractor={i => i.value} renderItem={({ item }) => { const active = item.value === timezoneRaw; return (<TouchableOpacity style={s.listItem} onPress={() => handleSelectTimezone(item.value)} activeOpacity={0.6}><View style={{ flex: 1 }}><Text style={[s.listItemTitle, { color: C.text }, active && s.listItemActive]}>{item.label}</Text><Text style={[s.listItemSub, { color: C.textSecondary }]}>{getTimezoneLabel(item.value)}</Text></View>{active && <Ionicons name="checkmark" size={20} color={C.text} />}</TouchableOpacity>); }} ItemSeparatorComponent={() => <View style={[s.listSep, { backgroundColor: C.border }]} />} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} />
        </SafeAreaView>
      </Modal>

      {/* ═══ Language Modal ═══ */}
      <Modal visible={langModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[s.modalSafe, { backgroundColor: C.background }]}>
          <View style={[s.modalHeader, { borderBottomColor: C.border }]}><Text style={[s.modalTitle, { color: C.text }]}>{t('PROFILE_SCREEN.INTERFACE_LANGUAGE')}</Text><TouchableOpacity onPress={() => { setLangModalVisible(false); setLangSearch(''); }}><Ionicons name="close" size={24} color={C.text} /></TouchableOpacity></View>
          <View style={[s.searchWrap, { backgroundColor: C.inputBg }]}><Ionicons name="search" size={18} color={C.textTertiary} /><TextInput style={[s.searchInput, { color: C.text }]} placeholder={t('COMMON.SEARCH') + '...'} placeholderTextColor={C.textTertiary} value={langSearch} onChangeText={setLangSearch} autoCorrect={false} /></View>
          <FlatList data={filteredLang} keyExtractor={i => i.code} renderItem={({ item }) => { const active = item.code === interfaceLang; return (<TouchableOpacity style={s.listItem} onPress={() => handleSelectLanguage(item.code)} activeOpacity={0.6}><Text style={s.langFlag}>{item.flag}</Text><View style={{ flex: 1 }}><Text style={[s.listItemTitle, { color: C.text }, active && s.listItemActive]}>{item.nativeName}</Text><Text style={[s.listItemSub, { color: C.textSecondary }]}>{item.name}</Text></View>{active && <Ionicons name="checkmark" size={20} color={C.text} />}</TouchableOpacity>); }} ItemSeparatorComponent={() => <View style={[s.listSep, { backgroundColor: C.border }]} />} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} />
        </SafeAreaView>
      </Modal>

      {/* ═══ Video Player Modal ═══ */}
      {videoModalVisible && (
        <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent>
          <View style={s.videoPM}>
            <TouchableOpacity style={[s.videoClose, { top: insets.top + 8 }]} onPress={() => setVideoModalVisible(false)}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
            {tutorVideoUrl && tutorVideoType === 'upload' ? <VideoPlayerInline uri={tutorVideoUrl} /> : <Text style={s.videoExtTxt}>This video is hosted externally.</Text>}
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ───

function SettingsRow({ icon, label, sublabel, chevron, onPress, colors: C }: { icon: keyof typeof Ionicons.glyphMap; label: string; sublabel?: string; chevron?: boolean; onPress?: () => void; colors: ThemeColors }) {
  const inner = (<View style={[s.setRow, { borderBottomColor: C.border }]}><Ionicons name={icon} size={20} color={C.text} style={s.setIcon} /><View style={s.setLblWrap}><Text style={[s.setLbl, { color: C.text }]}>{label}</Text>{sublabel && <Text style={[s.setHint, { color: C.textSecondary }]}>{sublabel}</Text>}</View>{chevron && <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />}</View>);
  return onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.6}>{inner}</TouchableOpacity> : inner;
}

function SettingsToggle({ icon, label, sublabel, value, onToggle, colors: C }: { icon: keyof typeof Ionicons.glyphMap; label: string; sublabel?: string; value: boolean; onToggle: (v: boolean) => void; colors: ThemeColors }) {
  return (<View style={[s.setRow, { borderBottomColor: C.border }]}><Ionicons name={icon} size={20} color={C.text} style={s.setIcon} /><View style={s.setLblWrap}><Text style={[s.setLbl, { color: C.text }]}>{label}</Text>{sublabel && <Text style={[s.setHint, { color: C.textSecondary }]}>{sublabel}</Text>}</View><Switch value={value} onValueChange={onToggle} trackColor={{ false: C.borderLight, true: '#34C759' }} thumbColor="#fff" ios_backgroundColor={C.borderLight} style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }} /></View>);
}

function VideoPlayerInline({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.play(); });
  return <VideoView player={player} style={s.videoPlayer} allowsFullscreen allowsPictureInPicture />;
}

// ─── Styles (base — colors applied inline via theme) ───

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { paddingVertical: 24, borderBottomWidth: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '600', letterSpacing: -0.2, marginBottom: 16 },
  overline: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  desc: { fontSize: 14, lineHeight: 21, marginBottom: 16 },

  profileHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFB: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { fontSize: 30, fontWeight: '600', letterSpacing: -1 },
  profileInfo: { flex: 1, paddingTop: 2 },
  profileName: { fontSize: 22, fontWeight: '600', letterSpacing: -0.2, marginBottom: 4 },
  profileSub: { fontSize: 14, lineHeight: 20, marginBottom: 8 },

  visBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 6 },
  visBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  visMissing: { fontSize: 13, marginBottom: 6, lineHeight: 18 },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  langTxt: { fontSize: 14, flex: 1 },
  chipGreen: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginTop: 4 },
  chipTxt: { fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },

  feedbackBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, marginTop: 12 },
  feedbackBtnTxt: { fontSize: 14, fontWeight: '500' },
  photoRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  oBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, borderWidth: 1 },
  oBtnTxt: { fontSize: 14, fontWeight: '500' },
  pBtn: { alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 10, marginTop: 14 },
  pBtnTxt: { fontSize: 15, fontWeight: '600' },

  warnCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 12, padding: 16, marginTop: 4, borderWidth: 1 },
  warnCardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  warnCardDesc: { fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  rowTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  rowDesc: { fontSize: 13, lineHeight: 19 },
  mutedTxt: { fontSize: 14 },

  statsGrid: { flexDirection: 'row' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statNum: { fontSize: 20, fontWeight: '600', letterSpacing: -0.3, marginBottom: 2 },
  statLbl: { fontSize: 12, textAlign: 'center' },

  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 12, marginBottom: 14 },
  warnBannerTxt: { flex: 1, fontSize: 13, lineHeight: 18 },
  videoWrap: { borderRadius: 12, overflow: 'hidden', position: 'relative' },
  videoThumb: { width: '100%', height: 200, borderRadius: 12 },
  videoThumbPH: { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  uploadArea: { height: 180, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  uploadTxt: { fontSize: 15, fontWeight: '500', marginTop: 10 },
  uploadHint: { fontSize: 12, marginTop: 4 },
  bio: { fontSize: 15, lineHeight: 24 },

  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  goalIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  goalType: { fontSize: 16, fontWeight: '600' },

  setRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  setIcon: { marginRight: 14, width: 22 },
  setLblWrap: { flex: 1 },
  setOverline: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  setLbl: { fontSize: 15 },
  setHint: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  setVal: { fontSize: 14, fontWeight: '500' },
  tzIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  tToggle: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden' },
  tBtn: { paddingHorizontal: 14, paddingVertical: 6 },
  tBtnOn: { borderRadius: 8 },
  tBtnTxt: { fontSize: 13, fontWeight: '600' },

  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', gap: 8, height: 48, minWidth: 200, maxWidth: 260, borderRadius: 12, borderWidth: 1, marginTop: 32 },
  signOutTxt: { fontSize: 15, fontWeight: '600' },

  skelBlock: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  skelCircle: { width: 88, height: 88, borderRadius: 44 },
  skelLine: { height: 18, borderRadius: 6 },

  modalSafe: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontWeight: '600' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 12, paddingHorizontal: 14, height: 44, borderRadius: 10, gap: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  listItemTitle: { fontSize: 15, fontWeight: '500' },
  listItemActive: { fontWeight: '700' },
  listItemSub: { fontSize: 13, marginTop: 1 },
  listSep: { height: StyleSheet.hairlineWidth, marginLeft: 20 },
  langFlag: { fontSize: 22 },

  videoPM: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  videoClose: { position: 'absolute', right: 16, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  videoPlayer: { width: '100%', height: '70%' },
  videoExtTxt: { color: '#fff', fontSize: 16, textAlign: 'center', paddingHorizontal: 40 },
});
