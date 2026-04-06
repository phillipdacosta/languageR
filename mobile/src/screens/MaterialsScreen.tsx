import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Clipboard,
  TextInput,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { materialService, getMaterialsCache, prefetchLibraryCoverImages, TutorMaterial, MaterialBundle, LinkedChannels } from '../services/materials';
import { env } from '../config/env';
import StaggerRow from '../components/StaggerRow';
import CreateMaterialScreen from './CreateMaterialScreen';
import MaterialDetailScreen from './MaterialDetailScreen';
import BundleDetailScreen from './BundleDetailScreen';
import CreateBundleScreen from './CreateBundleScreen';

type LibraryTab = 'materials' | 'bundles';

interface Props {
  goBack: () => void;
}

/** Calendar / Set Availability primary blue (slot bars, FAB). */
const SETUP_AVAILABILITY_BLUE = '#08a0e8';

export default function MaterialsScreen({ goBack }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isDark = colors.isDark;

  const cached = getMaterialsCache();

  const [activeTab, setActiveTab] = useState<LibraryTab>('materials');
  const tabFadeAnim = useRef(new Animated.Value(1)).current;

  const switchTab = useCallback((tab: LibraryTab) => {
    if (tab === activeTab) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    tabFadeAnim.setValue(0);
    setActiveTab(tab);
    setShowMaterialsList(false);
    setShowBundlesList(false);
    Animated.timing(tabFadeAnim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [activeTab, tabFadeAnim]);
  const [materials, setMaterials] = useState<TutorMaterial[]>(cached.materials || []);
  const [bundles, setBundles] = useState<MaterialBundle[]>(cached.bundles || []);
  const [loading, setLoading] = useState(!cached.hasCachedData);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bundlesFetched, setBundlesFetched] = useState(cached.bundles !== null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showCreateMaterial, setShowCreateMaterial] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<TutorMaterial | null>(null);
  const [showCreateBundle, setShowCreateBundle] = useState(false);
  const [previewBundle, setPreviewBundle] = useState<MaterialBundle | null>(null);
  const [editingBundle, setEditingBundle] = useState<MaterialBundle | null>(null);
  const [showMaterialsList, setShowMaterialsList] = useState(false);
  const [showBundlesList, setShowBundlesList] = useState(false);

  const [showChannelPanel, setShowChannelPanel] = useState(false);
  const [channels, setChannels] = useState<LinkedChannels>(cached.channels || {});
  const [soundcloudUrl, setSoundcloudUrl] = useState(cached.channels?.soundcloudProfileUrl || '');
  const [savingChannels, setSavingChannels] = useState(false);

  const panelAnim = useRef(new Animated.Value(0)).current;
  const panelHeight = useRef(0);
  const blurAnim = useRef(new Animated.Value(0)).current;

  const screenFade = useRef(new Animated.Value(0)).current;
  const screenFadeRan = useRef(false);

  useEffect(() => {
    if (loading || screenFadeRan.current) return;
    screenFadeRan.current = true;
    Animated.timing(screenFade, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [loading, screenFade]);

  const hasLinkedChannel = !!(
    (channels.youtubeChannelName && channels.youtubeVerified) ||
    (channels.vimeoChannelName && channels.vimeoVerified) ||
    channels.soundcloudProfileName
  );

  const fetchMaterials = useCallback(async (force = false) => {
    const data = await materialService.getMyMaterials(force);
    setMaterials(data);
  }, []);

  const fetchBundles = useCallback(async (force = false) => {
    setLoadingBundles(true);
    const data = await materialService.getMyBundles(force);
    setBundles(data);
    setLoadingBundles(false);
    setBundlesFetched(true);
  }, []);

  const fetchChannels = useCallback(async (force = false) => {
    const data = await materialService.getLinkedChannels(force);
    setChannels(data);
    setSoundcloudUrl(data.soundcloudProfileUrl || '');
  }, []);

  useEffect(() => {
    const snap = getMaterialsCache();
    if (snap.materials?.length) {
      void prefetchLibraryCoverImages(snap.materials, snap.bundles || [], snap.channels || undefined);
    }
    if (cached.hasCachedData && !cached.isStale) {
      setLoading(false);
      return;
    }
    (async () => {
      await Promise.all([fetchMaterials(), fetchBundles(), fetchChannels()]);
      setLoading(false);
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setBundlesFetched(false);
    await Promise.all([fetchMaterials(true), fetchBundles(true), fetchChannels(true)]);
    setRefreshing(false);
  }, [fetchMaterials, fetchBundles, fetchChannels]);

  const openPanel = useCallback(() => {
    setShowChannelPanel(true);
    Animated.parallel([
      Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false, friction: 10, tension: 50 }),
      Animated.timing(blurAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
    ]).start();
  }, [panelAnim, blurAnim]);

  const closePanel = useCallback(() => {
    Animated.parallel([
      Animated.spring(panelAnim, { toValue: 0, useNativeDriver: false, friction: 10, tension: 50 }),
      Animated.timing(blurAnim, { toValue: 0, duration: 250, useNativeDriver: false }),
    ]).start(() => setShowChannelPanel(false));
  }, [panelAnim, blurAnim]);

  const toggleChannelPanel = useCallback(() => {
    if (showChannelPanel) closePanel();
    else openPanel();
  }, [showChannelPanel, openPanel, closePanel]);

  const handleSaveChannels = useCallback(async () => {
    setSavingChannels(true);
    try {
      const updated = await materialService.updateLinkedChannels({
        ...channels,
        soundcloudProfileUrl: soundcloudUrl || null,
      });
      setChannels(updated);
      setSoundcloudUrl(updated.soundcloudProfileUrl || '');
      closePanel();
    } catch {
      Alert.alert('Error', 'Failed to save channels. Please try again.');
    } finally {
      setSavingChannels(false);
    }
  }, [channels, soundcloudUrl, closePanel]);

  const handleUnlinkSoundcloud = useCallback(async () => {
    setSavingChannels(true);
    try {
      const updated = await materialService.updateLinkedChannels({
        ...channels,
        soundcloudProfileUrl: null,
        soundcloudProfileName: null,
        soundcloudProfileAvatar: null,
      });
      setChannels(updated);
      setSoundcloudUrl('');
    } catch {
      Alert.alert('Error', 'Failed to unlink SoundCloud.');
    } finally {
      setSavingChannels(false);
    }
  }, [channels]);

  const handleUnlinkYoutube = useCallback(async () => {
    const ok = await materialService.unlinkYouTube();
    if (ok) {
      setChannels(prev => ({
        ...prev,
        youtubeChannelId: null,
        youtubeChannelUrl: null,
        youtubeChannelName: null,
        youtubeChannelAvatar: null,
        youtubeSubscriberCount: null,
        youtubeVerified: false,
      }));
    }
  }, []);

  const handleUnlinkVimeo = useCallback(async () => {
    const ok = await materialService.unlinkVimeo();
    if (ok) {
      setChannels(prev => ({
        ...prev,
        vimeoChannelId: null,
        vimeoChannelUrl: null,
        vimeoChannelName: null,
        vimeoChannelAvatar: null,
        vimeoVerified: false,
      }));
    }
  }, []);

  const handleCopyLink = useCallback(async (id: string) => {
    const baseUrl = env.apiUrl?.replace('/api', '') || 'https://barnabi.com';
    const link = `${baseUrl}/material/${id}`;
    Clipboard.setString(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleDelete = useCallback((material: TutorMaterial) => {
    Alert.alert(
      t('CREATE_MATERIAL.ALERT_DELETE_TITLE') || 'Delete Material',
      t('CREATE_MATERIAL.ALERT_DELETE_DESC') || 'This action cannot be undone.',
      [
        { text: t('COMMON.CANCEL') || 'Cancel', style: 'cancel' },
        {
          text: t('COMMON.DELETE') || 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await materialService.deleteMaterial(material._id);
            if (ok) setMaterials(prev => prev.filter(m => m._id !== material._id));
          },
        },
      ],
    );
  }, [t]);

  const handleDeleteBundle = useCallback((bundle: MaterialBundle) => {
    Alert.alert(
      'Delete Bundle',
      t('BUNDLE.CONFIRM_DELETE'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await materialService.deleteBundle(bundle._id);
            if (ok) {
              setBundles(prev => prev.filter(b => b._id !== bundle._id));
            } else {
              Alert.alert('', t('BUNDLE.DELETE_FAILED'));
            }
          },
        },
      ],
    );
  }, [t]);

  const handleToggleArchive = useCallback(async (material: TutorMaterial) => {
    const updated = await materialService.toggleArchive(material._id, material.status);
    if (updated) {
      setMaterials(prev => prev.map(m => m._id === updated._id ? updated : m));
    }
  }, []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'video_quiz': return t('CREATE_MATERIAL.TYPE_VIDEO_QUIZ');
      case 'reading': return t('CREATE_MATERIAL.TYPE_READING');
      case 'listening': return t('CREATE_MATERIAL.TYPE_LISTENING');
      default: return type;
    }
  };

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'video_quiz': return 'videocam';
      case 'reading': return 'book';
      case 'listening': return 'headset';
      default: return 'layers';
    }
  };

  const listOpen = showMaterialsList || showBundlesList;

  return (
    <View style={{ flex: 1 }}>
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <Animated.View style={[styles.header, { borderBottomColor: colors.border, opacity: screenFade }]}>
        <TouchableOpacity
          onPress={() => {
            if (listOpen) {
              setShowMaterialsList(false);
              setShowBundlesList(false);
              return;
            }
            if (showChannelPanel) closePanel();
            goBack();
          }}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={[styles.backLabel, { color: colors.text }]}>
            {listOpen
              ? (showMaterialsList ? (t('HOME.MATERIALS') || 'Materials') : 'Bundles')
              : t('CREATE_MATERIAL.NAV_BACK_SHORT')}
          </Text>
        </TouchableOpacity>
        {listOpen && (
          <TouchableOpacity
            style={[styles.headerNewBtn, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#111' }]}
            activeOpacity={0.85}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (showBundlesList) { setEditingBundle(null); setShowCreateBundle(true); }
              else setShowCreateMaterial(true);
            }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.headerNewBtnText}>New</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Main area — content scrolls, panel overlays */}
      <View style={{ flex: 1 }}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!showChannelPanel}
        >
          {/* Title + Channels + tabs — hidden when viewing material/bundle list */}
          {!listOpen && (
          <Animated.View style={{ opacity: screenFade }}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.text }]}>
                {t('CREATE_MATERIAL.LIBRARY_TITLE')}
              </Text>
              <TouchableOpacity
                style={[styles.channelBtn, {
                  backgroundColor: isDark ? '#1c1c1e' : '#fff',
                  borderColor: hasLinkedChannel ? (isDark ? 'rgba(16,185,129,0.3)' : '#d1fae5') : colors.border,
                }]}
                onPress={toggleChannelPanel}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={hasLinkedChannel ? 'link' : 'link-outline'}
                  size={14}
                  color={hasLinkedChannel ? '#10b981' : colors.textSecondary}
                />
                <Text style={[styles.channelBtnText, { color: hasLinkedChannel ? '#10b981' : colors.textSecondary }]}>
                  {hasLinkedChannel ? t('CREATE_MATERIAL.LIBRARY_CHANNELS_LINKED') : t('CREATE_MATERIAL.LIBRARY_LINK_CHANNELS')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Segmented Pill Switcher */}
            <View style={[styles.segmentedWrap, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0', backgroundColor: isDark ? '#1c1c1e' : '#f5f5f7' }]}>
              <TouchableOpacity
                style={[
                  styles.segmentedPill,
                  activeTab === 'materials' && styles.segmentedPillActive,
                  activeTab === 'materials' && { borderColor: isDark ? '#fff' : '#222', backgroundColor: isDark ? '#2c2c2e' : '#fff' },
                  activeTab !== 'materials' && { borderColor: 'transparent', backgroundColor: 'transparent' },
                ]}
                onPress={() => switchTab('materials')}
                activeOpacity={0.7}
              >
                <Ionicons name="layers-outline" size={16} color={activeTab === 'materials' ? colors.text : colors.textTertiary} />
                <Text style={[styles.segmentedLabel, { color: activeTab === 'materials' ? colors.text : colors.textTertiary }]}>
                  {t('HOME.MATERIALS') || 'Materials'}
                </Text>
                {materials.length > 0 && (
                  <View style={[styles.segmentedBadge, activeTab === 'materials' ? { backgroundColor: colors.text } : { backgroundColor: isDark ? '#3a3a3c' : '#d6d6db' }]}>
                    <Text style={[styles.segmentedBadgeText, { color: activeTab === 'materials' ? (isDark ? '#000' : '#fff') : colors.textSecondary }]}>
                      {materials.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentedPill,
                  activeTab === 'bundles' && styles.segmentedPillActive,
                  activeTab === 'bundles' && { borderColor: isDark ? '#fff' : '#222', backgroundColor: isDark ? '#2c2c2e' : '#fff' },
                  activeTab !== 'bundles' && { borderColor: 'transparent', backgroundColor: 'transparent' },
                ]}
                onPress={() => switchTab('bundles')}
                activeOpacity={0.7}
              >
                <Ionicons name="folder-outline" size={16} color={activeTab === 'bundles' ? colors.text : colors.textTertiary} />
                <Text style={[styles.segmentedLabel, { color: activeTab === 'bundles' ? colors.text : colors.textTertiary }]}>
                  Bundles
                </Text>
                {bundles.length > 0 && (
                  <View style={[styles.segmentedBadge, activeTab === 'bundles' ? { backgroundColor: colors.text } : { backgroundColor: isDark ? '#3a3a3c' : '#d6d6db' }]}>
                    <Text style={[styles.segmentedBadgeText, { color: activeTab === 'bundles' ? (isDark ? '#000' : '#fff') : colors.textSecondary }]}>
                      {bundles.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

          </Animated.View>
          )}

          {/* Loading */}
          {loading && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.textSecondary} />
            </View>
          )}

          {/* Materials Tab — Gateway */}
          {!loading && activeTab === 'materials' && !showMaterialsList && (
            <Animated.View style={{ opacity: Animated.multiply(screenFade, tabFadeAnim) }}>
              <View style={[styles.gatewayCard, {
                backgroundColor: colors.card,
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                shadowOpacity: isDark ? 0 : Platform.OS === 'ios' ? 0.14 : 0.12,
                elevation: isDark ? 0 : Platform.OS === 'android' ? 14 : 0,
              }]}>
                {/* Hero illustration */}
                <View style={styles.gatewayHero}>
                  <Image source={require('../../assets/shared/materials-gateway.png')} style={styles.gatewayHeroImg} contentFit="contain" />
                </View>

                {materials.length > 0 && (
                  <TouchableOpacity
                    style={[styles.gatewaySection, { borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                    activeOpacity={0.7}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setShowMaterialsList(true);
                    }}
                  >
                    <View style={styles.gatewayContent}>
                      <View style={[styles.gatewayIconWrap, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f5' }]}>
                        <Ionicons name="layers-outline" size={22} color={colors.text} />
                      </View>
                      <View style={styles.gatewayTextWrap}>
                        <Text style={[styles.gatewayTitle, { color: colors.text }]}>
                          {t('CREATE_MATERIAL.VIEW_EXISTING')}
                        </Text>
                        <Text style={[styles.gatewaySubtitle, { color: colors.textSecondary }]}>
                          {materials.length} {materials.length === 1 ? 'material' : 'materials'} {t('CREATE_MATERIAL.CREATED')}
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.gatewaySection, !materials.length && { borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setShowCreateMaterial(true);
                  }}
                >
                  <View style={styles.gatewayContent}>
                    <View style={[styles.gatewayIconWrap, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#111' }]}>
                      <Ionicons name="add" size={22} color="#fff" />
                    </View>
                    <View style={styles.gatewayTextWrap}>
                      <Text style={[styles.gatewayTitle, { color: colors.text }]}>
                        {materials.length > 0
                          ? t('CREATE_MATERIAL.CREATE_NEW')
                          : t('CREATE_MATERIAL.CREATE_FIRST')}
                      </Text>
                      <Text style={[styles.gatewaySubtitle, { color: colors.textSecondary }]}>
                        {materials.length > 0
                          ? t('CREATE_MATERIAL.CREATE_NEW_DESC')
                          : t('CREATE_MATERIAL.LIBRARY_EMPTY_DESC')}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}

          {/* Materials Tab — Full list */}
          {!loading && activeTab === 'materials' && showMaterialsList && (
            <Animated.View style={[styles.cardList, { opacity: tabFadeAnim }]}>
              {materials.map((m, index) => (
                <StaggerRow key={m._id} index={index}>
                  <MaterialCard
                    material={m}
                    colors={colors}
                    copiedId={copiedId}
                    getTypeLabel={getTypeLabel}
                    getTypeIcon={getTypeIcon}
                    formatDate={formatDate}
                    onCopyLink={handleCopyLink}
                    onDelete={handleDelete}
                    onToggleArchive={handleToggleArchive}
                    onPreview={setPreviewMaterial}
                    t={t}
                  />
                </StaggerRow>
              ))}
            </Animated.View>
          )}

          {/* Bundles Tab — Gateway */}
          {!loading && activeTab === 'bundles' && !showBundlesList && (
            <Animated.View style={{ opacity: Animated.multiply(screenFade, tabFadeAnim) }}>
              <View style={[styles.gatewayCard, {
                backgroundColor: colors.card,
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                shadowOpacity: isDark ? 0 : Platform.OS === 'ios' ? 0.14 : 0.12,
                elevation: isDark ? 0 : Platform.OS === 'android' ? 14 : 0,
              }]}>
                {/* Hero illustration */}
                <View style={styles.gatewayHero}>
                  <Image source={require('../../assets/shared/bundles-gateway.png')} style={styles.gatewayHeroImg} contentFit="contain" />
                </View>

                {bundles.length > 0 && (
                  <TouchableOpacity
                    style={[styles.gatewaySection, { borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                    activeOpacity={0.7}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setShowBundlesList(true);
                    }}
                  >
                    <View style={styles.gatewayContent}>
                      <View style={[styles.gatewayIconWrap, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f5' }]}>
                        <Ionicons name="folder-outline" size={22} color={colors.text} />
                      </View>
                      <View style={styles.gatewayTextWrap}>
                        <Text style={[styles.gatewayTitle, { color: colors.text }]}>View your bundles</Text>
                        <Text style={[styles.gatewaySubtitle, { color: colors.textSecondary }]}>
                          {bundles.length} {bundles.length === 1 ? 'bundle' : 'bundles'} created
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.gatewaySection, !bundles.length && { borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setEditingBundle(null);
                    setShowCreateBundle(true);
                  }}
                >
                  <View style={styles.gatewayContent}>
                    <View style={[styles.gatewayIconWrap, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#111' }]}>
                      <Ionicons name="add" size={22} color="#fff" />
                    </View>
                    <View style={styles.gatewayTextWrap}>
                      <Text style={[styles.gatewayTitle, { color: colors.text }]}>
                        {bundles.length > 0 ? 'Create new bundle' : 'Create your first bundle'}
                      </Text>
                      <Text style={[styles.gatewaySubtitle, { color: colors.textSecondary }]}>
                        {bundles.length > 0
                          ? 'Group materials into a structured pack'
                          : 'Group your materials into bundles to offer structured learning packs.'}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}

          {/* Bundles Tab — Full list */}
          {!loading && activeTab === 'bundles' && showBundlesList && (
            <Animated.View style={{ opacity: tabFadeAnim }}>
              {loadingBundles ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color={colors.textSecondary} />
                </View>
              ) : (
                <View style={styles.cardList}>
                  {bundles.map((b, index) => (
                    <StaggerRow key={b._id} index={index}>
                      <BundleCard
                        bundle={b}
                        colors={colors}
                        onPreview={setPreviewBundle}
                        onEdit={(bun) => { setEditingBundle(bun); setShowCreateBundle(true); }}
                        onDelete={handleDeleteBundle}
                      />
                    </StaggerRow>
                  ))}
                </View>
              )}
            </Animated.View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Overlay: blur + channel panel floating on top */}
        {showChannelPanel && (
          <Animated.View
            style={[styles.panelOverlay, { opacity: blurAnim }]}
            pointerEvents={showChannelPanel ? 'auto' : 'none'}
          >
            {/* Blur backdrop — tap to close */}
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closePanel}>
              <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.08)' }]} />
            </TouchableOpacity>

            {/* Panel sliding in from top */}
            <Animated.View
              style={{
                transform: [{ translateY: panelAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }],
                opacity: panelAnim,
                paddingHorizontal: 16,
                paddingTop: 8,
              }}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
                style={{ maxHeight: 520 }}
              >
                <ChannelPanel
                  channels={channels}
                  soundcloudUrl={soundcloudUrl}
                  setSoundcloudUrl={setSoundcloudUrl}
                  saving={savingChannels}
                  onSave={handleSaveChannels}
                  onClose={closePanel}
                  onUnlinkYoutube={handleUnlinkYoutube}
                  onUnlinkVimeo={handleUnlinkVimeo}
                  onUnlinkSoundcloud={handleUnlinkSoundcloud}
                  colors={colors}
                  t={t}
                />
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>

    {showCreateMaterial && (
      <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
        <CreateMaterialScreen
          goBack={() => {
            setShowCreateMaterial(false);
            fetchMaterials(true);
          }}
          channels={channels}
        />
      </View>
    )}

    {showCreateBundle && (
      <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
        <CreateBundleScreen
          goBack={() => {
            setShowCreateBundle(false);
            setEditingBundle(null);
            fetchBundles(true);
          }}
          editingBundle={editingBundle}
          materials={materials}
        />
      </View>
    )}

    {!!previewBundle && (
      <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
        <BundleDetailScreen
          bundle={previewBundle}
          goBack={() => {
            setPreviewBundle(null);
            fetchBundles(true);
          }}
          onViewMaterial={(mat) => {
            setPreviewMaterial(mat);
          }}
          onEditBundle={(bun) => {
            setPreviewBundle(null);
            setEditingBundle(bun);
            setShowCreateBundle(true);
          }}
        />
        {previewMaterial && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}>
            <MaterialDetailScreen
              material={previewMaterial}
              linkedChannelsFallback={channels}
              goBack={() => {
                setPreviewMaterial(null);
              }}
            />
          </View>
        )}
      </View>
    )}

    {!!previewMaterial && !previewBundle && (
      <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
        <MaterialDetailScreen
          material={previewMaterial}
          linkedChannelsFallback={channels}
          goBack={() => {
            setPreviewMaterial(null);
            fetchMaterials(true);
          }}
        />
      </View>
    )}
    </View>
  );
}

/** Quick soft row entrance (Airbnb-style stagger). */
/* StaggerRow is now imported from ../components/StaggerRow */

/* ─── Empty State ─── */

function EmptyState({ icon, title, description, ctaLabel, colors, onCtaPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  ctaLabel: string;
  colors: any;
  onCtaPress?: () => void;
}) {
  const isDark = colors.isDark;
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIconWrap, { backgroundColor: isDark ? '#1c1c1e' : '#f5f5f7' }]}>
        <Ionicons name={icon} size={48} color={colors.textTertiary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>{description}</Text>
      <TouchableOpacity style={[styles.emptyCta, { backgroundColor: isDark ? SETUP_AVAILABILITY_BLUE : '#111' }]} activeOpacity={0.85} onPress={onCtaPress}>
        <Text style={[styles.emptyCtaText, { color: '#fff' }]}>{ctaLabel}</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

/* ─── Channel Panel ─── */

function ChannelPanel({ channels, soundcloudUrl, setSoundcloudUrl, saving, onSave, onClose, onUnlinkYoutube, onUnlinkVimeo, onUnlinkSoundcloud, colors, t }: {
  channels: LinkedChannels;
  soundcloudUrl: string;
  setSoundcloudUrl: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  onUnlinkYoutube: () => void;
  onUnlinkVimeo: () => void;
  onUnlinkSoundcloud: () => void;
  colors: any;
  t: any;
}) {
  const isDark = colors.isDark;
  const ytLinked = !!(channels.youtubeChannelName && channels.youtubeVerified);
  const vimeoLinked = !!(channels.vimeoChannelName && channels.vimeoVerified);
  const scLinked = !!channels.soundcloudProfileName;

  return (
    <View style={[styles.channelPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <Text style={[styles.cpTitle, { color: colors.text }]}>
        {t('CREATE_MATERIAL.CHANNEL_HEADER')}
      </Text>
      <Text style={[styles.cpDesc, { color: colors.textSecondary }]}>
        {t('CREATE_MATERIAL.CHANNEL_DESC')}
      </Text>

      {/* YouTube */}
      <View style={[styles.cpField, { borderBottomColor: colors.border }]}>
        <View style={styles.cpLabelRow}>
          <View style={[styles.cpProviderIcon, { backgroundColor: '#FF0000' }]}>
            <Ionicons name="logo-youtube" size={14} color="#fff" />
          </View>
          <Text style={[styles.cpLabel, { color: colors.text }]}>
            {t('CREATE_MATERIAL.CHANNEL_YOUTUBE')}
          </Text>
        </View>
        {ytLinked ? (
          <View style={styles.cpLinkedRow}>
            {channels.youtubeChannelAvatar ? (
              <Image source={{ uri: channels.youtubeChannelAvatar }} style={styles.cpAvatar} />
            ) : (
              <View style={[styles.cpAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8' }]} />
            )}
            <View style={styles.cpLinkedInfo}>
              <Text style={[styles.cpChannelName, { color: colors.text }]} numberOfLines={1}>
                {channels.youtubeChannelName}
              </Text>
              {!!channels.youtubeSubscriberCount && (
                <Text style={[styles.cpSubs, { color: colors.textTertiary }]}>
                  {channels.youtubeSubscriberCount}
                </Text>
              )}
            </View>
            <View style={styles.cpVerifiedBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#10b981" />
              <Text style={styles.cpVerifiedText}>{t('CREATE_MATERIAL.CARD_VERIFIED')}</Text>
            </View>
            <TouchableOpacity onPress={onUnlinkYoutube} activeOpacity={0.7} style={styles.cpRemoveBtn}>
              <Ionicons name="close-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.cpSignInBtn, { backgroundColor: '#FF0000' }]}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-youtube" size={16} color="#fff" />
            <Text style={styles.cpSignInText}>{t('CREATE_MATERIAL.CHANNEL_SIGN_IN_YOUTUBE')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Vimeo */}
      <View style={[styles.cpField, { borderBottomColor: colors.border }]}>
        <View style={styles.cpLabelRow}>
          <View style={[styles.cpProviderIcon, { backgroundColor: '#1AB7EA' }]}>
            <Ionicons name="logo-vimeo" size={14} color="#fff" />
          </View>
          <Text style={[styles.cpLabel, { color: colors.text }]}>
            {t('CREATE_MATERIAL.CHANNEL_VIMEO')}
          </Text>
        </View>
        {vimeoLinked ? (
          <View style={styles.cpLinkedRow}>
            {channels.vimeoChannelAvatar ? (
              <Image source={{ uri: channels.vimeoChannelAvatar }} style={styles.cpAvatar} />
            ) : (
              <View style={[styles.cpAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8' }]} />
            )}
            <View style={styles.cpLinkedInfo}>
              <Text style={[styles.cpChannelName, { color: colors.text }]} numberOfLines={1}>
                {channels.vimeoChannelName}
              </Text>
            </View>
            <View style={styles.cpVerifiedBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#10b981" />
              <Text style={styles.cpVerifiedText}>{t('CREATE_MATERIAL.CARD_VERIFIED')}</Text>
            </View>
            <TouchableOpacity onPress={onUnlinkVimeo} activeOpacity={0.7} style={styles.cpRemoveBtn}>
              <Ionicons name="close-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.cpSignInBtn, { backgroundColor: '#1AB7EA' }]}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-vimeo" size={16} color="#fff" />
            <Text style={styles.cpSignInText}>{t('CREATE_MATERIAL.CHANNEL_SIGN_IN_VIMEO')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* SoundCloud */}
      <View style={styles.cpField}>
        <View style={styles.cpLabelRow}>
          <View style={[styles.cpProviderIcon, { backgroundColor: isDark ? '#444' : '#f0f0f2' }]}>
            <Ionicons name="musical-notes-outline" size={14} color={isDark ? '#ccc' : '#666'} />
          </View>
          <Text style={[styles.cpLabel, { color: colors.text }]}>
            {t('CREATE_MATERIAL.CHANNEL_SOUNDCLOUD')}
          </Text>
        </View>
        {scLinked ? (
          <View style={styles.cpLinkedRow}>
            {channels.soundcloudProfileAvatar ? (
              <Image source={{ uri: channels.soundcloudProfileAvatar }} style={styles.cpAvatar} />
            ) : (
              <View style={[styles.cpAvatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8', alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="musical-notes" size={14} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.cpLinkedInfo}>
              <Text style={[styles.cpChannelName, { color: colors.text }]} numberOfLines={1}>
                {channels.soundcloudProfileName}
              </Text>
            </View>
            <TouchableOpacity onPress={onUnlinkSoundcloud} activeOpacity={0.7} style={styles.cpRemoveBtn}>
              <Ionicons name="close-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TextInput
            style={[styles.cpInput, {
              backgroundColor: colors.inputBg,
              color: colors.text,
              borderColor: colors.border,
            }]}
            placeholder="https://soundcloud.com/yourprofile"
            placeholderTextColor={colors.textTertiary}
            value={soundcloudUrl}
            onChangeText={setSoundcloudUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        )}
      </View>

      {/* Actions */}
      <View style={styles.cpActions}>
        <TouchableOpacity
          style={[styles.cpCancelBtn, { borderColor: colors.border }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={[styles.cpCancelText, { color: colors.text }]}>{t('COMMON.CANCEL') || 'Cancel'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cpSaveBtn, { backgroundColor: isDark ? '#fff' : '#111', opacity: saving ? 0.6 : 1 }]}
          onPress={onSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving && <ActivityIndicator size="small" color={isDark ? '#000' : '#fff'} style={{ marginRight: 6 }} />}
          <Text style={[styles.cpSaveText, { color: isDark ? '#000' : '#fff' }]}>
            {saving ? t('CREATE_MATERIAL.CHANNEL_VERIFYING') : t('CREATE_MATERIAL.CHANNEL_SAVE')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Material Card ─── */

function MaterialCard({ material: m, colors, copiedId, getTypeLabel, getTypeIcon, formatDate, onCopyLink, onDelete, onToggleArchive, onPreview, t }: {
  material: TutorMaterial;
  colors: any;
  copiedId: string | null;
  getTypeLabel: (t: string) => string;
  getTypeIcon: (t: string) => keyof typeof Ionicons.glyphMap;
  formatDate: (d: string) => string;
  onCopyLink: (id: string) => void;
  onDelete: (m: TutorMaterial) => void;
  onToggleArchive: (m: TutorMaterial) => void;
  onPreview: (m: TutorMaterial) => void;
  t: any;
}) {
  const isDark = colors.isDark;
  const isArchived = m.status === 'archived';

  return (
    <View style={[
      styles.materialCard,
      {
        backgroundColor: colors.card,
        borderColor: colors.border,
        shadowOpacity: isDark ? 0.28 : 0.11,
        shadowRadius: isDark ? 10 : 12,
      },
      isArchived && { opacity: 0.55 },
    ]}>
      {/* Thumbnail */}
      <View style={styles.thumbWrap}>
        {m.thumbnailUrl ? (
          <Image source={{ uri: m.thumbnailUrl }} style={styles.thumbImg} contentFit="cover" />
        ) : (
          <View style={[styles.thumbPlaceholder, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
            <Ionicons name={getTypeIcon(m.materialType)} size={22} color={colors.textTertiary} />
          </View>
        )}
        {(m.status === 'draft' || m.status === 'archived') && (
          <View style={[
            styles.statusBadge,
            m.status === 'draft'
              ? { backgroundColor: isDark ? 'rgba(255,149,0,0.2)' : '#FFF3E0' }
              : { backgroundColor: isDark ? 'rgba(142,142,147,0.2)' : '#F5F5F5' },
          ]}>
            <Text style={[
              styles.statusBadgeText,
              { color: m.status === 'draft' ? (isDark ? '#fbbf24' : '#E65100') : colors.textSecondary },
            ]}>
              {m.status}
            </Text>
          </View>
        )}
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        {/* Type + Review badges */}
        <View style={styles.badgesRow}>
          <Text style={[styles.typeLabel, { color: colors.textSecondary }]}>
            {getTypeLabel(m.materialType).toUpperCase()}
          </Text>
          {m.channelVerified && (
            <View style={styles.reviewBadge}>
              <Ionicons name="checkmark-circle" size={10} color="#10b981" />
              <Text style={[styles.reviewBadgeText, { color: '#10b981' }]}>{t('CREATE_MATERIAL.CARD_VERIFIED')}</Text>
            </View>
          )}
          {m.reviewStatus === 'pending_review' && (
            <View style={styles.reviewBadge}>
              <Ionicons name="time-outline" size={10} color={colors.warning} />
              <Text style={[styles.reviewBadgeText, { color: colors.warning }]}>{t('CREATE_MATERIAL.CARD_PENDING')}</Text>
            </View>
          )}
          {m.reviewStatus === 'rejected' && (
            <View style={styles.reviewBadge}>
              <Ionicons name="close-circle-outline" size={10} color={colors.danger} />
              <Text style={[styles.reviewBadgeText, { color: colors.danger }]}>{t('CREATE_MATERIAL.CARD_REJECTED')}</Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>{m.title}</Text>

        {/* Price + Questions */}
        <View style={styles.priceRow}>
          <Text style={[
            styles.priceText,
            m.pricingType === 'paid' ? { color: isDark ? '#60a5fa' : '#2563eb' } : { color: '#10b981' },
          ]}>
            {m.pricingType === 'paid' ? `$${m.price}` : t('CREATE_MATERIAL.CARD_FREE')}
          </Text>
          <Text style={[styles.questionCount, { color: colors.textSecondary }]}>
            {m.quiz.length === 1
              ? t('CREATE_MATERIAL.CARD_QUESTIONS', { count: m.quiz.length })
              : t('CREATE_MATERIAL.CARD_QUESTIONS_PLURAL', { count: m.quiz.length })}
          </Text>
        </View>

        {/* Language + Date */}
        <Text style={[styles.detailsLine, { color: colors.textTertiary }]}>
          {m.language}  ·  Added {formatDate(m.createdAt)}
        </Text>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="eye-outline" size={12} color={colors.textTertiary} />
            <Text style={[styles.statText, { color: colors.textSecondary }]}>{m.stats.views}</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="school-outline" size={12} color={colors.textTertiary} />
            <Text style={[styles.statText, { color: colors.textSecondary }]}>{m.stats.quizAttempts}</Text>
          </View>
          {m.stats.averageScore > 0 && (
            <View style={styles.statItem}>
              <Ionicons name="trending-up-outline" size={12} color={colors.textTertiary} />
              <Text style={[styles.statText, { color: colors.textSecondary }]}>{m.stats.averageScore}%</Text>
            </View>
          )}
          {m.pricingType === 'paid' && (
            <View style={styles.statItem}>
              <Ionicons name="card-outline" size={12} color={colors.textTertiary} />
              <Text style={[styles.statText, { color: colors.textSecondary }]}>{m.stats.purchases}</Text>
            </View>
          )}
        </View>

        {/* Preview button */}
        <TouchableOpacity
          style={[styles.previewBtn, { borderColor: colors.border, backgroundColor: isDark ? '#1c1c1e' : '#fafafa' }]}
          activeOpacity={0.7}
          onPress={() => onPreview(m)}
        >
          <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.previewBtnText, { color: colors.text }]}>{t('CREATE_MATERIAL.CARD_PREVIEW')}</Text>
        </TouchableOpacity>

        {/* Action icons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]} activeOpacity={0.7}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}
            onPress={() => onCopyLink(m._id)}
            activeOpacity={0.7}
          >
            <Ionicons name={copiedId === m._id ? 'checkmark-outline' : 'link-outline'} size={15} color={copiedId === m._id ? '#10b981' : colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]}
            onPress={() => onToggleArchive(m)}
            activeOpacity={0.7}
          >
            <Ionicons name={isArchived ? 'arrow-undo-outline' : 'archive-outline'} size={15} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : '#fef2f2' }]}
            onPress={() => onDelete(m)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ─── Bundle Card ─── */

function BundleCard({ bundle: b, colors, onPreview, onEdit, onDelete }: {
  bundle: MaterialBundle;
  colors: any;
  onPreview?: (b: MaterialBundle) => void;
  onEdit?: (b: MaterialBundle) => void;
  onDelete?: (b: MaterialBundle) => void;
}) {
  const isDark = colors.isDark;
  return (
    <View style={[
      styles.materialCard,
      {
        backgroundColor: colors.card,
        borderColor: colors.border,
        shadowOpacity: isDark ? 0.28 : 0.11,
        shadowRadius: isDark ? 10 : 12,
      },
    ]}>
      {/* Cover */}
      <View style={styles.thumbWrap}>
        {b.coverImageUrl ? (
          <Image source={{ uri: b.coverImageUrl }} style={styles.thumbImg} contentFit="cover" />
        ) : (
          <View style={[styles.thumbPlaceholder, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
            <Ionicons name="folder-outline" size={22} color={colors.textTertiary} />
          </View>
        )}
        {b.status === 'draft' && (
          <View style={[styles.statusBadge, { backgroundColor: isDark ? 'rgba(255,149,0,0.2)' : '#FFF3E0' }]}>
            <Text style={[styles.statusBadgeText, { color: isDark ? '#fbbf24' : '#E65100' }]}>Draft</Text>
          </View>
        )}
        <View style={[
          styles.priceBadge,
          b.pricingType === 'paid' ? { backgroundColor: isDark ? 'rgba(96,165,250,0.18)' : '#EFF6FF' } : { backgroundColor: isDark ? 'rgba(16,185,129,0.18)' : '#ECFDF5' },
        ]}>
          <Text style={[styles.priceBadgeText, { color: b.pricingType === 'paid' ? (isDark ? '#60a5fa' : '#2563eb') : '#10b981' }]}>
            {b.pricingType === 'paid' ? `$${b.price}` : 'Free'}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>{b.title}</Text>
        {!!b.description && (
          <Text style={[styles.detailsLine, { color: colors.textSecondary }]} numberOfLines={2}>{b.description}</Text>
        )}

        <View style={styles.bundleMeta}>
          <View style={styles.statItem}>
            <Ionicons name="layers-outline" size={12} color={colors.textTertiary} />
            <Text style={[styles.statText, { color: colors.textSecondary }]}>{b.items?.length || 0} items</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="globe-outline" size={12} color={colors.textTertiary} />
            <Text style={[styles.statText, { color: colors.textSecondary }]}>{b.language}</Text>
          </View>
        </View>

        {b.structuredTags && b.structuredTags.length > 0 && (
          <View style={styles.tagsRow}>
            {b.structuredTags.slice(0, 3).map(tag => (
              <View key={tag} style={[styles.tag, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f2' }]}>
                <Text style={[styles.tagText, { color: colors.textSecondary }]}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.bundleFooter, { borderTopColor: colors.border }]}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="eye-outline" size={12} color={colors.textTertiary} />
              <Text style={[styles.statText, { color: colors.textSecondary }]}>{b.stats?.views || 0}</Text>
            </View>
            {b.pricingType === 'paid' && (
              <View style={styles.statItem}>
                <Ionicons name="card-outline" size={12} color={colors.textTertiary} />
                <Text style={[styles.statText, { color: colors.textSecondary }]}>{b.stats?.purchases || 0}</Text>
              </View>
            )}
          </View>
          <View style={styles.bundleActions}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]} activeOpacity={0.7} onPress={() => onPreview?.(b)}>
              <Ionicons name="eye-outline" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f7' }]} activeOpacity={0.7} onPress={() => onEdit?.(b)}>
              <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,69,58,0.12)' : '#fef2f2' }]} activeOpacity={0.7} onPress={() => onDelete?.(b)}>
              <Ionicons name="trash-outline" size={14} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLabel: { fontSize: 16, fontWeight: '500' },
  headerNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  headerNewBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },

  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 44,
  },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },

  /* Panel overlay (blur + floating panel) */
  panelOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },

  /* Channel button */
  channelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  channelBtnText: { fontSize: 12, fontWeight: '600' },

  /* Segmented pill switcher (Airbnb-style) */
  segmentedWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 14,
    padding: 3,
    marginBottom: 28,
  },
  segmentedPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  segmentedPillActive: {},
  segmentedLabel: { fontSize: 14, fontWeight: '600' },
  segmentedBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentedBadgeText: { fontSize: 11, fontWeight: '700' },

  /* New button */
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 48,
  },
  newBtnText: { fontSize: 15, fontWeight: '600' },

  /* Gateway card — matches Up Next card surface from HomeScreen */
  gatewayCard: {
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'visible',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 28,
    shadowOpacity: 0.14,
    elevation: 14,
  },
  gatewayHero: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
  },
  gatewayHeroImg: {
    width: 88,
    height: 88,
  },
  gatewaySection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 24,
    paddingHorizontal: 22,
  },
  gatewayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
  },
  gatewayIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayTextWrap: {
    flex: 1,
  },
  gatewayTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  gatewaySubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },

  /* List header row (back + new) */
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  listBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  listBackText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  listNewBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },

  /* Loading */
  loadingWrap: { paddingVertical: 60, alignItems: 'center' },

  /* Empty */
  emptyWrap: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptyDesc: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  emptyCtaText: { fontSize: 15, fontWeight: '600' },

  /* Card list */
  cardList: { gap: 48, paddingTop: 12 },

  /* Material Card */
  materialCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.11,
    shadowRadius: 12,
    elevation: 5,
  },

  /* Thumbnail */
  thumbWrap: {
    position: 'relative',
    // Shorter banner than 16:8 so cover art reads smaller on list cards
    aspectRatio: 16 / 6,
    overflow: 'hidden',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  priceBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priceBadgeText: { fontSize: 11, fontWeight: '700' },

  /* Card body */
  cardBody: {
    padding: 10,
    overflow: 'hidden',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },

  /* Badges */
  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  typeLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  reviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  reviewBadgeText: { fontSize: 9, fontWeight: '600' },

  /* Title */
  cardTitle: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2, marginBottom: 4 },

  /* Price row */
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  priceText: { fontSize: 12, fontWeight: '700' },
  questionCount: { fontSize: 11 },

  /* Details line */
  detailsLine: { fontSize: 11, marginBottom: 6 },

  /* Stats */
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statText: { fontSize: 11, fontWeight: '500' },

  /* Preview */
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  previewBtnText: { fontSize: 13, fontWeight: '600' },

  /* Actions */
  actionsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Bundle extras */
  bundleMeta: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  tagsRow: { flexDirection: 'row', gap: 5, marginBottom: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: '600' },
  bundleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bundleActions: { flexDirection: 'row', gap: 6 },

  /* Channel Panel */
  channelPanel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginTop: 12,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  cpTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cpDesc: { fontSize: 13, lineHeight: 19, marginBottom: 20 },
  cpField: {
    paddingBottom: 16,
    marginBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cpLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cpProviderIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cpLabel: { fontSize: 14, fontWeight: '600' },
  cpLinkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cpAvatar: { width: 36, height: 36, borderRadius: 18 },
  cpLinkedInfo: { flex: 1 },
  cpChannelName: { fontSize: 14, fontWeight: '600' },
  cpSubs: { fontSize: 11, marginTop: 1 },
  cpVerifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cpVerifiedText: { fontSize: 11, fontWeight: '600', color: '#10b981' },
  cpRemoveBtn: { padding: 4 },
  cpSignInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cpSignInText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  cpInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
  },
  cpActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cpCancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  cpCancelText: { fontSize: 14, fontWeight: '600' },
  cpSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 10,
  },
  cpSaveText: { fontSize: 14, fontWeight: '600' },
});
