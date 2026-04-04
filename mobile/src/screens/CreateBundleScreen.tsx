import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
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

  const [title, setTitle] = useState(editingBundle?.title || '');
  const [description, setDescription] = useState(editingBundle?.description || '');
  const [language, setLanguage] = useState(editingBundle?.language || LANGUAGES[0]);
  const [level, setLevel] = useState(editingBundle?.level || 'any');
  const [pricingType, setPricingType] = useState<'free' | 'paid'>(editingBundle?.pricingType || 'free');
  const [price, setPrice] = useState(editingBundle?.price?.toString() || '');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>(
    () => editingBundle?.items?.map(i => typeof i.materialId === 'string' ? i.materialId : (i.materialId as any)?._id).filter(Boolean) || []
  );
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [existingCoverUrl, setExistingCoverUrl] = useState(editingBundle?.coverImageUrl || null);
  const [isSaving, setIsSaving] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);

  const isEditing = !!editingBundle;
  const coverPreview = coverUri || existingCoverUrl;
  const publishedMaterials = useMemo(() => materials.filter(m => m.status === 'published' || m.status === 'draft'), [materials]);

  const hasPaidInFree = useMemo(() => {
    if (pricingType !== 'free') return false;
    return publishedMaterials.some(m => selectedMaterialIds.includes(m._id) && m.pricingType === 'paid');
  }, [pricingType, publishedMaterials, selectedMaterialIds]);

  const canPublish = title.trim().length > 0 && language && (pricingType !== 'paid' || (parseFloat(price) > 0));

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

  const save = useCallback(async (status: 'published' | 'draft') => {
    if (!title.trim()) return;
    if (status === 'published' && pricingType === 'paid' && (!price || parseFloat(price) <= 0)) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    try {
      let coverImageUrl = existingCoverUrl || undefined;
      if (coverUri) {
        coverImageUrl = await materialService.uploadBundleCover(coverUri);
      }

      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        coverImageUrl,
        language,
        level,
        items: selectedMaterialIds.map((id, i) => ({ materialId: id, sortOrder: i })),
        pricingType,
        price: pricingType === 'paid' ? parseFloat(price) : 0,
        status,
      };

      if (isEditing && editingBundle) {
        await materialService.updateBundle(editingBundle._id, payload);
      } else {
        await materialService.createBundle(payload);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('', isEditing ? 'Bundle updated' : status === 'draft' ? 'Bundle saved as draft' : 'Bundle published', [
        { text: 'OK', onPress: goBack },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save bundle');
    }
    setIsSaving(false);
  }, [title, description, language, level, pricingType, price, selectedMaterialIds, coverUri, existingCoverUrl, isEditing, editingBundle, goBack]);

  return (
    <View style={[s.root, { backgroundColor: isDark ? '#000' : '#f7f7f7' }]}>
      <SafeAreaView style={s.flex} edges={['top']}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
          <TouchableOpacity onPress={goBack} style={s.headerBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>
            {isEditing ? t('CREATE_BUNDLE.EDIT_TITLE') : t('CREATE_BUNDLE.TITLE')}
          </Text>
          <View style={s.headerBtn} />
        </View>

        <KeyboardAvoidingView style={s.flex} behavior="padding">
          <ScrollView
            style={s.flex}
            contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 100 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Tip */}
            {!isEditing && (
              <View style={[s.tip, { backgroundColor: isDark ? '#1c2a3d' : '#F0F7FF', borderColor: isDark ? '#2a3d55' : '#D6E4FF' }]}>
                <Ionicons name="bulb-outline" size={20} color={isDark ? '#7AB3E0' : '#4B7FBF'} />
                <View style={s.tipBody}>
                  <Text style={[s.tipTitle, { color: isDark ? '#f5f5f7' : '#222' }]}>{t('CREATE_BUNDLE.TIP_TITLE')}</Text>
                  <Text style={[s.tipDesc, { color: isDark ? '#aeaeb2' : '#6a6a6a' }]}>{t('CREATE_BUNDLE.TIP_DESC')}</Text>
                </View>
              </View>
            )}

            {/* Title */}
            <View style={s.field}>
              <Text style={[s.label, { color: colors.text }]}>
                {t('CREATE_BUNDLE.FIELD_TITLE')} <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={[s.input, { backgroundColor: isDark ? '#1c1c1e' : '#fff', color: colors.text, borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}
                value={title}
                onChangeText={setTitle}
                placeholder={t('CREATE_BUNDLE.FIELD_TITLE_PLACEHOLDER')}
                placeholderTextColor={isDark ? '#636366' : '#aeaeb2'}
                maxLength={100}
              />
              <Text style={[s.fieldHint, { color: isDark ? '#636366' : '#aeaeb2' }]}>{t('CREATE_BUNDLE.FIELD_TITLE_HINT')}</Text>
            </View>

            {/* Description */}
            <View style={s.field}>
              <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_DESCRIPTION')}</Text>
              <TextInput
                style={[s.input, s.textArea, { backgroundColor: isDark ? '#1c1c1e' : '#fff', color: colors.text, borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}
                value={description}
                onChangeText={setDescription}
                placeholder={t('CREATE_BUNDLE.FIELD_DESC_PLACEHOLDER')}
                placeholderTextColor={isDark ? '#636366' : '#aeaeb2'}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />
            </View>

            {/* Cover Image */}
            <View style={s.field}>
              <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_COVER')}</Text>
              {coverPreview ? (
                <View style={s.coverPreview}>
                  <Image source={{ uri: coverPreview }} style={s.coverImg} contentFit="cover" />
                  <TouchableOpacity style={s.coverRemove} onPress={removeCover}>
                    <Ionicons name="close" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={[s.coverDropzone, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]} onPress={pickCover} activeOpacity={0.7}>
                  <Ionicons name="image-outline" size={32} color={isDark ? '#636366' : '#aeaeb2'} />
                  <Text style={[s.coverDropzoneText, { color: isDark ? '#aeaeb2' : '#636366' }]}>{t('CREATE_BUNDLE.FIELD_COVER_UPLOAD')}</Text>
                  <Text style={[s.coverDropzoneHint, { color: isDark ? '#636366' : '#aeaeb2' }]}>{t('CREATE_BUNDLE.FIELD_COVER_HINT')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Language & Level */}
            <View style={s.fieldRow}>
              <View style={[s.field, s.fieldHalf]}>
                <Text style={[s.label, { color: colors.text }]}>
                  {t('CREATE_BUNDLE.FIELD_LANGUAGE')} <Text style={s.required}>*</Text>
                </Text>
                <TouchableOpacity
                  style={[s.selectBtn, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}
                  onPress={() => setShowLanguagePicker(!showLanguagePicker)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.selectBtnText, { color: colors.text }]}>{language}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {showLanguagePicker && (
                  <View style={[s.pickerList, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
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
                  style={[s.selectBtn, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}
                  onPress={() => setShowLevelPicker(!showLevelPicker)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.selectBtnText, { color: colors.text }]}>{LEVELS.find(l => l.value === level)?.label || 'Any Level'}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {showLevelPicker && (
                  <View style={[s.pickerList, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
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

            {/* Pricing */}
            <View style={s.field}>
              <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_PRICING')}</Text>
              <View style={s.pricingToggle}>
                <TouchableOpacity
                  style={[s.pricingOpt, pricingType === 'free' && [s.pricingOptActive, { backgroundColor: isDark ? '#1c2a3d' : '#F0F7FF', borderColor: isDark ? '#2a3d55' : '#4298d3' }], { borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}
                  onPress={() => setPricingType('free')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="gift-outline" size={18} color={pricingType === 'free' ? SETUP_AVAILABILITY_BLUE : (isDark ? '#636366' : '#8e8e93')} />
                  <Text style={[s.pricingOptText, { color: pricingType === 'free' ? SETUP_AVAILABILITY_BLUE : colors.text }]}>Free</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.pricingOpt, pricingType === 'paid' && [s.pricingOptActive, { backgroundColor: isDark ? '#1c2a3d' : '#F0F7FF', borderColor: isDark ? '#2a3d55' : '#4298d3' }], { borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}
                  onPress={() => setPricingType('paid')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="card-outline" size={18} color={pricingType === 'paid' ? SETUP_AVAILABILITY_BLUE : (isDark ? '#636366' : '#8e8e93')} />
                  <Text style={[s.pricingOptText, { color: pricingType === 'paid' ? SETUP_AVAILABILITY_BLUE : colors.text }]}>Paid</Text>
                </TouchableOpacity>
              </View>
              {pricingType === 'paid' && (
                <View style={[s.priceInputWrap, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
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
              )}
              <Text style={[s.fieldHint, { color: isDark ? '#636366' : '#aeaeb2' }]}>
                {pricingType === 'paid' ? t('CREATE_BUNDLE.PRICE_TIP_PAID') : t('CREATE_BUNDLE.PRICE_TIP_FREE')}
              </Text>
            </View>

            {/* Materials selection */}
            <View style={s.field}>
              <View style={s.materialFieldHeader}>
                <Text style={[s.label, { color: colors.text }]}>{t('CREATE_BUNDLE.FIELD_MATERIALS')}</Text>
                <Text style={[s.selectedCount, { color: colors.textSecondary }]}>{selectedMaterialIds.length} selected</Text>
              </View>

              {publishedMaterials.length === 0 ? (
                <View style={[s.emptyMaterials, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
                  <Ionicons name="layers-outline" size={28} color={isDark ? '#636366' : '#aeaeb2'} />
                  <Text style={[s.emptyMaterialsText, { color: isDark ? '#636366' : '#8e8e93' }]}>{t('CREATE_BUNDLE.NO_MATERIALS')}</Text>
                </View>
              ) : (
                <View style={[s.materialList, { borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
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
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Sticky actions */}
        <View style={[s.actions, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderTopColor: isDark ? '#2c2c2e' : '#f0f0f0', paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={[s.draftBtn, { borderColor: isDark ? '#636366' : '#222' }]}
            activeOpacity={0.7}
            onPress={() => save('draft')}
            disabled={isSaving || !title.trim()}
          >
            {isSaving ? <ActivityIndicator size="small" color={isDark ? '#f5f5f7' : '#222'} /> : (
              <Text style={[s.draftBtnText, { color: isDark ? '#f5f5f7' : '#222' }]}>{t('CREATE_BUNDLE.SAVE_DRAFT')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.publishBtn, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#222', opacity: canPublish ? 1 : 0.45 }]}
            activeOpacity={0.85}
            onPress={() => save('published')}
            disabled={isSaving || !canPublish}
          >
            {isSaving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={s.publishBtnText}>{isEditing ? t('CREATE_BUNDLE.UPDATE') : t('CREATE_BUNDLE.PUBLISH')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { padding: 20, gap: 4 },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1,
  },
  headerBtn: { width: 40, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },

  /* Tip */
  tip: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1,
    marginBottom: 16,
  },
  tipWarning: { marginBottom: 0, marginTop: 12, alignItems: 'flex-start' },
  tipBody: { flex: 1 },
  tipTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  tipDesc: { fontSize: 13, lineHeight: 19 },

  /* Field */
  field: { marginBottom: 20 },
  fieldHalf: { flex: 1 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  required: { color: '#ef4444' },
  fieldHint: { fontSize: 12, lineHeight: 17, marginTop: 6 },

  /* Input */
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  /* Cover */
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

  /* Select */
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

  /* Pricing */
  pricingToggle: { flexDirection: 'row', gap: 10 },
  pricingOpt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  pricingOptActive: {},
  pricingOptText: { fontSize: 14, fontWeight: '600' },
  priceInputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, marginTop: 10,
  },
  pricePrefix: { fontSize: 16, fontWeight: '600', marginRight: 4 },
  priceInput: { flex: 1, fontSize: 15, paddingVertical: 12 },

  /* Materials list */
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

  /* Actions */
  actions: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1,
  },
  draftBtn: {
    flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  draftBtnText: { fontSize: 15, fontWeight: '600' },
  publishBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  publishBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
