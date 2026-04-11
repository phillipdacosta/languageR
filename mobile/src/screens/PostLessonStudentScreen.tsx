import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';

import type { RootStackParamList } from '../navigation/types';
import { lessonService, Lesson, clearDetailCache } from '../services/lessons';
import {
  fetchLessonAnalysis,
  getLessonVocabularyBundle,
  getPaymentMethods,
  getWalletBalance,
  submitLessonTip,
  type LessonAnalysis,
  type VocabEntry,
  type GoalEntry,
} from '../services/postLesson';

type Props = NativeStackScreenProps<RootStackParamList, 'PostLessonStudent'>;

const POLL_MS = 3000;
const MAX_POLLS = 60;

function formatLessonDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatLessonTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function PostLessonStudentScreen({ navigation, route }: Props) {
  const { lessonId } = route.params;
  const { t } = useTranslation();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [tutor, setTutor] = useState<Lesson['tutorId'] | null>(null);

  const [aiAnalysisEnabled, setAiAnalysisEnabled] = useState(true);
  const [isTrialLesson, setIsTrialLesson] = useState(false);
  const [analysis, setAnalysis] = useState<LessonAnalysis | null>(null);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [goals, setGoals] = useState<GoalEntry[]>([]);

  const [showTip, setShowTip] = useState(false);
  const [tipSubmitted, setTipSubmitted] = useState(false);
  const [submittingTip, setSubmittingTip] = useState(false);
  const [selectedTip, setSelectedTip] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [cards, setCards] = useState<Awaited<ReturnType<typeof getPaymentMethods>>>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [selectedPm, setSelectedPm] = useState<string | null>(null);
  const [payWithWallet, setPayWithWallet] = useState(false);

  const tutorFirstName = useMemo(() => {
    if (!tutor) return '';
    return tutor.firstName || tutor.name?.split(' ')[0] || '';
  }, [tutor]);

  const tutorDisplayName = useMemo(() => {
    if (!tutor) return t('POST_LESSON_STUDENT.TUTOR');
    const fn = tutor.firstName || tutor.name?.split(' ')[0];
    const ln = tutor.lastName || tutor.name?.split(' ')[1];
    if (fn && ln) return `${fn} ${ln.charAt(0)}.`;
    return tutor.name || t('POST_LESSON_STUDENT.TUTOR');
  }, [tutor, t]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const checkAnalysis = useCallback(async () => {
    const result = await fetchLessonAnalysis(lessonId);
    if (result.kind === 'completed') {
      setAnalysis(result.analysis);
      setAnalysisReady(true);
      stopPolling();
    } else if (result.kind === 'unavailable') {
      setAnalysisUnavailable(true);
      stopPolling();
    }
  }, [lessonId, stopPolling]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const l = await lessonService.getLesson(lessonId);
      if (!alive) return;
      setLesson(l);
      if (l) {
        const tut = l.tutorId || (l as any).tutor;
        setTutor(tut || null);
        const trial = !!(l.isTrialLesson || l.isTrial);
        setIsTrialLesson(trial);
        if (l.tip?.amount) setTipSubmitted(true);
        if (l.aiAnalysisEnabledAtTime !== undefined && l.aiAnalysisEnabledAtTime !== null) {
          setAiAnalysisEnabled(l.aiAnalysisEnabledAtTime !== false);
        } else {
          const st = l.studentId as { profile?: { aiAnalysisEnabled?: boolean } } | undefined;
          setAiAnalysisEnabled(st?.profile?.aiAnalysisEnabled !== false);
        }
        const vb = await getLessonVocabularyBundle(lessonId);
        if (vb && alive) {
          setVocab(vb.vocabulary);
          setGoals(vb.goals);
        }
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [lessonId]);

  useEffect(() => {
    if (!lesson || !aiAnalysisEnabled || isTrialLesson) return;

    void checkAnalysis();
    pollTimerRef.current = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLLS) {
        setAnalysisUnavailable(true);
        stopPolling();
        return;
      }
      void checkAnalysis();
    }, POLL_MS);

    return () => stopPolling();
  }, [lesson, aiAnalysisEnabled, isTrialLesson, checkAnalysis, stopPolling]);

  const openTip = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const [c, w] = await Promise.all([getPaymentMethods(), getWalletBalance()]);
    setCards(c);
    setWalletBalance(w);
    if (c.length) {
      const def = c.find(x => x.isDefault) || c[0];
      setSelectedPm(def.stripePaymentMethodId || null);
    }
    setPayWithWallet(w > 0);
    setShowTip(true);
  };

  const tipAmount = useMemo(() => {
    if (customTip.trim()) {
      const n = parseFloat(customTip.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return selectedTip || 0;
  }, [customTip, selectedTip]);

  const submitTip = async () => {
    if (tipAmount <= 0) return;
    const ok = await new Promise<boolean>(resolve => {
      Alert.alert(
        t('POST_LESSON_STUDENT.TIP_CONFIRM_TITLE'),
        t('POST_LESSON_STUDENT.TIP_CONFIRM_MSG', { amount: tipAmount.toFixed(2), name: tutorFirstName }),
        [
          { text: t('COMMON.CANCEL'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('POST_LESSON_STUDENT.TIP_SEND'), onPress: () => resolve(true) },
        ],
      );
    });
    if (!ok) return;

    setSubmittingTip(true);
    const body: { amount: number; useWallet?: boolean; paymentMethodId?: string } = { amount: tipAmount };
    if (payWithWallet && walletBalance >= tipAmount) body.useWallet = true;
    else if (selectedPm) body.paymentMethodId = selectedPm;

    const res = await submitLessonTip(lessonId, body);
    setSubmittingTip(false);
    if (res.success) {
      setTipSubmitted(true);
      setShowTip(false);
      Alert.alert('', t('POST_LESSON_STUDENT.TIP_SUCCESS', { amount: tipAmount.toFixed(2) }));
    } else {
      Alert.alert(t('COMMON.ERROR'), res.message || t('POST_LESSON_STUDENT.TIP_FAILED'));
    }
  };

  const goBack = () => {
    clearDetailCache(lessonId);
    navigation.navigate('Main');
  };

  const start = lesson?.startTime || lesson?.scheduledTime;
  const end = lesson?.endTime;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backLink} onPress={goBack} hitSlop={12}>
          <Text style={styles.backText}>{t('POST_LESSON_STUDENT.GO_BACK')}</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.muted}>{t('POST_LESSON_STUDENT.LOADING')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.celebrate}>
              <Text style={styles.celebrateEmoji}>🎉</Text>
              <Text style={styles.celebrateTitle}>
                {isTrialLesson
                  ? t('POST_LESSON_STUDENT.TITLE_TRIAL', { name: tutorFirstName })
                  : t('POST_LESSON_STUDENT.TITLE')}
              </Text>
              <Text style={styles.celebrateSub}>
                {isTrialLesson
                  ? t('POST_LESSON_STUDENT.SUB_TRIAL', { name: tutorFirstName })
                  : t('POST_LESSON_STUDENT.SUB')}
              </Text>
            </View>

            {lesson && tutor ? (
              <View style={styles.card}>
                <View style={styles.tutorRow}>
                  {tutor.picture ? (
                    <Image source={{ uri: tutor.picture }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPh]}>
                      <Ionicons name="person" size={32} color="rgba(255,255,255,0.35)" />
                    </View>
                  )}
                  <View style={styles.tutorMeta}>
                    <Text style={styles.tutorName}>{tutorDisplayName}</Text>
                    <Text style={styles.subject}>{lesson.subject || t('POST_LESSON_STUDENT.DEFAULT_SUBJECT')}</Text>
                  </View>
                </View>
                <View style={styles.details}>
                  <View style={styles.detailRow}>
                    <Ionicons name="calendar-outline" size={18} color="rgba(255,255,255,0.65)" />
                    <Text style={styles.detailText}>{formatLessonDate(start)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={18} color="rgba(255,255,255,0.65)" />
                    <Text style={styles.detailText}>
                      {formatLessonTime(start)} – {formatLessonTime(end)}
                    </Text>
                  </View>
                  {lesson.actualDurationMinutes != null ? (
                    <View style={styles.detailRow}>
                      <Ionicons name="hourglass-outline" size={18} color="rgba(255,255,255,0.65)" />
                      <Text style={styles.detailText}>
                        {t('POST_LESSON_STUDENT.DURATION_MINS', { n: lesson.actualDurationMinutes })}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  {!tipSubmitted && !isTrialLesson ? (
                    <TouchableOpacity style={styles.btnPrimary} onPress={openTip} activeOpacity={0.9}>
                      <Ionicons name="heart-outline" size={20} color="#fff" />
                      <Text style={styles.btnPrimaryText}>
                        {t('POST_LESSON_STUDENT.TIP_CTA', { name: tutorFirstName })}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {tipSubmitted ? (
                    <View style={styles.tipSuccess}>
                      <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                      <Text style={styles.tipSuccessText}>{t('POST_LESSON_STUDENT.TIP_SENT')}</Text>
                    </View>
                  ) : null}
                  {!isTrialLesson ? (
                    <TouchableOpacity style={styles.btnSecondary} onPress={goBack} activeOpacity={0.9}>
                      <Ionicons name="star-outline" size={20} color="#fff" />
                      <Text style={styles.btnSecondaryText}>{t('POST_LESSON_STUDENT.REVIEW')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.btnSecondary} onPress={goBack} activeOpacity={0.9}>
                    <Ionicons name="person-outline" size={20} color="#fff" />
                    <Text style={styles.btnSecondaryText}>{t('POST_LESSON_STUDENT.HOME')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {isTrialLesson ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('POST_LESSON_STUDENT.TRIAL_NEXT')}</Text>
                <Text style={styles.muted}>{t('POST_LESSON_STUDENT.TRIAL_HINT')}</Text>
              </View>
            ) : null}

            {!isTrialLesson && aiAnalysisEnabled ? (
              <View style={styles.card}>
                {!analysisReady && !analysisUnavailable ? (
                  <View style={styles.analysisLoading}>
                    <ActivityIndicator size="large" color="#a78bfa" />
                    <Text style={styles.analysisTitle}>{t('POST_LESSON_STUDENT.ANALYSIS_LOADING_TITLE')}</Text>
                    <Text style={styles.muted}>{t('POST_LESSON_STUDENT.ANALYSIS_LOADING_SUB')}</Text>
                  </View>
                ) : null}
                {analysisUnavailable && !analysisReady ? (
                  <View style={styles.analysisEmpty}>
                    <Ionicons name="document-text-outline" size={40} color="rgba(255,255,255,0.35)" />
                    <Text style={styles.analysisTitle}>{t('POST_LESSON_STUDENT.ANALYSIS_NONE_TITLE')}</Text>
                    <Text style={styles.muted}>{t('POST_LESSON_STUDENT.ANALYSIS_NONE_SUB')}</Text>
                  </View>
                ) : null}
                {analysisReady && analysis ? (
                  <View>
                    <View style={styles.analysisHeader}>
                      <View style={styles.checkBadge}>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                      </View>
                      <Text style={styles.analysisReadyTitle}>{t('POST_LESSON_STUDENT.ANALYSIS_READY')}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <View style={styles.summaryCell}>
                        <Text style={styles.summaryLabel}>{t('POST_LESSON_STUDENT.LEVEL')}</Text>
                        <Text style={styles.summaryVal}>
                          {analysis.overallAssessment?.proficiencyLevel || '—'}
                        </Text>
                      </View>
                      <View style={styles.summaryCell}>
                        <Text style={styles.summaryLabel}>{t('POST_LESSON_STUDENT.VOCAB')}</Text>
                        <Text style={styles.summaryVal}>
                          {analysis.vocabularyAnalysis?.uniqueWordCount ?? 0}
                        </Text>
                      </View>
                      <View style={styles.summaryCell}>
                        <Text style={styles.summaryLabel}>{t('POST_LESSON_STUDENT.GRAMMAR')}</Text>
                        <Text style={styles.summaryVal}>
                          {analysis.grammarAnalysis?.accuracyScore ?? 0}%
                        </Text>
                      </View>
                    </View>
                    {analysis.progressionMetrics?.keyImprovements?.length ? (
                      <View style={styles.takeaways}>
                        <Text style={styles.takeawaysTitle}>{t('POST_LESSON_STUDENT.TAKEAWAYS')}</Text>
                        {analysis.progressionMetrics.keyImprovements.map((line, i) => (
                          <View key={i} style={styles.takeawayRow}>
                            <Text style={styles.bullet}>•</Text>
                            <Text style={styles.takeawayText}>{line}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            {(vocab.length > 0 || goals.length > 0) && (
              <View style={styles.card}>
                {vocab.length > 0 ? (
                  <>
                    <Text style={styles.sectionTitle}>{t('POST_LESSON_STUDENT.VOCAB_SECTION')}</Text>
                    {vocab.map((v, i) => (
                      <View key={i} style={styles.vocabRow}>
                        <Text style={styles.vocabWord}>{v.word}</Text>
                        <Text style={styles.vocabArrow}>→</Text>
                        <Text style={styles.vocabTrans}>{v.translation}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
                {goals.length > 0 ? (
                  <>
                    <Text style={[styles.sectionTitle, { marginTop: vocab.length ? 16 : 0 }]}>
                      {t('POST_LESSON_STUDENT.GOALS_SECTION')}
                    </Text>
                    {goals.map((g, i) => (
                      <Text key={i} style={styles.goalLine}>
                        {g.completed ? '☑ ' : '☐ '}
                        {g.text}
                      </Text>
                    ))}
                  </>
                ) : null}
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      <Modal visible={showTip} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {t('POST_LESSON_STUDENT.TIP_MODAL_TITLE', { name: tutorFirstName })}
              </Text>
              <TouchableOpacity onPress={() => setShowTip(false)}>
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.tipChips}>
              {[5, 10, 15].map(amt => (
                <TouchableOpacity
                  key={amt}
                  style={[styles.tipChip, selectedTip === amt && !customTip && styles.tipChipOn]}
                  onPress={() => {
                    setSelectedTip(amt);
                    setCustomTip('');
                  }}
                >
                  <Text style={styles.tipChipText}>${amt}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.tipCustom}
              placeholder={t('POST_LESSON_STUDENT.TIP_CUSTOM')}
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="decimal-pad"
              value={customTip}
              onChangeText={txt => {
                setCustomTip(txt);
                setSelectedTip(null);
              }}
            />
            {walletBalance > 0 ? (
              <TouchableOpacity
                style={[styles.walletRow, payWithWallet && styles.walletRowOn]}
                onPress={() => setPayWithWallet(true)}
              >
                <Ionicons name="wallet-outline" size={20} color="#fff" />
                <Text style={styles.walletText}>
                  {t('POST_LESSON_STUDENT.WALLET', { balance: walletBalance.toFixed(2) })}
                </Text>
              </TouchableOpacity>
            ) : null}
            {cards.length > 0 ? (
              <TouchableOpacity
                style={[styles.walletRow, !payWithWallet && styles.walletRowOn]}
                onPress={() => setPayWithWallet(false)}
              >
                <Ionicons name="card-outline" size={20} color="#fff" />
                <Text style={styles.walletText}>{t('POST_LESSON_STUDENT.CARD')}</Text>
              </TouchableOpacity>
            ) : null}
            {!payWithWallet && cards.length === 0 ? (
              <Text style={styles.warn}>{t('POST_LESSON_STUDENT.NO_CARD')}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.btnPrimary, styles.modalBtn, (tipAmount <= 0 || submittingTip) && styles.btnDisabled]}
              disabled={tipAmount <= 0 || submittingTip}
              onPress={() => void submitTip()}
            >
              {submittingTip ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{t('POST_LESSON_STUDENT.TIP_SEND')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f12' },
  safe: { flex: 1 },
  backLink: { paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '500' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  muted: { color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 20 },
  celebrate: { alignItems: 'center', marginBottom: 20, marginTop: 8 },
  celebrateEmoji: { fontSize: 40, marginBottom: 8 },
  celebrateTitle: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  celebrateSub: { color: 'rgba(255,255,255,0.65)', fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tutorRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 16, backgroundColor: '#2a2a2a' },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  tutorMeta: { flex: 1 },
  tutorName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subject: { color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 4 },
  details: { marginTop: 16, gap: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailText: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  actions: { marginTop: 20, gap: 10 },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#23839d',
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  btnSecondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  tipSuccess: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 8 },
  tipSuccessText: { color: '#4CAF50', fontSize: 15, fontWeight: '600' },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  analysisLoading: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  analysisTitle: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  analysisEmpty: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  checkBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysisReadyTitle: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  summaryCell: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  summaryLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 },
  summaryVal: { color: '#fff', fontSize: 17, fontWeight: '700' },
  takeaways: { marginTop: 8 },
  takeawaysTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  takeawayRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  bullet: { color: 'rgba(255,255,255,0.7)' },
  takeawayText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, flex: 1, lineHeight: 20 },
  vocabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  vocabWord: { color: '#fff', fontWeight: '600' },
  vocabArrow: { color: 'rgba(255,255,255,0.4)' },
  vocabTrans: { color: 'rgba(255,255,255,0.8)', flex: 1 },
  goalLine: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  modalCard: {
    backgroundColor: '#1c1c1f',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1, paddingRight: 12 },
  tipChips: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tipChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  tipChipOn: { backgroundColor: 'rgba(35, 131, 157, 0.45)', borderWidth: 1, borderColor: '#23839d' },
  tipChipText: { color: '#fff', fontWeight: '600' },
  tipCustom: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  walletRowOn: { borderWidth: 1, borderColor: '#23839d' },
  walletText: { color: '#fff', fontSize: 14, flex: 1 },
  warn: { color: '#f59e0b', fontSize: 13, marginBottom: 12 },
  modalBtn: { marginTop: 8 },
  btnDisabled: { opacity: 0.45 },
});
