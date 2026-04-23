import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { materialService, MaterialBundle, BundleItem, TutorMaterial, SavedCard } from '../services/materials';

const VISIBLE_LIMIT = 5;
const SETUP_AVAILABILITY_BLUE = '#08a0e8';
const HERO_HEIGHT = 280;
const CARD_OVERLAP = 40;

interface Props {
  bundle: MaterialBundle;
  goBack: () => void;
  onViewMaterial?: (material: TutorMaterial) => void;
  onEditBundle?: (bundle: MaterialBundle) => void;
}

export default function BundleDetailScreen({ bundle: initialBundle, goBack, onViewMaterial, onEditBundle }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isDark = colors.isDark;

  const [bundle, setBundle] = useState(initialBundle);
  const [isLoading, setIsLoading] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const scrollY = useRef(new Animated.Value(0)).current;
  const [cardAnim] = useState(() => new Animated.Value(0));

  const isOwner = useMemo(() => {
    if (!user?._id) return false;
    const tutorId = (bundle.tutorId as any)?._id || bundle.tutorId;
    return tutorId === user._id;
  }, [user?._id, bundle.tutorId]);

  const isFree = bundle.pricingType !== 'paid';
  const canAccess = isFree || hasPurchased || isOwner;
  const itemCount = bundle.items?.length || 0;

  const levelLabel = useMemo(() => {
    if (!bundle.level || bundle.level === 'any') return 'All Levels';
    return bundle.level.charAt(0).toUpperCase() + bundle.level.slice(1);
  }, [bundle.level]);

  const tutor = (bundle.tutorId || {}) as any;
  const tutorName = tutor.firstName && tutor.lastName
    ? `${tutor.firstName} ${tutor.lastName.charAt(0)}.`
    : tutor.name || 'Tutor';
  const tutorPicture = tutor.picture || '';
  const tutorBio = tutor.onboardingData?.bio || tutor.bio || '';
  const tutorSummary = tutor.onboardingData?.summary || '';
  const tutorCountry = tutor.country || '';
  const tutorLanguages: string[] = tutor.onboardingData?.languages || [];

  const displayItems = useMemo(() => {
    if (!bundle.items) return [];
    return showAllItems ? bundle.items : bundle.items.slice(0, VISIBLE_LIMIT);
  }, [bundle.items, showAllItems]);

  const hasMoreItems = itemCount > VISIBLE_LIMIT;

  const blurOpacity = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT * 0.6],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const heroDim = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [1, 0.4],
    extrapolate: 'clamp',
  });

  const heroScale = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [1, 1.08],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    Animated.timing(cardAnim, { toValue: 1, duration: 500, delay: 50, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: true }).start();
  }, []);

  const hasPopulatedData = !!(
    bundle.title &&
    bundle.items?.length >= 0 &&
    typeof (bundle.tutorId as any)?.picture === 'string'
  );

  useEffect(() => {
    if (!initialBundle._id || hasPopulatedData) return;
    materialService.getBundle(initialBundle._id).then(({ bundle: fresh, hasPurchased: purchased }) => {
      if (fresh) setBundle(fresh);
      if (purchased) setHasPurchased(true);
    });
  }, [initialBundle._id]);

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'video_quiz': return 'Video Quiz';
      case 'reading': return 'Reading';
      case 'listening': return 'Listening';
      default: return type;
    }
  };

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'video_quiz': return 'videocam';
      case 'reading': return 'book';
      case 'listening': return 'headset';
      default: return 'document';
    }
  };

  const handleItemPress = useCallback((item: BundleItem) => {
    if (!canAccess) return;
    const mat = item.materialId as TutorMaterial;
    if (mat?._id && onViewMaterial) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onViewMaterial(mat);
    }
  }, [canAccess, onViewMaterial]);

  const handlePurchase = useCallback(async () => {
    if (isPurchasing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isFree) {
      setIsPurchasing(true);
      const result = await materialService.purchaseBundle(bundle._id, 'default');
      setIsPurchasing(false);
      if (result.success) {
        setHasPurchased(true);
        Alert.alert('', t('BUNDLE.PURCHASE_SUCCESS'));
      } else {
        Alert.alert('', t('BUNDLE.PURCHASE_FAILED'));
      }
      return;
    }

    setLoadingCards(true);
    try {
      const cards = await materialService.getSavedCards();
      setSavedCards(cards);
      setShowCardPicker(true);
    } catch {
      Alert.alert('', t('MATERIAL_DETAIL.NO_SAVED_CARDS'));
    }
    setLoadingCards(false);
  }, [isPurchasing, isFree, bundle._id, t]);

  const confirmPurchase = useCallback(async (card: SavedCard) => {
    setShowCardPicker(false);
    Alert.alert(
      t('MATERIAL_DETAIL.PURCHASE_CONFIRM_TITLE'),
      t('MATERIAL_DETAIL.PURCHASE_CONFIRM_MSG', {
        price: bundle.price?.toFixed(2),
        brand: card.brand,
        last4: card.last4,
      }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purchase',
          onPress: async () => {
            setIsPurchasing(true);
            const result = await materialService.purchaseBundle(bundle._id, card.stripePaymentMethodId);
            setIsPurchasing(false);
            if (result.success) {
              setHasPurchased(true);
              Alert.alert('', t('BUNDLE.PURCHASE_SUCCESS'));
            } else {
              Alert.alert('', t('BUNDLE.PURCHASE_FAILED'));
            }
          },
        },
      ],
    );
  }, [bundle._id, bundle.price, t]);

  const cardStyle = {
    opacity: cardAnim,
    transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  return (
    <View style={[s.root, { backgroundColor: isDark ? '#111' : '#f7f7f7' }]}>
      {/* Hero — pinned behind the scroll view, stays in place */}
      <View style={s.heroPinned} pointerEvents="none">
        <Animated.View style={[s.heroImageWrap, { opacity: heroDim, transform: [{ scale: heroScale }] }]}>
          {bundle.coverImageUrl ? (
            <Image source={{ uri: bundle.coverImageUrl }} style={s.heroImg} contentFit="cover" />
          ) : (
            <View style={[s.heroPlaceholder, { backgroundColor: isDark ? '#1a2e44' : '#2a4a6e' }]}>
              <Ionicons name="folder-open-outline" size={64} color="rgba(255,255,255,0.12)" />
            </View>
          )}
        </Animated.View>
        <Animated.View style={[s.heroBlurWrap, { opacity: blurOpacity }]}>
          <BlurView intensity={50} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>

      {/* Nav buttons — above everything, fixed at top */}
      <View style={[s.heroActions, { paddingTop: Math.max(16, insets.top) }]} pointerEvents="box-none">
        <TouchableOpacity style={[s.heroBtn, { backgroundColor: isDark ? 'rgba(28,28,30,0.85)' : 'rgba(255,255,255,0.92)' }]} onPress={goBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={isDark ? '#f5f5f7' : '#222'} />
        </TouchableOpacity>
        {isOwner && onEditBundle && (
          <TouchableOpacity
            style={[s.heroBtn, s.heroBtnSm, { backgroundColor: isDark ? 'rgba(28,28,30,0.85)' : 'rgba(255,255,255,0.92)' }]}
            onPress={() => onEditBundle(bundle)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={16} color={isDark ? '#f5f5f7' : '#222'} />
          </TouchableOpacity>
        )}
      </View>

      {/* Scrollable content — transparent spacer then card */}
      <Animated.ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: (!isOwner && !canAccess) || (!isOwner && hasPurchased && !isFree) ? 100 : 40 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {/* Transparent spacer — hero shows through behind this */}
        <View style={{ height: HERO_HEIGHT - CARD_OVERLAP }} />

        {/* Card slides up over the hero */}
        <Animated.View style={[s.card, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }, cardStyle]}>
          {/* Tutor peek avatar */}
          <View style={s.tutorPeek}>
            <View style={[s.tutorPeekAvatar, { borderColor: isDark ? '#1c1c1e' : '#fff', backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
              {tutorPicture ? (
                <Image source={{ uri: tutorPicture }} style={s.tutorPeekImg} contentFit="cover" />
              ) : (
                <Ionicons name="person" size={24} color={isDark ? '#636366' : '#8e8e93'} />
              )}
            </View>
          </View>

          {/* Title */}
          <Text style={[s.title, { color: isDark ? '#f5f5f7' : '#222' }]}>{bundle.title}</Text>

          {/* Description */}
          {!!bundle.description && (
            <Text style={[s.description, { color: isDark ? '#aeaeb2' : '#6a6a6a' }]}>{bundle.description}</Text>
          )}

          {/* Meta row */}
          <View style={s.metaRow}>
            {!!bundle.language && (
              <>
                <View style={s.metaItem}>
                  <Ionicons name="globe-outline" size={14} color="#8e8e93" />
                  <Text style={s.metaText}>{bundle.language}</Text>
                </View>
                <Text style={s.metaDot}>·</Text>
              </>
            )}
            <Text style={s.metaText}>{levelLabel}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaText}>{itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
          </View>

          {/* Curated by */}
          <Text style={[s.curatedBy, { color: isDark ? '#636366' : '#8e8e93' }]}>
            Curated by {tutorName}
          </Text>

          {/* Owner pill */}
          {isOwner && (
            <View style={[s.ownerPill, { backgroundColor: isDark ? '#1c2a3d' : '#F0F4FF', borderColor: isDark ? '#2a3d55' : '#D6E4FF' }]}>
              <Ionicons name="eye-outline" size={14} color={isDark ? '#7AB3E0' : '#4B7FBF'} />
              <Text style={[s.ownerPillText, { color: isDark ? '#7AB3E0' : '#4B7FBF' }]}>Student preview</Text>
            </View>
          )}

          {/* Divider */}
          <View style={[s.divider, { backgroundColor: isDark ? '#2c2c2e' : '#EBEBEB' }]} />

          {/* Items */}
          {displayItems.map((item, idx) => {
            const mat = (item.materialId || {}) as any;
            return (
              <TouchableOpacity
                key={mat._id || idx}
                style={[
                  s.item,
                  { borderBottomColor: isDark ? '#2c2c2e' : '#f2f2f2' },
                  idx === displayItems.length - 1 && { borderBottomWidth: 0 },
                ]}
                activeOpacity={canAccess ? 0.7 : 1}
                onPress={() => handleItemPress(item)}
                disabled={!canAccess}
              >
                <View style={[s.itemThumb, { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
                  {mat.thumbnailUrl ? (
                    <Image source={{ uri: mat.thumbnailUrl }} style={s.itemThumbImg} contentFit="cover" />
                  ) : (
                    <View style={[s.itemThumbFallback, { backgroundColor: isDark ? '#2c2c2e' : '#E8F0FE' }]}>
                      <Ionicons name={getTypeIcon(mat.materialType || '')} size={24} color={isDark ? '#636366' : '#4298d3'} />
                    </View>
                  )}
                  {!canAccess && (
                    <View style={s.itemLock}>
                      <Ionicons name="lock-closed" size={18} color="#fff" />
                    </View>
                  )}
                </View>
                <View style={s.itemBody}>
                  <Text style={[s.itemTitle, { color: isDark ? '#f5f5f7' : '#222' }]} numberOfLines={1}>{mat.title || 'Material'}</Text>
                  {!!mat.description && (
                    <Text style={[s.itemDesc, { color: isDark ? '#8e8e93' : '#8e8e93' }]} numberOfLines={2}>{mat.description}</Text>
                  )}
                  <View style={s.itemMeta}>
                    <Ionicons name={getTypeIcon(mat.materialType || '')} size={13} color="#aeaeb2" />
                    <Text style={s.itemType}>{getTypeLabel(mat.materialType || '')}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Show all / Show less */}
          {hasMoreItems && (
            <TouchableOpacity
              style={[s.showAllBtn, { borderColor: isDark ? '#f5f5f7' : '#222' }]}
              activeOpacity={0.7}
              onPress={() => { setShowAllItems(!showAllItems); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Text style={[s.showAllText, { color: isDark ? '#f5f5f7' : '#222' }]}>
                {showAllItems ? 'Show less' : `Show all ${itemCount}`}
              </Text>
            </TouchableOpacity>
          )}

          {/* Divider */}
          {!isOwner && (
            <View style={[s.divider, { backgroundColor: isDark ? '#2c2c2e' : '#EBEBEB', marginTop: 8 }]} />
          )}

          {/* About tutor */}
          <View style={s.aboutSection}>
            <Text style={[s.aboutHeading, { color: isDark ? '#f5f5f7' : '#222' }]}>About the tutor</Text>
            <View style={[s.aboutCard, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#EBEBEB' }]}>
              <View style={[s.aboutProfile, { borderBottomColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
                <View style={[s.aboutAvatarRing, { backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' }]}>
                  <View style={[s.aboutAvatar, { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
                    {tutorPicture ? (
                      <Image source={{ uri: tutorPicture }} style={s.aboutAvatarImg} contentFit="cover" />
                    ) : (
                      <Ionicons name="person" size={32} color={isDark ? '#636366' : '#c7c7cc'} />
                    )}
                  </View>
                </View>
                <Text style={[s.aboutName, { color: isDark ? '#f5f5f7' : '#222' }]}>{tutorName}</Text>
                {!!tutorSummary && <Text style={s.aboutRole} numberOfLines={2}>{tutorSummary}</Text>}
              </View>

              <View style={s.aboutFacts}>
                {!!tutorCountry && (
                  <View style={s.factRow}>
                    <Ionicons name="flag-outline" size={22} color={isDark ? '#f5f5f7' : '#222'} />
                    <Text style={[s.factText, { color: isDark ? '#f5f5f7' : '#222' }]}>From {tutorCountry}</Text>
                  </View>
                )}
                {tutorLanguages.length > 0 && (
                  <View style={s.factRow}>
                    <Ionicons name="chatbubbles-outline" size={22} color={isDark ? '#f5f5f7' : '#222'} />
                    <Text style={[s.factText, { color: isDark ? '#f5f5f7' : '#222' }]}>Teaches {tutorLanguages.join(', ')}</Text>
                  </View>
                )}
              </View>
            </View>
            {!!tutorBio && (
              <Text style={[s.aboutBio, { color: isDark ? '#8e8e93' : '#6a6a6a' }]} numberOfLines={4}>{tutorBio}</Text>
            )}
          </View>
        </Animated.View>
      </Animated.ScrollView>

      {/* Sticky CTA */}
      {!isOwner && !canAccess && (
        <View style={[s.cta, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderTopColor: isDark ? '#2c2c2e' : '#ebebeb', paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={[s.ctaBtn, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#222' }]}
            activeOpacity={0.85}
            onPress={handlePurchase}
            disabled={isPurchasing || loadingCards}
          >
            {(isPurchasing || loadingCards) ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={s.ctaBtnLabel}>Get Bundle</Text>
                <View style={s.ctaBtnDivider} />
                <Text style={s.ctaBtnPrice}>{isFree ? 'Free' : `$${bundle.price}`}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Owned CTA */}
      {!isOwner && hasPurchased && !isFree && (
        <View style={[s.cta, s.ctaOwned, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderTopColor: isDark ? '#2c2c2e' : '#ebebeb', paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.ctaOwnedInner}>
            <Ionicons name="checkmark-circle" size={18} color="#34C759" />
            <Text style={[s.ctaOwnedText, { color: isDark ? '#f5f5f7' : '#222' }]}>You own this bundle</Text>
          </View>
        </View>
      )}

      {/* Card picker modal */}
      {showCardPicker && (
        <View style={s.cardPickerOverlay}>
          <TouchableOpacity style={s.cardPickerBackdrop} activeOpacity={1} onPress={() => setShowCardPicker(false)} />
          <View style={[s.cardPickerSheet, { backgroundColor: isDark ? '#1c1c1e' : '#fff', paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={s.cardPickerHeader}>
              <Text style={[s.cardPickerTitle, { color: colors.text }]}>{t('MATERIAL_DETAIL.SELECT_CARD_TITLE')}</Text>
              <TouchableOpacity onPress={() => setShowCardPicker(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={s.cardPickerSummary}>
              <Text style={[s.cardPickerSummaryTitle, { color: colors.text }]}>{bundle.title}</Text>
              <Text style={[s.cardPickerSummaryPrice, { color: colors.textSecondary }]}>${bundle.price?.toFixed(2)}</Text>
            </View>
            {savedCards.length === 0 ? (
              <Text style={[s.noCardsText, { color: colors.textSecondary }]}>{t('MATERIAL_DETAIL.NO_SAVED_CARDS')}</Text>
            ) : (
              savedCards.map(c => (
                <TouchableOpacity
                  key={c.stripePaymentMethodId}
                  style={[s.cardRow, { borderColor: isDark ? '#3a3a3c' : '#f0f0f0' }]}
                  activeOpacity={0.7}
                  onPress={() => confirmPurchase(c)}
                >
                  <Text style={[s.cardBrand, { color: colors.text }]}>{c.brand} •••• {c.last4}</Text>
                  <Text style={[s.cardExpiry, { color: colors.textSecondary }]}>{c.expMonth}/{c.expYear}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },

  /* Hero — pinned behind scroll */
  heroPinned: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: HERO_HEIGHT, overflow: 'hidden', backgroundColor: '#1a1a1a',
    zIndex: 0,
  },
  heroImageWrap: { width: '100%', height: '100%' },
  heroImg: { width: '100%', height: '100%' },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroBlurWrap: { ...StyleSheet.absoluteFillObject },
  heroActions: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 16,
  },
  heroBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3,
  },
  heroBtnSm: { width: 34, height: 34, borderRadius: 17 },

  /* Card */
  card: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24,
    minHeight: 400,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 5,
  },

  /* Tutor peek */
  tutorPeek: { alignItems: 'center', marginTop: -52, marginBottom: 14 },
  tutorPeekAvatar: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden',
    borderWidth: 3, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
  },
  tutorPeekImg: { width: '100%', height: '100%' },

  /* Content */
  title: { fontSize: 26, fontWeight: '700', lineHeight: 31, marginBottom: 10, textAlign: 'center' },
  description: { fontSize: 15, lineHeight: 23, marginBottom: 14, textAlign: 'center' },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 13, color: '#8e8e93' },
  metaDot: { fontSize: 13, color: '#c7c7cc' },

  curatedBy: { fontSize: 13, marginBottom: 12, textAlign: 'center' },

  ownerPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1,
    marginTop: 4, marginBottom: 4,
  },
  ownerPillText: { fontSize: 12, fontWeight: '600' },

  divider: { height: 1, marginVertical: 20 },

  /* Items */
  item: {
    flexDirection: 'row', gap: 14, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemThumb: {
    width: 120, aspectRatio: 4 / 3, borderRadius: 12, overflow: 'hidden',
    position: 'relative',
  },
  itemThumbImg: { width: '100%', height: '100%' },
  itemThumbFallback: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  itemLock: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  itemBody: { flex: 1, justifyContent: 'center', gap: 3 },
  itemTitle: { fontSize: 15, fontWeight: '600' },
  itemDesc: { fontSize: 13, lineHeight: 18 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  itemType: { fontSize: 12, color: '#aeaeb2' },

  /* Show all */
  showAllBtn: {
    borderWidth: 1, borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 8,
  },
  showAllText: { fontSize: 14, fontWeight: '600' },

  /* About tutor */
  aboutSection: { paddingBottom: 16 },
  aboutHeading: { fontSize: 20, fontWeight: '700', marginBottom: 20 },
  aboutCard: {
    borderWidth: 1, borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.07, shadowRadius: 20, elevation: 4,
  },
  aboutProfile: {
    alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  aboutAvatarRing: { width: 80, height: 80, borderRadius: 40, padding: 3, marginBottom: 12 },
  aboutAvatar: {
    width: '100%', height: '100%', borderRadius: 38, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  aboutAvatarImg: { width: '100%', height: '100%' },
  aboutName: { fontSize: 17, fontWeight: '700', lineHeight: 20, marginBottom: 4 },
  aboutRole: { fontSize: 13, color: '#8e8e93', textAlign: 'center', maxWidth: 240 },
  aboutFacts: { paddingVertical: 20, paddingHorizontal: 24, gap: 16 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  factText: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  aboutBio: { fontSize: 15, lineHeight: 25, marginTop: 20 },

  /* Sticky CTA */
  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
    borderTopWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 5,
    paddingHorizontal: 20, paddingTop: 12,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, paddingHorizontal: 32, borderRadius: 50,
  },
  ctaBtnLabel: { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  ctaBtnDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 14 },
  ctaBtnPrice: { color: '#fff', fontSize: 16, fontWeight: '700' },

  ctaOwned: {},
  ctaOwnedInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  ctaOwnedText: { fontSize: 15, fontWeight: '600' },

  /* Card picker */
  cardPickerOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, justifyContent: 'flex-end' },
  cardPickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  cardPickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  cardPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  cardPickerTitle: { fontSize: 18, fontWeight: '700' },
  cardPickerSummary: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  cardPickerSummaryTitle: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 12 },
  cardPickerSummaryPrice: { fontSize: 15, fontWeight: '700' },
  noCardsText: { fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 20 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1 },
  cardBrand: { flex: 1, fontSize: 15, fontWeight: '600' },
  cardExpiry: { fontSize: 13 },
});
