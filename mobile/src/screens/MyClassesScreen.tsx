import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Switch,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import {
  createClass,
  getClassesForTutor,
  getClass,
  cancelClass,
  hideClassFromHub,
  MyClassRecord,
  updateClass,
  uploadClassThumbnail,
  ClassRecurrenceType,
  CreateClassResponse,
} from '../services/classes';
import { lessonService, Lesson } from '../services/lessons';
import { ApiError } from '../services/api';

type HubTab = 'active' | 'history' | 'drafts';

/** Server `hubDraftForm` snapshot for React Native wizard (v1). */
type HubDraftRnV1 = {
  v: 1;
  wizardStepIndex: number;
  suggestedPrice?: number;
  rnWizard: {
    className: string;
    description: string;
    level: string;
    durationMin: number;
    capacity: string;
    useSuggestedPricing: boolean;
    customPrice: string;
    minStudents: string;
    flexibleMinimum: boolean;
    selectedInviteIds: string[];
    scheduleDate: string;
    scheduleTime: string;
    recurrenceType: ClassRecurrenceType;
    recurrenceCount: string;
    isPublic: boolean;
    existingThumbnailUrl: string | null;
  };
};
type WizardStep =
  | 'name'
  | 'description'
  | 'level'
  | 'duration'
  | 'capacity'
  | 'pricing'
  | 'minStudents'
  | 'flexibleMin'
  | 'invites'
  | 'schedule'
  | 'recurrence'
  | 'recurrenceCount'
  | 'visibility'
  | 'thumbnail'
  | 'review';

type HubBadge = 'live' | 'upcoming' | 'past' | 'cancelled' | 'draft';

interface HubCardVm {
  id: string;
  raw: MyClassRecord;
  name: string;
  whenLine: string;
  thumbUrl?: string;
  badge: HubBadge;
  badgeLabelKey: string;
  price: number;
  priceDisplay: string;
  confirmedCount: number;
  capacity: number;
  canEdit: boolean;
  canCancel: boolean;
  canRemoveFromHistory: boolean;
  isDraft: boolean;
}

/** Matches web `schedule-class.page.scss` hub + wizard tokens (light / ion-palette-dark). */
function webTokens(isDark: boolean) {
  if (isDark) {
    return {
      screen: '#1c1c1e',
      text: '#f5f5f7',
      textSub: '#8e8e93',
      meta: '#8e8e93',
      when: '#d1d1d6',
      tabRail: '#3a3a3c',
      tabActive: '#2c2c2e',
      tabActiveText: '#f5f5f7',
      tabInactiveText: '#8e8e93',
      thumbEmptyA: '#3a3a3c',
      thumbEmptyB: '#2c2c2c',
      iconMuted: '#8e8e93',
      topHairline: 'rgba(255,255,255,0.08)',
      progressTrack: '#3a3a3c',
      progressFill: '#f5f5f7',
      stepOf: '#8e8e93',
      heading: '#f5f5f7',
      headingSub: '#8e8e93',
      inputBg: '#2c2c2e',
      inputBorder: '#444444',
      chipBorder: '#555555',
      chipSelectedBg: '#f5f5f7',
      chipSelectedFg: '#1c1c1e',
      chipUnselectedFg: '#f5f5f7',
      primaryBg: '#1d1d1f',
      primaryFg: '#ffffff',
      backLink: '#f5f5f7',
      typeLabel: '#86868b',
      pricePaid: '#5ac8fa',
      priceFree: '#34c759',
      fabBg: '#1d1d1f',
      fabFg: '#ffffff',
      retryBg: '#2c2c2e',
      retryBorder: '#f5f5f7',
      retryFg: '#f5f5f7',
      footerHairline: 'rgba(255,255,255,0.08)',
      reviewCardBg: '#1c1c1e',
      reviewCardBorder: '#3a3a3c',
      reviewRowBg: '#2a2a2c',
      inviteCheck: '#5ac8fa',
      accent: '#5ac8fa',
      fieldLabel: '#e5e5ea',
      switchOn: '#636366',
    };
  }
  return {
    screen: '#ffffff',
    text: '#1d1d1f',
    textSub: '#6e6e73',
    meta: '#86868b',
    when: '#3a3a3c',
    tabRail: '#f5f5f7',
    tabActive: '#ffffff',
    tabActiveText: '#1d1d1f',
    tabInactiveText: '#6e6e73',
    thumbEmptyA: '#f0f0f2',
    thumbEmptyB: '#e8e8ea',
    iconMuted: '#c7c7cc',
    topHairline: 'rgba(0,0,0,0.06)',
    progressTrack: '#ebebeb',
    progressFill: '#222222',
    stepOf: '#717171',
    heading: '#1d1d1f',
    headingSub: '#6e6e73',
    inputBg: '#ffffff',
    inputBorder: '#dddddd',
    chipBorder: '#dddddd',
    chipSelectedBg: '#222222',
    chipSelectedFg: '#ffffff',
    chipUnselectedFg: '#1d1d1f',
    primaryBg: '#1d1d1f',
    primaryFg: '#ffffff',
    backLink: '#222222',
    typeLabel: '#86868b',
    pricePaid: '#4298d2',
    priceFree: '#34c759',
    fabBg: '#1d1d1f',
    fabFg: '#ffffff',
    retryBg: '#ffffff',
    retryBorder: '#1d1d1f',
    retryFg: '#1d1d1f',
    footerHairline: 'rgba(0,0,0,0.06)',
    reviewCardBg: '#ffffff',
    reviewCardBorder: '#e5e5e5',
    reviewRowBg: '#fafafa',
    inviteCheck: '#222222',
    accent: '#222222',
    fieldLabel: '#222222',
    switchOn: '#222222',
  };
}

