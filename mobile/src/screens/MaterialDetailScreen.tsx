import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { materialService, TutorMaterial, QuizSubmitResult, QuizResultItem, LinkedChannels, SavedCard } from '../services/materials';
import { env } from '../config/env';

type QuizMode = 'idle' | 'taking' | 'results';

interface Props {
  material: TutorMaterial;
  goBack: () => void;
  /** Tutor's linked channels from My Materials (list payload often omits these on tutorId). */
  linkedChannelsFallback?: LinkedChannels | null;
}

/** Calendar / Set Availability primary blue — matches Materials “New” CTA in dark mode. */
const SETUP_AVAILABILITY_BLUE = '#08a0e8';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MaterialDetailScreen({ material: initialMaterial, goBack, linkedChannelsFallback }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isDark = colors.isDark;

  const [material, setMaterial] = useState(initialMaterial);
  const [detailRequestDone, setDetailRequestDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quizMode, setQuizMode] = useState<QuizMode>('idle');
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<any[]>([]);
  const [orderingItems, setOrderingItems] = useState<string[][]>([]);
  const [fillBlankInput, setFillBlankInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizSubmitResult | null>(null);

  const [videoPlaying, setVideoPlaying] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isCheckingMedia, setIsCheckingMedia] = useState(false);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const scoreAnim = useRef(new Animated.Value(0)).current;
  const [displayScore, setDisplayScore] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const entranceAnim = useRef(new Animated.Value(0)).current;
  const infoAnim = useRef(new Animated.Value(0)).current;
  const quizCardAnim = useRef(new Animated.Value(0)).current;
  const mediaExpandAnim = useRef(new Animated.Value(0)).current;

  const quiz = material.quiz || [];
  const hasQuiz = quiz.length > 0;
  const isTutorOwner = user?._id === (typeof material.tutorId === 'string' ? material.tutorId : material.tutorId?._id);

  const isQuizLocked = !isTutorOwner && (
    material.quizLocked === true ||
    (material.pricingType === 'paid' && material.purchaseStatus !== 'purchased')
  );
  const tutorName = typeof material.tutorId === 'object' ? (material.tutorId?.firstName || material.tutorId?.name || '') : '';
  const tutorPic = typeof material.tutorId === 'object' ? material.tutorId?.picture : null;

  const supportsChannelPill =
    material.materialType === 'video_quiz' || material.materialType === 'listening';

  const channelInfo = useMemo(() => {
    const fromTutor =
      typeof material.tutorId === 'object' && material.tutorId?.linkedChannels != null
        ? material.tutorId.linkedChannels
        : null;
    const ch = fromTutor ?? linkedChannelsFallback ?? null;
    if (!ch) return null;
    if (material.materialType === 'video_quiz') {
      if (ch.youtubeChannelName && ch.youtubeChannelUrl) {
        return { name: ch.youtubeChannelName, avatar: ch.youtubeChannelAvatar, url: ch.youtubeChannelUrl, subs: ch.youtubeSubscriberCount, platform: 'youtube' as const };
      }
      if (ch.vimeoChannelName && ch.vimeoChannelUrl) {
        return { name: ch.vimeoChannelName, avatar: ch.vimeoChannelAvatar, url: ch.vimeoChannelUrl, platform: 'vimeo' as const };
      }
    }
    if (material.materialType === 'listening') {
      if (ch.soundcloudProfileName && ch.soundcloudProfileUrl) {
        return { name: ch.soundcloudProfileName, avatar: ch.soundcloudProfileAvatar, url: ch.soundcloudProfileUrl, platform: 'soundcloud' as const };
      }
    }
    return null;
  }, [material.tutorId, material.materialType, linkedChannelsFallback]);

  const typeLabel = useMemo(() => {
    switch (material.materialType) {
      case 'video_quiz': return t('CREATE_MATERIAL.TYPE_VIDEO_QUIZ');
      case 'reading': return t('CREATE_MATERIAL.TYPE_READING');
      case 'listening': return t('CREATE_MATERIAL.TYPE_LISTENING');
      default: return '';
    }
  }, [material.materialType, t]);

  const typeIcon = useMemo((): keyof typeof Ionicons.glyphMap => {
    switch (material.materialType) {
      case 'video_quiz': return 'videocam-outline';
      case 'reading': return 'book-outline';
      case 'listening': return 'headset-outline';
      default: return 'document-outline';
    }
  }, [material.materialType]);

  const levelLabel = useMemo(() => {
    switch (material.level) {
      case 'beginner': return t('CREATE_MATERIAL.LEVEL_BEGINNER');
      case 'intermediate': return t('CREATE_MATERIAL.LEVEL_INTERMEDIATE');
      case 'advanced': return t('CREATE_MATERIAL.LEVEL_ADVANCED');
      default: return t('CREATE_MATERIAL.LEVEL_ALL');
    }
  }, [material.level, t]);

  const addedDate = useMemo(() => {
    if (!material.createdAt) return '';
    const d = new Date(material.createdAt);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, [material.createdAt]);

  useEffect(() => {
    setDetailRequestDone(false);
    materialService
      .getMaterial(material._id)
      .then(m => {
        if (m) setMaterial(m);
      })
      .finally(() => {
        setDetailRequestDone(true);
      });

    requestAnimationFrame(() => {
      Animated.stagger(120, [
        Animated.timing(entranceAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(infoAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(quizCardAnim, { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    });
  }, [material._id, entranceAnim, infoAnim, quizCardAnim]);

  const videoEmbed = useMemo(() => {
    const extractYtId = (raw: string): string | null => {
      const m = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
      return m ? m[1] : null;
    };

    const ytId = extractYtId(material.videoEmbedUrl || '') || extractYtId(material.videoUrl || '');
    if (ytId) {
      const origin = encodeURIComponent(env.backendUrl);
      return {
        type: 'youtube' as const,
        html: `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="no-referrer-when-downgrade">
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none}</style>
</head><body>
<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?playsinline=1&modestbranding=1&rel=0&showinfo=0&autoplay=1&origin=${origin}"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  referrerpolicy="no-referrer-when-downgrade"
  allowfullscreen></iframe>
</body></html>`,
      };
    }

    if (material.videoUrl) {
      const vimeoMatch = material.videoUrl.match(/vimeo\.com\/(\d+)/);
      if (vimeoMatch) return { type: 'vimeo' as const, uri: `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1` };
    }
    return null;
  }, [material.videoUrl, material.videoEmbedUrl]);

  const playVideo = useCallback(() => { setVideoPlaying(true); }, []);
  const stopVideo = useCallback(() => { setVideoPlaying(false); }, []);

  /* ── Quiz flow ── */
  const initQuiz = useCallback(() => {
    const answers: any[] = quiz.map(q => {
      const qType = (q as any).type || 'multiple_choice';
      if (qType === 'ordering') return null;
      if (qType === 'true_false') return null;
      return null;
    });
    setSelectedAnswers(answers);

    const ordering: string[][] = quiz.map(q => {
      const qType = (q as any).type || 'multiple_choice';
      if (qType === 'ordering' && (q as any).correctOrder) {
        return shuffleArray((q as any).correctOrder);
      }
      return [];
    });
    setOrderingItems(ordering);
    setCurrentQIndex(0);
    setFillBlankInput('');
  }, [quiz]);

  const beginQuizMode = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    initQuiz();
    setQuizMode('taking');
    setQuizResult(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    Animated.timing(mediaExpandAnim, {
      toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [initQuiz, mediaExpandAnim]);

  const startQuiz = useCallback(async () => {
    if (isQuizLocked) {
      Alert.alert(t('MATERIAL_DETAIL.QUIZ_LOCKED_HINT'));
      return;
    }

    if (material.materialType === 'video_quiz' && material.pricingType === 'paid' && !isTutorOwner) {
      setIsCheckingMedia(true);
      const check = await materialService.checkMediaAvailability(material._id);
      setIsCheckingMedia(false);
      if (!check.available) {
        Alert.alert(
          t('MATERIAL_DETAIL.VIDEO_UNAVAILABLE_TITLE'),
          t('MATERIAL_DETAIL.VIDEO_UNAVAILABLE_MSG'),
        );
        return;
      }
    }

    beginQuizMode();
  }, [isQuizLocked, material.materialType, material.pricingType, material._id, isTutorOwner, beginQuizMode, t]);

  const purchaseQuiz = useCallback(async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to purchase this quiz.');
      return;
    }
    setLoadingCards(true);
    setShowCardPicker(true);
    const cards = await materialService.getSavedCards();
    setSavedCards(cards);
    setLoadingCards(false);
  }, [user]);

  const confirmPurchase = useCallback(async (card: SavedCard) => {
    setShowCardPicker(false);

    Alert.alert(
      t('MATERIAL_DETAIL.PURCHASE_CONFIRM_TITLE'),
      t('MATERIAL_DETAIL.PURCHASE_CONFIRM_MSG', { price: material.price.toFixed(2), brand: card.brand || 'card', last4: card.last4 }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Pay $${material.price.toFixed(2)}`,
          onPress: async () => {
            setIsPurchasing(true);
            const result = await materialService.purchaseMaterial(material._id, card.stripePaymentMethodId);
            if (result.success) {
              Alert.alert('', t('MATERIAL_DETAIL.PURCHASE_SUCCESS'));
              const refreshed = await materialService.getMaterial(material._id);
              if (refreshed) setMaterial(refreshed);
            } else {
              Alert.alert('', result.message || t('MATERIAL_DETAIL.PURCHASE_FAILED'));
            }
            setIsPurchasing(false);
          },
        },
      ],
    );
  }, [material._id, material.price, t]);

  const exitQuiz = useCallback(() => {
    Alert.alert('Exit Quiz', 'Are you sure you want to exit? Your progress will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit', style: 'destructive', onPress: () => {
          setQuizMode('idle');
          setCurrentQIndex(0);
          Animated.timing(mediaExpandAnim, {
            toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: false,
          }).start();
        },
      },
    ]);
  }, [mediaExpandAnim]);

  const selectAnswer = useCallback((qi: number, answer: any) => {
    setSelectedAnswers(prev => {
      const next = [...prev];
      next[qi] = answer;
      return next;
    });
  }, []);

  const nextQuestion = useCallback(() => {
    if (currentQIndex < quiz.length - 1) {
      setCurrentQIndex(i => i + 1);
      const nextQ = quiz[currentQIndex + 1] as any;
      if (nextQ?.type === 'fill_blank') {
        setFillBlankInput(selectedAnswers[currentQIndex + 1] || '');
      }
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [currentQIndex, quiz, selectedAnswers]);

  const prevQuestion = useCallback(() => {
    if (currentQIndex > 0) {
      const q = quiz[currentQIndex] as any;
      if (q?.type === 'fill_blank') {
        selectAnswer(currentQIndex, fillBlankInput);
      }
      setCurrentQIndex(i => i - 1);
      const prevQ = quiz[currentQIndex - 1] as any;
      if (prevQ?.type === 'fill_blank') {
        setFillBlankInput(selectedAnswers[currentQIndex - 1] || '');
      }
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [currentQIndex, quiz, fillBlankInput, selectedAnswers, selectAnswer]);

  const handleSubmitQuiz = useCallback(async () => {
    const q = quiz[currentQIndex] as any;
    if (q?.type === 'fill_blank') {
      selectAnswer(currentQIndex, fillBlankInput);
    }
    if (q?.type === 'ordering') {
      selectAnswer(currentQIndex, orderingItems[currentQIndex]);
    }

    const finalAnswers = [...selectedAnswers];
    if (q?.type === 'fill_blank') finalAnswers[currentQIndex] = fillBlankInput;
    if (q?.type === 'ordering') finalAnswers[currentQIndex] = orderingItems[currentQIndex];

    const answeredCount = finalAnswers.filter(a => a !== null && a !== undefined && a !== '').length;
    const total = quiz.length;

    const doSubmit = async () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setIsSubmitting(true);
      const mapped = quiz.map((question, i) => {
        const qType = (question as any).type || 'multiple_choice';
        const ans = finalAnswers[i];
        if (qType === 'ordering') return orderingItems[i] || [];
        return ans;
      });
      const result = await materialService.submitQuiz(material._id, mapped);
      setIsSubmitting(false);
      if (result) {
        setQuizResult(result);
        setQuizMode('results');
        animateScore(result.score);
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      } else {
        Alert.alert('Error', 'Failed to submit quiz. Please try again.');
      }
    };

    if (answeredCount < total) {
      Alert.alert(
        'Incomplete',
        `You answered ${answeredCount} of ${total} questions. Submit anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', onPress: doSubmit },
        ],
      );
    } else {
      doSubmit();
    }
  }, [quiz, currentQIndex, fillBlankInput, orderingItems, selectedAnswers, material._id, selectAnswer]);

  const animateScore = useCallback((target: number) => {
    scoreAnim.setValue(0);
    setDisplayScore(0);
    Animated.timing(scoreAnim, {
      toValue: target,
      duration: 1200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    const listener = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    setTimeout(() => scoreAnim.removeListener(listener), 1400);
  }, [scoreAnim]);

  const retakeQuiz = useCallback(() => {
    Alert.alert('Retake Quiz', 'Start a fresh attempt?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Retake', onPress: () => { beginQuizMode(); } },
    ]);
  }, [beginQuizMode]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#34c759';
    if (score >= 60) return '#ffc107';
    if (score >= 40) return '#ff9500';
    return '#e04848';
  };

  const currentQuestion = quiz[currentQIndex] as any;
  const currentQType = currentQuestion?.type || 'multiple_choice';
  const isLastQuestion = currentQIndex === quiz.length - 1;

  const inputBg = isDark ? '#1c1c1e' : '#fff';
  const inputBorder = isDark ? '#3a3a3c' : '#e5e5ea';
  const cardBg = isDark ? '#1c1c1e' : '#fff';
  const chipBg = isDark ? '#2c2c2e' : '#f0f0f2';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Nav Bar */}
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={goBack} style={styles.navBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={[styles.navBackLabel, { color: colors.text }]}>{t('COMMON.BACK')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        )}

        {!loading && (
          <>
            {/* ── Media Section ── */}
            {material.materialType === 'video_quiz' && quizMode !== 'results' && (
              <Animated.View style={{
                opacity: entranceAnim,
                transform: [
                  { scale: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) },
                ],
              }}>
                <Animated.View style={[styles.mediaWrap, {
                  marginHorizontal: mediaExpandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }),
                  borderRadius: mediaExpandAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 4] }),
                }]}>
                  {videoPlaying && videoEmbed ? (
                    <View style={styles.videoContainer}>
                      <WebView
                        source={
                          videoEmbed.type === 'youtube'
                            ? { html: videoEmbed.html, baseUrl: env.backendUrl }
                            : { uri: videoEmbed.uri! }
                        }
                        originWhitelist={['*']}
                        style={styles.videoWebView}
                        allowsInlineMediaPlayback
                        mediaPlaybackRequiresUserAction={false}
                        javaScriptEnabled
                        scrollEnabled={false}
                      />
                    </View>
                  ) : material.thumbnailUrl ? (
                    <TouchableOpacity activeOpacity={0.9} onPress={playVideo}>
                      <Image source={{ uri: material.thumbnailUrl }} style={styles.videoThumb} />
                      <View style={styles.playOverlay}>
                        <View style={styles.playBtn}>
                          <Ionicons name="play" size={32} color="#fff" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                </Animated.View>
              </Animated.View>
            )}

            {material.materialType === 'listening' && material.audioUrl && quizMode !== 'results' && (
              <Animated.View style={{ opacity: entranceAnim, transform: [{ scale: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }] }}>
                <TouchableOpacity
                  style={[styles.audioBanner, { backgroundColor: isDark ? '#1c1c2e' : '#f0f0ff' }]}
                  activeOpacity={0.8}
                  onPress={() => { if (material.audioUrl) Linking.openURL(material.audioUrl); }}
                >
                  <Ionicons name="headset-outline" size={28} color={isDark ? '#818cf8' : '#6366f1'} />
                  <Text style={[styles.audioBannerText, { color: colors.text }]}>
                    {t('MATERIAL_DETAIL.LISTEN_EXTERNAL')}
                  </Text>
                  <Ionicons name="open-outline" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              </Animated.View>
            )}

            {material.materialType === 'reading' && material.passage && quizMode !== 'results' && (
              <Animated.View style={{ opacity: entranceAnim, transform: [{ scale: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }] }}>
                <View style={[styles.passageCard, { backgroundColor: isDark ? '#1c1c1e' : '#fafafa', borderColor: inputBorder }]}>
                  <Text style={[styles.passageLabel, { color: colors.textSecondary }]}>
                    {t('MATERIAL_DETAIL.READING_PASSAGE')}
                  </Text>
                  <Text style={[styles.passageText, { color: colors.text }]}>{material.passage}</Text>
                </View>
              </Animated.View>
            )}

            {/* ── Idle: Title + badges + channel + quiz card ── */}
            {quizMode === 'idle' && (
              <Animated.View style={[styles.infoSection, {
                opacity: infoAnim,
                transform: [{ translateY: infoAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
              }]}>
                <Text style={[styles.title, { color: colors.text }]}>{material.title}</Text>

                {/* Meta badges */}
                <View style={styles.metaRow}>
                  <View style={[styles.badge, { backgroundColor: chipBg }]}>
                    <Ionicons name={typeIcon} size={14} color={colors.textSecondary} />
                    <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{typeLabel}</Text>
                  </View>
                  {material.language ? (
                    <View style={[styles.badge, { backgroundColor: chipBg }]}>
                      <Text style={[styles.badgeText, { color: colors.text }]}>{material.language}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.badge, { backgroundColor: chipBg }]}>
                    <Text style={[styles.badgeText, { color: colors.text }]}>{levelLabel}</Text>
                  </View>
                  <View style={[styles.badge, {
                    backgroundColor: material.pricingType === 'paid'
                      ? (isDark ? '#1c2333' : '#eef4ff')
                      : (isDark ? '#0d2818' : '#ecfdf5'),
                  }]}>
                    <Text style={[styles.badgeText, {
                      color: material.pricingType === 'paid' ? '#3b82f6' : '#10b981',
                      fontWeight: '600',
                    }]}>
                      {material.pricingType === 'free' ? t('CREATE_MATERIAL.PRICING_FREE') : `$${material.price}`}
                    </Text>
                  </View>
                </View>

                {/* Refund banner */}
                {material.purchaseStatus === 'refunded' && !isTutorOwner && (
                  <View style={[styles.bannerWrap, { backgroundColor: isDark ? '#0d2818' : '#ecfdf5', borderColor: isDark ? '#166534' : '#86efac' }]}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#10b981" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bannerTitle, { color: isDark ? '#86efac' : '#166534' }]}>
                        {t('MATERIAL_DETAIL.REFUND_BANNER_TITLE')}
                      </Text>
                      <Text style={[styles.bannerMsg, { color: isDark ? '#6ee7b7' : '#15803d' }]}>
                        {material.refundReason || t('MATERIAL_DETAIL.REFUND_BANNER_MSG')}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Media unavailable banner */}
                {material.mediaUnavailable && material.pricingType === 'paid' && material.purchaseStatus !== 'refunded' && !isTutorOwner && (
                  <View style={[styles.bannerWrap, { backgroundColor: isDark ? '#2a1f00' : '#fffbeb', borderColor: isDark ? '#854d0e' : '#fcd34d' }]}>
                    <Ionicons name="warning-outline" size={18} color={isDark ? '#fbbf24' : '#d97706'} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bannerTitle, { color: isDark ? '#fcd34d' : '#92400e' }]}>
                        {t('MATERIAL_DETAIL.MEDIA_UNAVAILABLE_TITLE')}
                      </Text>
                      <Text style={[styles.bannerMsg, { color: isDark ? '#fbbf24' : '#b45309' }]}>
                        {t('MATERIAL_DETAIL.MEDIA_UNAVAILABLE_MSG')}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Channel pill — fallback channels avoid late layout shift; skeleton reserves row until detail returns */}
                {channelInfo ? (
                  <TouchableOpacity
                    style={[styles.channelPill, { backgroundColor: chipBg }]}
                    activeOpacity={0.7}
                    onPress={() => WebBrowser.openBrowserAsync(channelInfo.url)}
                  >
                    {channelInfo.avatar ? (
                      <Image source={{ uri: channelInfo.avatar }} style={styles.channelAvatar} />
                    ) : (
                      <View style={[styles.channelAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#ddd', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text }}>{(channelInfo.name || '').slice(0, 2).toUpperCase()}</Text>
                      </View>
                    )}
                    <View>
                      <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>{channelInfo.name}</Text>
                      {channelInfo.subs ? (
                        <Text style={[styles.channelSubs, { color: colors.textTertiary }]}>{channelInfo.subs}</Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={channelInfo.platform === 'youtube' ? 'logo-youtube' : channelInfo.platform === 'vimeo' ? 'logo-vimeo' : 'musical-notes-outline'}
                      size={18}
                      color={channelInfo.platform === 'youtube' ? '#FF0000' : channelInfo.platform === 'vimeo' ? '#1ab7ea' : '#ff5500'}
                    />
                  </TouchableOpacity>
                ) : supportsChannelPill && !detailRequestDone ? (
                  <View
                    style={[styles.channelPillSkeleton, { backgroundColor: isDark ? '#2c2c2e' : '#ececec' }]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  />
                ) : null}

                {/* Unified quiz card */}
                {hasQuiz && (
                  <Animated.View style={[styles.quizCard, {
                    backgroundColor: cardBg,
                    borderColor: colors.border,
                    opacity: quizCardAnim,
                    transform: [{ translateY: quizCardAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
                  }]}>
                    <View style={styles.quizHeader}>
                      <Ionicons name="school-outline" size={20} color={isDark ? '#fff' : '#222'} />
                      <Text style={[styles.quizHeaderTitle, { color: colors.text }]}>{typeLabel}</Text>
                      <Text style={[styles.quizQuestionCount, { color: colors.textSecondary }]}>
                        {quiz.length} {quiz.length === 1 ? 'question' : 'questions'}
                      </Text>
                    </View>

                    {/* Stats */}
                    {material.stats && (
                      <View style={[styles.statsRow, { justifyContent: 'center', marginTop: 8, marginBottom: 0 }]}>
                        <View style={[styles.statPill, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}>
                          <Ionicons name="eye-outline" size={11} color={colors.textTertiary} />
                          <Text style={[styles.statText, { color: colors.text }]}>{material.stats.views || 0}</Text>
                        </View>
                        <View style={[styles.statPill, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}>
                          <Ionicons name="school-outline" size={11} color={colors.textTertiary} />
                          <Text style={[styles.statText, { color: colors.text }]}>{material.stats.quizAttempts || 0}</Text>
                        </View>
                        {material.stats.averageScore > 0 && (
                          <View style={[styles.statPill, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}>
                            <Ionicons name="bar-chart-outline" size={11} color={colors.textTertiary} />
                            <Text style={[styles.statText, { color: colors.text }]}>{material.stats.averageScore}%</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Tutor row */}
                    {tutorName ? (
                      <View style={[styles.tutorRow, { marginTop: 10 }]}>
                        {tutorPic ? (
                          <Image source={{ uri: tutorPic }} style={styles.tutorAvatar} />
                        ) : (
                          <View style={[styles.tutorAvatar, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2', alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="person" size={12} color={colors.textTertiary} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.tutorName, { color: colors.text }]}>
                            By {isTutorOwner ? `${tutorName} (You)` : tutorName}
                          </Text>
                          {addedDate ? (
                            <Text style={[styles.tutorDate, { color: colors.textTertiary }]}>Added {addedDate}</Text>
                          ) : null}
                        </View>
                      </View>
                    ) : null}

                    {/* Why take this */}
                    {material.whyTakeThis ? (
                      <Text style={[styles.quizWhy, { color: colors.textSecondary }]}>{material.whyTakeThis}</Text>
                    ) : null}

                    {/* Owner note */}
                    {isTutorOwner && (
                      <Text style={styles.ownerNoteInline}>
                        Preview — you're the owner. Students see Start Quiz here.
                      </Text>
                    )}

                    {/* Locked hint for non-owners */}
                    {isQuizLocked && (
                      <View style={[styles.lockedHint, { backgroundColor: isDark ? '#1c2333' : '#eef4ff' }]}>
                        <Ionicons name="lock-closed" size={14} color="#3b82f6" />
                        <Text style={[styles.lockedHintText, { color: '#3b82f6' }]}>
                          {t('MATERIAL_DETAIL.QUIZ_LOCKED_HINT')}
                        </Text>
                      </View>
                    )}
                  </Animated.View>
                )}
              </Animated.View>
            )}

            {/* ── Taking Quiz ── */}
            {hasQuiz && quizMode === 'taking' && currentQuestion && (
              <View style={[styles.quizCard, { backgroundColor: cardBg, borderColor: colors.border }]}>
                {/* Progress */}
                <View style={styles.quizProgress}>
                  <TouchableOpacity onPress={exitQuiz} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                  <Text style={[styles.quizProgressText, { color: colors.text }]}>
                    {currentQIndex + 1} / {quiz.length}
                  </Text>
                </View>
                <View style={[styles.progressBar, { backgroundColor: chipBg }]}>
                  <View style={[styles.progressFill, { width: `${((currentQIndex + 1) / quiz.length) * 100}%`, backgroundColor: isDark ? '#fff' : '#222' }]} />
                </View>

                {/* Question text */}
                <Text style={[styles.questionText, { color: colors.text }]}>{currentQuestion.question}</Text>

                {/* Multiple Choice */}
                {currentQType === 'multiple_choice' && currentQuestion.options?.map((opt: any, oi: number) => {
                  const selected = selectedAnswers[currentQIndex] === opt._id;
                  return (
                    <TouchableOpacity
                      key={opt._id || oi}
                      style={[styles.mcOption, {
                        borderColor: selected ? (isDark ? '#fff' : '#222') : inputBorder,
                        backgroundColor: selected ? (isDark ? '#2c2c2e' : '#fafafa') : 'transparent',
                      }]}
                      activeOpacity={0.7}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        selectAnswer(currentQIndex, opt._id);
                      }}
                    >
                      <View style={[styles.mcLetter, {
                        backgroundColor: selected ? (isDark ? '#fff' : '#222') : chipBg,
                      }]}>
                        <Text style={[styles.mcLetterText, {
                          color: selected ? (isDark ? '#000' : '#fff') : colors.text,
                        }]}>{LETTERS[oi]}</Text>
                      </View>
                      <Text style={[styles.mcText, { color: colors.text }]}>{opt.text}</Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Fill in the Blank */}
                {currentQType === 'fill_blank' && (
                  <TextInput
                    style={[styles.fillInput, { backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
                    value={fillBlankInput}
                    onChangeText={(v) => {
                      setFillBlankInput(prev => {
                        if (!prev.trim() && v.trim()) {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                        return v;
                      });
                      selectAnswer(currentQIndex, v);
                    }}
                    placeholder={t('MATERIAL_DETAIL.FILL_BLANK_PLACEHOLDER')}
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                  />
                )}

                {/* True / False */}
                {currentQType === 'true_false' && (
                  <View style={styles.tfRow}>
                    {[true, false].map(val => {
                      const selected = selectedAnswers[currentQIndex] === val;
                      return (
                        <TouchableOpacity
                          key={String(val)}
                          style={[styles.tfBtn, {
                            borderColor: selected ? (isDark ? '#fff' : '#222') : inputBorder,
                            backgroundColor: selected ? (isDark ? '#2c2c2e' : '#fafafa') : 'transparent',
                          }]}
                          activeOpacity={0.7}
                          onPress={() => {
                            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            selectAnswer(currentQIndex, val);
                          }}
                        >
                          <Ionicons
                            name={val ? 'checkmark-circle-outline' : 'close-circle-outline'}
                            size={18}
                            color={selected ? (val ? '#34c759' : '#e04848') : colors.textTertiary}
                          />
                          <Text style={[styles.tfLabel, { color: colors.text, fontWeight: selected ? '700' : '400' }]}>
                            {val ? t('CREATE_MATERIAL.QUIZ_TRUE') : t('CREATE_MATERIAL.QUIZ_FALSE')}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Ordering */}
                {currentQType === 'ordering' && (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <Text style={[styles.orderingHint, { color: colors.textTertiary }]}>
                      {t('MATERIAL_DETAIL.ORDERING_HINT')}
                    </Text>
                    {(orderingItems[currentQIndex] || []).map((item, ii) => (
                      <View key={`${item}-${ii}`} style={[styles.orderItem, { backgroundColor: chipBg, borderColor: inputBorder }]}>
                        <View style={[styles.orderNum, { backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
                          <Text style={[styles.orderNumText, { color: colors.text }]}>{ii + 1}</Text>
                        </View>
                        <Text style={[styles.orderItemText, { color: colors.text }]}>{item}</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {ii > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                const items = [...orderingItems[currentQIndex]];
                                [items[ii], items[ii - 1]] = [items[ii - 1], items[ii]];
                                setOrderingItems(prev => { const n = [...prev]; n[currentQIndex] = items; return n; });
                                selectAnswer(currentQIndex, items);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="chevron-up" size={16} color={colors.textTertiary} />
                            </TouchableOpacity>
                          )}
                          {ii < (orderingItems[currentQIndex]?.length || 0) - 1 && (
                            <TouchableOpacity
                              onPress={() => {
                                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                const items = [...orderingItems[currentQIndex]];
                                [items[ii], items[ii + 1]] = [items[ii + 1], items[ii]];
                                setOrderingItems(prev => { const n = [...prev]; n[currentQIndex] = items; return n; });
                                selectAnswer(currentQIndex, items);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ── Results ── */}
            {quizMode === 'results' && quizResult && (
              <View>
                {/* Score card */}
                <View style={[styles.resultsCard, { backgroundColor: cardBg, borderColor: colors.border }]}>
                  <View style={[styles.scoreCircle, { borderColor: getScoreColor(quizResult.score) }]}>
                    <Text style={[styles.scoreNumber, { color: getScoreColor(quizResult.score) }]}>
                      {displayScore}%
                    </Text>
                  </View>
                  <Text style={[styles.resultsTitle, { color: colors.text }]}>
                    {quizResult.score >= 80 ? t('MATERIAL_DETAIL.RESULT_GREAT')
                      : quizResult.score >= 60 ? t('MATERIAL_DETAIL.RESULT_GOOD')
                      : quizResult.score >= 40 ? t('MATERIAL_DETAIL.RESULT_OK')
                      : t('MATERIAL_DETAIL.RESULT_LOW')}
                  </Text>
                  <Text style={[styles.resultsSubtitle, { color: colors.textSecondary }]}>
                    {quizResult.correctCount} / {quizResult.totalQuestions} correct
                  </Text>
                </View>

                {/* Per-question breakdown */}
                <Text style={[styles.breakdownHeading, { color: colors.text }]}>
                  {t('MATERIAL_DETAIL.RESULTS_BREAKDOWN')}
                </Text>
                {quizResult.results.map((r: QuizResultItem, ri: number) => (
                  <View key={ri} style={[styles.resultRow, { borderColor: colors.border }]}>
                    <View style={[styles.resultIcon, { backgroundColor: r.isCorrect ? '#ecfdf5' : '#fef2f2' }]}>
                      <Ionicons
                        name={r.isCorrect ? 'checkmark' : 'close'}
                        size={12}
                        color={r.isCorrect ? '#10b981' : '#ef4444'}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.resultQuestion, { color: colors.text }]} numberOfLines={2}>
                        {r.question}
                      </Text>
                      {!r.isCorrect && (
                        <Text style={[styles.resultCorrect, { color: colors.textTertiary }]}>
                          Correct: {r.correctAnswerText}
                        </Text>
                      )}
                      {r.explanation ? (
                        <Text style={[styles.resultExplanation, { color: colors.textTertiary }]}>
                          {r.explanation}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Footer Actions ── */}
      {hasQuiz && (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + 8 }]}>
          {quizMode === 'idle' && !isQuizLocked && (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#222' }]}
              activeOpacity={0.85}
              onPress={startQuiz}
              disabled={isCheckingMedia}
            >
              {isCheckingMedia ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="school-outline" size={18} color="#fff" />
                  <Text style={[styles.primaryBtnText, { color: '#fff' }]}>
                    {t('MATERIAL_DETAIL.START_QUIZ')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {quizMode === 'idle' && isQuizLocked && (
            <TouchableOpacity
              style={[styles.primaryBtn, styles.purchaseBtn]}
              activeOpacity={0.85}
              onPress={purchaseQuiz}
              disabled={isPurchasing}
            >
              {isPurchasing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="lock-open-outline" size={18} color="#fff" />
                  <Text style={[styles.primaryBtnText, { color: '#fff' }]}>
                    {t('MATERIAL_DETAIL.UNLOCK_QUIZ', { price: material.price.toFixed(2) })}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {quizMode === 'taking' && (
            <View style={styles.footerRow}>
              {currentQIndex > 0 && (
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                  onPress={prevQuestion}
                >
                  <Ionicons name="chevron-back" size={18} color={colors.text} />
                  <Text style={[styles.secondaryBtnText, { color: colors.text }]}>{t('COMMON.PREVIOUS')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#222', flex: 1 }]}
                activeOpacity={0.85}
                onPress={isLastQuestion ? handleSubmitQuiz : nextQuestion}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.primaryBtnText, { color: '#fff' }]}>
                      {isLastQuestion ? t('MATERIAL_DETAIL.SUBMIT_QUIZ') : t('COMMON.NEXT')}
                    </Text>
                    {!isLastQuestion && <Ionicons name="chevron-forward" size={18} color="#fff" />}
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {quizMode === 'results' && (
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.border, flex: 1 }]}
                activeOpacity={0.7}
                onPress={retakeQuiz}
              >
                <Ionicons name="refresh-outline" size={18} color={colors.text} />
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>{t('MATERIAL_DETAIL.RETAKE')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#222', flex: 1 }]}
                activeOpacity={0.85}
                onPress={goBack}
              >
                <Text style={[styles.primaryBtnText, { color: '#fff' }]}>{t('COMMON.DONE')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      {/* ── Card Picker Modal ── */}
      {showCardPicker && (
        <View style={styles.cardPickerOverlay}>
          <TouchableOpacity style={styles.cardPickerBackdrop} activeOpacity={1} onPress={() => setShowCardPicker(false)} />
          <View style={[styles.cardPickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.cardPickerHeader}>
              <Text style={[styles.cardPickerTitle, { color: colors.text }]}>
                {t('MATERIAL_DETAIL.SELECT_CARD_TITLE')}
              </Text>
              <TouchableOpacity onPress={() => setShowCardPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Price summary */}
            <View style={[styles.cardPickerSummary, { backgroundColor: isDark ? '#1c1c1e' : '#f5f5f7' }]}>
              <Text style={[styles.cardPickerSummaryTitle, { color: colors.text }]} numberOfLines={1}>
                {material.title}
              </Text>
              <Text style={[styles.cardPickerSummaryPrice, { color: '#3b82f6' }]}>
                ${material.price.toFixed(2)}
              </Text>
            </View>

            {loadingCards ? (
              <ActivityIndicator size="large" color={colors.textSecondary} style={{ paddingVertical: 32 }} />
            ) : savedCards.length === 0 ? (
              <Text style={[styles.noCardsText, { color: colors.textSecondary }]}>
                {t('MATERIAL_DETAIL.NO_SAVED_CARDS')}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
                {savedCards.map(card => (
                  <TouchableOpacity
                    key={card.stripePaymentMethodId}
                    style={[styles.cardRow, { backgroundColor: isDark ? '#2c2c2e' : '#fff', borderColor: colors.border }]}
                    activeOpacity={0.7}
                    onPress={() => confirmPurchase(card)}
                  >
                    <Ionicons name="card-outline" size={20} color={colors.text} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardBrand, { color: colors.text }]}>
                        {(card.brand || 'Card').charAt(0).toUpperCase() + (card.brand || 'Card').slice(1)} •••• {card.last4}
                      </Text>
                      <Text style={[styles.cardExpiry, { color: colors.textTertiary }]}>
                        Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <Text style={[styles.stripeNote, { color: colors.textTertiary }]}>
              <Ionicons name="lock-closed" size={11} color={colors.textTertiary} /> Secure payment via Stripe
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBackLabel: { fontSize: 16, fontWeight: '500' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },

  /* Media */
  mediaWrap: { borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 16, overflow: 'hidden' },
  videoWebView: { flex: 1 },
  videoThumb: { width: '100%', aspectRatio: 16 / 9 },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  playBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  audioBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, marginBottom: 20 },
  audioBannerText: { flex: 1, fontSize: 15, fontWeight: '600' },
  passageCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20, maxHeight: 300, overflow: 'hidden' },
  passageLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  passageText: { fontSize: 15, lineHeight: 26 },

  /* Info */
  infoSection: { marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginBottom: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { fontSize: 13, fontWeight: '500' },

  /* Channel pill */
  channelPill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginBottom: 16, alignSelf: 'flex-start' },
  channelPillSkeleton: { height: 52, minWidth: 200, maxWidth: '72%' as const, borderRadius: 12, marginBottom: 16, alignSelf: 'flex-start' },
  channelAvatar: { width: 32, height: 32, borderRadius: 16 },
  channelName: { fontSize: 14, fontWeight: '600' },
  channelSubs: { fontSize: 12, marginTop: 1 },

  /* Unified quiz idle card */
  quizCard: { borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 8 },
  quizHeader: { alignItems: 'center', gap: 2 },
  quizHeaderTitle: { fontSize: 14, fontWeight: '700' },
  quizQuestionCount: { fontSize: 11 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 0 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  statText: { fontSize: 11, fontWeight: '500' },
  tutorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0, paddingVertical: 1 },
  tutorAvatar: { width: 26, height: 26, borderRadius: 13 },
  tutorName: { fontSize: 12, fontWeight: '600' },
  tutorDate: { fontSize: 10, marginTop: 0 },
  quizWhy: { fontSize: 12, lineHeight: 17, marginTop: 6, textAlign: 'center' },
  ownerNoteInline: { fontSize: 11, color: '#e04848', textAlign: 'center', marginTop: 6, fontStyle: 'italic' },

  /* Quiz taking */
  quizProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  quizProgressText: { fontSize: 12, fontWeight: '600' },
  progressBar: { height: 2.5, borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  questionText: { fontSize: 14, fontWeight: '600', lineHeight: 20, marginBottom: 10 },
  mcOption: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 6 },
  mcLetter: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mcLetterText: { fontSize: 11, fontWeight: '700' },
  mcText: { flex: 1, fontSize: 13 },
  fillInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  tfRow: { flexDirection: 'row', gap: 8 },
  tfBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 10, borderRadius: 8, borderWidth: 1 },
  tfLabel: { fontSize: 13 },
  orderingHint: { fontSize: 11, marginBottom: 1 },
  orderItem: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, borderWidth: 1 },
  orderNum: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  orderNumText: { fontSize: 11, fontWeight: '700' },
  orderItemText: { flex: 1, fontSize: 13 },

  /* Results */
  resultsCard: { borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center', marginBottom: 12, marginTop: 4 },
  scoreCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  scoreNumber: { fontSize: 24, fontWeight: '800' },
  resultsTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  resultsSubtitle: { fontSize: 12 },
  breakdownHeading: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  resultRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  resultIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  resultQuestion: { fontSize: 13, fontWeight: '500', marginBottom: 1 },
  resultCorrect: { fontSize: 11, marginTop: 1 },
  resultExplanation: { fontSize: 11, fontStyle: 'italic', marginTop: 2 },

  /* Banners (refund / media unavailable) */
  bannerWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  bannerTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  bannerMsg: { fontSize: 12, lineHeight: 18 },

  /* Locked quiz hint */
  lockedHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  lockedHintText: { fontSize: 12, fontWeight: '600' },

  /* Footer */
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16 },
  footerRow: { flexDirection: 'row', gap: 12 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 },
  primaryBtnText: { fontSize: 16, fontWeight: '700' },
  purchaseBtn: { backgroundColor: '#3b82f6' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1 },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },

  /* Card Picker Modal */
  cardPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    justifyContent: 'flex-end',
  },
  cardPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cardPickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  cardPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardPickerTitle: { fontSize: 18, fontWeight: '700' },
  cardPickerSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  cardPickerSummaryTitle: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 12 },
  cardPickerSummaryPrice: { fontSize: 16, fontWeight: '800' },
  noCardsText: { fontSize: 14, textAlign: 'center', paddingVertical: 24, lineHeight: 21 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  cardBrand: { fontSize: 14, fontWeight: '600' },
  cardExpiry: { fontSize: 12, marginTop: 1 },
  stripeNote: { fontSize: 11, textAlign: 'center', marginTop: 12 },
});
