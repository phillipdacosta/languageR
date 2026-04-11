import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import { materialService, MaterialBundle, TutorMaterial } from '../services/materials';

const SETUP_AVAILABILITY_BLUE = '#08a0e8';

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Korean', 'Chinese', 'Arabic', 'Russian', 'Hindi',
  'Turkish', 'Dutch', 'Polish', 'Vietnamese', 'Thai', 'Swedish',
];

const LEVELS: { value: string; label: string }[] = [
  { value: 'any', label: 'Any Level' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

type BundleWizardStepId =
  | 'bundleShare'
  | 'bundleTitle'
  | 'bundleDescription'
  | 'bundleMaterials'
  | 'bundleCover'
  | 'bundleLanguageLevel'
  | 'bundleTags'
  | 'bundlePrice';

function buildBundleWizardSteps(pricingType: 'free' | 'paid' | null): BundleWizardStepId[] {
  const steps: BundleWizardStepId[] = [
    'bundleShare',
    'bundleTitle',
    'bundleDescription',
    'bundleMaterials',
    'bundleCover',
    'bundleLanguageLevel',
    'bundleTags',
  ];
  if (pricingType === 'paid') steps.push('bundlePrice');
  return steps;
}

function bundleWizardCopyKeys(id: BundleWizardStepId): { h: string; d: string } {
  const map: Record<BundleWizardStepId, { h: string; d: string }> = {
    bundleShare: { h: 'CREATE_BUNDLE.WIZ_SHARE_H', d: 'CREATE_BUNDLE.WIZ_SHARE_D' },
    bundleTitle: { h: 'CREATE_BUNDLE.WIZ_TITLE_H', d: 'CREATE_BUNDLE.WIZ_TITLE_D' },
    bundleDescription: { h: 'CREATE_BUNDLE.WIZ_DESC_H', d: 'CREATE_BUNDLE.WIZ_DESC_D' },
    bundleMaterials: { h: 'CREATE_BUNDLE.WIZ_MATERIALS_H', d: 'CREATE_BUNDLE.WIZ_MATERIALS_D' },
    bundleCover: { h: 'CREATE_BUNDLE.WIZ_COVER_H', d: 'CREATE_BUNDLE.WIZ_COVER_D' },
    bundleLanguageLevel: { h: 'CREATE_BUNDLE.WIZ_LANG_H', d: 'CREATE_BUNDLE.WIZ_LANG_D' },
    bundleTags: { h: 'CREATE_BUNDLE.WIZ_TAGS_H', d: 'CREATE_BUNDLE.WIZ_TAGS_D' },
    bundlePrice: { h: 'CREATE_BUNDLE.WIZ_PRICE_H', d: 'CREATE_BUNDLE.WIZ_PRICE_D' },
  };
  return map[id];
}

interface Props {
  goBack: () => void;
  editingBundle?: MaterialBundle | null;
  materials: TutorMaterial[];
}

export default function CreateBundleScreen({ goBack, editingBundle, materials }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isDark = colors.isDark;
  const isEditing = !!editingBundle;

  const [title, setTitle] = useState(editingBundle?.title || '');
  const [description, setDescription] = useState(editingBundle?.description || '');
  const [language, setLanguage] = useState(editingBundle?.language || LANGUAGES[0]);
  const [level, setLevel] = useState<string>(editingBundle?.level || 'any');
  const [pricingType, setPricingType] = useState<'free' | 'paid' | null>(() =>
    isEditing && editingBundle ? editingBundle.pricingType : null
  );
  const [price, setPrice] = useState(editingBundle?.price?.toString() || '');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>(
    () => editingBundle?.items?.map(i => typeof i.materialId === 'string' ? i.materialId : (i.materialId as any)?._id).filter(Boolean) || []
  );
  const [structuredTags, setStructuredTags] = useState<string[]>(() => editingBundle?.structuredTags ? [...editingBundle.structuredTags] : []);
  const [structuredTagInput, setStructuredTagInput] = useState('');
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [existingCoverUrl, setExistingCoverUrl] = useState(editingBundle?.coverImageUrl || null);
  const [isSaving, setIsSaving] = useState(false);
  /** In-place edit save (footer / nav) — separate so primary CTA does not show publish spinner. */
  const [isPersistingEdit, setIsPersistingEdit] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [bundleStepIndex, setBundleStepIndex] = useState(0);
  /** After first draft create while staying in the wizard (mirrors material flow). */
  const [persistedBundleId, setPersistedBundleId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const coverPreview = coverUri || existingCoverUrl;
  const publishedMaterials = useMemo(() => materials.filter(m => m.status === 'published' || m.status === 'draft'), [materials]);

  const bundleSteps = useMemo(() => buildBundleWizardSteps(pricingType), [pricingType]);

  const prevPricingRef = useRef(pricingType);
  useEffect(() => {
    if (prevPricingRef.current !== pricingType) {
      setBundleStepIndex(0);
      prevPricingRef.current = pricingType;
    }
  }, [pricingType]);

  useEffect(() => {
    if (bundleStepIndex >= bundleSteps.length && bundleSteps.length > 0) {
      setBundleStepIndex(bundleSteps.length - 1);
    }
  }, [bundleSteps.length, bundleStepIndex]);

  const bundleStepId = bundleSteps[bundleStepIndex] ?? 'bundleShare';
  const { h: headlineKey, d: sublineKey } = bundleWizardCopyKeys(bundleStepId);
  /** Counting starts at “Name your bundle” (index 1), not share (0). */
  const bundleNumberedTotal = bundleSteps.length > 1 ? bundleSteps.length - 1 : 1;
  const bundleNumberedCurrent = bundleStepIndex >= 1 ? bundleStepIndex : 0;
  const progressWidth =
    bundleStepIndex >= 1 && bundleNumberedTotal > 0
      ? (bundleNumberedCurrent / bundleNumberedTotal) * 100
      : 0;
  const isLastStep = bundleStepIndex >= bundleSteps.length - 1;
  /** Index 0 = share, 1 = title — show Save draft only from description onward */
  const showFooterSaveDraft = !isEditing && bundleStepIndex >= 2;

  const activeBundleId = editingBundle?._id ?? persistedBundleId;

  const navBackLabel = useMemo(() => {
    if (bundleStepIndex <= 0) {
      return t('CREATE_BUNDLE.NAV_MY_BUNDLES');
    }
    const prevId = bundleSteps[bundleStepIndex - 1];
    if (prevId === 'bundleShare') {
      return t('CREATE_MATERIAL.STEP_PRICING');
    }
    return t(bundleWizardCopyKeys(prevId).h);
  }, [bundleStepIndex, bundleSteps, t]);

  /** Draft API requires pricing; paid drafts need a valid price (same as backend). */
  const canSaveDraft = useMemo(() => {
    if (pricingType === null) return false;
    if (pricingType === 'paid') {
      const p = parseFloat(price);
      return !Number.isNaN(p) && p > 0;
    }
    return true;
  }, [pricingType, price]);

  const hasPaidInFree = useMemo(() => {
    if (pricingType !== 'free') return false;
    return publishedMaterials.some(m => selectedMaterialIds.includes(m._id) && m.pricingType === 'paid');
  }, [pricingType, publishedMaterials, selectedMaterialIds]);

  const canPublish =
    pricingType !== null &&
    title.trim().length > 0 &&
    language &&
    (pricingType !== 'paid' || parseFloat(price) > 0);

  const pickCover = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1200, 630],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setCoverUri(result.assets[0].uri);
    }
  }, []);

  const removeCover = useCallback(() => {
    setCoverUri(null);
    setExistingCoverUrl(null);
  }, []);

  const toggleMaterial = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMaterialIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

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

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'video_quiz': return 'videocam';
      case 'reading': return 'book';
      case 'listening': return 'headset';
      default: return 'layers';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'video_quiz': return 'Video Quiz';
      case 'reading': return 'Reading';
      case 'listening': return 'Listening';
      default: return type;
    }
  };

  const validateCurrentStep = useCallback((): boolean => {
    switch (bundleStepId) {
      case 'bundleShare':
        if (pricingType === null) {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
          return false;
        }
        return true;
      case 'bundleTitle':
        if (!title.trim()) {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
          return false;
        }
        return true;
      case 'bundleMaterials':
        if (selectedMaterialIds.length < 2) {
          Alert.alert('', t('CREATE_BUNDLE.WIZ_TOAST_MATERIALS_MIN_TWO'));
          return false;
        }
        return true;
      case 'bundleLanguageLevel':
        if (!language?.trim()) {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
          return false;
        }
        return true;
      case 'bundlePrice':
        if (pricingType === 'paid' && (!price || parseFloat(price) <= 0)) {
          Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
          return false;
        }
        return true;
      default:
        return true;
    }
  }, [bundleStepId, title, selectedMaterialIds, language, pricingType, price, t]);

  const isCurrentStepValid = useMemo(() => {
    switch (bundleStepId) {
      case 'bundleShare':
        return pricingType !== null;
      case 'bundleTitle':
        return title.trim().length > 0;
      case 'bundleMaterials':
        return selectedMaterialIds.length >= 2;
      case 'bundleLanguageLevel':
        return !!language?.trim();
      case 'bundlePrice':
        return pricingType !== 'paid' || (parseFloat(price) > 0);
      default:
        return true;
    }
  }, [bundleStepId, title, selectedMaterialIds, language, pricingType, price]);

  const handleHeaderBack = useCallback(() => {
    if (bundleStepIndex <= 0) {
      goBack();
    } else {
      setBundleStepIndex(i => i - 1);
    }
  }, [bundleStepIndex, goBack]);

  const handleWizardNext = useCallback(() => {
    if (!validateCurrentStep()) return;
    if (bundleStepIndex >= bundleSteps.length - 1) return;
    setBundleStepIndex(i => i + 1);
  }, [validateCurrentStep, bundleStepIndex, bundleSteps.length]);

  /** Persist current bundle fields while editing; preserves draft vs published status. */
  const persistBundleEdit = useCallback(async (): Promise<boolean> => {
    if (!isEditing || !editingBundle?._id) return false;
    if (!canSaveDraft) {
      Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
      return false;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsPersistingEdit(true);
    try {
      let coverImageUrl = existingCoverUrl || undefined;
      if (coverUri) {
        coverImageUrl = await materialService.uploadBundleCover(coverUri);
        setExistingCoverUrl(coverImageUrl);
        setCoverUri(null);
      }

      const preservedStatus = editingBundle.status === 'published' ? 'published' : 'draft';
      const payload: Record<string, any> = {
        title: title.trim() || 'Untitled draft',
        description: description.trim(),
        coverImageUrl,
        language,
        level,
        items: selectedMaterialIds.map((id, i) => ({ materialId: id, sortOrder: i })),
        pricingType: pricingType as 'free' | 'paid',
        price: pricingType === 'paid' ? parseFloat(price) : 0,
        status: preservedStatus,
      };
      if (structuredTags.length > 0) payload.structuredTags = structuredTags;

      const updated = await materialService.updateBundle(editingBundle._id, payload);
      if (!updated) throw new Error(t('CREATE_BUNDLE.SAVE_FAILED'));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (err: any) {
      Alert.alert('Error', err?.message || t('CREATE_BUNDLE.SAVE_FAILED'));
      return false;
    } finally {
      setIsPersistingEdit(false);
    }
  }, [
    isEditing,
    editingBundle,
    canSaveDraft,
    title,
    description,
    language,
    level,
    pricingType,
    price,
    selectedMaterialIds,
    coverUri,
    existingCoverUrl,
    structuredTags,
    t,
  ]);

  const handleFooterSaveInPlace = useCallback(async () => {
    const ok = await persistBundleEdit();
    if (ok) {
      Alert.alert('', t('CREATE_BUNDLE.SAVED_TOAST'), [{ text: t('COMMON.OK') }]);
    }
  }, [persistBundleEdit, t]);

  const handleSaveAndExit = useCallback(async () => {
    const ok = await persistBundleEdit();
    if (ok) goBack();
  }, [persistBundleEdit, goBack]);

  const saveDraftProgress = useCallback(async () => {
    if (!canSaveDraft) {
      Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    try {
      let coverImageUrl = existingCoverUrl || undefined;
      if (coverUri) {
        coverImageUrl = await materialService.uploadBundleCover(coverUri);
        setExistingCoverUrl(coverImageUrl);
        setCoverUri(null);
      }

      const payload: Record<string, any> = {
        title: title.trim() || 'Untitled draft',
        description: description.trim(),
        coverImageUrl,
        language,
        level,
        items: selectedMaterialIds.map((id, i) => ({ materialId: id, sortOrder: i })),
        pricingType: pricingType as 'free' | 'paid',
        price: pricingType === 'paid' ? parseFloat(price) : 0,
        status: 'draft',
      };
      if (structuredTags.length > 0) payload.structuredTags = structuredTags;

      if (activeBundleId) {
        const updated = await materialService.updateBundle(activeBundleId, payload);
        if (!updated) throw new Error(t('CREATE_BUNDLE.SAVE_FAILED'));
      } else {
        const created = await materialService.createBundle(payload);
        if (created?._id) setPersistedBundleId(created._id);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('', t('CREATE_BUNDLE.DRAFT_SAVED_TOAST'), [{ text: t('COMMON.OK') }]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || t('CREATE_BUNDLE.SAVE_FAILED'));
    }
    setIsSaving(false);
  }, [
    canSaveDraft,
    title,
    description,
    language,
    level,
    pricingType,
    price,
    selectedMaterialIds,
    coverUri,
    existingCoverUrl,
    structuredTags,
    activeBundleId,
    t,
  ]);

  const savePublished = useCallback(async () => {
    if (!title.trim()) return;
    if (pricingType === null) {
      Alert.alert('', t('CREATE_MATERIAL.TOAST_FILL_REQUIRED'));
      return;
    }
    if (pricingType === 'paid' && (!price || parseFloat(price) <= 0)) return;
    if (selectedMaterialIds.length < 2) {
      Alert.alert('', t('CREATE_BUNDLE.WIZ_TOAST_MATERIALS_MIN_TWO'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    try {
      let coverImageUrl = existingCoverUrl || undefined;
      if (coverUri) {
        coverImageUrl = await materialService.uploadBundleCover(coverUri);
        setExistingCoverUrl(coverImageUrl);
        setCoverUri(null);
      }

      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        coverImageUrl,
        language,
        level,
        items: selectedMaterialIds.map((id, i) => ({ materialId: id, sortOrder: i })),
        pricingType: pricingType as 'free' | 'paid',
        price: pricingType === 'paid' ? parseFloat(price) : 0,
        status: 'published',
      };
      if (structuredTags.length > 0) payload.structuredTags = structuredTags;

      if (activeBundleId) {
        const updated = await materialService.updateBundle(activeBundleId, payload);
        if (!updated) throw new Error(t('CREATE_BUNDLE.SAVE_FAILED'));
      } else {
        await materialService.createBundle(payload);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        '',
        isEditing ? t('CREATE_BUNDLE.UPDATED_TOAST') : t('CREATE_BUNDLE.PUBLISHED_TOAST'),
        [{ text: t('COMMON.OK'), onPress: goBack }],
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || t('CREATE_BUNDLE.SAVE_FAILED'));
    }
    setIsSaving(false);
  }, [
    title,
    description,
    language,
    level,
    pricingType,
    price,
    selectedMaterialIds,
    coverUri,
    existingCoverUrl,
    structuredTags,
    isEditing,
    activeBundleId,
    goBack,
    t,
  ]);

  const inputBg = isDark ? '#1c1c1e' : '#fff';
  const inputBorder = isDark ? '#3a3a3c' : '#e5e5ea';

  const panel = (() => {
    switch (bundleStepId) {
      case 'bundleShare':
        return (
          <View style={s.panel}>
            <View style={s.pricingCards}>
              <TouchableOpacity
                style={[
                  s.pricingCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: pricingType === 'free' ? colors.text : colors.border,
                    borderWidth: pricingType === 'free' ? 2 : 1,
                    shadowOpacity: isDark ? 0 : 0.05,
                  },
                ]}
                activeOpacity={0.7}
                onPress={() => { setPricingType('free'); setPrice(''); }}
              >
                <View style={[s.pricingIconWrap, { backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : '#ECFDF5' }]}>
                  <Ionicons name="gift-outline" size={24} color="#10b981" />
                </View>
                <Text style={[s.pricingTitle, { color: colors.text }]}>{t('CREATE_BUNDLE.PRICING_FREE')}</Text>
                <Text style={[s.pricingDesc, { color: colors.textSecondary }]}>{t('CREATE_BUNDLE.PRICE_TIP_FREE')}</Text>
                {pricingType === 'free' && (
                  <Ionicons name="checkmark-circle" size={22} color="#10b981" style={{ marginTop: 8 }} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.pricingCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: pricingType === 'paid' ? colors.text : colors.border,
                    borderWidth: pricingType === 'paid' ? 2 : 1,
                    shadowOpacity: isDark ? 0 : 0.05,
                  },
                ]}
                activeOpacity={0.7}
                onPress={() => setPricingType('paid')}
              >
                <View style={[s.pricingIconWrap, { backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={24} color={isDark ? '#60a5fa' : '#2563eb'} />
                </View>
                <Text style={[s.pricingTitle, { color: colors.text }]}>{t('CREATE_BUNDLE.PRICING_PAID')}</Text>
                <Text style={[s.pricingDesc, { color: colors.textSecondary }]}>{t('CREATE_BUNDLE.PRICE_TIP_PAID')}</Text>
                {pricingType === 'paid' && (
                  <Ionicons name="checkmark-circle" size={22} color={SETUP_AVAILABILITY_BLUE} style={{ marginTop: 8 }} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        );
      case 'bundleTitle':
        return (
          <View style={s.panel}>
            <Text style={[s.label, { color: colors.text }]}>
              {t('CREATE_BUNDLE.FIELD_TITLE')} <Text style={s.required}>*</Text>
            </Text>
            <TextInput
              style={[s.input, { backgroundColor: inputBg, color: colors.text, borderColor: inputBorder }]}
              value={title}
              onChangeText={setTitle}
              placeholder={t('CREATE_BUNDLE.FIELD_TITLE_PLACEHOLDER')}
              placeholderTextColor={isDark ? '#636366' : '#aeaeb2'}
              maxLength={100}
            />
            <Text style={[s.fieldHint, { color: isDark ? '#636366' : '#aeaeb2' }]}>{t('CREATE_BUNDLE.FIELD_TITLE_HINT')}</Text>
          </View>
        );
      case 'bundleDescription':
        return (
          <View style={s.panel}>
            <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_DESCRIPTION')}</Text>
            <TextInput
              style={[s.input, s.textArea, { backgroundColor: inputBg, color: colors.text, borderColor: inputBorder }]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('CREATE_BUNDLE.FIELD_DESC_PLACEHOLDER')}
              placeholderTextColor={isDark ? '#636366' : '#aeaeb2'}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
          </View>
        );
      case 'bundleMaterials':
        return (
          <View style={s.panel}>
            <View style={s.materialFieldHeader}>
              <Text style={[s.label, { color: colors.text, marginBottom: 0 }]}>{t('CREATE_BUNDLE.FIELD_MATERIALS')}</Text>
              <Text style={[s.selectedCount, { color: colors.textSecondary }]}>{selectedMaterialIds.length} selected</Text>
            </View>
            {publishedMaterials.length === 0 ? (
              <View style={[s.emptyMaterials, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                <Ionicons name="layers-outline" size={28} color={isDark ? '#636366' : '#aeaeb2'} />
                <Text style={[s.emptyMaterialsText, { color: isDark ? '#636366' : '#8e8e93' }]}>{t('CREATE_BUNDLE.NO_MATERIALS')}</Text>
              </View>
            ) : (
              <View style={[s.materialList, { borderColor: inputBorder }]}>
                {publishedMaterials.map(m => {
                  const isSelected = selectedMaterialIds.includes(m._id);
                  return (
                    <TouchableOpacity
                      key={m._id}
                      style={[s.materialItem, isSelected && { backgroundColor: isDark ? '#1c2a3d' : '#F0F7FF' }, { borderBottomColor: isDark ? '#2c2c2e' : '#f2f2f2' }]}
                      activeOpacity={0.7}
                      onPress={() => toggleMaterial(m._id)}
                    >
                      <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={isSelected ? SETUP_AVAILABILITY_BLUE : (isDark ? '#636366' : '#aeaeb2')}
                      />
                      <View style={[s.materialItemThumb, { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
                        {m.thumbnailUrl ? (
                          <Image source={{ uri: m.thumbnailUrl }} style={s.materialItemThumbImg} contentFit="cover" />
                        ) : (
                          <Ionicons name={getTypeIcon(m.materialType)} size={16} color={isDark ? '#636366' : '#aeaeb2'} />
                        )}
                      </View>
                      <View style={s.materialItemInfo}>
                        <Text style={[s.materialItemTitle, { color: colors.text }]} numberOfLines={1}>{m.title}</Text>
                        <Text style={[s.materialItemMeta, { color: colors.textSecondary }]}>
                          {getTypeLabel(m.materialType)} · {m.quiz?.length || 0} questions
                        </Text>
                      </View>
                      <Text style={[s.materialItemPrice, { color: m.pricingType === 'paid' ? (isDark ? '#60a5fa' : '#2563eb') : '#10b981' }]}>
                        {m.pricingType === 'paid' ? `$${m.price}` : 'Free'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {hasPaidInFree && (
              <View style={[s.tip, s.tipWarning, { backgroundColor: isDark ? '#332b00' : '#FFFBEB', borderColor: isDark ? '#4a3f00' : '#FDE68A' }]}>
                <Ionicons name="warning-outline" size={18} color={isDark ? '#fbbf24' : '#D97706'} />
                <Text style={[s.tipDesc, { color: isDark ? '#fbbf24' : '#92400E', flex: 1 }]}>{t('CREATE_BUNDLE.PAID_IN_FREE_WARNING')}</Text>
              </View>
            )}
            <Text style={[s.fieldHint, { color: isDark ? '#636366' : '#aeaeb2', marginTop: 8 }]}>{t('CREATE_BUNDLE.MATERIALS_HINT')}</Text>
          </View>
        );
      case 'bundleCover':
        return (
          <View style={s.panel}>
            <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_COVER')} <Text style={{ color: colors.textSecondary, fontWeight: '400', fontSize: 12 }}>Optional</Text></Text>
            {coverPreview ? (
              <View style={s.coverPreview}>
                <Image source={{ uri: coverPreview }} style={s.coverImg} contentFit="cover" />
                <TouchableOpacity style={s.coverRemove} onPress={removeCover}>
                  <Ionicons name="close" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[s.coverDropzone, { backgroundColor: inputBg, borderColor: inputBorder }]} onPress={pickCover} activeOpacity={0.7}>
                <Ionicons name="image-outline" size={32} color={isDark ? '#636366' : '#aeaeb2'} />
                <Text style={[s.coverDropzoneText, { color: isDark ? '#aeaeb2' : '#636366' }]}>{t('CREATE_BUNDLE.FIELD_COVER_UPLOAD')}</Text>
                <Text style={[s.coverDropzoneHint, { color: isDark ? '#636366' : '#aeaeb2' }]}>{t('CREATE_BUNDLE.FIELD_COVER_HINT')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      case 'bundleLanguageLevel':
        return (
          <View style={s.panel}>
            <View style={s.fieldRow}>
              <View style={[s.field, s.fieldHalf]}>
                <Text style={[s.label, { color: colors.text }]}>
                  {t('CREATE_BUNDLE.FIELD_LANGUAGE')} <Text style={s.required}>*</Text>
                </Text>
                <TouchableOpacity
                  style={[s.selectBtn, { backgroundColor: inputBg, borderColor: inputBorder }]}
                  onPress={() => setShowLanguagePicker(!showLanguagePicker)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.selectBtnText, { color: colors.text }]}>{language}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {showLanguagePicker && (
                  <View style={[s.pickerList, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                    {LANGUAGES.map(lang => (
                      <TouchableOpacity
                        key={lang}
                        style={[s.pickerItem, lang === language && { backgroundColor: isDark ? '#2c2c2e' : '#f0f4ff' }]}
                        onPress={() => { setLanguage(lang); setShowLanguagePicker(false); }}
                      >
                        <Text style={[s.pickerItemText, { color: colors.text }, lang === language && { fontWeight: '600' }]}>{lang}</Text>
                        {lang === language && <Ionicons name="checkmark" size={16} color={SETUP_AVAILABILITY_BLUE} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
              <View style={[s.field, s.fieldHalf]}>
                <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_LEVEL')}</Text>
                <TouchableOpacity
                  style={[s.selectBtn, { backgroundColor: inputBg, borderColor: inputBorder }]}
                  onPress={() => setShowLevelPicker(!showLevelPicker)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.selectBtnText, { color: colors.text }]}>{LEVELS.find(l => l.value === level)?.label || 'Any Level'}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {showLevelPicker && (
                  <View style={[s.pickerList, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                    {LEVELS.map(lv => (
                      <TouchableOpacity
                        key={lv.value}
                        style={[s.pickerItem, lv.value === level && { backgroundColor: isDark ? '#2c2c2e' : '#f0f4ff' }]}
                        onPress={() => { setLevel(lv.value); setShowLevelPicker(false); }}
                      >
                        <Text style={[s.pickerItemText, { color: colors.text }, lv.value === level && { fontWeight: '600' }]}>{lv.label}</Text>
                        {lv.value === level && <Ionicons name="checkmark" size={16} color={SETUP_AVAILABILITY_BLUE} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      case 'bundleTags':
        return (
          <View style={s.panel}>
            <View style={s.tagInputRow}>
              <TextInput
                style={[s.input, { flex: 1, backgroundColor: inputBg, borderColor: inputBorder, color: colors.text }]}
                value={structuredTagInput}
                onChangeText={setStructuredTagInput}
                placeholder={t('CREATE_BUNDLE.WIZ_TAGS_PLACEHOLDER')}
                placeholderTextColor={isDark ? '#636366' : '#aeaeb2'}
                onSubmitEditing={addStructuredTag}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[s.addTagBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}
                onPress={addStructuredTag}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{t('CREATE_BUNDLE.WIZ_ADD_TAG')}</Text>
              </TouchableOpacity>
            </View>
            {structuredTags.length > 0 && (
              <View style={s.tagChips}>
                {structuredTags.map((tag, i) => (
                  <View key={`${tag}-${i}`} style={[s.tagChip, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                    <Text style={{ color: colors.text, fontSize: 14 }}>{tag}</Text>
                    <TouchableOpacity onPress={() => removeStructuredTag(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <Text style={[s.fieldHint, { color: isDark ? '#636366' : '#aeaeb2', marginTop: 8 }]}>{t('CREATE_BUNDLE.FIELD_TAGS_HINT')}</Text>
          </View>
        );
      case 'bundlePrice':
        return (
          <View style={s.panel}>
            <View style={[s.priceInputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
              <Text style={[s.pricePrefix, { color: colors.textSecondary }]}>$</Text>
              <TextInput
                style={[s.priceInput, { color: colors.text }]}
                value={price}
                onChangeText={setPrice}
                placeholder="15.00"
                placeholderTextColor={isDark ? '#636366' : '#aeaeb2'}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={[s.fieldHint, { color: isDark ? '#636366' : '#aeaeb2', marginTop: 8 }]}>{t('CREATE_BUNDLE.PRICE_TIP_PAID')}</Text>
          </View>
        );
      default:
        return null;
    }
  })();

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={s.flex} edges={['top']}>
        <View style={[s.navBar, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleHeaderBack} style={s.navBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[s.navBackLabel, { color: colors.text }]} numberOfLines={1}>
              {navBackLabel}
            </Text>
          </TouchableOpacity>
          <View style={s.navBarSpacer} />
          <View style={s.navBarRight}>
            {bundleStepIndex >= 1 && (
              <Text style={[s.navStepCount, { color: colors.textSecondary }]}>
                {t('CREATE_MATERIAL.STEP_OF', {
                  current: bundleNumberedCurrent,
                  total: bundleNumberedTotal,
                })}
              </Text>
            )}
            {isEditing && (
              <TouchableOpacity
                onPress={handleSaveAndExit}
                style={s.navSaveExitBtn}
                disabled={isSaving || isPersistingEdit || !canSaveDraft}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isPersistingEdit ? (
                  <ActivityIndicator size="small" color={SETUP_AVAILABILITY_BLUE} />
                ) : (
                  <Text style={[s.navSaveExitText, { color: SETUP_AVAILABILITY_BLUE }]} numberOfLines={1}>
                    {t('CREATE_BUNDLE.SAVE_AND_EXIT')}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={s.progressSection}>
          <View style={[s.progressTrack, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
            <View style={[s.progressFill, { width: `${progressWidth}%`, backgroundColor: isDark ? '#fff' : '#222' }]} />
          </View>
        </View>

        <KeyboardAvoidingView
          style={s.flex}
          behavior="padding"
          keyboardVerticalOffset={insets.bottom}
        >
          <ScrollView
            style={s.flex}
            contentContainerStyle={[
              s.scrollContent,
              !keyboardVisible && { paddingBottom: Math.max(insets.bottom, 20) + 100 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={[s.detailsStepMaxWidth, s.headAlignedStep]}>
              {isEditing && (
                <View style={s.editBadgeRow}>
                  <View style={[s.editBadge, { backgroundColor: isDark ? '#b45309' : '#f59e0b' }]}>
                    <Ionicons name="create-outline" size={13} color="#fff" />
                    <Text style={s.editBadgeText}>{t('CREATE_BUNDLE.EDITING_LABEL')}</Text>
                  </View>
                </View>
              )}
              <Text style={[s.detailsHeading, { color: colors.text }]}>{t(headlineKey)}</Text>
              <Text style={[s.detailsSubheading, { color: colors.textSecondary }]}>{t(sublineKey)}</Text>

              {!isEditing && bundleStepIndex === 0 && (
                <View style={[s.tip, { backgroundColor: isDark ? '#1c2a3d' : '#F0F7FF', borderColor: isDark ? '#2a3d55' : '#D6E4FF' }]}>
                  <Ionicons name="bulb-outline" size={20} color={isDark ? '#7AB3E0' : '#4B7FBF'} />
                  <View style={s.tipBody}>
                    <Text style={[s.tipTitle, { color: isDark ? '#f5f5f7' : '#222' }]}>{t('CREATE_BUNDLE.TIP_TITLE')}</Text>
                    <Text style={[s.tipDesc, { color: isDark ? '#aeaeb2' : '#6a6a6a' }]}>{t('CREATE_BUNDLE.TIP_DESC')}</Text>
                  </View>
                </View>
              )}

              <View style={s.panelHost}>{panel}</View>
            </View>
          </ScrollView>

          {keyboardVisible && (
            <View style={[s.kbToolbar, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2', borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)' }]}>
              <View style={s.kbToolbarArrows}>
                <TouchableOpacity style={s.kbArrowBtn} activeOpacity={0.6} onPress={() => {}}>
                  <Ionicons name="chevron-up" size={22} color={isDark ? '#aaa' : '#666'} />
                </TouchableOpacity>
                <TouchableOpacity style={s.kbArrowBtn} activeOpacity={0.6} onPress={() => {}}>
                  <Ionicons name="chevron-down" size={22} color={isDark ? '#aaa' : '#666'} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[s.kbDoneBtn, { backgroundColor: isDark ? '#fff' : '#111' }]}
                activeOpacity={0.8}
                onPress={() => Keyboard.dismiss()}
              >
                <Text style={[s.kbDoneText, { color: isDark ? '#000' : '#fff' }]}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {!keyboardVisible && (
            <View style={[s.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
              {!isLastStep && (
                <View style={s.footerWizardRow}>
                  {showFooterSaveDraft && (
                    <TouchableOpacity
                      style={[s.wizardBackBtn, { borderColor: colors.border }]}
                      onPress={saveDraftProgress}
                      disabled={isSaving || !canSaveDraft}
                      activeOpacity={0.75}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Text style={[s.wizardBackBtnText, { color: colors.text }]}>{t('CREATE_MATERIAL.SAVE_DRAFT')}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {isEditing && (
                    <TouchableOpacity
                      style={[s.wizardBackBtn, { borderColor: colors.border }]}
                      onPress={handleFooterSaveInPlace}
                      disabled={isSaving || isPersistingEdit || !canSaveDraft}
                      activeOpacity={0.75}
                    >
                      {isPersistingEdit ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Text style={[s.wizardBackBtnText, { color: colors.text }]}>{t('COMMON.SAVE')}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.wizardNextBtn, {
                      flex: showFooterSaveDraft || isEditing ? 1.25 : 1,
                      backgroundColor: isCurrentStepValid ? (isDark ? '#fff' : '#111') : (isDark ? '#3a3a3c' : '#d1d1d6'),
                    }]}
                    onPress={handleWizardNext}
                    disabled={!isCurrentStepValid || isSaving || isPersistingEdit}
                    activeOpacity={0.85}
                  >
                    <Text style={[s.wizardNextBtnText, { color: isCurrentStepValid ? (isDark ? '#000' : '#fff') : '#8e8e93' }]}>
                      {t('CREATE_BUNDLE.WIZ_NEXT')}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color={isCurrentStepValid ? (isDark ? '#000' : '#fff') : '#8e8e93'} />
                  </TouchableOpacity>
                </View>
              )}
              {isLastStep && (
                <View style={s.footerWizardRow}>
                  {showFooterSaveDraft && (
                    <TouchableOpacity
                      style={[s.wizardBackBtn, { borderColor: colors.border }]}
                      onPress={saveDraftProgress}
                      disabled={isSaving || !canSaveDraft}
                      activeOpacity={0.75}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Text style={[s.wizardBackBtnText, { color: colors.text }]}>{t('CREATE_MATERIAL.SAVE_DRAFT')}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {isEditing && (
                    <TouchableOpacity
                      style={[s.wizardBackBtn, { borderColor: colors.border }]}
                      onPress={handleFooterSaveInPlace}
                      disabled={isSaving || isPersistingEdit || !canSaveDraft}
                      activeOpacity={0.75}
                    >
                      {isPersistingEdit ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Text style={[s.wizardBackBtnText, { color: colors.text }]}>{t('COMMON.SAVE')}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.wizardNextBtn, {
                      flex: showFooterSaveDraft || isEditing ? 1.25 : 1,
                      backgroundColor: canPublish ? (isDark ? SETUP_AVAILABILITY_BLUE : '#222') : (isDark ? '#3a3a3c' : '#d1d1d6'),
                      opacity: canPublish ? 1 : 0.85,
                    }]}
                    onPress={savePublished}
                    disabled={isSaving || isPersistingEdit || !canPublish}
                    activeOpacity={0.85}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Text style={[s.wizardNextBtnText, { color: canPublish ? '#fff' : '#8e8e93' }]}>
                          {isEditing ? t('CREATE_BUNDLE.UPDATE') : t('CREATE_BUNDLE.PUBLISH')}
                        </Text>
                        <Ionicons name="arrow-forward" size={18} color={canPublish ? '#fff' : '#8e8e93'} />
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40 },
  detailsStepMaxWidth: {
    width: '100%' as const,
    maxWidth: 440,
    alignSelf: 'center' as const,
  },
  headAlignedStep: { marginTop: 8 },
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
  detailsHeading: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center' as const,
    marginBottom: 10,
  },
  detailsSubheading: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center' as const,
    marginBottom: 28,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0, maxWidth: '52%' },
  navBackLabel: { fontSize: 15, fontWeight: '500', flexShrink: 1 },
  navBarSpacer: { flex: 1, minWidth: 8 },
  navBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  navSaveExitBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navSaveExitText: {
    fontSize: 15,
    fontWeight: '600',
    maxWidth: 140,
  },
  navStepCount: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  progressSection: {
    marginTop: 14,
    marginBottom: 28,
  },
  progressTrack: { height: 3, width: '100%' },
  progressFill: { height: '100%', borderRadius: 1.5 },
  /** Space between step headline / tip and the fields below */
  panelHost: { marginTop: 24 },
  panel: { marginBottom: 8 },
  tip: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1,
    marginBottom: 16,
  },
  tipWarning: { marginBottom: 0, marginTop: 12, alignItems: 'flex-start' },
  tipBody: { flex: 1 },
  tipTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  tipDesc: { fontSize: 13, lineHeight: 19 },
  field: { marginBottom: 20 },
  fieldHalf: { flex: 1 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  required: { color: '#ef4444' },
  fieldHint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  coverPreview: { borderRadius: 14, overflow: 'hidden', aspectRatio: 1200 / 630 },
  coverImg: { width: '100%', height: '100%' },
  coverRemove: {
    position: 'absolute', top: 10, right: 10,
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  coverDropzone: {
    borderWidth: 1, borderStyle: 'dashed', borderRadius: 14,
    paddingVertical: 32, alignItems: 'center', gap: 6,
  },
  coverDropzoneText: { fontSize: 14, fontWeight: '500' },
  coverDropzoneHint: { fontSize: 12 },
  selectBtn: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectBtnText: { fontSize: 15 },
  pickerList: {
    borderWidth: 1, borderRadius: 12, marginTop: 4, overflow: 'hidden',
    maxHeight: 200,
  },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  pickerItemText: { fontSize: 14 },
  pricingCards: { flexDirection: 'row', gap: 12 },
  pricingCard: {
    flex: 1, borderRadius: 16, borderWidth: 1, padding: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  pricingIconWrap: {
    width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  pricingTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  pricingDesc: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  materialFieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  selectedCount: { fontSize: 13 },
  materialList: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  materialItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  materialItemThumb: {
    width: 40, height: 32, borderRadius: 6, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  materialItemThumbImg: { width: '100%', height: '100%' },
  materialItemInfo: { flex: 1, gap: 2 },
  materialItemTitle: { fontSize: 14, fontWeight: '600' },
  materialItemMeta: { fontSize: 12 },
  materialItemPrice: { fontSize: 12, fontWeight: '600' },
  emptyMaterials: {
    borderWidth: 1, borderRadius: 14, padding: 28, alignItems: 'center', gap: 8,
  },
  emptyMaterialsText: { fontSize: 13, textAlign: 'center' },
  tagInputRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  addTagBtn: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12 },
  tagChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20,
  },
  priceInputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14,
  },
  pricePrefix: { fontSize: 16, fontWeight: '600', marginRight: 4 },
  priceInput: { flex: 1, fontSize: 15, paddingVertical: 12 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
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
