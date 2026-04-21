import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../hooks/useAuth';

type MainTab = 'community' | 'profile' | 'answers';

interface Props {
  goBack: () => void;
}

/**
 * Community forum — same overlay entry as Materials / My Classes on Home.
 * Only students may start threads (matches web).
 */
export default function ForumScreen({ goBack }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDark = colors.isDark;
  const normalizedRole = (user?.userType as string | undefined)?.toLowerCase();
  const isTutorUser = normalizedRole === 'tutor';
  const isStudentUser = normalizedRole === 'student';
  const canStartThread = isStudentUser;

  const [mainTab, setMainTab] = useState<MainTab>('community');
  const [sortKey, setSortKey] = useState<'latest' | 'popular'>('latest');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const threads: unknown[] = [];

  const onTab = useCallback((tab: MainTab) => {
    void Haptics.selectionAsync();
    setMainTab(tab);
  }, []);

  const onSort = useCallback((key: 'latest' | 'popular') => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSortKey(key);
  }, []);

  const toggleBookmarks = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBookmarksOnly(b => !b);
  }, []);

  const toggleSearch = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearchOpen(s => {
      if (s) setSearchQuery('');
      return !s;
    });
  }, []);

  const startNewThread = useCallback(() => {
    if (!canStartThread) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Wire when compose API exists
  }, [canStartThread]);

  const primaryBg = colors.joinCtaBackground;

  const emptyTitle = useMemo(() => {
    if (isTutorUser) return t('FORUM.EMPTY_TITLE_TUTOR');
    return t('FORUM.EMPTY_TITLE');
  }, [isTutorUser, t]);

  const emptySub = useMemo(() => {
    if (isTutorUser) return t('FORUM.EMPTY_SUBTITLE_TUTOR');
    if (isStudentUser) return t('FORUM.EMPTY_SUBTITLE');
    return t('FORUM.EMPTY_SUBTITLE_FALLBACK');
  }, [isTutorUser, isStudentUser, t]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={goBack} style={styles.headerBack} hitSlop={12} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.headerBackLabel, { color: colors.text }]}>{t('COMMON.BACK')}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {t('FORUM.PAGE_TITLE')}
          </Text>
          <View style={{ width: 72 }} />
        </View>

        <View style={[styles.tabRail, { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
          {(['community', 'profile', 'answers'] as const).map(tab => {
            const active = mainTab === tab;
            const label =
              tab === 'community'
                ? t('FORUM.TAB_COMMUNITY')
                : tab === 'profile'
                  ? t('FORUM.TAB_PROFILE')
                  : t('FORUM.TAB_MY_ANSWERS');
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => onTab(tab)}
                style={[
                  styles.tabBtn,
                  active && { backgroundColor: isDark ? colors.card : '#ffffff' },
                  active && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
                ]}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.tabBtnText,
                    { color: active ? colors.text : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.threadHead, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('FORUM.THREADS')}</Text>
              <View style={styles.threadHeadActions}>
                <View style={[styles.sortSplit, { borderColor: colors.border, backgroundColor: isDark ? colors.surface : '#fafafa' }]}>
                  <TouchableOpacity
                    onPress={() => onSort('latest')}
                    style={[
                      styles.sortBtn,
                      styles.sortBtnFirst,
                      { borderRightColor: colors.border },
                      sortKey === 'latest' && { backgroundColor: isDark ? colors.card : '#fff' },
                    ]}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.sortBtnText,
                        { color: sortKey === 'latest' ? colors.text : colors.textSecondary },
                      ]}
                    >
                      {t('FORUM.SORT_LATEST')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onSort('popular')}
                    style={[styles.sortBtn, sortKey === 'popular' && { backgroundColor: isDark ? colors.card : '#fff' }]}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.sortBtnText,
                        { color: sortKey === 'popular' ? colors.text : colors.textSecondary },
                      ]}
                    >
                      {t('FORUM.SORT_POPULAR')}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={toggleBookmarks}
                  style={[
                    styles.iconBtn,
                    {
                      borderColor: bookmarksOnly ? primaryBg : colors.border,
                      backgroundColor: bookmarksOnly ? (isDark ? 'rgba(73,174,234,0.15)' : 'rgba(0,0,0,0.06)') : isDark ? colors.surface : '#fafafa',
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="bookmark-outline"
                    size={18}
                    color={bookmarksOnly ? primaryBg : colors.textSecondary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={toggleSearch}
                  style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: isDark ? colors.surface : '#fafafa' }]}
                  activeOpacity={0.8}
                >
                  <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {searchOpen ? (
              <View style={[styles.searchBar, { borderColor: colors.border, backgroundColor: isDark ? colors.surface : '#fafafa' }]}>
                <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('FORUM.SEARCH_PLACEHOLDER')}
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.searchInput, { color: colors.text }]}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : null}

            {threads.length === 0 ? (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
                  <Ionicons name="chatbubbles-outline" size={40} color={colors.textSecondary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{emptyTitle}</Text>
                <Text style={[styles.emptySub, { color: colors.textSecondary }]}>{emptySub}</Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.sideCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sideTitle, { color: colors.text }]}>{t('FORUM.TOP_USERS')}</Text>
            <Text style={[styles.sideHint, { color: colors.textSecondary }]}>{t('FORUM.SIDEBAR_EMPTY')}</Text>
          </View>

          {canStartThread ? (
            <TouchableOpacity
              style={[styles.fullWidthCta, { backgroundColor: primaryBg }]}
              onPress={startNewThread}
              activeOpacity={0.88}
            >
              <Ionicons name="add-outline" size={22} color="#ffffff" />
              <Text style={styles.primaryBtnText}>{t('FORUM.START_NEW_THREAD')}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 72,
  },
  headerBackLabel: {
    fontSize: 17,
    fontWeight: 400,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: 600,
  },
  tabRail: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: 600,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 16,
  },
  threadHead: {
    flexDirection: 'column',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  threadHeadActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  sortSplit: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  sortBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sortBtnFirst: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  sortBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 320,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  sideCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
  },
  sideTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  sideHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  fullWidthCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
});
