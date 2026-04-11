import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
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
import { fetchLessonAnalysis, submitTutorNote, type LessonAnalysis } from '../services/postLesson';

type Props = NativeStackScreenProps<RootStackParamList, 'PostLessonTutor'>;

const IMPRESSIONS = [
  { value: 'excellent', label: '🌟 Excellent Progress!' },
  { value: 'great', label: '✅ Great Job!' },
  { value: 'good', label: '👍 Good Effort' },
  { value: 'needs-work', label: '💪 Needs More Practice' },
];

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

const ERROR_AREAS = [
  'Verb conjugation',
  'Gender agreement',
  'Prepositions',
  'Tense usage',
  'Vocabulary',
  'Pronunciation',
  'Sentence structure',
  'Articles',
];

const STRENGTHS = [
  'Conversational fluency',
  'Vocabulary usage',
  'Grammar accuracy',
  'Pronunciation',
  'Listening comprehension',
  'Confidence',
  'Complex sentences',
  'Natural expressions',
];

const IMPROVE = [
  'Grammar accuracy',
  'Verb conjugation',
  'Vocabulary range',
  'Pronunciation',
  'Fluency/speed',
  'Listening skills',
  'Sentence complexity',
  'Idiomatic expressions',
];

const GRACE_MS = 2 * 60 * 60 * 1000;

