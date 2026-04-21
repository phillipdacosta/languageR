import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Animated,
  Easing,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keyboard } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import Slider from '@react-native-community/slider';
import Sortable from 'react-native-sortables';
import Reanimated, { useAnimatedRef } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { materialService } from '../services/materials';
import type { MaterialType, LinkedChannels, TutorMaterial } from '../services/materials';
import { cardShadowDark } from '../utils/cardShadow';

/** Paid-option checkmark color — matches bundle share step */
const SETUP_AVAILABILITY_BLUE = '#08a0e8';

type Step = 'type' | 'pricing' | 'details' | 'quiz' | 'preview';
type QuestionType = 'multiple_choice' | 'fill_blank' | 'true_false' | 'ordering';

interface QuizOption { text: string; isCorrect: boolean }
interface QuizQuestion {
  type: QuestionType;
  question: string;
  explanation: string;
  options?: QuizOption[];
  acceptedAnswers?: string[];
  correctAnswer?: boolean;
  correctOrder?: string[];
}

const STEP_ORDER: Step[] = ['type', 'pricing', 'details', 'quiz', 'preview'];

const CREATE_MATERIAL_VIDEO_TYPE_IMG = require('../../assets/shared/create-material-type-video-quiz.png');
const CREATE_MATERIAL_READING_TYPE_IMG = require('../../assets/shared/create-material-type-reading.png');
const CREATE_MATERIAL_LISTENING_TYPE_IMG = require('../../assets/shared/create-material-type-listening.png');

/** Sub-steps inside “Details”, aligned with desktop create-material wizard. */
type DetailsWizardStepId =
  | 'title'
  | 'description'
  | 'whyTake'
  | 'languageLevel'
  | 'tags'
  | 'customTopics'
  | 'thumbnail'
  | 'videoUrl'
  | 'readingPassage'
  | 'listeningAudio'
  | 'price';

function buildDetailsWizardSteps(selectedType: MaterialType, selectedPricing: 'free' | 'paid'): DetailsWizardStepId[] {
  const steps: DetailsWizardStepId[] = [
    'title',
    'description',
    'whyTake',
    'languageLevel',
    'tags',
    'customTopics',
    'thumbnail',
  ];
  if (selectedType === 'video_quiz') steps.push('videoUrl');
  else if (selectedType === 'reading') steps.push('readingPassage');
  else steps.push('listeningAudio');
  if (selectedPricing === 'paid') steps.push('price');
  return steps;
}

function detailsWizardCopyKeys(id: DetailsWizardStepId, selectedType: MaterialType): { h: string; d: string } {
  const base: Record<DetailsWizardStepId, { h: string; d: string }> = {
    title: { h: 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_TITLE_D' },
    description: { h: 'CREATE_MATERIAL.DETAILS_WIZ_DESCRIPTION_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_DESCRIPTION_D' },
    whyTake: { h: 'CREATE_MATERIAL.DETAILS_WIZ_WHY_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_WHY_D' },
    languageLevel: { h: 'CREATE_MATERIAL.DETAILS_WIZ_LANG_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_LANG_D' },
    tags: { h: 'CREATE_MATERIAL.DETAILS_WIZ_TAGS_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_TAGS_D' },
    customTopics: { h: 'CREATE_MATERIAL.DETAILS_WIZ_TOPICS_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_TOPICS_D' },
    thumbnail: {
      h: 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_H',
      d:
        selectedType === 'video_quiz'
          ? 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_D_VIDEO'
          : selectedType === 'reading'
            ? 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_D_READING'
            : 'CREATE_MATERIAL.DETAILS_WIZ_THUMBNAIL_D_LISTENING',
    },
    videoUrl: { h: 'CREATE_MATERIAL.DETAILS_WIZ_VIDEO_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_VIDEO_D' },
    readingPassage: { h: 'CREATE_MATERIAL.DETAILS_WIZ_PASSAGE_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_PASSAGE_D' },
    listeningAudio: { h: 'CREATE_MATERIAL.DETAILS_WIZ_AUDIO_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_AUDIO_D' },
    price: { h: 'CREATE_MATERIAL.DETAILS_WIZ_PRICE_H', d: 'CREATE_MATERIAL.DETAILS_WIZ_PRICE_D' },
  };
  return base[id];
}

const STEP_TITLE_KEYS: Record<Step, string> = {
  type: 'CREATE_MATERIAL.STEP_NEW_MATERIAL',
  pricing: 'CREATE_MATERIAL.STEP_PRICING',
  details: 'CREATE_MATERIAL.STEP_DETAILS',
  quiz: 'CREATE_MATERIAL.STEP_QUIZ_BUILDER',
  preview: 'CREATE_MATERIAL.STEP_PREVIEW',
};

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Korean', 'Chinese', 'Arabic', 'Russian', 'Hindi',
  'Turkish', 'Dutch', 'Polish', 'Swedish', 'Czech', 'Greek',
  'Hebrew', 'Thai', 'Vietnamese', 'Indonesian', 'Malay',
  'Finnish', 'Norwegian', 'Danish', 'Romanian', 'Ukrainian', 'Persian', 'Farsi',
];

const LEVELS = [
  { value: 'any', labelKey: 'CREATE_MATERIAL.LEVEL_ALL' },
  { value: 'beginner', labelKey: 'CREATE_MATERIAL.LEVEL_BEGINNER' },
  { value: 'intermediate', labelKey: 'CREATE_MATERIAL.LEVEL_INTERMEDIATE' },
  { value: 'advanced', labelKey: 'CREATE_MATERIAL.LEVEL_ADVANCED' },
];

const QUESTION_TYPES: { value: QuestionType; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'multiple_choice', labelKey: 'CREATE_MATERIAL.QUIZ_MC', icon: 'list-outline' },
  { value: 'fill_blank', labelKey: 'CREATE_MATERIAL.QUIZ_FILL_BLANK', icon: 'text-outline' },
  { value: 'true_false', labelKey: 'CREATE_MATERIAL.QUIZ_TRUE_FALSE', icon: 'swap-horizontal-outline' },
  { value: 'ordering', labelKey: 'CREATE_MATERIAL.QUIZ_ORDERING', icon: 'reorder-four-outline' },
];

function createQuestion(type: QuestionType): QuizQuestion {
  switch (type) {
    case 'fill_blank':
      return { type, question: '', explanation: '', acceptedAnswers: [''] };
    case 'true_false':
      return { type, question: '', explanation: '', correctAnswer: true };
    case 'ordering':
      return { type, question: '', explanation: '', correctOrder: ['', ''] };
    default:
      return {
        type: 'multiple_choice', question: '', explanation: '',
        options: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }],
      };
  }
}

function mapQuizQuestionToPayload(q: QuizQuestion): Record<string, any> {
  const base: Record<string, any> = { type: q.type, question: q.question };
  if (q.explanation?.trim()) base.explanation = q.explanation.trim();
  switch (q.type) {
    case 'multiple_choice':
      base.options = (q.options || []).filter(o => o.text.trim());
      break;
    case 'fill_blank':
      base.acceptedAnswers = (q.acceptedAnswers || []).filter(a => a.trim());
      break;
    case 'true_false':
      base.correctAnswer = q.correctAnswer;
      break;
    case 'ordering':
      base.correctOrder = (q.correctOrder || []).filter(s => s.trim());
      break;
  }
  return base;
}

function buildQuizPayloadForApi(quiz: QuizQuestion[]): Record<string, any>[] {
  return quiz.map(mapQuizQuestionToPayload);
}

/** When false, omit `quiz` from draft PUT so incomplete WIP is not sent / does not overwrite. */
function isQuizPayloadCompleteForApi(quiz: QuizQuestion[]): boolean {
  if (quiz.length === 0) return true;
  for (let i = 0; i < quiz.length; i++) {
    const q = quiz[i];
    if (!q.question.trim()) return false;
    if (q.type === 'multiple_choice') {
      const hasCorrect = q.options?.some(o => o.isCorrect && o.text.trim());
      if (!hasCorrect) return false;
    }
    if (q.type === 'fill_blank') {
      if (!q.acceptedAnswers?.some(a => a.trim())) return false;
    }
    if (q.type === 'ordering') {
      const filled = q.correctOrder?.filter(s => s.trim()).length || 0;
      if (filled < 2) return false;
    }
    if (q.type === 'true_false' && typeof q.correctAnswer !== 'boolean') return false;
  }
  return true;
}

interface Rect { x: number; y: number; w: number; h: number }

interface FlyState {
  type: MaterialType;
  src: Rect;
  dst: Rect | null;
}

interface Props {
  goBack: () => void;
  channels?: LinkedChannels;
  editingMaterial?: TutorMaterial | null;
}

/** YouTube default thumbnail for preview when no custom cover is set (matches web behavior). */
function youtubeThumbnailFromVideoUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  const m = u.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