function ReviewRow({ label, value, tk, last }: { label: string; value: string; tk: ReturnType<typeof webTokens>; last?: boolean }) {
  return (
    <View style={[styles.rvRow, !last && { borderBottomColor: tk.reviewCardBorder, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.rvLabel, { color: tk.meta }]}>{label}</Text>
      <Text style={[styles.rvValue, { color: tk.text }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function hubBadgeOverlay(b: HubBadge): { backgroundColor: string; color: string } {
  switch (b) {
    case 'live':
      return { backgroundColor: 'rgba(52, 199, 89, 0.95)', color: '#ffffff' };
    case 'upcoming':
      return { backgroundColor: 'rgba(66, 152, 210, 0.95)', color: '#ffffff' };
    case 'past':
      return { backgroundColor: 'rgba(142, 142, 147, 0.95)', color: '#ffffff' };
    case 'cancelled':
      return { backgroundColor: 'rgba(220, 38, 38, 0.92)', color: '#ffffff' };
    case 'draft':
      return { backgroundColor: 'rgba(245, 158, 11, 0.95)', color: '#1c1917' };
    default:
      return { backgroundColor: 'rgba(255, 255, 255, 0.95)', color: '#1d1d1f' };
  }
}

const LEVEL_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'any', labelKey: 'MY_CLASSES_FLOW.LEVEL_ANY' },
  { value: 'beginner', labelKey: 'MY_CLASSES_FLOW.LEVEL_BEGINNER' },
  { value: 'intermediate', labelKey: 'MY_CLASSES_FLOW.LEVEL_INTERMEDIATE' },
  { value: 'advanced', labelKey: 'MY_CLASSES_FLOW.LEVEL_ADVANCED' },
];

const DURATION_OPTIONS = [30, 45, 60, 90];

function tutorIdString(t: unknown): string {
  if (t && typeof t === 'object' && '_id' in (t as object)) return String((t as { _id: string })._id);
  if (typeof t === 'string') return t;
  return '';
}

function partitionHubClasses(
  all: MyClassRecord[],
  nowMs: number,
): { active: MyClassRecord[]; history: MyClassRecord[]; drafts: MyClassRecord[] } {
  const active: MyClassRecord[] = [];
  const history: MyClassRecord[] = [];
  const drafts: MyClassRecord[] = [];
  for (const c of all) {
    const st = c.status || 'scheduled';
    if (st === 'draft') {
      drafts.push(c);
      continue;
    }
    const end = new Date(c.endTime || c.startTime).getTime();
    const start = new Date(c.startTime).getTime();
    const cancelled = st === 'cancelled';
    const completed = st === 'completed';
    const past = end < nowMs || completed;
    const inProgress = !cancelled && start <= nowMs && nowMs < end;
    const upcoming = !cancelled && start > nowMs;
    if (past || cancelled) history.push(c);
    else if (upcoming || inProgress) active.push(c);
    else history.push(c);
  }
  active.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  history.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  drafts.sort(
    (a, b) =>
      new Date(b.updatedAt || b.startTime).getTime() - new Date(a.updatedAt || a.startTime).getTime(),
  );
  return { active, history, drafts };
}

function formatHubWhen(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const tOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleDateString(undefined, dOpts)} · ${start.toLocaleTimeString(undefined, tOpts)} – ${end.toLocaleTimeString(undefined, tOpts)}`;
}

function toHubCardVm(c: MyClassRecord, nowMs: number, draftWhenPlaceholder: string): HubCardVm {
  const start = new Date(c.startTime).getTime();
  const end = new Date(c.endTime || c.startTime).getTime();
  const st = c.status || 'scheduled';
  if (st === 'draft') {
    const confirmed =
      Array.isArray(c.confirmedStudents) && c.confirmedStudents.length > 0
        ? c.confirmedStudents.length
        : c.invitationStats?.accepted ?? 0;
    const price = Number(c.price) || 0;
    return {
      id: c._id,
      raw: c,
      name: c.name || '',
      whenLine: draftWhenPlaceholder,
      thumbUrl: c.thumbnail,
      badge: 'draft',
      badgeLabelKey: 'MY_CLASSES_FLOW.BADGE_DRAFT',
      price,
      priceDisplay: price > 0 ? price.toFixed(2) : '',
      confirmedCount: confirmed,
      capacity: c.capacity ?? 1,
      canEdit: false,
      canCancel: true,
      canRemoveFromHistory: false,
      isDraft: true,
    };
  }
  let badge: HubBadge = 'upcoming';
  let badgeLabelKey = 'MY_CLASSES_FLOW.BADGE_UPCOMING';
  if (st === 'cancelled') {
    badge = 'cancelled';
    badgeLabelKey = 'MY_CLASSES_FLOW.BADGE_CANCELLED';
  } else if (end < nowMs || st === 'completed') {
    badge = 'past';
    badgeLabelKey = 'MY_CLASSES_FLOW.BADGE_PAST';
  } else if (start <= nowMs && nowMs < end) {
    badge = 'live';
    badgeLabelKey = 'MY_CLASSES_FLOW.BADGE_LIVE';
  }
  const confirmed =
    Array.isArray(c.confirmedStudents) && c.confirmedStudents.length > 0
      ? c.confirmedStudents.length
      : c.invitationStats?.accepted ?? 0;
  const price = Number(c.price) || 0;
  const canEdit = st === 'scheduled' && start > nowMs;
  const canCancel = st !== 'cancelled' && end > nowMs;
  const canRemoveFromHistory = end < nowMs || st === 'completed' || st === 'cancelled';
  return {
    id: c._id,
    raw: c,
    name: c.name || '',
    whenLine: formatHubWhen(c.startTime, c.endTime || c.startTime),
    thumbUrl: c.thumbnail,
    badge,
    badgeLabelKey,
    price,
    priceDisplay: price > 0 ? price.toFixed(2) : '',
    confirmedCount: confirmed,
    capacity: c.capacity ?? 1,
    canEdit,
    canCancel,
    canRemoveFromHistory,
    isDraft: false,
  };
}

function buildWizardSteps(recurrenceType: ClassRecurrenceType): WizardStep[] {
  const base: WizardStep[] = [
    'name',
    'description',
    'level',
    'duration',
    'capacity',
    'pricing',
    'minStudents',
    'flexibleMin',
    'invites',
    'schedule',
    'recurrence',
  ];
  if (recurrenceType !== 'none') base.push('recurrenceCount');
  base.push('visibility', 'thumbnail', 'review');
  return base;
}

function inviteCandidatesFromLessons(lessons: Lesson[], tutorMongoId: string): { id: string; name: string; picture?: string }[] {
  const tid = String(tutorMongoId || '').trim();
  if (!tid) return [];
  const seen = new Set<string>();
  const out: { id: string; name: string; picture?: string }[] = [];
  for (const l of lessons) {
    if (l.isClass) continue;
    const tutorKey = tutorIdString(l.tutorId);
    if (!tutorKey || tutorKey !== tid) continue;
    const s = l.studentId;
    if (!s || !s._id || seen.has(s._id)) continue;
    seen.add(s._id);
    out.push({
      id: s._id,
      name: s.firstName || s.name?.split(' ')[0] || 'Student',
      picture: s.picture || s.profilePicture,
    });
  }
  return out;
}

function defaultDateInput(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pickCreatedClasses(res: CreateClassResponse): MyClassRecord[] {
  if (res.classes?.length) return res.classes;
  if (res.class) return [res.class];
  return [];
}

interface Props {
  goBack: () => void;
}

export default function MyClassesScreen({ goBack }: Props) {
  const { colors } = useTheme();
  const tk = useMemo(() => webTokens(colors.isDark), [colors.isDark]);
  const { t } = useTranslation();
  const { user } = useAuth();
  const tutorId = user?._id || user?.id || '';
  const hourlyRate = Number(user?.onboardingData?.hourlyRate) || 25;

  const [hubPhase, setHubPhase] = useState<'list' | 'create'>('list');
  const [hubTab, setHubTab] = useState<HubTab>('active');
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tutorClasses, setTutorClasses] = useState<MyClassRecord[]>([]);

  const [stepIndex, setStepIndex] = useState(0);
  const [className, setClassName] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('any');
  const [durationMin, setDurationMin] = useState(60);
  const [capacity, setCapacity] = useState('8');
  const [useSuggestedPricing, setUseSuggestedPricing] = useState(true);
  const [customPrice, setCustomPrice] = useState('');
  const [minStudents, setMinStudents] = useState('2');
  const [flexibleMinimum, setFlexibleMinimum] = useState(false);
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<string>>(new Set());
  const [scheduleDate, setScheduleDate] = useState(defaultDateInput);
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [recurrenceType, setRecurrenceType] = useState<ClassRecurrenceType>('none');
  const [recurrenceCount, setRecurrenceCount] = useState('4');
  const [isPublic, setIsPublic] = useState(false);
  const [thumbnailLocalUri, setThumbnailLocalUri] = useState<string | null>(null);
  const [existingThumbnailUrl, setExistingThumbnailUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [hubDraftClassId, setHubDraftClassId] = useState<string | null>(null);

  const suggestedPrice = useMemo(() => {
    const d = Math.max(15, durationMin);
    const base = hourlyRate * (d / 60);
    const mult = level === 'advanced' ? 1.08 : level === 'beginner' ? 0.95 : 1;
    return Math.max(0, Math.round(base * mult * (capacity ? Math.max(1, parseInt(capacity, 10) || 1) : 1) * 0.12 * 100) / 100);
  }, [hourlyRate, durationMin, level, capacity]);

  const wizardSteps = useMemo(() => buildWizardSteps(recurrenceType), [recurrenceType]);
  const currentStep = wizardSteps[stepIndex] || 'name';
  const totalSteps = wizardSteps.length;

  useEffect(() => {
    setStepIndex(i => Math.min(i, Math.max(0, wizardSteps.length - 1)));
  }, [wizardSteps.length]);

  const loadHub = useCallback(async () => {
    if (!tutorId) {
      setTutorClasses([]);
      setHubLoading(false);
      setHubError(false);
      return;
    }
    setHubError(false);
    try {
      const list = await getClassesForTutor(tutorId);
      setTutorClasses(list);
    } catch {
      setHubError(true);
      setTutorClasses([]);
    } finally {
      setHubLoading(false);
    }
  }, [tutorId]);

  useEffect(() => {
    setHubLoading(true);
    void loadHub();
  }, [loadHub]);

  const onRefreshHub = useCallback(async () => {
    setRefreshing(true);
    await loadHub();
    setRefreshing(false);
  }, [loadHub]);

  const [inviteStudents, setInviteStudents] = useState<{ id: string; name: string; picture?: string }[]>([]);

  useEffect(() => {
    if (hubPhase !== 'create' || !tutorId) return;
    let cancelled = false;
    (async () => {
      const lessons = await lessonService.getMyLessons();
      if (cancelled) return;
      setInviteStudents(inviteCandidatesFromLessons(lessons, tutorId));
    })();
    return () => {
      cancelled = true;
    };
  }, [hubPhase, tutorId]);

  const draftWhenPlaceholder = t('MY_CLASSES_FLOW.HUB_DRAFT_SUBLINE');

  const { active: activeRaw, history: historyRaw, drafts: draftsRaw } = useMemo(() => {
    const now = Date.now();
    return partitionHubClasses(tutorClasses, now);
  }, [tutorClasses]);
  const activeCards = useMemo(() => {
    const now = Date.now();
    return activeRaw.map(c => toHubCardVm(c, now, draftWhenPlaceholder));
  }, [activeRaw, draftWhenPlaceholder]);
  const historyCards = useMemo(() => {
    const now = Date.now();
    return historyRaw.map(c => toHubCardVm(c, now, draftWhenPlaceholder));
  }, [historyRaw, draftWhenPlaceholder]);
  const draftCards = useMemo(
    () => draftsRaw.map(c => toHubCardVm(c, Date.now(), draftWhenPlaceholder)),
    [draftsRaw, draftWhenPlaceholder],
  );
  const listCards = hubTab === 'active' ? activeCards : hubTab === 'history' ? historyCards : draftCards;

  const resetWizard = useCallback(() => {
    setStepIndex(0);
    setClassName('');
    setDescription('');
    setLevel('any');
    setDurationMin(60);
    setCapacity('8');
    setUseSuggestedPricing(true);
    setCustomPrice('');
    setMinStudents('2');
    setFlexibleMinimum(false);
    setSelectedInviteIds(new Set());
    setScheduleDate(defaultDateInput());
    setScheduleTime('10:00');
    setRecurrenceType('none');
    setRecurrenceCount('4');
    setIsPublic(false);
    setThumbnailLocalUri(null);
    setExistingThumbnailUrl(null);
    setEditingClassId(null);
    setHubDraftClassId(null);
  }, []);

  const openCreate = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    resetWizard();
    setHubPhase('create');
    setStepIndex(0);
  }, [resetWizard]);

  const closeCreateToList = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetWizard();
    setHubPhase('list');
    void loadHub();
  }, [loadHub, resetWizard]);

  const beginEditHubClass = useCallback(
    async (card: HubCardVm) => {
      if (!card.canEdit) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        const loaded = await getClass(card.id);
        resetWizard();
        setClassName(loaded.name || '');
        setDescription(loaded.description || '');
        setLevel(loaded.level || 'any');
        setDurationMin(loaded.duration || 60);
        setCapacity(String(loaded.capacity ?? 8));
        setMinStudents(String(loaded.minStudents ?? 2));
        setFlexibleMinimum(!!loaded.flexibleMinimum);
        setIsPublic(!!loaded.isPublic);

        const useSuggested = (loaded as any).useSuggestedPricing !== false;
        setUseSuggestedPricing(useSuggested);
        if (!useSuggested) {
          setCustomPrice(String(Number(loaded.price) || 0));
        }

        const start = new Date(loaded.startTime);
        const pad2 = (n: number) => String(n).padStart(2, '0');
        setScheduleDate(`${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`);
        setScheduleTime(`${pad2(start.getHours())}:${pad2(start.getMinutes())}`);

        const rec = loaded.recurrence || { type: 'none', count: 1 };
        setRecurrenceType((rec.type as ClassRecurrenceType) || 'none');
        setRecurrenceCount(String(rec.count ?? 4));

        if (loaded.thumbnail) {
          setExistingThumbnailUrl(loaded.thumbnail);
        }

        setEditingClassId(card.id);
        setHubPhase('create');
        setStepIndex(0);
      } catch {
        Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.HUB_EDIT_LOAD_ERROR'));
      }
    },
    [resetWizard, t],
  );

  const beginResumeDraft = useCallback(
    async (card: HubCardVm) => {
      if (!card.isDraft) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        const loaded = await getClass(card.id);
        resetWizard();
        const hub = loaded.hubDraftForm as HubDraftRnV1 | undefined;
        const w = hub?.rnWizard;
        if (hub?.v === 1 && w) {
          setClassName(w.className || loaded.name || '');
          setDescription(w.description ?? '');
          setLevel(w.level || 'any');
          setDurationMin(Number(w.durationMin) || 60);
          setCapacity(String(w.capacity ?? '8'));
          setMinStudents(String(w.minStudents ?? '2'));
          setFlexibleMinimum(!!w.flexibleMinimum);
          setIsPublic(!!w.isPublic);
          setUseSuggestedPricing(!!w.useSuggestedPricing);
          setCustomPrice(w.customPrice || '');
          setSelectedInviteIds(new Set(Array.isArray(w.selectedInviteIds) ? w.selectedInviteIds : []));
          setScheduleDate(w.scheduleDate || defaultDateInput());
          setScheduleTime(w.scheduleTime || '10:00');
          setRecurrenceType((w.recurrenceType as ClassRecurrenceType) || 'none');
          setRecurrenceCount(String(w.recurrenceCount ?? '4'));
          if (w.existingThumbnailUrl) setExistingThumbnailUrl(w.existingThumbnailUrl);
          else if (loaded.thumbnail) setExistingThumbnailUrl(loaded.thumbnail);
          setHubDraftClassId(String(loaded._id));
          const steps = buildWizardSteps((w.recurrenceType as ClassRecurrenceType) || 'none');
          const idx = Math.min(Math.max(0, Number(hub.wizardStepIndex) || 0), Math.max(0, steps.length - 1));
          setStepIndex(idx);
        } else {
          setClassName(loaded.name || '');
          setDescription(loaded.description || '');
          setLevel(loaded.level || 'any');
          setDurationMin(loaded.duration || 60);
          setCapacity(String(loaded.capacity ?? 8));
          setMinStudents(String(loaded.minStudents ?? 2));
          setFlexibleMinimum(!!loaded.flexibleMinimum);
          setIsPublic(false);
          const useSuggested = loaded.useSuggestedPricing !== false;
          setUseSuggestedPricing(useSuggested);
          if (!useSuggested) setCustomPrice(String(Number(loaded.price) || 0));
          if (loaded.thumbnail) setExistingThumbnailUrl(loaded.thumbnail);
          setHubDraftClassId(String(loaded._id));
          setStepIndex(0);
        }
        setHubPhase('create');
      } catch {
        Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.HUB_EDIT_LOAD_ERROR'));
      }
    },
    [resetWizard, t],
  );

  const confirmDeleteHubClass = useCallback(
    (card: HubCardVm) => {
      if (!card.canCancel) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert(
        card.isDraft ? t('MY_CLASSES_FLOW.HUB_DELETE_DRAFT_TITLE') : t('MY_CLASSES_FLOW.HUB_DELETE_TITLE'),
        card.isDraft
          ? t('MY_CLASSES_FLOW.HUB_DELETE_DRAFT_MESSAGE', { name: card.name })
          : t('MY_CLASSES_FLOW.HUB_DELETE_MESSAGE', { name: card.name }),
        [
          { text: t('COMMON.CANCEL'), style: 'cancel' },
          {
            text: card.isDraft ? t('MY_CLASSES_FLOW.HUB_DELETE_DRAFT_CONFIRM') : t('MY_CLASSES_FLOW.HUB_DELETE_CONFIRM'),
            style: 'destructive',
            onPress: async () => {
              try {
                await cancelClass(card.id);
                Alert.alert('', card.isDraft ? t('MY_CLASSES_FLOW.HUB_DELETE_DRAFT_SUCCESS') : t('MY_CLASSES_FLOW.HUB_DELETE_SUCCESS'));
                void loadHub();
              } catch {
                Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.HUB_DELETE_ERROR'));
              }
            },
          },
        ],
      );
    },
    [t, loadHub],
  );

  const confirmRemoveFromHistoryHubClass = useCallback(
    (card: HubCardVm) => {
      if (!card.canRemoveFromHistory) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert(
        t('MY_CLASSES_FLOW.HUB_REMOVE_HISTORY_TITLE'),
        t('MY_CLASSES_FLOW.HUB_REMOVE_HISTORY_MESSAGE', { name: card.name }),
        [
          { text: t('COMMON.CANCEL'), style: 'cancel' },
          {
            text: t('MY_CLASSES_FLOW.HUB_REMOVE_HISTORY_CONFIRM'),
            style: 'destructive',
            onPress: async () => {
              try {
                await hideClassFromHub(card.id);
                Alert.alert('', t('MY_CLASSES_FLOW.HUB_REMOVE_HISTORY_SUCCESS'));
                void loadHub();
              } catch {
                Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.HUB_REMOVE_HISTORY_ERROR'));
              }
            },
          },
        ],
      );
    },
    [t, loadHub],
  );

  const goWizardBack = useCallback(() => {
    void Haptics.selectionAsync();
    if (stepIndex <= 0) {
      closeCreateToList();
      return;
    }
    setStepIndex(i => Math.max(0, i - 1));
  }, [stepIndex, closeCreateToList]);

  const validateStep = useCallback(
    (step: WizardStep): string | null => {
      switch (step) {
        case 'name':
          return className.trim() ? null : t('MY_CLASSES_FLOW.ERR_NAME');
        case 'description':
          return null;
        case 'level':
          return null;
        case 'duration':
          return durationMin >= 15 ? null : t('MY_CLASSES_FLOW.ERR_DURATION');
        case 'capacity': {
          const cap = parseInt(capacity, 10);
          if (!Number.isFinite(cap) || cap < 1) return t('MY_CLASSES_FLOW.ERR_CAPACITY');
          return null;
        }
        case 'pricing': {
          const final = useSuggestedPricing ? suggestedPrice : parseFloat(customPrice || '0') || 0;
          if (final > 0 && final < 10) return t('MY_CLASSES_FLOW.ERR_MIN_PRICE');
          return null;
        }
        case 'minStudents': {
          const cap = parseInt(capacity, 10) || 1;
          const min = parseInt(minStudents, 10) || 1;
          if (min < 1 || min > cap) return t('MY_CLASSES_FLOW.ERR_MIN_STUDENTS');
          return null;
        }
        case 'flexibleMin':
          return null;
        case 'invites':
          return null;
        case 'schedule': {
          const start = new Date(`${scheduleDate}T${scheduleTime}:00`);
          const end = new Date(start);
          end.setMinutes(end.getMinutes() + durationMin);
          if (Number.isNaN(start.getTime())) return t('MY_CLASSES_FLOW.ERR_SCHEDULE');
          if (end.getTime() <= Date.now()) return t('MY_CLASSES_FLOW.ERR_FUTURE');
          return null;
        }
        case 'recurrence':
          return null;
        case 'recurrenceCount': {
          if (recurrenceType === 'none') return null;
          const n = parseInt(recurrenceCount, 10);
          if (!Number.isFinite(n) || n < 1 || n > 100) return t('MY_CLASSES_FLOW.ERR_RECURRENCE_COUNT');
          return null;
        }
        case 'visibility':
          return null;
        case 'thumbnail':
          if (isPublic && !thumbnailLocalUri) return t('MY_CLASSES_FLOW.ERR_THUMB_PUBLIC');
          return null;
        case 'review':
          return null;
        default:
          return null;
      }
    },
    [
      className,
      durationMin,
      capacity,
      useSuggestedPricing,
      suggestedPrice,
      customPrice,
      minStudents,
      scheduleDate,
      scheduleTime,
      recurrenceType,
      recurrenceCount,
      isPublic,
      thumbnailLocalUri,
      t,
    ],
  );

  const advance = useCallback(() => {
    const err = validateStep(currentStep);
    if (err) {
      Alert.alert(t('COMMON.ERROR'), err);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (stepIndex >= totalSteps - 1) return;
    setStepIndex(i => i + 1);
  }, [currentStep, stepIndex, totalSteps, validateStep, t]);

  const finalPrice = useMemo(() => {
    if (useSuggestedPricing) return suggestedPrice;
    return parseFloat(customPrice || '0') || 0;
  }, [useSuggestedPricing, suggestedPrice, customPrice]);

  const insets = useSafeAreaInsets();
  const levelLabelReview = useMemo(
    () => t(LEVEL_OPTIONS.find(o => o.value === level)?.labelKey || 'MY_CLASSES_FLOW.LEVEL_ANY'),
    [level, t],
  );
  const recurrenceSummary = useMemo(() => {
    if (recurrenceType === 'none') return t('MY_CLASSES_FLOW.REC_SUMMARY_SINGLE');
    const pk =
      recurrenceType === 'daily'
        ? 'MY_CLASSES_FLOW.REC_DAILY'
        : recurrenceType === 'weekly'
          ? 'MY_CLASSES_FLOW.REC_WEEKLY'
          : 'MY_CLASSES_FLOW.REC_MONTHLY';
    return t('MY_CLASSES_FLOW.REC_SUMMARY_PATTERN', { pattern: t(pk), count: recurrenceCount });
  }, [recurrenceType, recurrenceCount, t]);
  const invitedLine = useMemo(() => {
    const names = inviteStudents.filter(s => selectedInviteIds.has(s.id)).map(s => s.name);
    return names.length ? names.join(', ') : t('MY_CLASSES_FLOW.INVITED_NONE');
  }, [inviteStudents, selectedInviteIds, t]);
  const priceLineReview = useMemo(() => {
    if (useSuggestedPricing) return t('MY_CLASSES_FLOW.PRICE_SUGGESTED_LINE', { amount: suggestedPrice.toFixed(2) });
    return t('MY_CLASSES_FLOW.PRICE_CUSTOM_LINE', { amount: finalPrice.toFixed(2) });
  }, [useSuggestedPricing, suggestedPrice, finalPrice, t]);
  const scheduleLineReview = useMemo(() => {
    try {
      const d = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (Number.isNaN(d.getTime())) return `${scheduleDate} ${scheduleTime}`;
      return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return `${scheduleDate} ${scheduleTime}`;
    }
  }, [scheduleDate, scheduleTime]);

  const submitWizard = useCallback(async () => {
    for (const s of wizardSteps) {
      const e = validateStep(s);
      if (e) {
        Alert.alert(t('COMMON.ERROR'), e);
        return;
      }
    }
    setSubmitting(true);
    try {
      let thumbnailUrl: string | null = null;
      if (thumbnailLocalUri) {
        thumbnailUrl = await uploadClassThumbnail(thumbnailLocalUri);
      } else if (isPublic && !existingThumbnailUrl) {
        Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.ERR_THUMB_PUBLIC'));
        setSubmitting(false);
        return;
      }

      const start = new Date(`${scheduleDate}T${scheduleTime}:00`);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + durationMin);

      const recCount = recurrenceType === 'none' ? 1 : Math.max(1, Math.min(100, parseInt(recurrenceCount, 10) || 1));

      if (editingClassId) {
        const body: Record<string, unknown> = {
          name: className.trim(),
          description: description.trim(),
          capacity: Math.max(1, parseInt(capacity, 10) || 1),
          level,
          duration: durationMin,
          isPublic,
          price: finalPrice,
          useSuggestedPricing,
          suggestedPrice,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          recurrence: { type: recurrenceType, count: recCount },
          minStudents: Math.max(1, parseInt(minStudents, 10) || 1),
          flexibleMinimum,
        };
        if (thumbnailUrl) {
          body.thumbnail = thumbnailUrl;
        }
        await updateClass(editingClassId, body);
        Alert.alert('', t('MY_CLASSES_FLOW.UPDATE_SUCCESS', { name: className.trim() }));
        closeCreateToList();
      } else {
        const payload = {
          name: className.trim(),
          description: description.trim(),
          capacity: Math.max(1, parseInt(capacity, 10) || 1),
          level,
          duration: durationMin,
          isPublic,
          thumbnail: thumbnailUrl || undefined,
          price: finalPrice,
          useSuggestedPricing,
          suggestedPrice,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          recurrence: { type: recurrenceType, count: recCount },
          invitedStudentIds: Array.from(selectedInviteIds),
        };

        const res = await createClass(payload);
        const createdList = pickCreatedClasses(res);
        if (!res.success || !createdList.length) {
          throw new Error(res.message || t('MY_CLASSES_FLOW.CREATE_FAILED'));
        }

        const minN = Math.max(1, parseInt(minStudents, 10) || 1);
        await Promise.all(
          createdList.map(cls => {
            const id = cls._id;
            if (!id) return Promise.resolve();
            return updateClass(id, { minStudents: minN, flexibleMinimum });
          }),
        );

        if (hubDraftClassId) {
          try {
            await cancelClass(hubDraftClassId);
          } catch {
            /* published class exists even if draft row lingers */
          }
        }

        Alert.alert('', t('MY_CLASSES_FLOW.CREATE_SUCCESS', { name: className.trim() }));
        closeCreateToList();
      }
    } catch (e: unknown) {
      const failKey = editingClassId ? 'MY_CLASSES_FLOW.UPDATE_FAILED' : 'MY_CLASSES_FLOW.CREATE_FAILED';
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t(failKey);
      Alert.alert(t('COMMON.ERROR'), msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    wizardSteps,
    validateStep,
    thumbnailLocalUri,
    existingThumbnailUrl,
    isPublic,
    scheduleDate,
    scheduleTime,
    durationMin,
    recurrenceType,
    recurrenceCount,
    className,
    description,
    capacity,
    level,
    finalPrice,
    useSuggestedPricing,
    suggestedPrice,
    selectedInviteIds,
    minStudents,
    flexibleMinimum,
    editingClassId,
    hubDraftClassId,
    t,
    closeCreateToList,
  ]);

  const saveEditInPlace = useCallback(async () => {
    if (!editingClassId || savingEdit) return;
    setSavingEdit(true);
    try {
      let thumbnailUrl: string | null = null;
      if (thumbnailLocalUri) {
        thumbnailUrl = await uploadClassThumbnail(thumbnailLocalUri);
      }

      const start = scheduleDate && scheduleTime ? new Date(`${scheduleDate}T${scheduleTime}:00`) : null;
      const end = start ? new Date(start.getTime() + durationMin * 60000) : null;
      const recCount = recurrenceType === 'none' ? 1 : Math.max(1, Math.min(100, parseInt(recurrenceCount, 10) || 1));

      const body: Record<string, unknown> = {
        name: className.trim(),
        description: description.trim(),
        capacity: Math.max(1, parseInt(capacity, 10) || 1),
        level,
        duration: durationMin,
        isPublic,
        price: finalPrice,
        useSuggestedPricing,
        suggestedPrice,
        recurrence: { type: recurrenceType, count: recCount },
        minStudents: Math.max(1, parseInt(minStudents, 10) || 1),
        flexibleMinimum,
      };
      if (start && end) {
        body.startTime = start.toISOString();
        body.endTime = end.toISOString();
      }
      if (thumbnailUrl) body.thumbnail = thumbnailUrl;

      await updateClass(editingClassId, body);
      void loadHub();
      Alert.alert('', t('MY_CLASSES_FLOW.UPDATE_SUCCESS', { name: className.trim() }));
    } catch (err: any) {
      Alert.alert(t('COMMON.ERROR'), err?.message || t('MY_CLASSES_FLOW.UPDATE_FAILED'));
    } finally {
      setSavingEdit(false);
    }
  }, [
    editingClassId,
    savingEdit,
    loadHub,
    thumbnailLocalUri,
    scheduleDate,
    scheduleTime,
    durationMin,
    recurrenceType,
    recurrenceCount,
    className,
    description,
    capacity,
    level,
    isPublic,
    finalPrice,
    useSuggestedPricing,
    suggestedPrice,
    minStudents,
    flexibleMinimum,
    t,
  ]);

  /** Same flow as Create Material `pickCoverImage`: system crop 16:10, then JPEG normalize. */
  const pickThumbnail = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.PHOTO_PERM'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 10],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]?.uri?.trim()) return;
    const rawUri = result.assets[0].uri.trim();
    try {
      const normalized = await manipulateAsync(rawUri, [], { compress: 0.85, format: SaveFormat.JPEG });
      setThumbnailLocalUri(normalized.uri);
    } catch {
      setThumbnailLocalUri(rawUri);
    }
  }, [t]);

  const removeThumbnail = useCallback(() => {
    void Haptics.selectionAsync();
    setThumbnailLocalUri(null);
  }, []);

  const saveHubDraft = useCallback(async () => {
    if (savingDraft || editingClassId) return;
    const name = className.trim();
    if (!name) return;
    setSavingDraft(true);
    try {
      let thumbUrl: string | null = existingThumbnailUrl;
      if (thumbnailLocalUri) {
        thumbUrl = await uploadClassThumbnail(thumbnailLocalUri);
        setExistingThumbnailUrl(thumbUrl);
        setThumbnailLocalUri(null);
      }
      const capN = Math.max(1, parseInt(capacity, 10) || 1);
      const minN = Math.max(1, parseInt(minStudents, 10) || 1);
      const rnWizard: HubDraftRnV1['rnWizard'] = {
        className: name,
        description: description.trim(),
        level,
        durationMin,
        capacity,
        useSuggestedPricing,
        customPrice,
        minStudents,
        flexibleMinimum,
        selectedInviteIds: Array.from(selectedInviteIds),
        scheduleDate,
        scheduleTime,
        recurrenceType,
        recurrenceCount,
        isPublic,
        existingThumbnailUrl: thumbUrl,
      };
      const hubDraftForm: HubDraftRnV1 = {
        v: 1,
        wizardStepIndex: stepIndex,
        suggestedPrice,
        rnWizard,
      };
      const patchBase: Record<string, unknown> = {
        name,
        description: rnWizard.description,
        capacity: capN,
        minStudents: minN,
        flexibleMinimum,
        level,
        duration: durationMin,
        price: finalPrice,
        useSuggestedPricing,
        suggestedPrice,
        thumbnail: thumbUrl || undefined,
        hubDraftForm,
      };
      if (hubDraftClassId) {
        await updateClass(hubDraftClassId, patchBase);
      } else {
        const res = await createClass({
          status: 'draft',
          name,
          description: rnWizard.description,
          capacity: capN,
          isPublic: false,
          minStudents: minN,
          flexibleMinimum,
          level,
          duration: durationMin,
          price: finalPrice,
          useSuggestedPricing,
          suggestedPrice,
          thumbnail: thumbUrl || undefined,
          hubDraftForm,
        });
        const created = pickCreatedClasses(res)[0];
        if (created?._id) setHubDraftClassId(String(created._id));
      }
      Alert.alert('', t('MY_CLASSES_FLOW.HUB_DRAFT_SAVED'));
      void loadHub();
    } catch {
      Alert.alert(t('COMMON.ERROR'), t('MY_CLASSES_FLOW.UPDATE_FAILED'));
    } finally {
      setSavingDraft(false);
    }
  }, [
    savingDraft,
    editingClassId,
    className,
    description,
    level,
    durationMin,
    capacity,
    minStudents,
    flexibleMinimum,
    scheduleDate,
    scheduleTime,
    recurrenceType,
    recurrenceCount,
    isPublic,
    selectedInviteIds,
    stepIndex,
    suggestedPrice,
    finalPrice,
    useSuggestedPricing,
    customPrice,
    thumbnailLocalUri,
    existingThumbnailUrl,
    hubDraftClassId,
    t,
    loadHub,
  ]);

  const headerTitle = hubPhase === 'list' ? t('MY_CLASSES_FLOW.HUB_TITLE') : t('MY_CLASSES_FLOW.WIZARD_TITLE');
  const showHubFab = !hubLoading && !hubError;
  const hubWizardSaveDraftVisible = !editingClassId && !!className.trim();

  if (hubPhase === 'list') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: tk.screen }]} edges={['top', 'left', 'right']}>
        <View style={[styles.topBar, { borderBottomColor: tk.topHairline }]}>
          <TouchableOpacity onPress={goBack} style={styles.topBarBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={tk.text} />
          </TouchableOpacity>
          <Text style={[styles.topBarTitle, { color: tk.text }]} numberOfLines={1}>
            {headerTitle}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.hubToolbar}>
          <View style={[styles.hubTabs, { backgroundColor: tk.tabRail }]}>
            {(['active', 'history', 'drafts'] as HubTab[]).map(tab => {
              const active = hubTab === tab;
              const tabLabel =
                tab === 'active' ? t('MY_CLASSES_FLOW.TAB_ACTIVE') : tab === 'history' ? t('MY_CLASSES_FLOW.TAB_HISTORY') : t('MY_CLASSES_FLOW.TAB_DRAFTS');
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setHubTab(tab);
                  }}
                  style={[styles.hubTabBtn, active && { backgroundColor: tk.tabActive }, active && styles.hubTabBtnOn]}
                >
                  <Text style={[styles.hubTabText, { color: active ? tk.tabActiveText : tk.tabInactiveText }]} numberOfLines={1}>
                    {tabLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {hubLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color={tk.progressFill} />
            <Text style={[styles.hubLoadingText, { color: tk.textSub }]}>{t('MY_CLASSES_FLOW.HUB_LOADING')}</Text>
          </View>
        ) : hubError ? (
          <View style={styles.centerFill}>
            <Text style={[styles.hubErrorText, { color: tk.textSub }]}>{t('MY_CLASSES_FLOW.LOAD_ERROR')}</Text>
            <TouchableOpacity
              onPress={() => {
                setHubLoading(true);
                void loadHub();
              }}
              style={[styles.hubRetry, { backgroundColor: tk.retryBg, borderColor: tk.retryBorder }]}
            >
              <Text style={[styles.hubRetryText, { color: tk.retryFg }]}>{t('MY_CLASSES_FLOW.RETRY')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.hubRoot}>
            <ScrollView
              contentContainerStyle={styles.hubScrollContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshHub} tintColor={tk.textSub} />}
            >
              {listCards.length === 0 && hubTab === 'active' ? (
                <View style={styles.hubEmpty}>
                  <View style={styles.hubEmptyIconWrap} accessibilityElementsHidden>
                    <Ionicons name="calendar-outline" size={56} color={tk.iconMuted} />
                  </View>
                  <Text style={[styles.hubEmptyTitle, { color: tk.text }]}>{t('MY_CLASSES_FLOW.HUB_EMPTY_ACTIVE_TITLE')}</Text>
                  <Text style={[styles.hubEmptyDesc, { color: tk.textSub, marginBottom: 0 }]}>{t('MY_CLASSES_FLOW.HUB_EMPTY_ACTIVE_DESC')}</Text>
                </View>
              ) : null}

              {listCards.length === 0 && hubTab === 'history' ? (
                <View style={[styles.hubEmpty, styles.hubEmptySubtle]}>
                  <Text style={[styles.hubEmptyDesc, { color: tk.textSub, marginBottom: 0 }]}>{t('MY_CLASSES_FLOW.HUB_EMPTY_HISTORY')}</Text>
                </View>
              ) : null}

              {listCards.length === 0 && hubTab === 'drafts' ? (
                <View style={[styles.hubEmpty, styles.hubEmptySubtle]}>
                  <Text style={[styles.hubEmptyDesc, { color: tk.textSub, marginBottom: 0 }]}>{t('MY_CLASSES_FLOW.HUB_EMPTY_DRAFTS')}</Text>
                </View>
              ) : null}

              {listCards.length > 0 ? (
                <View style={styles.hubGrid}>
                  {listCards.map(card => {
                    const badgeS = hubBadgeOverlay(card.badge);
                    const historyDim = hubTab === 'history';
                    const showActions = card.isDraft || card.canEdit || card.canCancel || card.canRemoveFromHistory;
                    return (
                      <View key={card.id} style={[styles.hubCard, historyDim && styles.hubCardHistory]}>
                        <View style={styles.hubThumb}>
                          {card.thumbUrl ? (
                            <Image source={{ uri: card.thumbUrl }} style={styles.hubThumbImg} />
                          ) : (
                            <LinearGradient colors={[tk.thumbEmptyA, tk.thumbEmptyB]} style={styles.hubThumbEmpty} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                              <Ionicons name="people-outline" size={36} color={tk.iconMuted} />
                            </LinearGradient>
                          )}
                          <View style={[styles.hubBadge, { backgroundColor: badgeS.backgroundColor }]}>
                            <Text style={[styles.hubBadgeText, { color: badgeS.color }]}>{t(card.badgeLabelKey)}</Text>
                          </View>
                        </View>
                        <View style={styles.hubCardBody}>
                          <Text style={[styles.hubTypeLabel, { color: tk.typeLabel }]}>{t('MY_CLASSES_FLOW.HUB_CARD_GROUP')}</Text>
                          <Text style={[styles.hubCardTitle, { color: tk.text }]} numberOfLines={2}>
                            {card.name}
                          </Text>
                          <View style={styles.hubPriceRow}>
                            {card.price > 0 ? (
                              <Text style={[styles.hubPrice, { color: tk.pricePaid }]}>${card.priceDisplay}</Text>
                            ) : (
                              <Text style={[styles.hubPrice, styles.hubPriceFree, { color: tk.priceFree }]}>{t('MY_CLASSES_FLOW.HUB_CLASS_FREE')}</Text>
                            )}
                          </View>
                          <Text style={[styles.hubWhen, { color: tk.when }]}>{card.whenLine}</Text>
                          <Text style={[styles.hubMeta, { color: tk.meta }]}>
                            {t('MY_CLASSES_FLOW.HUB_CARD_ENROLLED', { current: card.confirmedCount, max: card.capacity })}
                          </Text>
                          {showActions && (
                            <View style={styles.hubCardActions}>
                              {card.isDraft && (
                                <TouchableOpacity
                                  style={[styles.hubResumeBtn, { borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
                                  onPress={() => void beginResumeDraft(card)}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.hubResumeBtnText, { color: tk.text }]}>{t('MY_CLASSES_FLOW.HUB_RESUME')}</Text>
                                </TouchableOpacity>
                              )}
                              {card.canEdit && (
                                <TouchableOpacity
                                  style={[styles.hubCardActionBtn, { borderColor: tk.inputBorder }]}
                                  onPress={() => void beginEditHubClass(card)}
                                  activeOpacity={0.7}
                                >
                                  <Ionicons name="create-outline" size={16} color={tk.text} />
                                </TouchableOpacity>
                              )}
                              {card.canCancel && (
                                <TouchableOpacity
                                  style={[styles.hubCardActionBtn, styles.hubCardActionBtnDanger]}
                                  onPress={() => confirmDeleteHubClass(card)}
                                  activeOpacity={0.7}
                                >
                                  <Ionicons name="trash-outline" size={16} color="#dc2626" />
                                </TouchableOpacity>
                              )}
                              {card.canRemoveFromHistory && (
                                <TouchableOpacity
                                  style={[styles.hubCardActionBtn, styles.hubCardActionBtnDanger]}
                                  onPress={() => confirmRemoveFromHistoryHubClass(card)}
                                  activeOpacity={0.7}
                                >
                                  <Ionicons name="trash-outline" size={16} color="#dc2626" />
                                </TouchableOpacity>
                              )}
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </ScrollView>

            {showHubFab ? (
              <TouchableOpacity style={styles.hubFab} onPress={openCreate} activeOpacity={0.88}>
                <Ionicons name="add-outline" size={22} color={tk.fabFg} />
                <Text style={[styles.hubFabLabel, { color: tk.fabFg }]}>{t('MY_CLASSES_FLOW.HUB_CREATE_CLASS_FAB')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    );
  }

  const stepTitleKey = `MY_CLASSES_FLOW.STEP_${String(currentStep).toUpperCase()}`;

  const scrollBottomPad = currentStep === 'review' ? 24 : 100 + insets.bottom;
  const kavBehavior = currentStep === 'review' ? undefined : Platform.OS === 'ios' ? 'padding' : undefined;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tk.screen }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={kavBehavior}>
        <View style={[styles.wizTop, { borderBottomColor: tk.topHairline }]}>
          <TouchableOpacity onPress={goWizardBack} style={styles.wizBackRow} hitSlop={12}>
            <Ionicons name="chevron-back-outline" size={20} color={tk.backLink} />
            <Text style={[styles.wizBackText, { color: tk.backLink }]}>{t('MY_CLASSES_FLOW.WIZ_BACK')}</Text>
          </TouchableOpacity>
          <View style={styles.wizProgressBlock}>
            <View style={[styles.wizProgressTrack, { backgroundColor: tk.progressTrack }]}>
              <View style={[styles.wizProgressFill, { width: `${((stepIndex + 1) / totalSteps) * 100}%`, backgroundColor: tk.progressFill }]} />
            </View>
            <Text style={[styles.wizStepOf, { color: tk.stepOf }]}>
              {t('MY_CLASSES_FLOW.STEP_OF', { current: stepIndex + 1, total: totalSteps })}
            </Text>
          </View>
        </View>

        {editingClassId && (
          <View style={styles.editBadgeStrip}>
            <LinearGradient colors={['#f59e0b', '#d97706']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.editBadge}>
              <Ionicons name="create-outline" size={14} color="#fff" />
              <Text style={styles.editBadgeText}>{t('MY_CLASSES_FLOW.HUB_EDIT_BADGE')}</Text>
            </LinearGradient>
          </View>
        )}

        <ScrollView
          style={styles.wizardScroll}
          contentContainerStyle={[styles.wizardContent, { paddingBottom: scrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator
        >
          {currentStep !== 'review' && (
            <Text style={[styles.stepHead, { color: tk.heading }]}>{t(stepTitleKey)}</Text>
          )}

          {currentStep === 'name' && (
            <TextInput
              value={className}
              onChangeText={setClassName}
              placeholder={t('MY_CLASSES_FLOW.PLACEHOLDER_NAME')}
              placeholderTextColor={tk.textSub}
              style={[styles.input, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
            />
          )}

          {currentStep === 'description' && (
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={t('MY_CLASSES_FLOW.PLACEHOLDER_DESC')}
              placeholderTextColor={tk.textSub}
              multiline
              style={[styles.input, styles.textArea, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
            />
          )}

          {currentStep === 'level' && (
            <View style={styles.chipWrap}>
              {LEVEL_OPTIONS.map(opt => {
                const sel = level === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setLevel(opt.value);
                    }}
                    style={[
                      styles.chip,
                      { borderColor: tk.chipBorder },
                      sel && { backgroundColor: tk.chipSelectedBg, borderColor: tk.chipSelectedBg },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: sel ? tk.chipSelectedFg : tk.chipUnselectedFg }]}>{t(opt.labelKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {currentStep === 'duration' && (
            <View style={styles.chipWrap}>
              {DURATION_OPTIONS.map(d => {
                const sel = durationMin === d;
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setDurationMin(d);
                    }}
                    style={[styles.chip, { borderColor: tk.chipBorder }, sel && { backgroundColor: tk.chipSelectedBg, borderColor: tk.chipSelectedBg }]}
                  >
                    <Text style={[styles.chipText, { color: sel ? tk.chipSelectedFg : tk.chipUnselectedFg }]}>{d} min</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {currentStep === 'capacity' && (
            <TextInput
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="number-pad"
              placeholder="8"
              placeholderTextColor={tk.textSub}
              style={[styles.input, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
            />
          )}

          {currentStep === 'pricing' && (
            <View>
              <View style={styles.rowBetween}>
                <Text style={[styles.wizBodyText, { color: tk.text, flex: 1 }]}>{t('MY_CLASSES_FLOW.USE_SUGGESTED')}</Text>
                <Switch
                  value={useSuggestedPricing}
                  onValueChange={setUseSuggestedPricing}
                  trackColor={{ false: colors.isDark ? '#3a3a3c' : '#e8e8e8', true: tk.switchOn }}
                  thumbColor="#ffffff"
                />
              </View>
              <Text style={[styles.hint, { color: tk.textSub }]}>
                {t('MY_CLASSES_FLOW.SUGGESTED_LABEL')}: ${suggestedPrice.toFixed(2)}
              </Text>
              {!useSuggestedPricing && (
                <TextInput
                  value={customPrice}
                  onChangeText={setCustomPrice}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={tk.textSub}
                  style={[styles.input, { marginTop: 12, color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
                />
              )}
              <Text style={[styles.hint, { color: tk.textSub, marginTop: 8 }]}>{t('MY_CLASSES_FLOW.PRICE_HINT')}</Text>
            </View>
          )}

          {currentStep === 'minStudents' && (
            <TextInput
              value={minStudents}
              onChangeText={setMinStudents}
              keyboardType="number-pad"
              style={[styles.input, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
            />
          )}

          {currentStep === 'flexibleMin' && (
            <View style={styles.rowBetween}>
              <Text style={[styles.wizBodyText, { color: tk.text, flex: 1, paddingRight: 12 }]}>{t('MY_CLASSES_FLOW.FLEXIBLE_MIN')}</Text>
              <Switch
                value={flexibleMinimum}
                onValueChange={setFlexibleMinimum}
                trackColor={{ false: colors.isDark ? '#3a3a3c' : '#e8e8e8', true: tk.switchOn }}
                thumbColor="#ffffff"
              />
            </View>
          )}

          {currentStep === 'invites' && (
            <View>
              {inviteStudents.length === 0 ? (
                <Text style={{ color: tk.textSub }}>{t('MY_CLASSES_FLOW.NO_INVITE_STUDENTS')}</Text>
              ) : (
                inviteStudents.map(s => {
                  const on = selectedInviteIds.has(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.inviteRow, { borderColor: tk.inputBorder }]}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setSelectedInviteIds(prev => {
                          const n = new Set(prev);
                          if (n.has(s.id)) n.delete(s.id);
                          else n.add(s.id);
                          return n;
                        });
                      }}
                    >
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? tk.inviteCheck : tk.textSub} />
                      <Text style={[styles.inviteName, { color: tk.text }]}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {currentStep === 'schedule' && (
            <View>
              <Text style={[styles.fieldLabel, { color: tk.fieldLabel }]}>{t('MY_CLASSES_FLOW.DATE')}</Text>
              <TextInput
                value={scheduleDate}
                onChangeText={setScheduleDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={tk.textSub}
                style={[styles.input, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
              />
              <Text style={[styles.fieldLabel, { color: tk.fieldLabel, marginTop: 12 }]}>{t('MY_CLASSES_FLOW.TIME')}</Text>
              <TextInput
                value={scheduleTime}
                onChangeText={setScheduleTime}
                placeholder="10:00"
                placeholderTextColor={tk.textSub}
                style={[styles.input, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
              />
            </View>
          )}

          {currentStep === 'recurrence' && (
            <View style={styles.chipWrap}>
              {(
                [
                  { v: 'none' as const, k: 'MY_CLASSES_FLOW.REC_NONE' },
                  { v: 'daily' as const, k: 'MY_CLASSES_FLOW.REC_DAILY' },
                  { v: 'weekly' as const, k: 'MY_CLASSES_FLOW.REC_WEEKLY' },
                  { v: 'monthly' as const, k: 'MY_CLASSES_FLOW.REC_MONTHLY' },
                ] as const
              ).map(({ v, k }) => {
                const sel = recurrenceType === v;
                return (
                  <TouchableOpacity
                    key={v}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setRecurrenceType(v);
                    }}
                    style={[styles.chip, { borderColor: tk.chipBorder }, sel && { backgroundColor: tk.chipSelectedBg, borderColor: tk.chipSelectedBg }]}
                  >
                    <Text style={[styles.chipText, { color: sel ? tk.chipSelectedFg : tk.chipUnselectedFg }]}>{t(k)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {currentStep === 'recurrenceCount' && (
            <TextInput
              value={recurrenceCount}
              onChangeText={setRecurrenceCount}
              keyboardType="number-pad"
              placeholder="4"
              placeholderTextColor={tk.textSub}
              style={[styles.input, { color: tk.text, borderColor: tk.inputBorder, backgroundColor: tk.inputBg }]}
            />
          )}

          {currentStep === 'visibility' && (
            <View style={styles.rowBetween}>
              <Text style={[styles.wizBodyText, { color: tk.text, flex: 1, paddingRight: 12 }]}>{t('MY_CLASSES_FLOW.PUBLIC_CLASS')}</Text>
              <Switch
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ false: colors.isDark ? '#3a3a3c' : '#e8e8e8', true: tk.switchOn }}
                thumbColor="#ffffff"
              />
            </View>
          )}

          {currentStep === 'thumbnail' && (
            <View>
              <Text style={[styles.fieldLabel, { color: tk.fieldLabel, marginBottom: 10 }]}>
                {t('CREATE_MATERIAL.FIELD_COVER_IMAGE')}{' '}
                <Text style={[styles.thumbOptionalTag, { color: tk.textSub }]}>
                  {isPublic ? `(${t('CREATE_MATERIAL.FIELD_COVER_REQUIRED')})` : `(${t('MY_CLASSES_FLOW.COVER_OPTIONAL')})`}
                </Text>
              </Text>
              {thumbnailLocalUri || existingThumbnailUrl ? (
                <View style={[styles.coverPreview, { borderColor: tk.inputBorder }]}>
                  <Image source={{ uri: thumbnailLocalUri || existingThumbnailUrl! }} style={styles.coverImage} />
                  <TouchableOpacity
                    style={styles.coverRemove}
                    onPress={() => {
                      removeThumbnail();
                      setExistingThumbnailUrl(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close-circle" size={26} color="rgba(0,0,0,0.55)" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.coverPicker, { backgroundColor: tk.inputBg, borderColor: tk.inputBorder }]}
                  onPress={pickThumbnail}
                  activeOpacity={0.7}
                >
                  <Ionicons name="image-outline" size={32} color={tk.textSub} />
                  <Text style={[styles.coverPickerLabel, { color: tk.text }]}>{t('CREATE_MATERIAL.FIELD_COVER_ADD')}</Text>
                  <Text style={[styles.coverPickerHint, { color: tk.textSub }]}>{t('CREATE_MATERIAL.FIELD_COVER_HINT')}</Text>
                </TouchableOpacity>
              )}
              {isPublic ? (
                <Text style={[styles.hint, { color: tk.textSub, marginTop: 12 }]}>{t('MY_CLASSES_FLOW.THUMB_REQUIRED_PUBLIC')}</Text>
              ) : null}
            </View>
          )}

          {currentStep === 'review' && (
            <View>
              {/* ── Header row: thumbnail + meta pills ── */}
              <View style={styles.rvHeaderRow}>
                {thumbnailLocalUri || existingThumbnailUrl ? (
                  <Image source={{ uri: thumbnailLocalUri || existingThumbnailUrl! }} style={styles.rvThumb} />
                ) : (
                  <View style={[styles.rvThumb, styles.rvThumbEmpty, { backgroundColor: tk.reviewRowBg }]}>
                    <Ionicons name="people-outline" size={22} color={tk.iconMuted} />
                  </View>
                )}
                <View style={styles.rvPillsCol}>
                  <View style={[styles.rvPill, { borderColor: tk.reviewCardBorder }]}>
                    <Text style={[styles.rvPillText, { color: tk.pricePaid }]}>{t('MY_CLASSES_FLOW.HUB_CARD_GROUP').toUpperCase()}</Text>
                  </View>
                  <View style={styles.rvPillsWrap}>
                    <View style={[styles.rvPill, { borderColor: tk.reviewCardBorder }]}>
                      <Text style={[styles.rvPillText, { color: tk.text }]}>{scheduleLineReview}</Text>
                    </View>
                    <View style={[styles.rvPill, { borderColor: tk.reviewCardBorder }]}>
                      <Text style={[styles.rvPillText, { color: tk.text }]}>{levelLabelReview}</Text>
                    </View>
                    <View style={[styles.rvPill, { borderColor: tk.reviewCardBorder }]}>
                      <Text style={[styles.rvPillText, { color: tk.text }]}>
                        {isPublic ? t('MY_CLASSES_FLOW.VIS_PUBLIC') : 'Invite only'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* ── Title ── */}
              <Text style={[styles.rvTitle, { color: tk.text }]}>{className.trim() || '—'}</Text>

              {/* ── Description ── */}
              {description.trim() ? (
                <View style={[styles.rvDescBlock, { borderLeftColor: tk.reviewCardBorder }]}>
                  <Text style={[styles.rvDescText, { color: tk.text }]}>{description.trim()}</Text>
                </View>
              ) : null}

              {/* ── Detail rows ── */}
              <Text style={[styles.rvSectionLabel, { color: tk.meta }]}>{t('MY_CLASSES_FLOW.CLASS_DETAILS')}</Text>

              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_DURATION')} value={`${durationMin} min`} />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_MAX_STUDENTS')} value={String(parseInt(capacity, 10) || 0)} />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_MIN_STUDENTS')} value={String(parseInt(minStudents, 10) || 0)} />
              <ReviewRow
                tk={tk}
                label={t('MY_CLASSES_FLOW.DETAIL_FLEXIBLE_MIN')}
                value={flexibleMinimum ? t('MY_CLASSES_FLOW.FLEXIBLE_YES') : t('MY_CLASSES_FLOW.FLEXIBLE_NO')}
              />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_PRICE')} value={priceLineReview} />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_LEVEL')} value={levelLabelReview} />
              <ReviewRow
                tk={tk}
                label={t('MY_CLASSES_FLOW.DETAIL_VISIBILITY')}
                value={isPublic ? t('MY_CLASSES_FLOW.VIS_PUBLIC') : t('MY_CLASSES_FLOW.VIS_PRIVATE')}
              />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_SCHEDULE')} value={scheduleLineReview} />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_RECURRENCE')} value={recurrenceSummary} />
              <ReviewRow tk={tk} label={t('MY_CLASSES_FLOW.DETAIL_INVITED')} value={invitedLine} last />
            </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: tk.screen,
              borderTopColor: tk.footerHairline,
              paddingBottom: Math.max(12, insets.bottom),
            },
          ]}
        >
          <View style={styles.footerRow}>
            {hubWizardSaveDraftVisible && (
              <TouchableOpacity
                style={[styles.saveDraftBtn, { borderColor: tk.inputBorder }, savingDraft && { opacity: 0.6 }]}
                onPress={() => void saveHubDraft()}
                disabled={savingDraft}
              >
                {savingDraft ? (
                  <ActivityIndicator size="small" color={tk.text} />
                ) : (
                  <Text style={[styles.saveDraftBtnText, { color: tk.text }]}>{t('MY_CLASSES_FLOW.HUB_SAVE_DRAFT')}</Text>
                )}
              </TouchableOpacity>
            )}
            {editingClassId && (
              <TouchableOpacity
                style={[styles.saveEditBtn, { borderColor: '#34c759' }, savingEdit && { opacity: 0.6 }]}
                onPress={() => void saveEditInPlace()}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color="#1a8d3a" />
                ) : (
                  <Text style={styles.saveEditBtnText}>{t('MY_CLASSES_FLOW.SAVE')}</Text>
                )}
              </TouchableOpacity>
            )}
            {currentStep === 'review' ? (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: tk.primaryBg, flex: 1 }, submitting && { opacity: 0.6 }]}
                onPress={() => void submitWizard()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={tk.primaryFg} />
                ) : (
                  <Text style={[styles.primaryBtnText, { color: tk.primaryFg }]}>
                    {editingClassId ? t('MY_CLASSES_FLOW.UPDATE_CLASS') : t('MY_CLASSES_FLOW.CREATE_CLASS')}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: tk.primaryBg, flex: 1 }]} onPress={advance}>
                <Text style={[styles.primaryBtnText, { color: tk.primaryFg }]}>{t('COMMON.NEXT')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  hubToolbar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  hubTabs: { flexDirection: 'row', alignSelf: 'flex-start', gap: 8, borderRadius: 10, padding: 4 },
  hubTabBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  hubTabBtnOn: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  hubTabText: { fontSize: 14, fontWeight: '600' },
  hubRoot: { flex: 1, position: 'relative', paddingHorizontal: 8, paddingBottom: 88 },
  hubScrollContent: { paddingBottom: 24, paddingTop: 8 },
  hubLoadingText: { marginTop: 12, fontSize: 15, fontWeight: '500' },
  hubErrorText: { fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  hubRetry: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  hubRetryText: { fontSize: 15, fontWeight: '600' },
  hubEmpty: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32, maxWidth: 420, alignSelf: 'center' },
  hubEmptySubtle: { paddingTop: 32 },
  hubEmptyIconWrap: { marginBottom: 0 },
  hubEmptyTitle: { marginTop: 16, marginBottom: 8, fontSize: 22, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
  hubEmptyDesc: { marginBottom: 24, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  hubGrid: { gap: 20, paddingTop: 8 },
  hubCard: { width: '100%', maxWidth: 400, alignSelf: 'center' },
  hubCardHistory: { opacity: 0.92 },
  hubThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0f2',
  },
  hubThumbImg: { width: '100%', height: '100%' },
  hubThumbEmpty: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  hubBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  hubBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  hubCardBody: { paddingTop: 12, paddingHorizontal: 2 },
  hubTypeLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  hubCardTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, lineHeight: 20, marginBottom: 8 },
  hubPriceRow: { marginBottom: 6 },
  hubPrice: { fontSize: 14, fontWeight: '700' },
  hubPriceFree: {},
  hubWhen: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  hubMeta: { fontSize: 12, marginBottom: 8 },
  hubCardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 4, alignItems: 'center' },
  hubResumeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  hubResumeBtnText: { fontSize: 14, fontWeight: '600' },
  hubCardActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubCardActionBtnDanger: { borderColor: 'rgba(220, 38, 38, 0.3)', backgroundColor: 'rgba(220, 38, 38, 0.06)' },
  hubFab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: '#1d1d1f',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  hubFabLabel: { fontSize: 15, fontWeight: '600' },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  editBadgeStrip: { paddingHorizontal: 20, paddingTop: 10 },
  editBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  editBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  wizTop: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  wizBackRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, alignSelf: 'flex-start' },
  wizBackText: { fontSize: 15, fontWeight: '500' },
  wizProgressBlock: { marginBottom: 8 },
  wizProgressTrack: { height: 4, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  wizProgressFill: { height: '100%', borderRadius: 4 },
  wizStepOf: { fontSize: 13, fontWeight: '500' },
  wizBodyText: { fontSize: 16 },
  wizardScroll: { flex: 1 },
  wizardContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, maxWidth: 560, width: '100%', alignSelf: 'center' },
  stepHead: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 32,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 48,
  },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipText: { fontSize: 15, fontWeight: '500' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { fontSize: 14, lineHeight: 20 },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inviteName: { fontSize: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  thumbOptionalTag: { fontWeight: '500' },
  coverPicker: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 6,
  },
  coverPickerLabel: { fontSize: 15, fontWeight: '600' },
  coverPickerHint: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  coverPreview: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  coverImage: { width: '100%', aspectRatio: 16 / 10 },
  coverRemove: { position: 'absolute', top: 8, right: 8 },
  rvHeaderRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  rvThumb: { width: 80, aspectRatio: 16 / 10, borderRadius: 12, overflow: 'hidden' },
  rvThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rvPillsCol: { flex: 1, gap: 6, justifyContent: 'center' },
  rvPillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  rvPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  rvPillText: { fontSize: 11, fontWeight: '500' },
  rvTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, lineHeight: 24, marginBottom: 6 },
  rvDescBlock: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 14 },
  rvDescText: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  rvSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
    marginTop: 2,
  },
  rvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
  rvLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  rvValue: { fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1, marginLeft: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  saveDraftBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  saveDraftBtnText: { fontSize: 15, fontWeight: '600' },
  saveEditBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  saveEditBtnText: { fontSize: 15, fontWeight: '600', color: '#1a8d3a' },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 17, fontWeight: '600' },
});