export default function PostLessonTutorScreen({ navigation, route }: Props) {
  const { lessonId, fromVideoCall = false } = route.params;
  const { t } = useTranslation();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [student, setStudent] = useState<Lesson['studentId'] | null>(null);
  const [studentAiEnabled, setStudentAiEnabled] = useState(true);
  const [analysis, setAnalysis] = useState<LessonAnalysis | null>(null);
  const [analysisLoaded, setAnalysisLoaded] = useState(false);

  const [noteText, setNoteText] = useState('');
  const [quickImpression, setQuickImpression] = useState('');
  const [homework, setHomework] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [cefrLevel, setCefrLevel] = useState('');
  const [grammarRating, setGrammarRating] = useState(0);
  const [fluencyRating, setFluencyRating] = useState(0);
  const [errorAreas, setErrorAreas] = useState<string[]>([]);
  const [strengths, setStrengths] = useState<string[]>([]);
  const [areasImprove, setAreasImprove] = useState<string[]>([]);

  const [countdown, setCountdown] = useState('');
  const [countdownExpired, setCountdownExpired] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<Date | null>(null);

  const studentDisplayName = useMemo(() => {
    if (!student || typeof student !== 'object') return t('POST_LESSON_TUTOR.STUDENT');
    if (student.firstName && student.lastName) return `${student.firstName} ${student.lastName}`;
    if (student.firstName) return student.firstName;
    return student.name || t('POST_LESSON_TUTOR.STUDENT');
  }, [student, t]);

  const studentProfile = student && typeof student === 'object' ? student : null;

  const lessonDateTime = useMemo(() => {
    const start = lesson?.startTime || lesson?.scheduledTime;
    if (!start) return '';
    const d = new Date(start);
    return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }, [lesson]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const l = await lessonService.getLesson(lessonId);
      if (!alive || !l) return;
      setLesson(l);
      const st = l.studentId || (l as any).student;
      setStudent(st || null);
      if (l.aiAnalysisEnabledAtTime !== undefined && l.aiAnalysisEnabledAtTime !== null) {
        setStudentAiEnabled(l.aiAnalysisEnabledAtTime !== false);
      } else if (st && typeof st === 'object' && (st as any).profile) {
        setStudentAiEnabled((st as any).profile.aiAnalysisEnabled !== false);
      } else {
        setStudentAiEnabled(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lessonId]);

  useEffect(() => {
    if (!lesson || studentAiEnabled) return;
    const end = lesson.endTime ? new Date(lesson.endTime) : new Date(lesson.startTime || Date.now());
    deadlineRef.current = new Date(end.getTime() + GRACE_MS);
    setShowCountdown(true);
    const tick = () => {
      const dl = deadlineRef.current;
      if (!dl) return;
      const rem = dl.getTime() - Date.now();
      if (rem <= 0) {
        setCountdownExpired(true);
        setCountdown(t('POST_LESSON_TUTOR.COUNTDOWN_EXPIRED'));
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const s = Math.floor(rem / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setCountdown(h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [lesson, studentAiEnabled, t]);

  useEffect(() => {
    void (async () => {
      const r = await fetchLessonAnalysis(lessonId);
      if (r.kind === 'completed') {
        setAnalysis(r.analysis);
        setAnalysisLoaded(true);
      }
    })();
  }, [lessonId]);

  const toggleIn = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  };

  const submitDisabled = useMemo(() => {
    if (submitting) return true;
    if (!noteText.trim()) return true;
    if (!studentAiEnabled) {
      if (!cefrLevel || grammarRating <= 0 || fluencyRating <= 0) return true;
      if (strengths.length === 0 || areasImprove.length === 0) return true;
    }
    return false;
  }, [submitting, noteText, studentAiEnabled, cefrLevel, grammarRating, fluencyRating, strengths, areasImprove]);

  const submit = async () => {
    if (submitDisabled) return;
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      text: noteText.trim(),
      quickImpression,
      homework: homework.trim(),
    };
    if (!studentAiEnabled) {
      payload.cefrLevel = cefrLevel;
      payload.grammarRating = grammarRating;
      payload.fluencyRating = fluencyRating;
      payload.keyErrorAreas = errorAreas;
      payload.strengths = strengths;
      payload.areasToImprove = areasImprove;
      payload.isTutorAssessment = true;
    }
    const res = await submitTutorNote(lessonId, payload);
    setSubmitting(false);
    if (res.success) {
      setSubmitted(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => goHome(), 1600);
    } else {
      Alert.alert(t('COMMON.ERROR'), res.message || t('POST_LESSON_TUTOR.SUBMIT_FAIL'));
    }
  };

  const goHome = () => {
    clearDetailCache(lessonId);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const tryGoHome = () => {
    if (!studentAiEnabled && !submitted) {
      Alert.alert(t('POST_LESSON_TUTOR.FEEDBACK_REQUIRED_TITLE'), t('POST_LESSON_TUTOR.FEEDBACK_REQUIRED_MSG'), [
        { text: t('POST_LESSON_TUTOR.LEAVE_ANYWAY'), style: 'destructive', onPress: goHome },
        { text: t('POST_LESSON_TUTOR.STAY'), style: 'cancel' },
      ]);
      return;
    }
    goHome();
  };

  const skip = () => {
    Alert.alert(t('POST_LESSON_TUTOR.SKIP_TITLE'), t('POST_LESSON_TUTOR.SKIP_MSG'), [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('POST_LESSON_TUTOR.SKIP_CONFIRM'), style: 'destructive', onPress: goHome },
    ]);
  };

  const backLabel = fromVideoCall ? t('POST_LESSON_TUTOR.HOME') : t('POST_LESSON_TUTOR.BACK');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={tryGoHome}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
          <Text style={styles.backText}>{backLabel}</Text>
        </TouchableOpacity>

        {!submitted ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Text style={styles.emoji}>🎉</Text>
              <Text style={styles.title}>{t('POST_LESSON_TUTOR.TITLE')}</Text>
              {student ? (
                <Text style={styles.sub}>{t('POST_LESSON_TUTOR.WITH', { name: studentDisplayName })}</Text>
              ) : null}
            </View>

            {studentProfile && lesson ? (
              <View style={styles.studentRow}>
                {studentProfile.picture ? (
                  <Image source={{ uri: studentProfile.picture }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarPh]}>
                    <Ionicons name="person" size={28} color="rgba(255,255,255,0.35)" />
                  </View>
                )}
                <View style={styles.studentMeta}>
                  <Text style={styles.studentName}>{studentDisplayName}</Text>
                  <Text style={styles.dt}>{lessonDateTime}</Text>
                  <Text style={styles.dur}>
                    {(lesson.actualDurationMinutes ?? lesson.duration) || 30} {t('POST_LESSON_TUTOR.MIN_LESSON')}
                  </Text>
                </View>
              </View>
            ) : null}

            {analysisLoaded && analysis ? (
              <View style={styles.metrics}>
                <View style={styles.metric}>
                  <Text style={styles.metricVal}>{analysis.overallAssessment?.proficiencyLevel || '—'}</Text>
                  <Text style={styles.metricLbl}>{t('POST_LESSON_TUTOR.LEVEL')}</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricVal}>{analysis.vocabularyAnalysis?.uniqueWordCount ?? 0}</Text>
                  <Text style={styles.metricLbl}>{t('POST_LESSON_TUTOR.WORDS')}</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricVal}>{analysis.grammarAnalysis?.accuracyScore ?? 0}%</Text>
                  <Text style={styles.metricLbl}>{t('POST_LESSON_TUTOR.GRAMMAR')}</Text>
                </View>
              </View>
            ) : null}

            {showCountdown ? (
              <View style={[styles.banner, countdownExpired && styles.bannerBad]}>
                <Ionicons name={countdownExpired ? 'alert-circle' : 'time-outline'} size={22} color="#fff" />
                <Text style={styles.bannerText}>
                  {countdownExpired
                    ? t('POST_LESSON_TUTOR.COUNTDOWN_HIDDEN')
                    : t('POST_LESSON_TUTOR.COUNTDOWN', { time: countdown })}
                </Text>
              </View>
            ) : null}

            <View style={styles.tip}>
              <Text style={styles.tipEmoji}>🎓</Text>
              <Text style={styles.tipLead}>{t('POST_LESSON_TUTOR.TIP_LEAD')}</Text>
              <Text style={styles.tipDetail}>{t('POST_LESSON_TUTOR.TIP_DETAIL')}</Text>
            </View>

            <Text style={styles.sectionTitle}>{t('POST_LESSON_TUTOR.NOTE_SECTION')}</Text>
            {!studentAiEnabled ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t('POST_LESSON_TUTOR.ASSESSMENT_BADGE')}</Text>
              </View>
            ) : null}

            <View style={styles.chipWrap}>
              {IMPRESSIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, quickImpression === opt.value && styles.chipOn]}
                  onPress={() => setQuickImpression(opt.value)}
                >
                  <Text style={styles.chipText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {!studentAiEnabled ? (
              <>
                <Text style={styles.label}>
                  {t('POST_LESSON_TUTOR.CEFR')} <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.chipWrap}>
                  {CEFR.map(lv => (
                    <TouchableOpacity
                      key={lv}
                      style={[styles.cefrChip, cefrLevel === lv && styles.chipOn]}
                      onPress={() => setCefrLevel(lv)}
                    >
                      <Text style={styles.chipText}>{lv}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>
                  {t('POST_LESSON_TUTOR.GRAMMAR_RATING')} <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.dots}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.dot, grammarRating >= n && styles.dotOn]}
                      onPress={() => setGrammarRating(n)}
                    />
                  ))}
                  <Text style={styles.dotVal}>{grammarRating > 0 ? `${grammarRating}/10` : ''}</Text>
                </View>
                <Text style={styles.label}>
                  {t('POST_LESSON_TUTOR.FLUENCY_RATING')} <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.dots}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.dot, fluencyRating >= n && styles.dotOn]}
                      onPress={() => setFluencyRating(n)}
                    />
                  ))}
                  <Text style={styles.dotVal}>{fluencyRating > 0 ? `${fluencyRating}/10` : ''}</Text>
                </View>
                <Text style={styles.label}>{t('POST_LESSON_TUTOR.ERROR_AREAS')}</Text>
                <View style={styles.chipWrap}>
                  {ERROR_AREAS.map(a => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.tag, errorAreas.includes(a) && styles.tagOn]}
                      onPress={() => toggleIn(errorAreas, setErrorAreas, a)}
                    >
                      <Text style={styles.tagText}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>
                  {t('POST_LESSON_TUTOR.STRENGTHS')} <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.chipWrap}>
                  {STRENGTHS.map(a => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.tag, strengths.includes(a) && styles.tagGreen]}
                      onPress={() => toggleIn(strengths, setStrengths, a)}
                    >
                      <Text style={styles.tagText}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>
                  {t('POST_LESSON_TUTOR.IMPROVE')} <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.chipWrap}>
                  {IMPROVE.map(a => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.tag, areasImprove.includes(a) && styles.tagAmber]}
                      onPress={() => toggleIn(areasImprove, setAreasImprove, a)}
                    >
                      <Text style={styles.tagText}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>
              {t('POST_LESSON_TUTOR.NOTE_LABEL')} <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={styles.noteInput}
              multiline
              placeholder={t('POST_LESSON_TUTOR.NOTE_PLACEHOLDER')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={noteText}
              onChangeText={setNoteText}
              textAlignVertical="top"
            />

            <Text style={styles.label}>{t('POST_LESSON_TUTOR.HOMEWORK')}</Text>
            <TextInput
              style={styles.hwInput}
              multiline
              placeholder={t('POST_LESSON_TUTOR.HOMEWORK_PH')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={homework}
              onChangeText={setHomework}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.submitBtn, submitDisabled && styles.submitDisabled]}
              disabled={submitDisabled}
              onPress={() => void submit()}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>{t('POST_LESSON_TUTOR.SEND')}</Text>
              )}
            </TouchableOpacity>
            {studentAiEnabled ? (
              <TouchableOpacity style={styles.skipBtn} onPress={skip}>
                <Text style={styles.skipText}>{t('POST_LESSON_TUTOR.SKIP')}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.success}>
            <Ionicons name="checkmark-circle" size={64} color="#4CAF50" />
            <Text style={styles.successTitle}>{t('POST_LESSON_TUTOR.SENT_TITLE')}</Text>
            <Text style={styles.successSub}>{t('POST_LESSON_TUTOR.SENT_SUB', { name: studentDisplayName })}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f12' },
  safe: { flex: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
  backText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: 20 },
  emoji: { fontSize: 36, marginBottom: 8 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 6 },
  studentRow: { flexDirection: 'row', gap: 14, marginBottom: 20, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 14, backgroundColor: '#2a2a2a' },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  studentMeta: { flex: 1 },
  studentName: { color: '#fff', fontSize: 18, fontWeight: '700' },
  dt: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 },
  dur: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  metrics: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  metric: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  metricVal: { color: '#fff', fontSize: 18, fontWeight: '800' },
  metricLbl: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  bannerBad: { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)' },
  bannerText: { color: 'rgba(255,255,255,0.9)', fontSize: 14, flex: 1, lineHeight: 20 },
  tip: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tipEmoji: { fontSize: 22, marginBottom: 6 },
  tipLead: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 6 },
  tipDetail: { color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 19 },
  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', backgroundColor: 'rgba(245, 158, 11, 0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 12 },
  badgeText: { color: '#fbbf24', fontSize: 12, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipOn: { borderColor: '#23839d', backgroundColor: 'rgba(35, 131, 157, 0.25)' },
  chipText: { color: '#fff', fontSize: 13 },
  cefrChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tag: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  tagOn: { borderColor: '#94a3b8' },
  tagGreen: { backgroundColor: 'rgba(34, 197, 94, 0.15)', borderColor: 'rgba(34, 197, 94, 0.4)' },
  tagAmber: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.4)' },
  tagText: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  label: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  req: { color: '#f87171' },
  dots: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 16 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.15)' },
  dotOn: { backgroundColor: '#23839d' },
  dotVal: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginLeft: 8 },
  noteInput: {
    minHeight: 120,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  hwInput: {
    minHeight: 72,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 20,
  },
  submitBtn: {
    backgroundColor: '#23839d',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  skipBtn: { alignItems: 'center', paddingVertical: 16 },
  skipText: { color: 'rgba(255,255,255,0.55)', fontSize: 15 },
  success: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  successTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  successSub: { color: 'rgba(255,255,255,0.65)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
