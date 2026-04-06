import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../hooks/useAuth';
import { lessonService, Lesson } from '../services/lessons';

const ENTER_TEAL = '#23839d';
const ENTER_TEAL_ACTIVE = '#1a6a80';
const WIDE_BREAKPOINT = 768;

type Props = NativeStackScreenProps<RootStackParamList, 'PreCall'>;

function displayNameFromPopulated(
  p: { firstName?: string; lastName?: string; name?: string } | undefined,
  fallback: string,
): string {
  if (!p) return fallback;
  if (p.firstName && p.lastName) return `${p.firstName} ${p.lastName}`;
  if (p.firstName) return p.firstName;
  return p.name || fallback;
}

export default function PreCallScreen({ navigation, route }: Props) {
  const { lessonId } = route.params;
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showVb, setShowVb] = useState(false);
  const [vbMode, setVbMode] = useState<'none' | 'blur' | 'black'>('none');
  const [audioLevel, setAudioLevel] = useState(35);

  const isTutor = user?.userType === 'tutor';

  useEffect(() => {
    let alive = true;
    (async () => {
      setLessonLoading(true);
      setLoadError(false);
      const l = await lessonService.getLesson(lessonId);
      if (!alive) return;
      if (!l) {
        setLoadError(true);
        setLesson(null);
      } else {
        setLesson(l);
      }
      setLessonLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [lessonId]);

  useEffect(() => {
    if (isMuted) {
      setAudioLevel(0);
      return;
    }
    const id = setInterval(() => {
      setAudioLevel(22 + Math.random() * 48);
    }, 120);
    return () => clearInterval(id);
  }, [isMuted]);

  const lessonTitle = useMemo(() => {
    if (!lesson) return '';
    if (lesson.isClass) return lesson.className || lesson.subject || t('PRE_CALL.LESSON_DEFAULT');
    return lesson.subject || lesson.language || t('PRE_CALL.LESSON_DEFAULT');
  }, [lesson, t]);

  const isTrialLesson = !!lesson?.isTrialLesson;

  const studentName = useMemo(
    () => displayNameFromPopulated(lesson?.studentId, t('PRE_CALL.YOUR_STUDENT')),
    [lesson?.studentId, t],
  );
  const tutorName = useMemo(
    () => displayNameFromPopulated(lesson?.tutorId, t('PRE_CALL.YOUR_TUTOR')),
    [lesson?.tutorId, t],
  );

  const subtitle = useMemo(() => {
    if (isTutor && !isTrialLesson) {
      return t('PRE_CALL.SUBTITLE_TUTOR', { name: studentName });
    }
    if (isTutor && isTrialLesson) {
      return t('PRE_CALL.SUBTITLE_TUTOR_TRIAL', { name: studentName });
    }
    if (!isTutor && !isTrialLesson) {
      return t('PRE_CALL.SUBTITLE_STUDENT');
    }
    return t('PRE_CALL.SUBTITLE_STUDENT_TRIAL', { name: tutorName });
  }, [isTutor, isTrialLesson, studentName, tutorName, t]);

  const previewTitle = t('PRE_CALL.PREVIEW_MIC_CAM', {
    mic: isMuted ? t('PRE_CALL.MIC_OFF') : t('PRE_CALL.MIC_ON'),
    cam: isVideoOff ? t('PRE_CALL.CAM_OFF') : t('PRE_CALL.CAM_ON'),
  });

  const goBack = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const onRequestCamera = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  const toggleMute = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsMuted(m => !m);
  }, []);

  const toggleVideo = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsVideoOff(v => {
      const next = !v;
      if (!next) setCameraReady(false);
      return next;
    });
    setCameraError(null);
  }, []);

  const toggleVbPanel = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowVb(v => !v);
  }, []);

  const onDevices = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(t('PRE_CALL.DEVICES_ALERT_TITLE'), t('PRE_CALL.DEVICES_ALERT_MSG'), [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('PRE_CALL.OPEN_SETTINGS'), onPress: () => void Linking.openSettings() },
    ]);
  }, [t]);

  const setVbBlur = useCallback(() => {
    setVbMode('blur');
  }, []);
  const setVbBlack = useCallback(() => {
    setVbMode('black');
  }, []);
  const setVbNormal = useCallback(() => {
    setVbMode('none');
  }, []);

  const enterClassroom = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(t('PRE_CALL.ENTER_CLASSROOM'), t('PRE_CALL.ENTER_NATIVE_SOON'));
  }, [t]);

  const camGranted = permission?.granted === true;
  const showCamera = camGranted && !isVideoOff && !cameraError;
  const previewLoading = showCamera && !cameraReady;

  const previewPanel = (
    <View style={[styles.previewPanel, isWide && styles.previewPanelWide]}>
      <TouchableOpacity
        style={[styles.goBackButton, { top: Math.max(insets.top, Platform.OS === 'ios' ? 12 : 16) + 12 }]}
        onPress={goBack}
        activeOpacity={0.85}
      >
        <Text style={styles.goBackText}>{t('PRE_CALL.GO_BACK')}</Text>
      </TouchableOpacity>

      <View style={styles.previewHeader}>
        <Text style={styles.previewTitle}>{previewTitle}</Text>
      </View>

      <View style={[styles.videoShell, isVideoOff && styles.videoShellOff]}>
        {showCamera ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="front"
            mirror
            mode="video"
            mute={isMuted}
            active
            onCameraReady={() => setCameraReady(true)}
            onMountError={e => setCameraError(e?.message || 'Camera error')}
          />
        ) : null}
        {(!camGranted || isVideoOff) && !cameraError ? (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="person" size={72} color="rgba(255,255,255,0.35)" />
            {!camGranted ? (
              <>
                <Text style={styles.placeholderText}>{t('PRE_CALL.CAMERA_PERMISSION')}</Text>
                <TouchableOpacity style={styles.permissionBtn} onPress={onRequestCamera}>
                  <Text style={styles.permissionBtnText}>{t('COMMON.CONTINUE')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.placeholderText}>{t('PRE_CALL.CAMERA_OFF_PLACEHOLDER')}</Text>
            )}
          </View>
        ) : null}
        {previewLoading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingOverlayText}>{t('PRE_CALL.LOADING_CAMERA')}</Text>
          </View>
        ) : null}
        {cameraError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={44} color="#ef4444" />
            <Text style={styles.errorText}>{cameraError}</Text>
          </View>
        ) : null}
        {vbMode === 'black' && showCamera && cameraReady ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none" />
        ) : null}
        {vbMode === 'blur' && showCamera && cameraReady ? (
          <View style={[StyleSheet.absoluteFill, styles.fakeBlur]} pointerEvents="none" />
        ) : null}
      </View>

      <View style={styles.previewControls}>
        <View style={styles.controlRow}>
          <TouchableOpacity style={styles.controlItem} onPress={toggleMute} activeOpacity={0.8}>
            <View style={[styles.controlBtn, isMuted && styles.controlBtnDanger]}>
              <Ionicons name={isMuted ? 'mic-off' : 'mic-outline'} size={22} color="#fff" />
            </View>
            <Text style={[styles.controlLabel, isMuted && styles.controlLabelDanger]}>
              {isMuted ? t('PRE_CALL.UNMUTE') : t('PRE_CALL.MUTE')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlItem} onPress={toggleVideo} activeOpacity={0.8}>
            <View style={[styles.controlBtn, isVideoOff && styles.controlBtnDanger]}>
              <Ionicons name={isVideoOff ? 'videocam-off' : 'videocam-outline'} size={22} color="#fff" />
            </View>
            <Text style={[styles.controlLabel, isVideoOff && styles.controlLabelDanger]}>
              {isVideoOff ? t('PRE_CALL.START_VIDEO') : t('PRE_CALL.CAMERA')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlItem} onPress={toggleVbPanel} activeOpacity={0.8}>
            <View style={[styles.controlBtn, showVb && styles.controlBtnPrimary]}>
              <Ionicons name="color-filter-outline" size={22} color="#fff" />
            </View>
            <Text style={[styles.controlLabel, showVb && styles.controlLabelPrimary]}>
              {t('PRE_CALL.EFFECTS')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlItem} onPress={onDevices} activeOpacity={0.8}>
            <View style={styles.controlBtn}>
              <Ionicons name="settings-outline" size={22} color="#fff" />
            </View>
            <Text style={styles.controlLabel}>{t('PRE_CALL.DEVICES')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.audioMeter}>
          <Ionicons
            name={isMuted ? 'mic-off-outline' : 'mic-outline'}
            size={18}
            color={isMuted ? '#ef4444' : '#22c55e'}
          />
          <View style={styles.audioBarTrack}>
            <View
              style={[
                styles.audioBarFill,
                { width: `${Math.min(100, audioLevel)}%` },
                isMuted && styles.audioBarMuted,
              ]}
            />
          </View>
        </View>
      </View>

      {showVb ? (
        <View style={styles.vbPanel}>
          <View style={styles.vbHeader}>
            <Text style={styles.vbTitle}>{t('PRE_CALL.VB_TITLE')}</Text>
            <TouchableOpacity onPress={toggleVbPanel} hitSlop={12}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.vbOption} onPress={setVbBlur} activeOpacity={0.85}>
            <Ionicons name="color-wand-outline" size={20} color="#fff" />
            <Text style={styles.vbOptionText}>{t('PRE_CALL.VB_BLUR')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.vbOption} onPress={setVbBlack} activeOpacity={0.85}>
            <View style={styles.vbColorDot} />
            <Text style={styles.vbOptionText}>{t('PRE_CALL.VB_BLACK')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.vbOption} onPress={setVbNormal} activeOpacity={0.85}>
            <Ionicons name="videocam-outline" size={20} color="#fff" />
            <Text style={styles.vbOptionText}>{t('PRE_CALL.VB_NORMAL')}</Text>
          </TouchableOpacity>
          {vbMode !== 'none' ? (
            <View style={styles.vbStatus}>
              <Ionicons name="checkmark-circle" size={16} color="#34C759" />
              <Text style={styles.vbStatusText}>{t('PRE_CALL.VB_ACTIVE')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const infoPanel = (
    <View style={[styles.infoPanel, isWide && styles.infoPanelWide]}>
      {lessonLoading ? (
        <ActivityIndicator color="#fff" style={{ marginVertical: 24 }} />
      ) : loadError || !lesson ? (
        <Text style={styles.lessonSubtitle}>{t('PRE_CALL.LOAD_LESSON_ERROR')}</Text>
      ) : (
        <>
          <View style={styles.lessonHeader}>
            <Text style={styles.lessonTitle} numberOfLines={3}>
              {lessonTitle}
            </Text>
            {isTrialLesson ? (
              <LinearGradient
                colors={['#FFA500', '#FF6B35']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.trialBadge}
              >
                <Ionicons name="star" size={16} color="#fff" />
                <Text style={styles.trialBadgeText}>{t('PRE_CALL.TRIAL_BADGE')}</Text>
              </LinearGradient>
            ) : null}
          </View>
          <Text style={styles.lessonSubtitle}>{subtitle}</Text>
        </>
      )}
      <View style={[styles.infoSpacer, isWide && styles.infoSpacerWide]} />
      <TouchableOpacity
        style={[
          styles.enterButton,
          (!lesson || lessonLoading) && styles.enterButtonDisabled,
        ]}
        onPress={enterClassroom}
        activeOpacity={0.9}
        disabled={!lesson || lessonLoading}
      >
        <Text style={styles.enterButtonText}>{t('PRE_CALL.ENTER_CLASSROOM')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {isWide ? (
        <View style={styles.rowLayout}>
          {previewPanel}
          <ScrollView
            style={styles.infoScrollWide}
            contentContainerStyle={styles.infoScrollContentWide}
            keyboardShouldPersistTaps="handled"
          >
            {infoPanel}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 12 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SafeAreaView edges={['top']} style={styles.safeTop}>
            {previewPanel}
          </SafeAreaView>
          {infoPanel}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, backgroundColor: '#000' },
  safeTop: { backgroundColor: '#000' },
  rowLayout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#000',
  },
  previewPanel: {
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Platform.select({ ios: 380, default: 360 }),
  },
  previewPanelWide: {
    flex: 1,
    maxHeight: '100%',
    paddingTop: 32,
    paddingHorizontal: 32,
  },
  goBackButton: {
    position: 'absolute',
    left: 16,
    zIndex: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  goBackText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  previewHeader: {
    width: '100%',
    maxWidth: 600,
    marginBottom: 20,
    marginTop: 44,
    alignItems: 'center',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
  },
  videoShell: {
    width: '100%',
    maxWidth: 600,
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  videoShellOff: {
    backgroundColor: '#2d2d2d',
  },
  videoPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 2,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 3,
  },
  loadingOverlayText: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '500',
  },
  permissionBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
  },
  permissionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  errorBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  fakeBlur: {
    backgroundColor: 'rgba(30,30,40,0.65)',
  },
  previewControls: {
    width: '100%',
    maxWidth: 600,
    alignItems: 'center',
    gap: 14,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  controlItem: {
    alignItems: 'center',
    minWidth: 64,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  controlBtn: {
    width: Platform.OS === 'ios' ? 52 : 48,
    height: Platform.OS === 'ios' ? 52 : 48,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnDanger: {
    backgroundColor: 'rgba(255, 59, 48, 0.85)',
  },
  controlBtnPrimary: {
    backgroundColor: 'rgba(33, 150, 243, 0.85)',
  },
  controlLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
  },
  controlLabelDanger: { color: '#ff6961' },
  controlLabelPrimary: { color: '#64b5f6' },
  audioMeter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 400,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  audioBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  audioBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  audioBarMuted: {
    backgroundColor: 'rgba(239, 68, 68, 0.5)',
  },
  vbPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: 'rgba(0,0,0,0.95)',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    zIndex: 30,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 16,
      },
      android: { elevation: 16 },
    }),
  },
  vbHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  vbTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  vbOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 8,
  },
  vbOptionText: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  vbColorDot: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  vbStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  vbStatusText: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  infoPanel: {
    flexGrow: 1,
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    alignItems: 'center',
  },
  infoPanelWide: {
    flex: 0,
    width: undefined,
    flexGrow: 1,
    alignSelf: 'stretch',
    paddingHorizontal: 48,
    paddingTop: 40,
    minWidth: 320,
  },
  infoScrollWide: {
    flex: 1,
    backgroundColor: '#000',
  },
  infoScrollContentWide: {
    flexGrow: 1,
    minHeight: '100%',
  },
  lessonHeader: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    width: '100%',
  },
  lessonTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 38,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 24,
  },
  trialBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  lessonSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  infoSpacer: { minHeight: 32, width: '100%' },
  infoSpacerWide: { flex: 1, minHeight: 40 },
  enterButton: {
    backgroundColor: ENTER_TEAL,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 52,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: ENTER_TEAL,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  enterButtonDisabled: {
    opacity: 0.45,
  },
  enterButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