export default function CreateMaterialScreen({ goBack, channels, editingMaterial }: Props) {
  const isEditing = !!editingMaterial;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isDark = colors.isDark;
  const inputBorder = isDark ? '#3a3a3c' : '#e5e5ea';

  const [currentStep, setCurrentStep] = useState<Step>(isEditing ? 'details' : 'type');
  const [selectedType, setSelectedType] = useState<MaterialType | null>(editingMaterial?.materialType || null);
  const [selectedPricing, setSelectedPricing] = useState<'free' | 'paid' | null>(isEditing ? editingMaterial!.pricingType : null);

  /* ── Form state ── */
  const defaultLang = useMemo(() => {
    const langs = user?.languages;
    if (langs?.length) return typeof langs[0] === 'string' ? langs[0] : '';
    const obLangs = user?.onboardingData?.languages;
    if (obLangs?.length) {
      const first = obLangs[0];
      return typeof first === 'string' ? first : first?.name || first?.language || '';
    }
    return '';
  }, [user]);

  const [title, setTitle] = useState(editingMaterial?.title || '');
  const [description, setDescription] = useState(editingMaterial?.description || '');
  const [whyTakeThis, setWhyTakeThis] = useState(editingMaterial?.whyTakeThis || '');
  const [language, setLanguage] = useState(() => editingMaterial?.language || '');
  const [level, setLevel] = useState<string>(editingMaterial?.level || 'any');
  const [videoUrl, setVideoUrl] = useState(editingMaterial?.videoUrl || '');
  const [passage, setPassage] = useState(editingMaterial?.passage || '');
  const [audioUrl, setAudioUrl] = useState(editingMaterial?.audioUrl || '');
  const [price, setPrice] = useState(editingMaterial?.price || 5);
  const [topics, setTopics] = useState<string[]>(editingMaterial?.topics ? [...editingMaterial.topics] : []);
  const [topicInput, setTopicInput] = useState('');
  const [structuredTags, setStructuredTags] = useState<string[]>(editingMaterial?.structuredTags ? [...editingMaterial.structuredTags] : []);
  const [structuredTagInput, setStructuredTagInput] = useState('');
  const [detailsWizardIndex, setDetailsWizardIndex] = useState(0);
  const [titleTouched, setTitleTouched] = useState(false);
  const [languageTouched, setLanguageTouched] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [existingThumbnailUrl, setExistingThumbnailUrl] = useState<string | null>(editingMaterial?.thumbnailUrl || null);
  const [showVideoPolicy, setShowVideoPolicy] = useState(true);

  const displayThumbnailUri = thumbnailUri || existingThumbnailUrl;

  /* ── Quiz state ── */
  const [quiz, setQuiz] = useState<QuizQuestion[]>(editingMaterial?.quiz?.length ? editingMaterial.quiz as unknown as QuizQuestion[] : []);

  useEffect(() => {
    if (defaultLang && !language) setLanguage(defaultLang);
  }, [defaultLang]);

  /* ── Preview / submit state ── */
  const [contentAttested, setContentAttested] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftMaterialId, setDraftMaterialId] = useState<string | null>(editingMaterial?._id || null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  /** In-place edit save (footer / nav) — separate so primary CTA does not show publish spinner. */
  const [isPersistingEdit, setIsPersistingEdit] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();

  /* ── FLIP animation ── */
  const [fly, setFly] = useState<FlyState | null>(null);
  const flyProgress = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(1)).current;
  const chipRef = useRef<View | null>(null);

  const isFlying = fly !== null;
  const dstReady = !!fly?.dst;

  const stepIndex = STEP_ORDER.indexOf(currentStep);

  const detailsWizardSteps = useMemo((): DetailsWizardStepId[] => {
    if (!selectedType || !selectedPricing) return [];
    return buildDetailsWizardSteps(selectedType, selectedPricing);
  }, [selectedType, selectedPricing]);

  const detailsWizardStepId: DetailsWizardStepId =
    detailsWizardSteps[detailsWizardIndex] ?? 'title';

  const prevFlowStepRef = useRef<Step | null>(null);
  useEffect(() => {
    if (currentStep === 'details' && prevFlowStepRef.current === 'pricing') {
      setDetailsWizardIndex(0);
    }
    prevFlowStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    if (detailsWizardSteps.length === 0) return;
    if (detailsWizardIndex >= detailsWizardSteps.length) {
      setDetailsWizardIndex(detailsWizardSteps.length - 1);
    }
  }, [detailsWizardSteps.length, detailsWizardIndex]);

  useEffect(() => {
    if (currentStep !== 'details') return;
    (scrollRef.current as any)?.scrollTo?.({ y: 0, animated: true });
  }, [detailsWizardIndex, currentStep]);

  /** Quiz / preview reuse the same ScrollView — reset offset so each step opens at the top. */
  useLayoutEffect(() => {
    if (currentStep !== 'quiz' && currentStep !== 'preview') return;
    const scrollTop = () => {
      (scrollRef.current as any)?.scrollTo?.({ y: 0, animated: false });
    };
    scrollTop();
    const t = setTimeout(scrollTop, 0);
    return () => clearTimeout(t);
  }, [currentStep]);

  /**
   * Step count starts at “Name your material” (first details sub-step), not type/pricing.
   * Total = details substeps + quiz + preview.
   */
  const numberedMaterialStep = useMemo((): { current: number; total: number } | null => {
    if (currentStep === 'type' || currentStep === 'pricing') return null;
    if (!selectedType || !selectedPricing || detailsWizardSteps.length === 0) return null;

    const total = detailsWizardSteps.length + 2;
    if (currentStep === 'details') {
      return { current: detailsWizardIndex + 1, total };
    }
    if (currentStep === 'quiz') {
      return { current: detailsWizardSteps.length + 1, total };
    }
    if (currentStep === 'preview') {
      return { current: detailsWizardSteps.length + 2, total };
    }
    return null;
  }, [
    currentStep,
    detailsWizardIndex,
    detailsWizardSteps.length,
    selectedType,
    selectedPricing,
  ]);

  const progressWidth = numberedMaterialStep
    ? (numberedMaterialStep.current / numberedMaterialStep.total) * 100
    : 0;

  const hasVideoChannel = !!(
    (channels?.youtubeChannelName && channels?.youtubeVerified) ||
    (channels?.vimeoChannelName && channels?.vimeoVerified)
  );

  const navBackLabel = useMemo(() => {
    if (isEditing && currentStep === 'details' && detailsWizardIndex === 0) return t('CREATE_MATERIAL.NAV_MY_MATERIALS');
    if (stepIndex <= 0) return t('CREATE_MATERIAL.NAV_MY_MATERIALS');
    return t('CREATE_MATERIAL.NAV_BACK_SHORT');
  }, [stepIndex, isEditing, currentStep, detailsWizardIndex, t]);

  const handleNavBack = useCallback(() => {
    if (currentStep === 'details') {
      if (detailsWizardIndex > 0) {
        setDetailsWizardIndex(i => i - 1);
        return;
      }
      if (isEditing) {
        goBack();
        return;
      }
      setCurrentStep('pricing');
      return;
    }
    if (stepIndex <= 0) {
      goBack();
    } else {
      setCurrentStep(STEP_ORDER[stepIndex - 1]);
    }
  }, [currentStep, detailsWizardIndex, stepIndex, isEditing, goBack]);

  /* ── FLIP Step A: card pressed → measure source, switch step ── */
  const handleSelectType = useCallback((type: MaterialType, cardRef: View | null) => {
    const goPricing = () => {
      setSelectedType(type);
      setSelectedPricing(null);
      setCurrentStep('pricing');
    };
    if (!cardRef) {
      goPricing();
      return;
    }

    cardRef.measureInWindow((x, y, w, h) => {
      if (w === 0 && h === 0) {
        goPricing();
        return;
      }
      setSelectedType(type);
      setSelectedPricing(null);
      flyProgress.setValue(0);
      contentFade.setValue(0);
      setFly({ type, src: { x, y, w, h }, dst: null });
      setCurrentStep('pricing');
    });
  }, [flyProgress, contentFade]);

  /* ── FLIP Step B: chip destination measured ── */
  const handleChipMeasured = useCallback((x: number, y: number, w: number, h: number) => {
    if (w > 0 && h > 0) {
      setFly(prev => prev && !prev.dst ? { ...prev, dst: { x, y, w, h } } : prev);
    }
  }, []);

  /* ── FLIP Step C: animate when dest rect is ready ── */
  useEffect(() => {
    if (!fly?.dst) return;
    Animated.parallel([
      Animated.timing(flyProgress, {
        toValue: 1,
        duration: 420,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
        useNativeDriver: false,
      }),
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 320,
        delay: 140,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start(() => setFly(null));
  }, [dstReady]);

  const handleSelectPricing = useCallback((pricing: 'free' | 'paid') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPricing(pricing);
    if (pricing === 'free') setPrice(0);
  }, []);

  const handlePricingNext = useCallback(() => {
    if (selectedPricing === null) {
      Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
      return;
    }
    setCurrentStep('details');
  }, [selectedPricing, t]);

  const validateDetailsWizardStep = useCallback(
    (stepId: DetailsWizardStepId): boolean => {
      switch (stepId) {
        case 'title':
          if (!title.trim() || title.trim().length < 3) {
            setTitleTouched(true);
            Alert.alert('', t('CREATE_MATERIAL.FIELD_TITLE_ERROR'));
            return false;
          }
          return true;
        case 'languageLevel':
          if (!language) {
            setLanguageTouched(true);
            Alert.alert('', t('CREATE_MATERIAL.FIELD_LANGUAGE_ERROR'));
            return false;
          }
          return true;
        case 'videoUrl':
          if (selectedType === 'video_quiz' && !videoUrl.trim()) {
            Alert.alert('', t('CREATE_MATERIAL.FIELD_VIDEO_URL_ERROR'));
            return false;
          }
          return true;
        case 'readingPassage':
          if (selectedType === 'reading' && !passage.trim()) {
            Alert.alert('', t('CREATE_MATERIAL.TOAST_ENTER_PASSAGE'));
            return false;
          }
          return true;
        case 'listeningAudio':
          if (selectedType === 'listening' && !audioUrl.trim()) {
            Alert.alert('', t('CREATE_MATERIAL.FIELD_AUDIO_URL_ERROR'));
            return false;
          }
          return true;
        case 'thumbnail':
          if (!displayThumbnailUri?.trim()) {
            Alert.alert('', t('CREATE_MATERIAL.TOAST_ADD_COVER'));
            return false;
          }
          return true;
        case 'price':
          if (selectedPricing === 'paid' && (!Number.isFinite(price) || price < 1)) {
            Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
            return false;
          }
          return true;
        default:
          return true;
      }
    },
    [title, language, selectedType, videoUrl, passage, audioUrl, displayThumbnailUri, selectedPricing, price, t],
  );

  const isCurrentDetailsStepValid = useMemo(() => {
    const id = detailsWizardStepId;
    switch (id) {
      case 'title':
        return title.trim().length >= 3;
      case 'languageLevel':
        return !!language;
      case 'videoUrl':
        return selectedType !== 'video_quiz' || !!videoUrl.trim();
      case 'readingPassage':
        return selectedType !== 'reading' || !!passage.trim();
      case 'listeningAudio':
        return selectedType !== 'listening' || !!audioUrl.trim();
      case 'thumbnail':
        return !!displayThumbnailUri?.trim();
      case 'price':
        return selectedPricing !== 'paid' || (Number.isFinite(price) && price >= 1);
      default:
        return true;
    }
  }, [detailsWizardStepId, title, language, selectedType, videoUrl, passage, audioUrl, displayThumbnailUri, selectedPricing, price]);

  const handleGoToQuiz = useCallback(() => {
    if (!validateDetailsWizardStep('title')) return;
    if (!validateDetailsWizardStep('languageLevel')) return;
    if (!validateDetailsWizardStep('videoUrl')) return;
    if (!validateDetailsWizardStep('readingPassage')) return;
    if (!validateDetailsWizardStep('listeningAudio')) return;
    if (!validateDetailsWizardStep('thumbnail')) return;
    if (!validateDetailsWizardStep('price')) return;
    setCurrentStep('quiz');
  }, [validateDetailsWizardStep]);

  const handleDetailsWizardNext = useCallback(() => {
    if (!validateDetailsWizardStep(detailsWizardStepId)) return;
    if (detailsWizardIndex >= detailsWizardSteps.length - 1) {
      handleGoToQuiz();
      return;
    }
    setDetailsWizardIndex(i => i + 1);
  }, [detailsWizardStepId, detailsWizardIndex, detailsWizardSteps.length, validateDetailsWizardStep, handleGoToQuiz]);

  const addTopic = useCallback(() => {
    const trimmed = topicInput.trim();
    if (trimmed && !topics.includes(trimmed)) {
      setTopics(prev => [...prev, trimmed]);
      setTopicInput('');
    }
  }, [topicInput, topics]);

  const addStructuredTag = useCallback(() => {
    const trimmed = structuredTagInput.trim();
    if (trimmed && !structuredTags.includes(trimmed)) {
      setStructuredTags(prev => [...prev, trimmed]);
      setStructuredTagInput('');
    }
  }, [structuredTagInput, structuredTags]);

  const removeStructuredTag = useCallback((idx: number) => {
    setStructuredTags(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const removeTopic = useCallback((idx: number) => {
    setTopics(prev => prev.filter((_, i) => i !== idx));
  }, []);

  /* ── Cover image ── */
  const pickCoverImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to add a cover image.');
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
      setThumbnailUri(normalized.uri);
    } catch {
      setThumbnailUri(rawUri);
    }
  }, []);

  /* ── Quiz helpers ── */
  const addQuestion = useCallback((type: QuestionType) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuiz(prev => [...prev, createQuestion(type)]);
    setTimeout(() => (scrollRef.current as any)?.scrollToEnd?.({ animated: true }), 150);
  }, []);

  const removeQuestion = useCallback((idx: number) => {
    setQuiz(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateQuestion = useCallback((idx: number, patch: Partial<QuizQuestion>) => {
    setQuiz(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }, []);

  /* ── Go to preview (validates quiz) ── */
  const handleGoToPreview = useCallback(() => {
    if (quiz.length === 0) {
      Alert.alert('', 'Add at least one question to continue.');
      return;
    }
    for (let i = 0; i < quiz.length; i++) {
      const q = quiz[i];
      if (!q.question.trim()) {
        Alert.alert('', `Question ${i + 1} is missing its question text.`);
        return;
      }
      if (q.type === 'multiple_choice') {
        const hasCorrect = q.options?.some(o => o.isCorrect && o.text.trim());
        if (!hasCorrect) {
          Alert.alert('', `Question ${i + 1}: mark a correct answer with text.`);
          return;
        }
      }
      if (q.type === 'fill_blank') {
        const hasAnswer = q.acceptedAnswers?.some(a => a.trim());
        if (!hasAnswer) {
          Alert.alert('', `Question ${i + 1}: add at least one accepted answer.`);
          return;
        }
      }
      if (q.type === 'ordering') {
        const filled = q.correctOrder?.filter(s => s.trim()).length || 0;
        if (filled < 2) {
          Alert.alert('', `Question ${i + 1}: add at least 2 ordering items.`);
          return;
        }
      }
    }
    setCurrentStep('preview');
  }, [quiz]);

  /* ── Submit / Publish ── */
  const handleSubmit = useCallback(async () => {
    if (!contentAttested) return;
    if (!thumbnailUri?.trim() && !existingThumbnailUrl) {
      Alert.alert('', t('CREATE_MATERIAL.TOAST_ADD_COVER'));
      return;
    }
    setIsSubmitting(true);
    try {
      let thumbnailUrl: string | undefined;
      if (thumbnailUri?.trim()) {
        try {
          thumbnailUrl = await materialService.uploadThumbnail(thumbnailUri);
        } catch {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_UPLOAD_FAILED'));
          setIsSubmitting(false);
          return;
        }
      }
      if (!thumbnailUrl) thumbnailUrl = existingThumbnailUrl || undefined;

      const quizPayload = buildQuizPayloadForApi(quiz);

      const payload: Record<string, any> = {
        materialType: selectedType!,
        title: title.trim(),
        description: description.trim() || '',
        whyTakeThis: whyTakeThis.trim() || '',
        language,
        level: level || 'any',
        pricingType: selectedPricing!,
        price: selectedPricing === 'paid' ? price : 0,
        quiz: quizPayload,
        contentAttested: true,
      };

      if (selectedType === 'video_quiz') payload.videoUrl = videoUrl.trim();
      if (selectedType === 'reading') payload.passage = passage.trim();
      if (selectedType === 'listening') payload.audioUrl = audioUrl.trim();
      if (topics.length > 0) payload.topics = topics;
      if (structuredTags.length > 0) payload.structuredTags = structuredTags;
      if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
      payload.status = 'published';

      if (draftMaterialId) {
        await materialService.updateMaterial(draftMaterialId, payload);
      } else {
        await materialService.createMaterial(payload);
      }
      const alertTitle = isEditing ? 'Updated!' : 'Published!';
      const alertMsg = isEditing ? 'Your material has been updated.' : 'Your material is now live.';
      Alert.alert(alertTitle, alertMsg, [
        { text: 'OK', onPress: goBack },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to publish material.');
    } finally {
      setIsSubmitting(false);
    }
  }, [contentAttested, thumbnailUri, existingThumbnailUrl, isEditing, selectedType, title, description, whyTakeThis, language, level,
      videoUrl, passage, audioUrl, selectedPricing, price, quiz, topics, structuredTags, draftMaterialId,
      goBack, t]);

  const canSaveDraft = !!selectedType && !!selectedPricing;
  const showSaveDraft = !isEditing && canSaveDraft;

  const handleSaveDraft = useCallback(async () => {
    if (!selectedType || !selectedPricing) return;
    setIsSavingDraft(true);
    try {
      let thumbnailUrl: string | undefined;
      if (thumbnailUri?.trim()) {
        try {
          thumbnailUrl = await materialService.uploadThumbnail(thumbnailUri);
        } catch {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_UPLOAD_FAILED'));
          setIsSavingDraft(false);
          return;
        }
      }
      if (!thumbnailUrl) thumbnailUrl = existingThumbnailUrl || undefined;

      const draftTitle = title.trim() || t('CREATE_MATERIAL.DRAFT_UNTITLED');
      const draftLang = language.trim() || defaultLang.trim() || 'English';

      const basePayload: Record<string, any> = {
        title: draftTitle,
        description: description.trim() || '',
        whyTakeThis: whyTakeThis.trim() || '',
        language: draftLang,
        level: level || 'any',
        pricingType: selectedPricing,
        price: selectedPricing === 'paid' ? price : 0,
        status: 'draft',
      };

      if (selectedType === 'video_quiz') basePayload.videoUrl = videoUrl.trim() || 'https://placeholder.draft';
      if (selectedType === 'reading') basePayload.passage = passage.trim() || ' ';
      if (selectedType === 'listening') basePayload.audioUrl = audioUrl.trim() || 'https://placeholder.draft';
      if (topics.length > 0) basePayload.topics = topics;
      if (structuredTags.length > 0) basePayload.structuredTags = structuredTags;
      if (thumbnailUrl) basePayload.thumbnailUrl = thumbnailUrl;

      const quizComplete = isQuizPayloadCompleteForApi(quiz);
      const quizPayload = quizComplete ? buildQuizPayloadForApi(quiz) : [];

      if (draftMaterialId) {
        const putPayload: Record<string, any> = { ...basePayload };
        if (quizComplete) putPayload.quiz = quizPayload;
        await materialService.updateMaterial(draftMaterialId, putPayload);
      } else {
        const m = await materialService.createMaterial({
          ...basePayload,
          materialType: selectedType,
          quiz: quizPayload,
        });
        setDraftMaterialId(m._id);
      }

      return true;
    } catch (err: any) {
      Alert.alert(
        t('CREATE_MATERIAL.DRAFT_SAVE_FAILED_TITLE'),
        err?.message || t('CREATE_MATERIAL.DRAFT_SAVE_FAILED_MSG'),
      );
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  }, [
    selectedType,
    selectedPricing,
    thumbnailUri,
    existingThumbnailUrl,
    title,
    description,
    whyTakeThis,
    language,
    defaultLang,
    level,
    price,
    videoUrl,
    passage,
    audioUrl,
    topics,
    structuredTags,
    quiz,
    draftMaterialId,
    t,
  ]);

  /** Persist current material while editing; preserves draft vs published status. */
  const persistMaterialEdit = useCallback(async (): Promise<boolean> => {
    if (!isEditing || !editingMaterial?._id) return false;
    if (!selectedType || !selectedPricing) {
      Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
      return false;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsPersistingEdit(true);
    try {
      let thumbnailUrl: string | undefined;
      if (thumbnailUri?.trim()) {
        try {
          thumbnailUrl = await materialService.uploadThumbnail(thumbnailUri);
        } catch {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_UPLOAD_FAILED'));
          setIsPersistingEdit(false);
          return false;
        }
      }
      if (!thumbnailUrl) thumbnailUrl = existingThumbnailUrl || undefined;

      const preservedStatus = editingMaterial.status === 'published' ? 'published' : 'draft';
      const draftTitle = title.trim() || t('CREATE_MATERIAL.DRAFT_UNTITLED');
      const draftLang = language.trim() || defaultLang.trim() || 'English';

      const basePayload: Record<string, any> = {
        materialType: selectedType,
        title: draftTitle,
        description: description.trim() || '',
        whyTakeThis: whyTakeThis.trim() || '',
        language: draftLang,
        level: level || 'any',
        pricingType: selectedPricing,
        price: selectedPricing === 'paid' ? price : 0,
        status: preservedStatus,
      };

      if (selectedType === 'video_quiz') {
        const v = videoUrl.trim();
        basePayload.videoUrl =
          preservedStatus === 'published'
            ? (v || editingMaterial.videoUrl || '')
            : (v || 'https://placeholder.draft');
      }
      if (selectedType === 'reading') {
        const p = passage.trim();
        basePayload.passage = preservedStatus === 'published' ? (p || editingMaterial.passage || ' ') : (p || ' ');
      }
      if (selectedType === 'listening') {
        const a = audioUrl.trim();
        basePayload.audioUrl =
          preservedStatus === 'published'
            ? (a || editingMaterial.audioUrl || '')
            : (a || 'https://placeholder.draft');
      }
      if (topics.length > 0) basePayload.topics = topics;
      if (structuredTags.length > 0) basePayload.structuredTags = structuredTags;
      if (thumbnailUrl) basePayload.thumbnailUrl = thumbnailUrl;

      const quizComplete = isQuizPayloadCompleteForApi(quiz);
      const putPayload: Record<string, any> = { ...basePayload };
      if (quizComplete) putPayload.quiz = buildQuizPayloadForApi(quiz);

      await materialService.updateMaterial(editingMaterial._id, putPayload);
      if (thumbnailUrl && thumbnailUri?.trim()) {
        setExistingThumbnailUrl(thumbnailUrl);
        setThumbnailUri(null);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (err: any) {
      Alert.alert(
        t('CREATE_MATERIAL.DRAFT_SAVE_FAILED_TITLE'),
        err?.message || t('CREATE_MATERIAL.DRAFT_SAVE_FAILED_MSG'),
      );
      return false;
    } finally {
      setIsPersistingEdit(false);
    }
  }, [
    isEditing,
    editingMaterial,
    selectedType,
    selectedPricing,
    thumbnailUri,
    existingThumbnailUrl,
    title,
    description,
    whyTakeThis,
    language,
    defaultLang,
    level,
    price,
    videoUrl,
    passage,
    audioUrl,
    topics,
    structuredTags,
    quiz,
    t,
  ]);

  const handleFooterSaveInPlace = useCallback(async () => {
    const ok = await persistMaterialEdit();
    if (ok) {
      Alert.alert('', t('CREATE_MATERIAL.SAVED_TOAST'), [{ text: t('COMMON.OK') }]);
    }
  }, [persistMaterialEdit, t]);

  const handleSaveAndExit = useCallback(async () => {
    if (isEditing) {
      const ok = await persistMaterialEdit();
      if (ok) goBack();
    } else {
      const saved = await handleSaveDraft();
      if (saved) goBack();
    }
  }, [isEditing, persistMaterialEdit, handleSaveDraft, goBack]);

  const getTypeLabel = (type: MaterialType) => {
    switch (type) {
      case 'video_quiz': return t('CREATE_MATERIAL.TYPE_VIDEO_QUIZ');
      case 'reading': return t('CREATE_MATERIAL.TYPE_READING');
      case 'listening': return t('CREATE_MATERIAL.TYPE_LISTENING');
    }
  };

  /* ── Flying clone interpolations ── */
  /* Match web create-material chip: same gray on pricing as selected-type pill */
  const chipBg = isDark ? '#2c2c2e' : '#f5f5f5';

  const cloneStyle = fly ? {
    top: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 1], outputRange: [fly.src.y, fly.dst.y] })
      : fly.src.y,
    left: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 1], outputRange: [fly.src.x, fly.dst.x] })
      : fly.src.x,
    width: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 1], outputRange: [fly.src.w, fly.dst.w] })
      : fly.src.w,
    height: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 1], outputRange: [fly.src.h, fly.dst.h] })
      : fly.src.h,
    borderRadius: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 1], outputRange: [16, 28] })
      : 16,
    backgroundColor: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 1], outputRange: [colors.card, chipBg] })
      : colors.card,
    borderColor: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [colors.border, colors.border, chipBg] })
      : colors.border,
    shadowOpacity: fly.dst
      ? flyProgress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [isDark ? 0 : 0.1, isDark ? 0 : 0.04, 0] })
      : (isDark ? 0 : 0.1),
  } : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Nav Bar */}
        <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleNavBack} style={styles.navBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.navBackLabel, { color: colors.text }]} numberOfLines={1}>
              {navBackLabel}
            </Text>
          </TouchableOpacity>
          {numberedMaterialStep != null && (
            <Text
              style={[styles.navStepCount, { color: colors.textSecondary }]}
              accessibilityRole="text"
              accessibilityLabel={t('ONBOARDING.STEP_INDICATOR', {
                current: numberedMaterialStep.current,
                total: numberedMaterialStep.total,
              })}
            >
              {t('CREATE_MATERIAL.STEP_OF', {
                current: numberedMaterialStep.current,
                total: numberedMaterialStep.total,
              })}
            </Text>
          )}
          {(showSaveDraft || isEditing) && (
            <TouchableOpacity
              style={styles.navSaveExit}
              activeOpacity={0.7}
              onPress={handleSaveAndExit}
              disabled={
                !canSaveDraft ||
                (isEditing ? isPersistingEdit : isSavingDraft)
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isEditing ? (
                isPersistingEdit ? (
                  <ActivityIndicator size="small" color={SETUP_AVAILABILITY_BLUE} />
                ) : (
                  <Text style={[styles.navSaveExitText, { color: SETUP_AVAILABILITY_BLUE }]} numberOfLines={1}>
                    {t('CREATE_MATERIAL.SAVE_EXIT')}
                  </Text>
                )
              ) : isSavingDraft ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Text style={[styles.navSaveExitText, { color: colors.textSecondary }]}>
                  {t('CREATE_MATERIAL.SAVE_EXIT')}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {numberedMaterialStep != null && (
          <View style={styles.progressSection}>
            <View style={[styles.progressTrack, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
              <View style={[styles.progressFill, { width: `${progressWidth}%`, backgroundColor: isDark ? '#fff' : '#222' }]} />
            </View>
          </View>
        )}

        {/* Step Content + Footer */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={insets.bottom}
        >
          <Reanimated.ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              (currentStep === 'pricing' || (currentStep === 'details' && !keyboardVisible)) && {
                paddingBottom: Math.max(insets.bottom, 20) + 100,
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {currentStep === 'type' && (
              <View style={[styles.detailsStepMaxWidth, styles.headAlignedStep]}>
                <StepType
                  hasVideoChannel={hasVideoChannel}
                  onSelect={handleSelectType}
                  colors={colors}
                  t={t}
                />
              </View>
            )}

            {currentStep === 'pricing' && selectedType && (
              <View style={[styles.detailsStepMaxWidth, styles.pricingShareWrap]}>
                <StepPricing
                  selectedType={selectedType}
                  selectedPricing={selectedPricing}
                  getTypeLabel={getTypeLabel}
                  onSelect={handleSelectPricing}
                  chipRef={chipRef}
                  chipHidden={isFlying}
                  contentFade={isFlying ? contentFade : undefined}
                  onChipLayout={() => {
                    setTimeout(() => {
                      chipRef.current?.measureInWindow((x, y, w, h) => {
                        handleChipMeasured(x, y, w, h);
                      });
                    }, 60);
                  }}
                  colors={colors}
                  t={t}
                />
              </View>
            )}

            {currentStep === 'details' && selectedType && selectedPricing && (
              <View style={[styles.detailsStepMaxWidth, styles.headAlignedStepBelowProgress]}>
              {isEditing && (
                <View style={styles.editBadgeRow}>
                  <View style={[styles.editBadge, { backgroundColor: isDark ? '#b45309' : '#f59e0b' }]}>
                    <Ionicons name="create-outline" size={13} color="#fff" />
                    <Text style={styles.editBadgeText}>{t('CREATE_MATERIAL.EDITING_LABEL')}</Text>
                  </View>
                </View>
              )}
              <StepDetails
                wizardStepId={detailsWizardStepId}
                selectedType={selectedType}
                selectedPricing={selectedPricing}
                title={title} setTitle={setTitle}
                description={description} setDescription={setDescription}
                whyTakeThis={whyTakeThis} setWhyTakeThis={setWhyTakeThis}
                language={language} setLanguage={setLanguage}
                level={level} setLevel={setLevel}
                videoUrl={videoUrl} setVideoUrl={setVideoUrl}
                passage={passage} setPassage={setPassage}
                audioUrl={audioUrl} setAudioUrl={setAudioUrl}
                price={price} setPrice={setPrice}
                topics={topics} topicInput={topicInput} setTopicInput={setTopicInput}
                addTopic={addTopic} removeTopic={removeTopic}
                structuredTags={structuredTags}
                structuredTagInput={structuredTagInput} setStructuredTagInput={setStructuredTagInput}
                addStructuredTag={addStructuredTag} removeStructuredTag={removeStructuredTag}
                titleTouched={titleTouched} setTitleTouched={setTitleTouched}
                languageTouched={languageTouched} setLanguageTouched={setLanguageTouched}
                showLanguagePicker={showLanguagePicker} setShowLanguagePicker={setShowLanguagePicker}
                showLevelPicker={showLevelPicker} setShowLevelPicker={setShowLevelPicker}
                thumbnailUri={displayThumbnailUri} pickCoverImage={pickCoverImage} removeCover={() => { setThumbnailUri(null); setExistingThumbnailUrl(null); }}
                showVideoPolicy={showVideoPolicy} dismissVideoPolicy={() => setShowVideoPolicy(false)}
                colors={colors}
                t={t}
              />
              </View>
            )}

            {currentStep === 'quiz' && (
              <View style={[styles.detailsStepMaxWidth, styles.headAlignedStepBelowProgress]}>
                <StepQuiz
                  quiz={quiz}
                  addQuestion={addQuestion}
                  removeQuestion={removeQuestion}
                  updateQuestion={updateQuestion}
                  scrollRef={scrollRef}
                  colors={colors}
                  t={t}
                />
              </View>
            )}

            {currentStep === 'preview' && selectedType && (
              <View style={[styles.detailsStepMaxWidth, styles.headAlignedStepBelowProgress]}>
              <StepPreview
                selectedType={selectedType}
                selectedPricing={selectedPricing!}
                title={title}
                description={description}
                whyTakeThis={whyTakeThis}
                language={language}
                level={level}
                passage={passage}
                videoUrl={videoUrl}
                price={price}
                quiz={quiz}
                thumbnailUri={displayThumbnailUri}
                getTypeLabel={getTypeLabel}
                colors={colors}
                t={t}
              />
              </View>
            )}
          </Reanimated.ScrollView>

          {/* Keyboard toolbar — sits above keyboard, replaces footer when typing */}
          {keyboardVisible && (
            <View style={[styles.kbToolbar, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2', borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)' }]}>
              <View style={styles.kbToolbarArrows}>
                <TouchableOpacity style={styles.kbArrowBtn} activeOpacity={0.6} onPress={() => {}}>
                  <Ionicons name="chevron-up" size={22} color={isDark ? '#aaa' : '#666'} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.kbArrowBtn} activeOpacity={0.6} onPress={() => {}}>
                  <Ionicons name="chevron-down" size={22} color={isDark ? '#aaa' : '#666'} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.kbDoneBtn, { backgroundColor: isDark ? '#fff' : '#111' }]}
                activeOpacity={0.8}
                onPress={() => Keyboard.dismiss()}
              >
                <Text style={[styles.kbDoneText, { color: isDark ? '#000' : '#fff' }]}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Footer buttons per step */}
          {!keyboardVisible && currentStep === 'pricing' && (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.footerWizardRow}>
                <TouchableOpacity
                  style={[styles.wizardNextBtn, {
                    flex: 1,
                    backgroundColor: selectedPricing !== null ? (isDark ? '#fff' : '#111') : (isDark ? '#3a3a3c' : '#d1d1d6'),
                  }]}
                  activeOpacity={selectedPricing !== null ? 0.85 : 1}
                  onPress={handlePricingNext}
                  disabled={selectedPricing === null}
                >
                  <Text style={[styles.wizardNextBtnText, {
                    color: selectedPricing !== null ? (isDark ? '#000' : '#fff') : '#8e8e93',
                  }]}>
                    {t('CREATE_MATERIAL.DETAILS_WIZ_NEXT')}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={selectedPricing !== null ? (isDark ? '#000' : '#fff') : '#8e8e93'}
                  />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!keyboardVisible && currentStep === 'details' && (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.footerWizardRow}>
                {showSaveDraft && detailsWizardIndex > 0 && (
                  <TouchableOpacity
                    style={[styles.wizardBackBtn, { borderColor: colors.border }]}
                    activeOpacity={0.75}
                    onPress={async () => {
                      const saved = await handleSaveDraft();
                      if (saved) {
                        Alert.alert(
                          t('CREATE_MATERIAL.DRAFT_SAVED'),
                          t('CREATE_MATERIAL.DRAFT_SAVED_MSG'),
                          [{ text: t('CREATE_MATERIAL.DRAFT_SAVED_OK') }],
                        );
                      }
                    }}
                    disabled={isSavingDraft || isPersistingEdit}
                  >
                    {isSavingDraft ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={[styles.wizardBackBtnText, { color: colors.text }]}>
                        {t('CREATE_MATERIAL.SAVE_DRAFT')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                {isEditing && (
                  <TouchableOpacity
                    style={[styles.wizardBackBtn, { borderColor: colors.border }]}
                    activeOpacity={0.75}
                    onPress={handleFooterSaveInPlace}
                    disabled={isSavingDraft || isPersistingEdit || !canSaveDraft}
                  >
                    {isPersistingEdit ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={[styles.wizardBackBtnText, { color: colors.text }]}>
                        {t('COMMON.SAVE')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.wizardNextBtn, {
                    flex: (detailsWizardIndex > 0 && showSaveDraft) || isEditing ? 1.25 : 1,
                    backgroundColor: isCurrentDetailsStepValid ? (isDark ? '#fff' : '#111') : (isDark ? '#3a3a3c' : '#d1d1d6'),
                  }]}
                  activeOpacity={isCurrentDetailsStepValid ? 0.85 : 1}
                  onPress={handleDetailsWizardNext}
                  disabled={!isCurrentDetailsStepValid || isPersistingEdit}
                >
                  <Text style={[styles.wizardNextBtnText, {
                    color: isCurrentDetailsStepValid ? (isDark ? '#000' : '#fff') : '#8e8e93',
                  }]}>
                    {detailsWizardIndex >= detailsWizardSteps.length - 1
                      ? t('CREATE_MATERIAL.CONTINUE_TO_QUIZ')
                      : t('CREATE_MATERIAL.DETAILS_WIZ_NEXT')}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={isCurrentDetailsStepValid ? (isDark ? '#000' : '#fff') : '#8e8e93'}
                  />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {currentStep === 'quiz' && (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              <View style={styles.footerWizardRow}>
                {isEditing && (
                  <TouchableOpacity
                    style={[styles.wizardBackBtn, { borderColor: colors.border }]}
                    activeOpacity={0.75}
                    onPress={handleFooterSaveInPlace}
                    disabled={isPersistingEdit || !canSaveDraft}
                  >
                    {isPersistingEdit ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={[styles.wizardBackBtnText, { color: colors.text }]}>
                        {t('COMMON.SAVE')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.continueBtn, {
                    flex: isEditing ? 1.25 : 1,
                    backgroundColor: quiz.length === 0 ? (isDark ? '#3a3a3c' : '#d1d1d6') : (isDark ? '#fff' : '#111'),
                  }]}
                  activeOpacity={quiz.length === 0 ? 1 : 0.85}
                  onPress={handleGoToPreview}
                  disabled={quiz.length === 0 || isPersistingEdit}
                >
                  <Text style={[styles.continueBtnText, {
                    color: quiz.length === 0 ? (isDark ? '#8e8e93' : '#8e8e93') : (isDark ? '#000' : '#fff'),
                  }]}>
                    {t('CREATE_MATERIAL.QUIZ_PREVIEW_BTN')}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={quiz.length === 0 ? '#8e8e93' : (isDark ? '#000' : '#fff')}
                  />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {currentStep === 'preview' && (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              <View style={styles.attestRow}>
                <TouchableOpacity
                  style={[styles.attestCheck, { borderColor: contentAttested ? (isDark ? '#fff' : '#111') : inputBorder, backgroundColor: contentAttested ? (isDark ? '#fff' : '#111') : 'transparent' }]}
                  onPress={() => setContentAttested(!contentAttested)}
                  activeOpacity={0.7}
                >
                  {contentAttested && <Ionicons name="checkmark" size={14} color={isDark ? '#000' : '#fff'} />}
                </TouchableOpacity>
                <Text style={[styles.attestLabel, { color: colors.textSecondary }]}>
                  {t('CREATE_MATERIAL.ATTEST_LABEL')}
                </Text>
              </View>
              <View style={styles.footerWizardRow}>
                {isEditing && (
                  <TouchableOpacity
                    style={[styles.wizardBackBtn, { borderColor: colors.border }]}
                    activeOpacity={0.75}
                    onPress={handleFooterSaveInPlace}
                    disabled={isPersistingEdit || isSubmitting || !canSaveDraft}
                  >
                    {isPersistingEdit ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={[styles.wizardBackBtnText, { color: colors.text }]}>
                        {t('COMMON.SAVE')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.continueBtn, {
                    flex: isEditing ? 1.25 : 1,
                    backgroundColor: (!contentAttested || isSubmitting || isPersistingEdit) ? (isDark ? '#3a3a3c' : '#d1d1d6') : (isDark ? '#fff' : '#111'),
                  }]}
                  activeOpacity={(!contentAttested || isSubmitting || isPersistingEdit) ? 1 : 0.85}
                  onPress={handleSubmit}
                  disabled={!contentAttested || isSubmitting || isPersistingEdit}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color={isDark ? '#000' : '#fff'} />
                  ) : (
                    <>
                      <Text style={[styles.continueBtnText, {
                        color: !contentAttested ? '#8e8e93' : (isDark ? '#000' : '#fff'),
                      }]}>
                        {isEditing ? t('CREATE_MATERIAL.SUBMIT_UPDATE') : t('CREATE_MATERIAL.SUBMIT_PUBLISH')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── FLIP flying clone ── */}
      {fly && cloneStyle && (
        <Animated.View
          pointerEvents="none"
          style={[styles.flyClone, cloneStyle]}
        >
          {fly.type === 'video_quiz' ? (
            <Image source={CREATE_MATERIAL_VIDEO_TYPE_IMG} style={styles.flyCloneTypeIcon} resizeMode="contain" />
          ) : fly.type === 'reading' ? (
            <Image source={CREATE_MATERIAL_READING_TYPE_IMG} style={styles.flyCloneTypeIcon} resizeMode="contain" />
          ) : (
            <Image source={CREATE_MATERIAL_LISTENING_TYPE_IMG} style={styles.flyCloneTypeIcon} resizeMode="contain" />
          )}
          <Text style={[styles.flyLabel, { color: colors.text }]} numberOfLines={1}>
            {getTypeLabel(fly.type)}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

/* ═══════════ Step 1: Material Type ═══════════ */

function StepType({ hasVideoChannel, onSelect, colors, t }: {
  hasVideoChannel: boolean;
  onSelect: (type: MaterialType, cardRef: View | null) => void;
  colors: any;
  t: any;
}) {
  const isDark = colors.isDark;
  const cardRefs = useRef<Record<string, any>>({});

  const types: { type: MaterialType; titleKey: string; descKey: string; locked?: boolean; lockedKey?: string }[] = [
    {
      type: 'video_quiz',
      titleKey: 'CREATE_MATERIAL.TYPE_VIDEO_QUIZ',
      descKey: 'CREATE_MATERIAL.TYPE_VIDEO_QUIZ_DESC',
      locked: !hasVideoChannel,
      lockedKey: 'CREATE_MATERIAL.TYPE_VIDEO_QUIZ_LOCKED',
    },
    {
      type: 'reading',
      titleKey: 'CREATE_MATERIAL.TYPE_READING',
      descKey: 'CREATE_MATERIAL.TYPE_READING_DESC',
    },
    {
      type: 'listening',
      titleKey: 'CREATE_MATERIAL.TYPE_LISTENING',
      descKey: 'CREATE_MATERIAL.TYPE_LISTENING_DESC',
    },
  ];

  return (
    <View>
      <Text style={[styles.stepHeading, { color: colors.text }]}>
        {t('CREATE_MATERIAL.TYPE_TITLE')}
      </Text>

      <View style={styles.typeCards}>
        {types.map(item => {
          const disabled = !!item.locked;
          const iconWrapBg =
            item.type === 'video_quiz'
              ? (isDark ? '#2a2a2e' : '#eceef4')
              : item.type === 'reading'
                ? (isDark ? 'rgba(10, 132, 255, 0.14)' : '#E8F4FF')
                : (isDark ? 'rgba(191, 90, 242, 0.14)' : '#F3E8FF');
          return (
            <TouchableOpacity
              key={item.type}
              ref={(ref: any) => { cardRefs.current[item.type] = ref; }}
              style={[
                styles.typeCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  ...(isDark ? cardShadowDark('subtle') : { shadowOpacity: 0.05 }),
                  opacity: disabled ? 0.45 : 1,
                },
              ]}
              activeOpacity={disabled ? 1 : 0.7}
              onPress={() => !disabled && onSelect(item.type, cardRefs.current[item.type])}
            >
              <View style={[styles.typeIconWrap, { backgroundColor: iconWrapBg }]}>
                {item.type === 'video_quiz' ? (
                  <Image source={CREATE_MATERIAL_VIDEO_TYPE_IMG} style={styles.typeIconRaster} resizeMode="contain" />
                ) : item.type === 'reading' ? (
                  <Image source={CREATE_MATERIAL_READING_TYPE_IMG} style={styles.typeIconRaster} resizeMode="contain" />
                ) : (
                  <Image source={CREATE_MATERIAL_LISTENING_TYPE_IMG} style={styles.typeIconRaster} resizeMode="contain" />
                )}
              </View>
              <View style={styles.typeTextWrap}>
                <Text style={[styles.typeTitle, { color: colors.text }]}>{t(item.titleKey)}</Text>
                {disabled && item.lockedKey ? (
                  <View style={styles.lockedRow}>
                    <Ionicons name="lock-closed-outline" size={12} color={colors.textTertiary} />
                    <Text style={[styles.typeDesc, { color: colors.textTertiary }]}>{t(item.lockedKey)}</Text>
                  </View>
                ) : (
                  <Text style={[styles.typeDesc, { color: colors.textSecondary }]}>{t(item.descKey)}</Text>
                )}
              </View>
              {!disabled && (
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* ═══════════ Step 2: Pricing ═══════════ */

function StepPricing({ selectedType, selectedPricing, getTypeLabel, onSelect, chipRef, chipHidden, contentFade, onChipLayout, colors, t }: {
  selectedType: MaterialType;
  selectedPricing: 'free' | 'paid' | null;
  getTypeLabel: (t: MaterialType) => string;
  onSelect: (pricing: 'free' | 'paid') => void;
  chipRef: React.MutableRefObject<View | null>;
  chipHidden: boolean;
  contentFade?: Animated.Value;
  onChipLayout: () => void;
  colors: any;
  t: any;
}) {
  const isDark = colors.isDark;

  const contentWrap = contentFade
    ? (children: React.ReactNode) => (
        <Animated.View style={{ opacity: contentFade }}>{children}</Animated.View>
      )
    : (children: React.ReactNode) => <>{children}</>;

  return (
    <View>
      <View
        ref={chipRef}
        collapsable={false}
        onLayout={onChipLayout}
        style={[styles.selectedChip, {
          backgroundColor: isDark ? '#2c2c2e' : '#f5f5f5',
          opacity: chipHidden ? 0 : 1,
          marginTop: PRICING_CHIP_MARGIN_TOP,
          marginBottom: PRICING_CHIP_TO_TITLE_GAP,
        }]}
      >
        {selectedType === 'video_quiz' ? (
          <Image source={CREATE_MATERIAL_VIDEO_TYPE_IMG} style={styles.selectedChipTypeIcon} resizeMode="contain" />
        ) : selectedType === 'reading' ? (
          <Image source={CREATE_MATERIAL_READING_TYPE_IMG} style={styles.selectedChipTypeIcon} resizeMode="contain" />
        ) : (
          <Image source={CREATE_MATERIAL_LISTENING_TYPE_IMG} style={styles.selectedChipTypeIcon} resizeMode="contain" />
        )}
        <Text style={[styles.selectedChipText, { color: colors.text }]}>{getTypeLabel(selectedType)}</Text>
      </View>

      {contentWrap(
        <>
          <Text style={[styles.detailsHeading, { color: colors.text }]}>
            {t('CREATE_MATERIAL.PRICING_TITLE')}
          </Text>
          <Text style={[styles.detailsSubheading, styles.pricingShareSubline, { color: colors.textSecondary }]}>
            {t('CREATE_MATERIAL.WIZ_SHARE_D')}
          </Text>

          <View style={[styles.shareTip, { backgroundColor: isDark ? '#1c2a3d' : '#F0F7FF', borderColor: isDark ? '#2a3d55' : '#D6E4FF' }]}>
            <Ionicons name="bulb-outline" size={20} color={isDark ? '#7AB3E0' : '#4B7FBF'} />
            <View style={styles.shareTipBody}>
              <Text style={[styles.shareTipTitle, { color: isDark ? '#f5f5f7' : '#222' }]}>
                {t('CREATE_MATERIAL.SHARE_TIP_TITLE')}
              </Text>
              <Text style={[styles.shareTipDesc, { color: isDark ? '#aeaeb2' : '#6a6a6a' }]}>
                {t('CREATE_MATERIAL.SHARE_TIP_DESC')}
              </Text>
            </View>
          </View>

          <View style={styles.pricingCards}>
            <TouchableOpacity
              style={[
                styles.pricingCard,
                {
                  backgroundColor: colors.card,
                  borderColor: selectedPricing === 'free' ? colors.text : colors.border,
                  borderWidth: selectedPricing === 'free' ? 2 : 1,
                  ...(isDark ? cardShadowDark('subtle') : { shadowOpacity: 0.05 }),
                },
              ]}
              activeOpacity={0.7}
              onPress={() => onSelect('free')}
            >
              <View style={[styles.pricingIconWrap, { backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : '#ECFDF5' }]}>
                <Ionicons name="gift-outline" size={24} color="#10b981" />
              </View>
              <Text style={[styles.pricingTitle, { color: colors.text }]}>{t('CREATE_MATERIAL.PRICING_FREE')}</Text>
              <Text style={[styles.pricingDesc, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.PRICING_FREE_DESC')}</Text>
              {selectedPricing === 'free' && (
                <Ionicons name="checkmark-circle" size={22} color="#10b981" style={styles.pricingCheck} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.pricingCard,
                {
                  backgroundColor: colors.card,
                  borderColor: selectedPricing === 'paid' ? colors.text : colors.border,
                  borderWidth: selectedPricing === 'paid' ? 2 : 1,
                  ...(isDark ? cardShadowDark('subtle') : { shadowOpacity: 0.05 }),
                },
              ]}
              activeOpacity={0.7}
              onPress={() => onSelect('paid')}
            >
              <View style={[styles.pricingIconWrap, { backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : '#EFF6FF' }]}>
                <Ionicons name="card-outline" size={24} color={isDark ? '#60a5fa' : '#2563eb'} />
              </View>
              <Text style={[styles.pricingTitle, { color: colors.text }]}>{t('CREATE_MATERIAL.PRICING_PAID')}</Text>
              <Text style={[styles.pricingDesc, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.PRICING_PAID_DESC')}</Text>
              {selectedPricing === 'paid' && (
                <Ionicons name="checkmark-circle" size={22} color={SETUP_AVAILABILITY_BLUE} style={styles.pricingCheck} />
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

/* ═══════════ Step 3: Details (sub-step wizard) ═══════════ */

function StepDetails({
  wizardStepId,
  selectedType,
  selectedPricing,
  title, setTitle,
  description, setDescription,
  whyTakeThis, setWhyTakeThis,
  language, setLanguage,
  level, setLevel,
  videoUrl, setVideoUrl,
  passage, setPassage,
  audioUrl, setAudioUrl,
  price, setPrice,
  topics, topicInput, setTopicInput, addTopic, removeTopic,
  structuredTags,
  structuredTagInput, setStructuredTagInput, addStructuredTag, removeStructuredTag,
  titleTouched, setTitleTouched,
  languageTouched, setLanguageTouched,
  showLanguagePicker, setShowLanguagePicker,
  showLevelPicker, setShowLevelPicker,
  thumbnailUri, pickCoverImage, removeCover,
  showVideoPolicy, dismissVideoPolicy,
  colors, t,
}: {
  wizardStepId: DetailsWizardStepId;
  selectedType: MaterialType;
  selectedPricing: 'free' | 'paid';
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  whyTakeThis: string; setWhyTakeThis: (v: string) => void;
  language: string; setLanguage: (v: string) => void;
  level: string; setLevel: (v: string) => void;
  videoUrl: string; setVideoUrl: (v: string) => void;
  passage: string; setPassage: (v: string) => void;
  audioUrl: string; setAudioUrl: (v: string) => void;
  price: number; setPrice: (v: number) => void;
  topics: string[]; topicInput: string; setTopicInput: (v: string) => void;
  addTopic: () => void; removeTopic: (i: number) => void;
  structuredTags: string[];
  structuredTagInput: string; setStructuredTagInput: (v: string) => void;
  addStructuredTag: () => void; removeStructuredTag: (i: number) => void;
  titleTouched: boolean; setTitleTouched: (v: boolean) => void;
  languageTouched: boolean; setLanguageTouched: (v: boolean) => void;
  showLanguagePicker: boolean; setShowLanguagePicker: (v: boolean) => void;
  showLevelPicker: boolean; setShowLevelPicker: (v: boolean) => void;
  thumbnailUri: string | null; pickCoverImage: () => void; removeCover: () => void;
  showVideoPolicy: boolean; dismissVideoPolicy: () => void;
  colors: any; t: any;
}) {
  const isDark = colors.isDark;
  const titleInvalid = titleTouched && title.trim().length < 3;
  const langInvalid = languageTouched && !language;
  const inputBg = isDark ? '#1c1c1e' : '#fff';
  const inputBorder = isDark ? '#3a3a3c' : '#e5e5ea';
  const errorBorder = '#ef4444';
  const levelLabel = LEVELS.find(l => l.value === level)?.labelKey;
  const { h, d } = detailsWizardCopyKeys(wizardStepId, selectedType);

  const header = (
    <>
      <Text style={[styles.detailsHeading, { color: colors.text }]}>{t(h)}</Text>
      <Text style={[styles.detailsSubheading, { color: colors.textSecondary }]}>{t(d)}</Text>
    </>
  );

  switch (wizardStepId) {
    case 'title':
      return (
        <View>
          {header}
          {showVideoPolicy && selectedType === 'video_quiz' && selectedPricing === 'paid' && (
            <View style={[styles.policyNotice, { backgroundColor: isDark ? '#1c2333' : '#eef4ff', borderColor: isDark ? '#2a3a5c' : '#c7d8f5' }]}>
              <Ionicons name="shield-checkmark-outline" size={24} color={isDark ? '#60a5fa' : '#3b82f6'} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.policyTitle, { color: colors.text }]}>{t('CREATE_MATERIAL.POLICY_TITLE')}</Text>
                <Text style={[styles.policyBody, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.POLICY_DESC_1')}</Text>
                <Text style={[styles.policyBody, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.POLICY_DESC_2')}</Text>
                <TouchableOpacity style={[styles.policyBtn, { backgroundColor: isDark ? '#2c2c2e' : '#fff' }]} onPress={dismissVideoPolicy} activeOpacity={0.7}>
                  <Text style={[styles.policyBtnText, { color: colors.text }]}>{t('CREATE_MATERIAL.POLICY_GOT_IT')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_TITLE')} <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, {
                backgroundColor: inputBg,
                borderColor: titleInvalid ? errorBorder : inputBorder,
                color: colors.text,
              }]}
              value={title}
              onChangeText={setTitle}
              onBlur={() => setTitleTouched(true)}
              placeholder={t('CREATE_MATERIAL.FIELD_TITLE_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              maxLength={120}
            />
            {titleInvalid && (
              <Text style={styles.fieldError}>{t('CREATE_MATERIAL.FIELD_TITLE_ERROR')}</Text>
            )}
          </View>
        </View>
      );
    case 'description':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.FIELD_DESCRIPTION')}</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea, {
                backgroundColor: inputBg,
                borderColor: inputBorder,
                color: colors.text,
              }]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('CREATE_MATERIAL.FIELD_DESCRIPTION_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </View>
      );
    case 'whyTake':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_WHY_TAKE')}{' '}
              <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                {t('CREATE_MATERIAL.FIELD_WHY_TAKE_HINT')}
              </Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea, {
                backgroundColor: inputBg,
                borderColor: inputBorder,
                color: colors.text,
              }]}
              value={whyTakeThis}
              onChangeText={setWhyTakeThis}
              placeholder={t('CREATE_MATERIAL.FIELD_WHY_TAKE_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              maxLength={100}
            />
            {whyTakeThis.length > 0 && (
              <Text style={[styles.charCount, { color: colors.textTertiary }]}>{whyTakeThis.length}/100</Text>
            )}
          </View>
        </View>
      );
    case 'languageLevel':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_LANGUAGE')} <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TouchableOpacity
              style={[styles.fieldSelect, {
                backgroundColor: inputBg,
                borderColor: langInvalid ? errorBorder : inputBorder,
              }]}
              activeOpacity={0.7}
              onPress={() => setShowLanguagePicker(!showLanguagePicker)}
            >
              <Text style={[styles.fieldSelectText, { color: language ? colors.text : colors.textTertiary }]}>
                {language || t('CREATE_MATERIAL.FIELD_LANGUAGE_PLACEHOLDER')}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            {langInvalid && (
              <Text style={styles.fieldError}>{t('CREATE_MATERIAL.FIELD_LANGUAGE_ERROR')}</Text>
            )}
            {showLanguagePicker && (
              <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: inputBorder }]}>
                <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {LANGUAGES.map(lang => (
                    <TouchableOpacity
                      key={lang}
                      style={[styles.pickerItem, language === lang && { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}
                      onPress={() => { setLanguage(lang); setShowLanguagePicker(false); setLanguageTouched(true); }}
                    >
                      <Text style={[styles.pickerItemText, { color: colors.text }]}>{lang}</Text>
                      {language === lang && <Ionicons name="checkmark" size={18} color={isDark ? '#fff' : '#222'} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.FIELD_LEVEL')}</Text>
            <TouchableOpacity
              style={[styles.fieldSelect, { backgroundColor: inputBg, borderColor: inputBorder }]}
              activeOpacity={0.7}
              onPress={() => setShowLevelPicker(!showLevelPicker)}
            >
              <Text style={[styles.fieldSelectText, { color: colors.text }]}>
                {levelLabel ? t(levelLabel) : t('CREATE_MATERIAL.LEVEL_ALL')}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            {showLevelPicker && (
              <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: inputBorder }]}>
                {LEVELS.map(lvl => (
                  <TouchableOpacity
                    key={lvl.value}
                    style={[styles.pickerItem, level === lvl.value && { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}
                    onPress={() => { setLevel(lvl.value); setShowLevelPicker(false); }}
                  >
                    <Text style={[styles.pickerItemText, { color: colors.text }]}>{t(lvl.labelKey)}</Text>
                    {level === lvl.value && <Ionicons name="checkmark" size={18} color={isDark ? '#fff' : '#222'} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>
      );
    case 'tags':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <View style={styles.topicInputRow}>
              <TextInput
                style={[styles.fieldInput, { flex: 1, backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
                value={structuredTagInput}
                onChangeText={setStructuredTagInput}
                placeholder={t('CREATE_MATERIAL.DETAILS_WIZ_TAGS_PLACEHOLDER')}
                placeholderTextColor={colors.textTertiary}
                onSubmitEditing={addStructuredTag}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.wizardChipAddBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}
                onPress={addStructuredTag}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{t('CREATE_MATERIAL.DETAILS_WIZ_ADD_TAG')}</Text>
              </TouchableOpacity>
            </View>
            {structuredTags.length > 0 && (
              <View style={styles.topicChips}>
                {structuredTags.map((tag, i) => (
                  <View key={`${tag}-${i}`} style={[styles.topicChip, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                    <Text style={[styles.topicChipText, { color: colors.text }]}>{tag}</Text>
                    <TouchableOpacity onPress={() => removeStructuredTag(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={14} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      );
    case 'customTopics':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <View style={styles.topicInputRow}>
              <TextInput
                style={[styles.fieldInput, { flex: 1, backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
                value={topicInput}
                onChangeText={setTopicInput}
                placeholder={t('CREATE_MATERIAL.DETAILS_WIZ_TOPICS_PLACEHOLDER')}
                placeholderTextColor={colors.textTertiary}
                onSubmitEditing={addTopic}
                returnKeyType="done"
              />
            </View>
            {topics.length > 0 && (
              <View style={styles.topicChips}>
                {topics.map((topic, i) => (
                  <View key={topic} style={[styles.topicChip, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                    <Text style={[styles.topicChipText, { color: colors.text }]}>{topic}</Text>
                    <TouchableOpacity onPress={() => removeTopic(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={14} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      );
    case 'thumbnail':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_COVER_IMAGE')}{' '}
              <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.FIELD_COVER_REQUIRED')}</Text>
            </Text>
            {thumbnailUri ? (
              <View style={[styles.coverPreview, { borderColor: inputBorder }]}>
                <Image source={{ uri: thumbnailUri }} style={styles.coverImage} />
                <TouchableOpacity style={styles.coverRemove} onPress={removeCover} activeOpacity={0.7}>
                  <Ionicons name="close-circle" size={26} color="rgba(0,0,0,0.6)" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.coverPicker, { backgroundColor: isDark ? '#1c1c1e' : '#fafafa', borderColor: inputBorder }]}
                onPress={pickCoverImage}
                activeOpacity={0.7}
              >
                <Ionicons name="image-outline" size={32} color={colors.textTertiary} />
                <Text style={[styles.coverPickerLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.FIELD_COVER_ADD')}</Text>
                <Text style={[styles.coverPickerHint, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.FIELD_COVER_HINT')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    case 'videoUrl':
      return (
        <View>
          {header}
          <View style={[styles.proTip, { backgroundColor: isDark ? '#1c1c2e' : '#f0f0ff', borderColor: isDark ? '#2a2a4c' : '#ddddf5' }]}>
            <View style={styles.proTipIcon}>
              <Text style={{ fontSize: 22 }}>🐦</Text>
            </View>
            <Text style={[styles.proTipText, { color: colors.textSecondary }]}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{t('CREATE_MATERIAL.PRO_TIP')} </Text>
              {t('CREATE_MATERIAL.PRO_TIP_VIDEO')}
            </Text>
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_VIDEO_URL')} <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, { backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
              value={videoUrl}
              onChangeText={setVideoUrl}
              placeholder={t('CREATE_MATERIAL.FIELD_VIDEO_URL_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
      );
    case 'readingPassage':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_READING_PASSAGE')} <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldPassage, { backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
              value={passage}
              onChangeText={setPassage}
              placeholder={t('CREATE_MATERIAL.FIELD_READING_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
            />
          </View>
        </View>
      );
    case 'listeningAudio':
      return (
        <View>
          {header}
          <View style={[styles.proTip, { backgroundColor: isDark ? '#1c1c2e' : '#f0f0ff', borderColor: isDark ? '#2a2a4c' : '#ddddf5' }]}>
            <View style={styles.proTipIcon}>
              <Text style={{ fontSize: 22 }}>🐦</Text>
            </View>
            <Text style={[styles.proTipText, { color: colors.textSecondary }]}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{t('CREATE_MATERIAL.PRO_TIP')} </Text>
              {t('CREATE_MATERIAL.PRO_TIP_AUDIO')}
            </Text>
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {t('CREATE_MATERIAL.FIELD_AUDIO_URL')} <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, { backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
              value={audioUrl}
              onChangeText={setAudioUrl}
              placeholder={t('CREATE_MATERIAL.FIELD_AUDIO_URL_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
      );
    case 'price':
      return (
        <View>
          {header}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.FIELD_PRICE_LABEL')}</Text>
            <View style={styles.priceDisplay}>
              <Text style={[styles.priceValue, { color: colors.text }]}>${price}</Text>
              <Text style={[styles.pricePerQuiz, { color: colors.textTertiary }]}>
                {t('CREATE_MATERIAL.FIELD_PRICE_PER_QUIZ')}
              </Text>
            </View>
            <Slider
              style={styles.priceSlider}
              minimumValue={1}
              maximumValue={50}
              step={1}
              value={price}
              onValueChange={(v) => setPrice(Math.round(v))}
              minimumTrackTintColor={isDark ? '#fff' : '#222'}
              maximumTrackTintColor={isDark ? '#3a3a3c' : '#e5e5ea'}
              thumbTintColor={isDark ? '#fff' : '#222'}
            />
            <View style={styles.priceRange}>
              <Text style={[styles.priceRangeLabel, { color: colors.textTertiary }]}>$1</Text>
              <Text style={[styles.priceRangeLabel, { color: colors.textTertiary }]}>$50</Text>
            </View>
            <Text style={[styles.priceHint, { color: colors.textTertiary }]}>
              {t('CREATE_MATERIAL.FIELD_PRICE_HINT')}
            </Text>
          </View>
        </View>
      );
    default:
      return <View />;
  }
}

/* ═══════════ Ordering (sortable) ═══════════ */

function OrderingSection({ qi, correctOrder, updateQuestion, scrollRef, isDark, inputBg, inputBorder, colors, t }: {
  qi: number;
  correctOrder: string[];
  updateQuestion: (idx: number, patch: Partial<QuizQuestion>) => void;
  scrollRef: any;
  isDark: boolean;
  inputBg: string;
  inputBorder: string;
  colors: any;
  t: any;
}) {
  const handleDragEnd = useCallback(({ order }: any) => {
    updateQuestion(qi, { correctOrder: order(correctOrder) });
  }, [qi, correctOrder, updateQuestion]);

  return (
    <View style={{ gap: 8, marginTop: 22 }}>
      <Text style={[styles.qSectionLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.QUIZ_ITEMS_CORRECT_ORDER')}</Text>
      <Text style={[styles.qSectionHint, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.QUIZ_ITEMS_HINT')}</Text>
      <Sortable.Flex
        flexDirection="column"
        gap={8}
        customHandle
        scrollableRef={scrollRef}
        onDragEnd={handleDragEnd}
      >
        {correctOrder.map((item, ii) => (
          <View key={`order-${ii}`} style={styles.orderRow}>
            <Sortable.Handle>
              <View style={styles.dragHandle}>
                <Ionicons name="menu-outline" size={20} color={colors.textTertiary} />
              </View>
            </Sortable.Handle>
            <View style={[styles.orderNum, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
              <Text style={[styles.orderNumText, { color: colors.text }]}>{ii + 1}</Text>
            </View>
            <TextInput
              style={[styles.fieldInput, { flex: 1, backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
              value={item}
              onChangeText={(v) => {
                const newOrder = [...correctOrder];
                newOrder[ii] = v;
                updateQuestion(qi, { correctOrder: newOrder });
              }}
              placeholder={`Item ${ii + 1}`}
              placeholderTextColor={colors.textTertiary}
            />
            {correctOrder.length > 2 && (
              <TouchableOpacity onPress={() => {
                updateQuestion(qi, { correctOrder: correctOrder.filter((_, i) => i !== ii) });
              }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-outline" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </Sortable.Flex>
      <TouchableOpacity
        style={styles.addOptionBtn}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          updateQuestion(qi, { correctOrder: [...correctOrder, ''] });
        }}
      >
        <Ionicons name="add-outline" size={16} color={isDark ? '#8e8e93' : '#636366'} />
        <Text style={[styles.addOptionText, { color: isDark ? '#8e8e93' : '#636366' }]}>{t('CREATE_MATERIAL.QUIZ_ADD_ITEM')}</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ═══════════ Step 4: Quiz Builder ═══════════ */

function StepQuiz({ quiz, addQuestion, removeQuestion, updateQuestion, scrollRef, colors, t }: {
  quiz: QuizQuestion[];
  addQuestion: (type: QuestionType) => void;
  removeQuestion: (idx: number) => void;
  updateQuestion: (idx: number, patch: Partial<QuizQuestion>) => void;
  scrollRef: any;
  colors: any; t: any;
}) {
  const isDark = colors.isDark;
  const inputBg = isDark ? '#1c1c1e' : '#fff';
  const inputBorder = isDark ? '#3a3a3c' : '#e5e5ea';

  const getQTypeLabel = (type: QuestionType) =>
    QUESTION_TYPES.find(q => q.value === type)?.labelKey || '';

  const getQTypeIcon = (type: QuestionType): keyof typeof Ionicons.glyphMap =>
    QUESTION_TYPES.find(q => q.value === type)?.icon || 'list-outline';

  return (
    <View>
      <Text style={[styles.detailsHeading, { color: colors.text }]}>{t('CREATE_MATERIAL.QUIZ_TITLE')}</Text>
      <Text style={[styles.detailsSubheading, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.QUIZ_DESC')}</Text>

      {/* Instructions */}
      <View style={[styles.quizInstructions, { backgroundColor: isDark ? '#1c1c1e' : '#fafafa', borderColor: inputBorder }]}>
        {[
          { icon: 'create-outline' as const, key: 'CREATE_MATERIAL.QUIZ_INST_1' },
          { icon: 'checkmark-circle-outline' as const, key: 'CREATE_MATERIAL.QUIZ_INST_2' },
          { icon: 'bulb-outline' as const, key: 'CREATE_MATERIAL.QUIZ_INST_3' },
        ].map((inst, i) => (
          <View key={i} style={styles.quizInstRow}>
            <Ionicons name={inst.icon} size={18} color={colors.textSecondary} />
            <Text style={[styles.quizInstText, { color: colors.textSecondary }]}>{t(inst.key)}</Text>
          </View>
        ))}
      </View>

      {/* Add question picker */}
      <Text style={[styles.addQLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.QUIZ_ADD_QUESTION')}</Text>
      <View style={styles.qTypeGrid}>
        {QUESTION_TYPES.map(qt => (
          <TouchableOpacity
            key={qt.value}
            style={[styles.qTypeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={() => addQuestion(qt.value)}
          >
            <Ionicons name={qt.icon} size={22} color={colors.textSecondary} />
            <Text style={[styles.qTypeBtnLabel, { color: colors.text }]}>{t(qt.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Question list */}
      {quiz.length === 0 && (
        <View style={styles.quizEmpty}>
          <Ionicons name="help-circle-outline" size={40} color={colors.textTertiary} />
          <Text style={[styles.quizEmptyText, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.QUIZ_EMPTY')}</Text>
        </View>
      )}

      {quiz.map((q, qi) => (
        <View key={qi} style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Question header */}
          <View style={styles.qHeader}>
            <Text style={[styles.qNum, { color: colors.text }]}>Q{qi + 1}</Text>
            <View style={[styles.qTypeBadge, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
              <Ionicons name={getQTypeIcon(q.type)} size={12} color={colors.textSecondary} />
              <Text style={[styles.qTypeBadgeText, { color: colors.textSecondary }]}>{t(getQTypeLabel(q.type))}</Text>
            </View>
            <TouchableOpacity onPress={() => removeQuestion(qi)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 'auto' }}>
              <Ionicons name="trash-outline" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>

          {/* Question text */}
          <TextInput
            style={[styles.fieldInput, { backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
            value={q.question}
            onChangeText={(v) => updateQuestion(qi, { question: v })}
            placeholder={
              q.type === 'fill_blank' ? t('CREATE_MATERIAL.QUIZ_FILL_BLANK_PLACEHOLDER') :
              q.type === 'ordering' ? t('CREATE_MATERIAL.QUIZ_ORDERING_PLACEHOLDER') :
              t('CREATE_MATERIAL.QUIZ_MC_PLACEHOLDER')
            }
            placeholderTextColor={colors.textTertiary}
          />

          {/* Multiple Choice */}
          {q.type === 'multiple_choice' && q.options && (
            <View style={{ gap: 8, marginTop: 22 }}>
              {q.options.map((opt, oi) => (
                <View key={oi} style={styles.mcOptionRow}>
                  <TouchableOpacity
                    style={[styles.mcRadio, opt.isCorrect && styles.mcRadioActive]}
                    onPress={() => {
                      const newOpts = q.options!.map((o, i) => ({ ...o, isCorrect: i === oi }));
                      updateQuestion(qi, { options: newOpts });
                    }}
                  >
                    {opt.isCorrect && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.fieldInput, { flex: 1, backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
                    value={opt.text}
                    onChangeText={(v) => {
                      const newOpts = [...q.options!];
                      newOpts[oi] = { ...newOpts[oi], text: v };
                      updateQuestion(qi, { options: newOpts });
                    }}
                    placeholder={`Option ${'ABCDEF'[oi]}`}
                    placeholderTextColor={colors.textTertiary}
                  />
                  {q.options!.length > 2 && (
                    <TouchableOpacity onPress={() => {
                      const newOpts = q.options!.filter((_, i) => i !== oi);
                      updateQuestion(qi, { options: newOpts });
                    }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-outline" size={20} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {q.options.length < 6 && (
                <TouchableOpacity
                  style={styles.addOptionBtn}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    updateQuestion(qi, { options: [...q.options!, { text: '', isCorrect: false }] });
                  }}
                >
                  <Ionicons name="add-outline" size={16} color={isDark ? '#8e8e93' : '#636366'} />
                  <Text style={[styles.addOptionText, { color: isDark ? '#8e8e93' : '#636366' }]}>{t('CREATE_MATERIAL.QUIZ_ADD_OPTION')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Fill in the Blank */}
          {q.type === 'fill_blank' && q.acceptedAnswers && (
            <View style={{ gap: 8, marginTop: 22 }}>
              <Text style={[styles.qSectionLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.QUIZ_ACCEPTED_ANSWERS')}</Text>
              <Text style={[styles.qSectionHint, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.QUIZ_ACCEPTED_HINT')}</Text>
              {q.acceptedAnswers.map((ans, ai) => (
                <View key={ai} style={styles.mcOptionRow}>
                  <TextInput
                    style={[styles.fieldInput, { flex: 1, backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
                    value={ans}
                    onChangeText={(v) => {
                      const newAns = [...q.acceptedAnswers!];
                      newAns[ai] = v;
                      updateQuestion(qi, { acceptedAnswers: newAns });
                    }}
                    placeholder={`Answer ${ai + 1}`}
                    placeholderTextColor={colors.textTertiary}
                  />
                  {q.acceptedAnswers!.length > 1 && (
                    <TouchableOpacity onPress={() => {
                      updateQuestion(qi, { acceptedAnswers: q.acceptedAnswers!.filter((_, i) => i !== ai) });
                    }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-outline" size={20} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={styles.addOptionBtn}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  updateQuestion(qi, { acceptedAnswers: [...q.acceptedAnswers!, ''] });
                }}
              >
                <Ionicons name="add-outline" size={16} color={isDark ? '#8e8e93' : '#636366'} />
                <Text style={[styles.addOptionText, { color: isDark ? '#8e8e93' : '#636366' }]}>{t('CREATE_MATERIAL.QUIZ_ADD_ALTERNATIVE')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* True / False */}
          {q.type === 'true_false' && (
            <View style={{ gap: 8, marginTop: 22 }}>
              <Text style={[styles.qSectionLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.QUIZ_CORRECT_ANSWER')}</Text>
              <View style={styles.tfRow}>
                <TouchableOpacity
                  style={[styles.tfBtn, q.correctAnswer === true && styles.tfBtnActive, { borderColor: inputBorder }]}
                  onPress={() => updateQuestion(qi, { correctAnswer: true })}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color={q.correctAnswer === true ? '#10b981' : colors.textTertiary} />
                  <Text style={[styles.tfBtnText, { color: q.correctAnswer === true ? '#10b981' : colors.text }]}>{t('CREATE_MATERIAL.QUIZ_TRUE')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tfBtn, q.correctAnswer === false && styles.tfBtnActive, { borderColor: inputBorder }]}
                  onPress={() => updateQuestion(qi, { correctAnswer: false })}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle-outline" size={18} color={q.correctAnswer === false ? '#ef4444' : colors.textTertiary} />
                  <Text style={[styles.tfBtnText, { color: q.correctAnswer === false ? '#ef4444' : colors.text }]}>{t('CREATE_MATERIAL.QUIZ_FALSE')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Ordering */}
          {q.type === 'ordering' && q.correctOrder && (
            <OrderingSection
              qi={qi}
              correctOrder={q.correctOrder}
              updateQuestion={updateQuestion}
              scrollRef={scrollRef}
              isDark={isDark}
              inputBg={inputBg}
              inputBorder={inputBorder}
              colors={colors}
              t={t}
            />
          )}

          {/* Explanation */}
          <View style={{ marginTop: 22, gap: 8 }}>
            <Text style={[styles.qSectionLabel, { color: colors.text }]}>{t('CREATE_MATERIAL.QUIZ_EXPLANATION')}</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea, { backgroundColor: inputBg, borderColor: inputBorder, color: colors.text, minHeight: 60 }]}
              value={q.explanation}
              onChangeText={(v) => updateQuestion(qi, { explanation: v })}
              placeholder={t('CREATE_MATERIAL.QUIZ_EXPLANATION_PLACEHOLDER')}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ═══════════ Step 5: Preview ═══════════ */

function StepPreview({ selectedType, selectedPricing, title, description, whyTakeThis,
  language, level, passage, videoUrl, price, quiz, thumbnailUri, getTypeLabel, colors, t }: {
  selectedType: MaterialType;
  selectedPricing: 'free' | 'paid';
  title: string;
  description: string;
  whyTakeThis: string;
  language: string;
  level: string;
  passage: string;
  videoUrl: string;
  price: number;
  quiz: QuizQuestion[];
  thumbnailUri: string | null;
  getTypeLabel: (type: MaterialType) => string;
  colors: any; t: any;
}) {
  const isDark = colors.isDark;
  const levelLabel = LEVELS.find(l => l.value === level)?.labelKey;
  const videoFallbackCover =
    selectedType === 'video_quiz' ? youtubeThumbnailFromVideoUrl(videoUrl) : null;
  const previewCoverUri = thumbnailUri?.trim() || videoFallbackCover || null;

  return (
    <View>
      <Text style={[styles.detailsHeading, { color: colors.text }]}>{t('CREATE_MATERIAL.PREVIEW_TITLE')}</Text>
      <Text style={[styles.detailsSubheading, { color: colors.textSecondary }]}>{t('CREATE_MATERIAL.PREVIEW_DESC_NEW')}</Text>

      {/* Preview Card */}
      <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Cover: custom upload, or YouTube still for video quiz */}
        {previewCoverUri && (
          <Image source={{ uri: previewCoverUri }} style={styles.previewCover} />
        )}

        <View style={styles.previewInfo}>
          {/* Type badge */}
          <View style={[styles.previewBadge, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
            <Text style={[styles.previewBadgeText, { color: colors.textSecondary }]}>{getTypeLabel(selectedType)}</Text>
          </View>

          {/* Title */}
          <Text style={[styles.previewTitle, { color: colors.text }]}>{title || 'Untitled'}</Text>

          {/* Description */}
          {!!description && (
            <Text style={[styles.previewDesc, { color: colors.textSecondary }]}>{description}</Text>
          )}

          {/* Why take this */}
          {!!whyTakeThis && (
            <View style={styles.previewPitch}>
              <Ionicons name="bulb-outline" size={16} color={isDark ? '#fbbf24' : '#d97706'} />
              <Text style={[styles.previewPitchText, { color: colors.textSecondary }]}>{whyTakeThis}</Text>
            </View>
          )}

          {/* Meta badges */}
          <View style={styles.previewMeta}>
            {!!language && (
              <View style={[styles.previewMetaBadge, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                <Text style={[styles.previewMetaText, { color: colors.text }]}>{language}</Text>
              </View>
            )}
            {!!levelLabel && (
              <View style={[styles.previewMetaBadge, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                <Text style={[styles.previewMetaText, { color: colors.text }]}>{t(levelLabel)}</Text>
              </View>
            )}
            <View style={[styles.previewMetaBadge, { backgroundColor: selectedPricing === 'paid' ? (isDark ? '#1c2333' : '#eef4ff') : (isDark ? '#0d2818' : '#ecfdf5') }]}>
              <Text style={[styles.previewMetaText, { color: selectedPricing === 'paid' ? '#3b82f6' : '#10b981' }]}>
                {selectedPricing === 'free' ? t('CREATE_MATERIAL.PRICING_FREE') : `$${price}`}
              </Text>
            </View>
          </View>
        </View>

        {/* Reading passage preview */}
        {selectedType === 'reading' && !!passage && (
          <View style={[styles.previewPassage, { borderTopColor: colors.border }]}>
            <Text style={[styles.previewPassageHeading, { color: colors.text }]}>{t('CREATE_MATERIAL.PREVIEW_READING_PASSAGE')}</Text>
            <Text style={[styles.previewPassageText, { color: colors.textSecondary }]}>{passage}</Text>
          </View>
        )}

        {/* Quiz summary */}
        <View style={[styles.previewQuizSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.previewQuizHeading, { color: colors.text }]}>
            {quiz.length === 1
              ? t('CREATE_MATERIAL.PREVIEW_QUIZ_COUNT', { count: quiz.length })
              : t('CREATE_MATERIAL.PREVIEW_QUIZ_COUNT_PLURAL', { count: quiz.length })}
          </Text>

          {quiz.map((q, i) => {
            const qtConfig = QUESTION_TYPES.find(qt => qt.value === q.type);
            return (
              <View key={i} style={[styles.pqCard, { borderColor: colors.border }]}>
                <View style={styles.pqHeader}>
                  <View style={[styles.pqNum, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                    <Text style={[styles.pqNumText, { color: colors.text }]}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.pqText, { color: colors.text }]} numberOfLines={2}>{q.question || '(no question text)'}</Text>
                  <Text style={[styles.pqType, { color: colors.textTertiary }]}>{qtConfig ? t(qtConfig.labelKey) : ''}</Text>
                </View>

                {/* MC options */}
                {q.type === 'multiple_choice' && q.options && (
                  <View style={{ gap: 4, marginTop: 8 }}>
                    {q.options.map((opt, oi) => (
                      <View key={oi} style={styles.pqOptionRow}>
                        <Text style={[styles.pqLetter, { color: opt.isCorrect ? '#10b981' : colors.textTertiary }]}>{'ABCDEF'[oi]}</Text>
                        <Text style={[styles.pqOptionText, { color: colors.text, fontWeight: opt.isCorrect ? '600' : '400' }]}>{opt.text || '—'}</Text>
                        {opt.isCorrect && <Ionicons name="checkmark-circle" size={14} color="#10b981" />}
                      </View>
                    ))}
                  </View>
                )}

                {/* Fill blank */}
                {q.type === 'fill_blank' && q.acceptedAnswers && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.pqAnswerLabel, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.PREVIEW_ACCEPTED')}</Text>
                    <View style={styles.pqChips}>
                      {q.acceptedAnswers.filter(a => a.trim()).map((a, ai) => (
                        <View key={ai} style={[styles.pqChip, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                          <Text style={[styles.pqChipText, { color: colors.text }]}>{a}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* True/False */}
                {q.type === 'true_false' && (
                  <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.pqAnswerLabel, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.PREVIEW_ANSWER')}</Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: q.correctAnswer ? '#10b981' : '#ef4444' }}>
                      {q.correctAnswer ? t('CREATE_MATERIAL.QUIZ_TRUE') : t('CREATE_MATERIAL.QUIZ_FALSE')}
                    </Text>
                  </View>
                )}

                {/* Ordering */}
                {q.type === 'ordering' && q.correctOrder && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.pqAnswerLabel, { color: colors.textTertiary }]}>{t('CREATE_MATERIAL.PREVIEW_CORRECT_ORDER')}</Text>
                    <View style={{ gap: 4, marginTop: 4 }}>
                      {q.correctOrder.filter(s => s.trim()).map((item, idx) => (
                        <View key={idx} style={styles.pqOrderItem}>
                          <Text style={[styles.pqOrderNum, { color: colors.textTertiary }]}>{idx + 1}</Text>
                          <Text style={[styles.pqOrderText, { color: colors.text }]}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/**
 * Vertical offset from scroll content top → “How would you like to share this?” (chip + gap).
 * Type & pricing have no progress bar above the scroll; details/quiz/preview do — see below.
 */
const PRICING_CHIP_MARGIN_TOP = 6;
/** Space between type chip and “How would you like to share this?” */
const PRICING_CHIP_TO_TITLE_GAP = 30;
/** Approx. chip row height (padding + text line) */
const PRICING_CHIP_ROW_HEIGHT = 36;
const PRICING_SHARE_WRAP_PADDING_TOP = 4;
/** Distance from scroll top to share title (matches StepPricing layout) */
const PRICING_TITLE_OFFSET_FROM_SCROLL_TOP =
  PRICING_SHARE_WRAP_PADDING_TOP +
  PRICING_CHIP_MARGIN_TOP +
  PRICING_CHIP_ROW_HEIGHT +
  PRICING_CHIP_TO_TITLE_GAP;
/** progressSection: marginTop + track + marginBottom — must stay in sync with styles.progressSection */
const MATERIAL_PROGRESS_ABOVE_SCROLL_HEIGHT = 14 + 3 + 28;
/**
 * Details / quiz / preview: progress bar sits above ScrollView, so pull content up by that amount
 * so the main title matches the share screen Y position.
 */
const HEAD_STEP_MARGIN_BELOW_PROGRESS =
  PRICING_TITLE_OFFSET_FROM_SCROLL_TOP - MATERIAL_PROGRESS_ABOVE_SCROLL_HEIGHT;
/** Type step: no progress bar above scroll — align with share title offset */
const HEAD_STEP_MARGIN_NO_PROGRESS = PRICING_TITLE_OFFSET_FROM_SCROLL_TOP;

/* ═══════════ Styles ═══════════ */

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  detailsStepMaxWidth: {
    width: '100%' as const,
    maxWidth: 440,
    alignSelf: 'center' as const,
  },
  pricingShareWrap: { marginTop: 0, paddingTop: PRICING_SHARE_WRAP_PADDING_TOP },
  headAlignedStep: {
    marginTop: HEAD_STEP_MARGIN_NO_PROGRESS,
  },
  headAlignedStepBelowProgress: {
    marginTop: HEAD_STEP_MARGIN_BELOW_PROGRESS,
  },
  editBadgeRow: { alignItems: 'center' as const, marginBottom: 12 },
  editBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  editBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },

  /* Nav Bar */
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 1 },
  navBackLabel: { fontSize: 15, fontWeight: '500' },
  navStepCount: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  navSaveExit: {
    marginLeft: 'auto',
    zIndex: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  navSaveExitText: {
    fontSize: 14,
    fontWeight: '600',
  },

  progressSection: {
    marginTop: 14,
    marginBottom: 28,
  },
  /* Progress Bar */
  progressTrack: { height: 3, width: '100%' },
  progressFill: { height: '100%', borderRadius: 1.5 },

  /* Step Heading */
  stepHeading: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 0,
    marginBottom: 40,
  },
  /* Step 1: Type Cards */
  typeCards: { gap: 12 },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
    gap: 14,
  },
  typeIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIconRaster: {
    width: 38,
    height: 38,
  },
  typeTextWrap: { flex: 1, justifyContent: 'flex-start' as const },
  typeTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 3,
    lineHeight: 21,
    minHeight: 42,
  },
  typeDesc: { fontSize: 13, lineHeight: 18 },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  /* Step 2: Pricing */
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 28,
  },
  selectedChipText: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  selectedChipTypeIcon: {
    width: 38,
    height: 38,
  },

  pricingShareSubline: {
    marginBottom: 20,
  },
  shareTip: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  shareTipBody: { flex: 1 },
  shareTipTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  shareTipDesc: { fontSize: 13, lineHeight: 18 },
  pricingCheck: { marginTop: 8 },
  pricingCards: { flexDirection: 'row', gap: 12 },
  pricingCard: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  pricingIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  pricingTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  pricingDesc: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

  /* FLIP flying clone — matches selectedChip layout exactly */
  flyClone: {
    position: 'absolute',
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    elevation: 6,
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  flyLabel: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  flyCloneTypeIcon: {
    width: 38,
    height: 38,
  },

  /* Step 3: Details Form */
  detailsHeading: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center' as const,
    marginTop: 0,
    marginBottom: 10,
  },
  detailsSubheading: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center' as const,
    marginBottom: 72,
  },
  fieldWrap: {
    marginBottom: 28,
    flexDirection: 'column' as const,
    gap: 10,
  },
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  requiredStar: { color: '#ef4444', fontWeight: '600' },
  fieldHint: { fontSize: 12, fontWeight: '400' },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  fieldTextarea: {
    minHeight: 80,
    paddingTop: 12,
  },
  fieldPassage: { minHeight: 180 },
  fieldError: { color: '#ef4444', fontSize: 12, marginTop: 4 },
  charCount: { fontSize: 11, textAlign: 'right' as const, marginTop: 4 },
  fieldSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  fieldSelectText: { fontSize: 15 },
  pickerList: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerItemText: { fontSize: 15 },
  topicInputRow: { flexDirection: 'row', gap: 8 },
  topicChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  topicChipText: { fontSize: 13, fontWeight: '500' },
  priceDisplay: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 4 },
  priceValue: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  pricePerQuiz: { fontSize: 14 },
  priceSlider: { width: '100%', height: 40 },
  priceRange: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  priceRangeLabel: { fontSize: 12 },
  priceHint: { fontSize: 12, marginTop: 6 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerWizardRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  wizardBackBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardBackBtnText: { fontSize: 15, fontWeight: '600' },
  wizardNextBtn: {
    flex: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  wizardNextBtnText: { fontSize: 16, fontWeight: '700' },
  wizardChipAddBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: 'center',
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  continueBtnText: { fontSize: 16, fontWeight: '700' },
  attestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  attestCheck: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  attestLabel: { flex: 1, fontSize: 12, lineHeight: 17 },

  /* Video Policy Notice */
  policyNotice: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: 14,
    borderWidth: 1, marginTop: 20, marginBottom: 8, alignItems: 'flex-start',
  },
  policyTitle: { fontSize: 15, fontWeight: '700' },
  policyBody: { fontSize: 13, lineHeight: 18 },
  policyBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 10, marginTop: 8,
  },
  policyBtnText: { fontSize: 14, fontWeight: '600' },

  /* Cover Image */
  coverPicker: {
    alignItems: 'center', justifyContent: 'center', padding: 24,
    borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', gap: 6,
  },
  coverPickerLabel: { fontSize: 15, fontWeight: '600' },
  coverPickerHint: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  coverPreview: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  coverImage: { width: '100%', aspectRatio: 16 / 10 },
  coverRemove: { position: 'absolute', top: 8, right: 8 },

  /* Pro Tip */
  proTip: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: 14,
    borderWidth: 1, marginBottom: 20, alignItems: 'flex-start',
  },
  proTipIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  proTipText: { flex: 1, fontSize: 13, lineHeight: 19 },

  /* Quiz Builder */
  quizInstructions: {
    borderRadius: 14, borderWidth: 1, padding: 16, gap: 10, marginBottom: 24,
  },
  quizInstRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quizInstText: { flex: 1, fontSize: 13, lineHeight: 18 },
  addQLabel: { fontSize: 15, fontWeight: '600', marginBottom: 14 },
  qTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  qTypeBtn: {
    flexBasis: '47%', flexGrow: 1, alignItems: 'center', padding: 16,
    borderRadius: 14, borderWidth: 1, gap: 6,
  },
  qTypeBtnLabel: { fontSize: 13, fontWeight: '600' },
  quizEmpty: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  quizEmptyText: { fontSize: 14, textAlign: 'center' },
  questionCard: {
    borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16,
  },
  qHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  qNum: { fontSize: 16, fontWeight: '800' },
  qTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  qTypeBadgeText: { fontSize: 11, fontWeight: '600' },
  mcOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mcRadio: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#d1d1d6',
    alignItems: 'center', justifyContent: 'center',
  },
  mcRadioActive: { backgroundColor: '#10b981', borderColor: '#10b981' },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addOptionText: { fontSize: 13, fontWeight: '500' },
  qSectionLabel: { fontSize: 14, fontWeight: '600' },
  qSectionHint: { fontSize: 12 },
  tfRow: { flexDirection: 'row', gap: 10 },
  tfBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  tfBtnActive: { borderWidth: 2 },
  tfBtnText: { fontSize: 15, fontWeight: '600' },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 2, borderRadius: 10 },
  dragHandle: { padding: 4 },
  orderNum: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  orderNumText: { fontSize: 13, fontWeight: '700' },

  /* Preview */
  previewCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 16 },
  previewCover: { width: '100%', aspectRatio: 16 / 10 },
  previewInfo: { padding: 16, gap: 8 },
  previewBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  previewBadgeText: { fontSize: 12, fontWeight: '600' },
  previewTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  previewDesc: { fontSize: 14, lineHeight: 20 },
  previewPitch: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  previewPitchText: { flex: 1, fontSize: 13, lineHeight: 18 },
  previewMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  previewMetaBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  previewMetaText: { fontSize: 13, fontWeight: '600' },
  previewPassage: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  previewPassageHeading: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  previewPassageText: { fontSize: 14, lineHeight: 22 },
  previewQuizSection: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  previewQuizHeading: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  pqCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  pqHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pqNum: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pqNumText: { fontSize: 13, fontWeight: '700' },
  pqText: { flex: 1, fontSize: 14, fontWeight: '500' },
  pqType: { fontSize: 11, fontWeight: '500' },
  pqOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  pqLetter: { fontSize: 13, fontWeight: '700', width: 16 },
  pqOptionText: { fontSize: 13, flex: 1 },
  pqAnswerLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  pqChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pqChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  pqChipText: { fontSize: 13, fontWeight: '500' },
  pqOrderItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pqOrderNum: { fontSize: 12, fontWeight: '700', width: 16 },
  pqOrderText: { fontSize: 13 },

  /* Keyboard Toolbar (Airbnb-style) */
  kbToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  kbToolbarArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  kbArrowBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kbDoneBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
  },
  kbDoneText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
