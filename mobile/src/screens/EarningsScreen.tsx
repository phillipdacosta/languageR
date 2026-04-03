import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import {
  earningsService,
  EarningsBalance,
  PaymentItem,
  WithdrawalItem,
  buildChartData,
  getEarningsCache,
} from '../services/earnings';

const SCREEN_W = Dimensions.get('window').width;
type ChartPeriod = '1m' | '6m' | 'all';
type DateRange = 'all' | 'today' | 'week' | 'month' | 'year';
const DATE_OPTION_KEYS: { key: DateRange; tKey: string }[] = [
  { key: 'all', tKey: 'EARNINGS.FILTER_ALL_TIME' },
  { key: 'today', tKey: 'EARNINGS.FILTER_TODAY' },
  { key: 'week', tKey: 'EARNINGS.FILTER_LAST_7_DAYS' },
  { key: 'month', tKey: 'EARNINGS.FILTER_THIS_MONTH' },
  { key: 'year', tKey: 'EARNINGS.FILTER_THIS_YEAR' },
];

interface Props { goBack: () => void }

export default function EarningsScreen({ goBack }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const cached = getEarningsCache();

  const [loading, setLoading] = useState(!cached.hasCachedData);
  const [refreshing, setRefreshing] = useState(false);
  const [balance, setBalance] = useState<EarningsBalance>(cached.balance || { available: 0, pending: 0, lifetime: 0 });
  const [payments, setPayments] = useState<PaymentItem[]>(cached.payments || []);
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>(cached.withdrawals || []);
  const [showBalance, setShowBalance] = useState(true);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1m');
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(20);

  // Filters
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDate, setFilterDate] = useState<DateRange>('all');
  const [filterStudent, setFilterStudent] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const chartData = buildChartData(payments, chartPeriod);
  const hasChartData = chartData.data.some(v => v > 0);

  const uniqueStudents = useMemo(() => {
    const map = new Map<string, { id: string; name: string; picture?: string }>();
    for (const p of payments) {
      if (p.studentName && !map.has(p.studentName)) {
        map.set(p.studentName, { id: p.studentName, name: p.studentName, picture: p.studentPicture });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [payments]);

  const uniqueStatuses = useMemo(() => {
    const s = new Set<string>();
    for (const p of payments) if (p.status) s.add(p.status);
    return Array.from(s).sort();
  }, [payments]);

  const filteredPayments = useMemo(() => {
    let filtered = [...payments];

    if (filterDate !== 'all') {
      const now = new Date();
      let start: Date;
      if (filterDate === 'today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      else if (filterDate === 'week') start = new Date(now.getTime() - 7 * 86400000);
      else if (filterDate === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
      else start = new Date(now.getFullYear(), 0, 1);
      filtered = filtered.filter(p => new Date(p.date) >= start);
    }
    if (filterStudent !== 'all') filtered = filtered.filter(p => p.studentName === filterStudent);
    if (filterStatus !== 'all') filtered = filtered.filter(p => p.status === filterStatus);
    return filtered;
  }, [payments, filterDate, filterStudent, filterStatus]);

  const activeFilterCount = (filterDate !== 'all' ? 1 : 0) + (filterStudent !== 'all' ? 1 : 0) + (filterStatus !== 'all' ? 1 : 0);
  const displayedPayments = filteredPayments.slice(0, displayLimit);

  const fetchAll = useCallback(async () => {
    const [bal, earningsData, history] = await Promise.all([
      earningsService.getBalance(),
      earningsService.getEarnings(),
      earningsService.getWithdrawalHistory(),
    ]);
    setBalance(bal);
    setPayments(earningsData.payments);
    setWithdrawals(history);
  }, []);

  useEffect(() => {
    (async () => { await fetchAll(); setLoading(false); })();
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await fetchAll(); setRefreshing(false);
  }, [fetchAll]);

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { Alert.alert(t('EARNINGS.WITHDRAW_INVALID_AMOUNT'), t('EARNINGS.WITHDRAW_MIN_STRIPE_ERROR')); return; }
    if (amount > balance.available) { Alert.alert(t('EARNINGS.WITHDRAW_INSUFFICIENT'), t('EARNINGS.WITHDRAW_EXCEEDS_BALANCE')); return; }
    Alert.alert(t('EARNINGS.WITHDRAW_CONFIRM_TITLE'), t('EARNINGS.WITHDRAW_CONFIRM_MSG', { amount: amount.toFixed(2), method: 'Stripe' }), [
      { text: t('COMMON.CANCEL'), style: 'cancel' },
      { text: t('EARNINGS.WITHDRAW_CONFIRM_BTN'), onPress: async () => {
        setWithdrawing(true);
        const res = await earningsService.requestWithdrawal(amount, 'stripe_connect');
        setWithdrawing(false);
        if (res.success) { setWithdrawModalOpen(false); setWithdrawAmount(''); Alert.alert(t('EARNINGS.WITHDRAW_SUCCESS_TITLE'), t('EARNINGS.WITHDRAW_SUCCESS', { amount: amount.toFixed(2) })); await fetchAll(); }
        else Alert.alert(t('EARNINGS.OK'), res.message || t('EARNINGS.WITHDRAW_ERROR'));
      }},
    ]);
  };

  const smoothLayout = () => {
    LayoutAnimation.configureNext({
      duration: 280,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
  };

  const setFilterDateSmooth = (v: DateRange) => { smoothLayout(); setFilterDate(v); };
  const setFilterStudentSmooth = (v: string) => { smoothLayout(); setFilterStudent(v); };
  const setFilterStatusSmooth = (v: string) => { smoothLayout(); setFilterStatus(v); };
  const clearFilters = () => { smoothLayout(); setFilterDate('all'); setFilterStudent('all'); setFilterStatus('all'); };

  const getStatusLabel = (st: string) => {
    const map: Record<string, string> = {
      paid: t('EARNINGS.STATUS_TRANSFERRED'),
      succeeded: t('EARNINGS.STATUS_AVAILABLE'),
      pending: t('EARNINGS.STATUS_PENDING'),
      in_progress: t('EARNINGS.STATUS_IN_PROGRESS'),
      processing: t('EARNINGS.STATUS_PROCESSING'),
      scheduled: t('EARNINGS.STATUS_SCHEDULED'),
      class_scheduled: t('EARNINGS.STATUS_SCHEDULED'),
      cancelled: t('EARNINGS.STATUS_CANCELLED'),
      refunded: t('EARNINGS.STATUS_REFUNDED'),
      partially_refunded: t('EARNINGS.STATUS_REDUCED'),
    };
    return map[st] || st.charAt(0).toUpperCase() + st.slice(1);
  };

  const getStatusDotColor = (s: string) => {
    if (s === 'paid' || s === 'succeeded') return '#008A05';
    if (s === 'pending' || s === 'processing' || s === 'in_progress' || s === 'scheduled' || s === 'class_scheduled') return '#E07912';
    if (s === 'cancelled' || s === 'refunded' || s === 'partially_refunded') return '#C13515';
    return '#ccc';
  };

  if (loading) return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header goBack={goBack} colors={colors} t={t} />
      <SkeletonLoader colors={colors} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.surface }]} edges={['top']}>
      <Header goBack={goBack} colors={colors} t={t} />
      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Balance Hero ── */}
        <View style={[s.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowBalance(!showBalance)} activeOpacity={0.8} style={s.heroMain}>
            <Text style={s.heroLabel}>{t('EARNINGS.AVAILABLE').toUpperCase()}</Text>
            <Text style={[s.heroAmount, { color: colors.text }]}>{showBalance ? `$${balance.available.toFixed(2)}` : '$••••'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.withdrawBtn, { backgroundColor: colors.accent }, balance.available <= 0 && [s.withdrawBtnDisabled, { backgroundColor: colors.inputBg, borderColor: colors.border }]]}
            onPress={() => { setWithdrawAmount(''); setWithdrawModalOpen(true); }}
            disabled={balance.available <= 0} activeOpacity={0.85}
          >
            <Text style={[s.withdrawBtnText, { color: colors.background }, balance.available <= 0 && { color: colors.textTertiary }]}>{t('EARNINGS.WITHDRAW_FUNDS')}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Pending / Lifetime ── */}
        <View style={s.statRow}>
          <TouchableOpacity style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setShowBalance(!showBalance)} activeOpacity={0.8}>
            <Text style={[s.statLabel, { color: '#E07912' }]}>{t('EARNINGS.PENDING')}</Text>
            <Text style={[s.statValue, { color: colors.text }]}>{showBalance ? `$${balance.pending.toFixed(2)}` : '$••••'}</Text>
            <Text style={[s.statSub, { color: colors.textTertiary }]}>{t('EARNINGS.PENDING_HOLD')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setShowBalance(!showBalance)} activeOpacity={0.8}>
            <Text style={[s.statLabel, { color: colors.textSecondary }]}>{t('EARNINGS.LIFETIME')}</Text>
            <Text style={[s.statValue, { color: colors.text }]}>{showBalance ? `$${balance.lifetime.toFixed(2)}` : '$••••'}</Text>
            <Text style={[s.statSub, { color: colors.textTertiary }]}>{t('EARNINGS.TOTAL_EARNED')}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Chart ── */}
        {payments.length > 0 && (
          <View style={[s.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.chartHeader}>
              <Text style={[s.chartTitle, { color: colors.text }]}>{t('EARNINGS.CHART_TITLE')}</Text>
              <View style={[s.periodRow, { backgroundColor: colors.inputBg }]}>
                {(['1m', '6m', 'all'] as ChartPeriod[]).map(p => (
                  <TouchableOpacity key={p} style={[s.periodBtn, chartPeriod === p && [s.periodActive, { backgroundColor: colors.card }]]} onPress={() => setChartPeriod(p)} activeOpacity={0.7}>
                    <Text style={[s.periodText, { color: colors.textSecondary }, chartPeriod === p && s.periodTextActive]}>{p === 'all' ? t('EARNINGS.CHART_ALL') : p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={[s.chartTotal, { color: colors.text }]}>{showBalance ? `$${chartData.total.toFixed(2)}` : '$••••'}</Text>
            {hasChartData ? (
              <MiniChart data={chartData.data} labels={chartData.labels} colors={colors} />
            ) : (
              <View style={s.chartEmpty}>
                <Ionicons name="bar-chart-outline" size={36} color={colors.textTertiary} />
                <Text style={[s.chartEmptyText, { color: colors.textSecondary }]}>{t('EARNINGS.CHART_NO_DATA')}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Transfers ── */}
        {withdrawals.length > 0 && (
          <View style={[s.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('EARNINGS.TRANSFERS_TITLE')}</Text>
            {withdrawals.map(w => (
              <View key={w.id} style={[s.transferRow, { borderTopColor: colors.border }]}>
                <View style={[s.transferIconWrap, { backgroundColor: colors.inputBg }]}>
                  <Ionicons name={w.method === 'paypal' ? 'logo-paypal' : 'card-outline'} size={20} color={colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.transferMethod, { color: colors.text }]}>{w.method === 'paypal' ? 'PayPal' : 'Stripe'}</Text>
                  <Text style={[s.transferDate, { color: colors.textTertiary }]}>{new Date(w.requestedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.transferAmt, { color: colors.text }]}>${(w.netAmount || w.amount).toFixed(2)}</Text>
                  <Text style={[s.transferStat, { color: getStatusDotColor(w.status) }]}>{w.status.charAt(0).toUpperCase() + w.status.slice(1)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Transactions ── */}
        <View style={[s.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.txnHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('EARNINGS.TXN_TITLE')}</Text>
            <TouchableOpacity style={[s.filterBtn, { backgroundColor: colors.inputBg }]} onPress={() => setFiltersOpen(true)} activeOpacity={0.7}>
              <Ionicons name="options-outline" size={16} color={colors.text} />
              <Text style={[s.filterBtnText, { color: colors.text }]}>{t('EARNINGS.TXN_FILTERS')}</Text>
              {activeFilterCount > 0 && <View style={[s.filterBadge, { backgroundColor: colors.accent }]}><Text style={s.filterBadgeText}>{activeFilterCount}</Text></View>}
            </TouchableOpacity>
          </View>

          {activeFilterCount > 0 && (
            <View style={s.activeChips}>
              {filterDate !== 'all' && (
                <TouchableOpacity style={[s.chip, { backgroundColor: colors.inputBg }]} onPress={() => setFilterDateSmooth('all')}>
                  <Text style={[s.chipText, { color: colors.text }]}>{t(DATE_OPTION_KEYS.find(d => d.key === filterDate)?.tKey || '')}</Text>
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {filterStudent !== 'all' && (
                <TouchableOpacity style={[s.chip, { backgroundColor: colors.inputBg }]} onPress={() => setFilterStudentSmooth('all')}>
                  <Text style={[s.chipText, { color: colors.text }]}>{filterStudent}</Text>
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {filterStatus !== 'all' && (
                <TouchableOpacity style={[s.chip, { backgroundColor: colors.inputBg }]} onPress={() => setFilterStatusSmooth('all')}>
                  <Text style={[s.chipText, { color: colors.text }]}>{getStatusLabel(filterStatus)}</Text>
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={clearFilters}><Text style={s.clearAll}>{t('EARNINGS.TXN_CLEAR_ALL')}</Text></TouchableOpacity>
            </View>
          )}

          {filteredPayments.length === 0 ? (
            <View style={s.txnEmpty}>
              <Ionicons name={activeFilterCount > 0 ? 'filter-outline' : 'receipt-outline'} size={36} color={colors.textTertiary} />
              <Text style={[s.txnEmptyTitle, { color: colors.text }]}>{activeFilterCount > 0 ? t('EARNINGS.TXN_NO_RESULTS_TITLE') : t('EARNINGS.TXN_EMPTY_TITLE')}</Text>
              <Text style={[s.txnEmptyBody, { color: colors.textSecondary }]}>{activeFilterCount > 0 ? t('EARNINGS.TXN_NO_RESULTS_SUB') : t('EARNINGS.TXN_EMPTY_SUB')}</Text>
              {activeFilterCount > 0 && <TouchableOpacity onPress={clearFilters}><Text style={s.clearLink}>{t('EARNINGS.TXN_CLEAR_FILTERS')}</Text></TouchableOpacity>}
            </View>
          ) : (
            displayedPayments.map(p => (
              <View key={p.id} style={[s.txnRow, { borderTopColor: colors.border }]}>
                <View style={s.txnAvatarWrap}>
                  {p.studentPicture ? <Image source={{ uri: p.studentPicture }} style={s.txnAvatar} /> : (
                    <View style={[s.txnAvatar, s.txnAvatarPH, { backgroundColor: colors.inputBg }]}><Ionicons name="person" size={16} color={colors.textTertiary} /></View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.txnName, { color: colors.text }]} numberOfLines={1}>{p.studentName}</Text>
                  <Text style={[s.txnDate, { color: colors.textTertiary }]}>{p.formattedDate || new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{p.formattedTime ? ` · ${p.formattedTime}` : ''}</Text>
                  <View style={s.txnChips}>
                    {p.isClassPayment && <View style={[s.txnChip, { backgroundColor: '#E8F5E9' }]}><Text style={[s.txnChipText, { color: '#2E7D32' }]}>{t('HOME.CLASSES')}</Text></View>}
                    {p.isMaterialPurchase && <View style={[s.txnChip, { backgroundColor: '#E3F2FD' }]}><Text style={[s.txnChipText, { color: '#1565C0' }]}>{t('HOME.MATERIALS')}</Text></View>}
                    {(p.tipAmount || 0) > 0 && <View style={[s.txnChip, { backgroundColor: '#FFF3E0' }]}><Text style={[s.txnChipText, { color: '#E07912' }]}>{t('EARNINGS.TXN_TIP')}</Text></View>}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.txnAmt, { color: colors.text }]}>${p.tutorPayout.toFixed(2)}</Text>
                  <View style={s.txnStatusRow}>
                    <View style={[s.dot, { backgroundColor: getStatusDotColor(p.status) }]} />
                    <Text style={[s.txnStatusText, { color: colors.textTertiary }]}>{getStatusLabel(p.status)}</Text>
                  </View>
                </View>
              </View>
            ))
          )}
          {displayLimit < filteredPayments.length && (
            <TouchableOpacity style={s.loadMore} onPress={() => setDisplayLimit(n => n + 20)} activeOpacity={0.7}>
              <Text style={s.loadMoreText}>{t('COMMON.LOAD_MORE') || 'Load More'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Filters Modal ── */}
      <Modal visible={filtersOpen} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaProvider>
        <SafeAreaView style={[s.modalSafe, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
          <View style={[s.modalHead, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setFiltersOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            <Text style={[s.modalHeadTitle, { color: colors.text }]}>{t('EARNINGS.TXN_FILTERS')}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView contentContainerStyle={s.filterContent} showsVerticalScrollIndicator={false}>
            {activeFilterCount > 0 && (
              <View style={s.filterChipRow}>
                {filterDate !== 'all' && (
                  <TouchableOpacity style={[s.filterChip, { backgroundColor: colors.inputBg }]} onPress={() => setFilterDateSmooth('all')}>
                    <Text style={[s.filterChipText, { color: colors.text }]}>{t(DATE_OPTION_KEYS.find(d => d.key === filterDate)?.tKey || '')}</Text>
                    <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                {filterStudent !== 'all' && (
                  <TouchableOpacity style={[s.filterChip, { backgroundColor: colors.inputBg }]} onPress={() => setFilterStudentSmooth('all')}>
                    <Text style={[s.filterChipText, { color: colors.text }]}>{filterStudent}</Text>
                    <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                {filterStatus !== 'all' && (
                  <TouchableOpacity style={[s.filterChip, { backgroundColor: colors.inputBg }]} onPress={() => setFilterStatusSmooth('all')}>
                    <Text style={[s.filterChipText, { color: colors.text }]}>{getStatusLabel(filterStatus)}</Text>
                    <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text style={[s.filterSectionTitle, { color: colors.text }]}>{t('EARNINGS.FILTER_TIME_PERIOD')}</Text>
            <View style={s.filterGrid}>
              {DATE_OPTION_KEYS.map(d => (
                <TouchableOpacity key={d.key} style={[s.filterGridBtn, { backgroundColor: colors.card, borderColor: colors.border }, filterDate === d.key && s.filterGridBtnActive]} onPress={() => setFilterDateSmooth(d.key)} activeOpacity={0.7}>
                  <Text style={[s.filterGridBtnText, { color: colors.text }, filterDate === d.key && s.filterGridBtnTextActive]}>{t(d.tKey)}</Text>
                  {filterDate === d.key && <Ionicons name="checkmark" size={16} color="#3478f7" style={{ marginLeft: 4 }} />}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.filterSectionTitle, { color: colors.text }]}>{t('EARNINGS.FILTER_STUDENT')}</Text>
            <TouchableOpacity style={[s.filterListItem, { borderBottomColor: colors.border }, filterStudent === 'all' && s.filterListItemActive]} onPress={() => setFilterStudentSmooth('all')}>
              <Text style={[s.filterListText, { color: colors.text }, filterStudent === 'all' && s.filterListTextActive]}>{t('EARNINGS.FILTER_ALL_STUDENTS')}</Text>
              {filterStudent === 'all' && <Ionicons name="checkmark" size={18} color="#3478f7" />}
            </TouchableOpacity>
            {uniqueStudents.map(st => (
              <TouchableOpacity key={st.id} style={[s.filterListItem, { borderBottomColor: colors.border }, filterStudent === st.id && s.filterListItemActive]} onPress={() => setFilterStudentSmooth(st.id)}>
                <View style={s.filterStudentRow}>
                  {st.picture ? <Image source={{ uri: st.picture }} style={s.filterStudentAvatar} /> : (
                    <View style={[s.filterStudentAvatar, s.txnAvatarPH, { backgroundColor: colors.inputBg }]}><Ionicons name="person" size={14} color={colors.textTertiary} /></View>
                  )}
                  <Text style={[s.filterListText, { color: colors.text }, filterStudent === st.id && s.filterListTextActive]}>{st.name}</Text>
                </View>
                {filterStudent === st.id && <Ionicons name="checkmark" size={18} color="#3478f7" />}
              </TouchableOpacity>
            ))}

            <Text style={[s.filterSectionTitle, { color: colors.text }]}>{t('EARNINGS.FILTER_STATUS')}</Text>
            <TouchableOpacity style={[s.filterListItem, { borderBottomColor: colors.border }, filterStatus === 'all' && s.filterListItemActive]} onPress={() => setFilterStatusSmooth('all')}>
              <Text style={[s.filterListText, { color: colors.text }, filterStatus === 'all' && s.filterListTextActive]}>{t('EARNINGS.FILTER_ALL_STATUSES')}</Text>
              {filterStatus === 'all' && <Ionicons name="checkmark" size={18} color="#3478f7" />}
            </TouchableOpacity>
            {uniqueStatuses.map(st => (
              <TouchableOpacity key={st} style={[s.filterListItem, { borderBottomColor: colors.border }, filterStatus === st && s.filterListItemActive]} onPress={() => setFilterStatusSmooth(st)}>
                <View style={s.filterStatusRow}>
                  <View style={[s.dot, { backgroundColor: getStatusDotColor(st), marginRight: 8 }]} />
                  <Text style={[s.filterListText, { color: colors.text }, filterStatus === st && s.filterListTextActive]}>{getStatusLabel(st)}</Text>
                </View>
                {filterStatus === st && <Ionicons name="checkmark" size={18} color="#3478f7" />}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={[s.filterFooter, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <TouchableOpacity style={s.filterClearBtn} onPress={() => { clearFilters(); }} disabled={activeFilterCount === 0}>
              <Text style={[s.filterClearText, { color: colors.text }, activeFilterCount === 0 && { color: colors.textTertiary }]}>{t('EARNINGS.TXN_CLEAR_ALL')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.filterShowBtn, { backgroundColor: colors.accent }]} onPress={() => setFiltersOpen(false)} activeOpacity={0.85}>
              <Text style={[s.filterShowText, { color: colors.background }]}>{filteredPayments.length === 1 ? t('EARNINGS.FILTER_SHOW_RESULTS_ONE', { count: filteredPayments.length }) : t('EARNINGS.FILTER_SHOW_RESULTS_MANY', { count: filteredPayments.length })}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {/* ── Withdraw Modal ── */}
      <Modal visible={withdrawModalOpen} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaProvider>
        <SafeAreaView style={[s.modalSafe, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
          <View style={[s.modalHead, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={{ width: 24 }} />
            <Text style={[s.modalHeadTitle, { color: colors.text }]}>{t('EARNINGS.WITHDRAW_TITLE')}</Text>
            <TouchableOpacity onPress={() => setWithdrawModalOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.withdrawContent}>
            <View style={s.withdrawBalanceCard}>
              <Text style={s.withdrawBalanceLabel}>{t('EARNINGS.WITHDRAW_BALANCE_LABEL')}</Text>
              <Text style={s.withdrawBalanceAmt}>${balance.available.toFixed(2)}</Text>
            </View>
            <Text style={[s.withdrawInputLabel, { color: colors.text }]}>{t('EARNINGS.WITHDRAW_AMOUNT_SECTION')}</Text>
            <View style={[s.withdrawInputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.withdrawPrefix, { color: colors.text }]}>$</Text>
              <TextInput style={[s.withdrawInput, { color: colors.text }]} value={withdrawAmount} onChangeText={setWithdrawAmount} placeholder="0.00" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
              <TouchableOpacity style={[s.withdrawMax, { backgroundColor: colors.inputBg }]} onPress={() => setWithdrawAmount(balance.available.toFixed(2))} activeOpacity={0.7}>
                <Text style={[s.withdrawMaxText, { color: colors.textSecondary }]}>MAX</Text>
              </TouchableOpacity>
            </View>
            <View style={[s.withdrawMethodCard, { backgroundColor: colors.card }]}>
              <Ionicons name="card-outline" size={24} color="#008A05" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.withdrawMethodTitle, { color: colors.text }]}>{t('EARNINGS.WITHDRAW_STRIPE_CONNECT')}</Text>
                <Text style={[s.withdrawMethodSub, { color: colors.textSecondary }]}>{t('EARNINGS.WITHDRAW_NO_FEES')}</Text>
              </View>
              <View style={s.noFeesBadge}><Text style={s.noFeesText}>{t('EARNINGS.WITHDRAW_NO_FEES')}</Text></View>
            </View>
          </ScrollView>
          <View style={[s.withdrawFooter, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <TouchableOpacity style={[s.withdrawCancelBtn, { borderColor: colors.border }]} onPress={() => setWithdrawModalOpen(false)} activeOpacity={0.7}>
              <Text style={[s.withdrawCancelText, { color: colors.text }]}>{t('EARNINGS.WITHDRAW_CANCEL')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.withdrawConfirmBtn, { backgroundColor: colors.accent }, withdrawing && { opacity: 0.5 }]} onPress={handleWithdraw} disabled={withdrawing} activeOpacity={0.85}>
              {withdrawing ? <ActivityIndicator color={colors.background} /> : <Text style={[s.withdrawConfirmText, { color: colors.background }]}>{t('EARNINGS.WITHDRAW_REQUEST')}</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

/* ─── Mini Chart (pure RN, no SVG dependency) ─── */

function MiniChart({ data, labels, colors }: { data: number[]; labels: string[]; colors: any }) {
  const maxVal = Math.max(...data, 1);
  const barCount = data.length;
  const step = Math.max(1, Math.floor(labels.length / 6));
  const visibleLabels = labels.filter((_, i) => i % step === 0 || i === labels.length - 1);
  const visibleIndices = labels.map((_, i) => i).filter(i => i % step === 0 || i === labels.length - 1);

  return (
    <View style={s.miniChart}>
      <View style={s.miniChartBars}>
        {data.map((val, i) => (
          <View key={i} style={s.miniChartBarWrap}>
            <View style={[s.miniChartBar, { height: `${Math.max((val / maxVal) * 100, 2)}%`, backgroundColor: val > 0 ? '#6eacd9' : '#e8e8e8' }]} />
          </View>
        ))}
      </View>
      <View style={s.miniChartLabels}>
        {visibleIndices.map(i => (
          <Text key={i} style={[s.miniChartLabel, { color: colors.textTertiary }]}>{labels[i]}</Text>
        ))}
      </View>
    </View>
  );
}

/* ─── Header ─── */

function Header({ goBack, colors, t }: { goBack: () => void; colors: any; t: any }) {
  return (
    <View style={[s.header, { backgroundColor: colors.surface }]}>
      <TouchableOpacity onPress={goBack} activeOpacity={0.7} style={s.headerBack}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
        <Text style={[s.headerBackText, { color: colors.text }]}>{t('TABS.HOME')}</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ─── Skeleton ─── */

function SkeletonLoader({ colors }: { colors: any }) {
  return (
    <View style={[s.content, { paddingTop: 16 }]}>
      <View style={[s.heroCard, { alignItems: 'flex-start', backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ width: 80, height: 12, borderRadius: 6, backgroundColor: colors.skeleton, marginBottom: 12 }} />
        <View style={{ width: 160, height: 32, borderRadius: 8, backgroundColor: colors.skeleton, marginBottom: 16 }} />
        <View style={{ width: '100%', height: 44, borderRadius: 8, backgroundColor: colors.skeleton }} />
      </View>
      <View style={s.statRow}>
        <View style={[s.statCard, { height: 80, backgroundColor: colors.card, borderColor: colors.border }]} />
        <View style={[s.statCard, { height: 80, backgroundColor: colors.card, borderColor: colors.border }]} />
      </View>
      <View style={[s.section, { height: 240, backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ width: 140, height: 14, borderRadius: 7, backgroundColor: colors.skeleton, marginBottom: 12 }} />
        <View style={{ width: 100, height: 24, borderRadius: 8, backgroundColor: colors.skeleton, marginBottom: 20 }} />
        <View style={{ flex: 1, backgroundColor: colors.skeleton, borderRadius: 8 }} />
      </View>
    </View>
  );
}

/* ─── Styles ─── */

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f7f7' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerBackText: { fontSize: 16, fontWeight: '600', color: '#222' },

  heroCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  heroMain: { alignItems: 'center', marginBottom: 12, width: '100%' },
  heroLabel: { fontSize: 13, fontWeight: '500', color: '#008A05', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  heroAmount: { fontSize: 34, fontWeight: '700', color: '#222' },
  withdrawBtn: { width: '100%', backgroundColor: '#222', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  withdrawBtnDisabled: { backgroundColor: '#f0f0f0', borderWidth: 1, borderColor: '#ddd' },
  withdrawBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  withdrawBtnTextOff: { color: '#999' },

  statRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statLabel: { fontSize: 12, fontWeight: '500', color: '#717171', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#222', marginBottom: 2 },
  statSub: { fontSize: 11, color: '#b0b0b0' },

  chartCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 20, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  chartTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  periodRow: { flexDirection: 'row', backgroundColor: '#f7f7f7', borderRadius: 8, padding: 2 },
  periodBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  periodActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 1 },
  periodText: { fontSize: 12, fontWeight: '600', color: '#717171' },
  periodTextActive: { color: '#3478f7' },
  chartTotal: { fontSize: 26, fontWeight: '700', color: '#222', marginBottom: 12 },
  chartEmpty: { height: 180, alignItems: 'center', justifyContent: 'center', gap: 8 },
  chartEmptyText: { fontSize: 14, color: '#999' },

  miniChart: { height: 180 },
  miniChartBars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingBottom: 4 },
  miniChartBarWrap: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  miniChartBar: { width: '100%', borderRadius: 3, minHeight: 2 },
  miniChartLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 },
  miniChartLabel: { fontSize: 10, color: '#b0b0b0' },

  section: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 14 },
  txnHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f7f7f7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: '#222' },
  filterBadge: { backgroundColor: '#222', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  filterBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  activeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '600', color: '#222' },
  clearAll: { fontSize: 13, fontWeight: '600', color: '#3478f7', paddingVertical: 6 },
  clearLink: { fontSize: 13, fontWeight: '600', color: '#3478f7', marginTop: 8 },

  transferRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#f0f0f0' },
  transferIconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#f7f7f7', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  transferMethod: { fontSize: 14, fontWeight: '600', color: '#222' },
  transferDate: { fontSize: 12, color: '#999', marginTop: 2 },
  transferAmt: { fontSize: 15, fontWeight: '700', color: '#222' },
  transferStat: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  txnEmpty: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  txnEmptyTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  txnEmptyBody: { fontSize: 13, color: '#999', textAlign: 'center' },
  txnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#f0f0f0' },
  txnAvatarWrap: { marginRight: 10 },
  txnAvatar: { width: 36, height: 36, borderRadius: 18 },
  txnAvatarPH: { backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  txnName: { fontSize: 14, fontWeight: '600', color: '#222' },
  txnDate: { fontSize: 12, color: '#999', marginTop: 2 },
  txnChips: { flexDirection: 'row', gap: 6, marginTop: 4 },
  txnChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  txnChipText: { fontSize: 10, fontWeight: '600' },
  txnAmt: { fontSize: 15, fontWeight: '700', color: '#222' },
  txnStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  txnStatusText: { fontSize: 11, color: '#999' },
  loadMore: { alignItems: 'center', paddingVertical: 14 },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: '#3478f7' },

  // Modals shared
  modalSafe: { flex: 1, backgroundColor: '#f7f7f7' },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', backgroundColor: '#fff' },
  modalHeadTitle: { fontSize: 18, fontWeight: '700', color: '#222' },

  // Filters modal
  filterContent: { padding: 20 },
  filterChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#222' },
  filterSectionTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginTop: 20, marginBottom: 12 },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  filterGridBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e5e5', flexDirection: 'row', alignItems: 'center' },
  filterGridBtnActive: { borderColor: '#3478f7', backgroundColor: '#EFF6FF' },
  filterGridBtnText: { fontSize: 13, fontWeight: '600', color: '#222' },
  filterGridBtnTextActive: { color: '#3478f7' },
  filterListItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  filterListItemActive: {},
  filterListText: { fontSize: 15, color: '#222' },
  filterListTextActive: { fontWeight: '600', color: '#3478f7' },
  filterStudentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterStudentAvatar: { width: 32, height: 32, borderRadius: 16 },
  filterStatusRow: { flexDirection: 'row', alignItems: 'center' },
  filterFooter: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e5e5', backgroundColor: '#fff' },
  filterClearBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filterClearText: { fontSize: 15, fontWeight: '600', color: '#222', textDecorationLine: 'underline' },
  filterShowBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  filterShowText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Withdraw modal
  withdrawContent: { padding: 20, gap: 20 },
  withdrawBalanceCard: { backgroundColor: '#008A05', borderRadius: 12, padding: 20, alignItems: 'center' },
  withdrawBalanceLabel: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.8)', marginBottom: 6 },
  withdrawBalanceAmt: { fontSize: 32, fontWeight: '700', color: '#fff' },
  withdrawInputLabel: { fontSize: 14, fontWeight: '600', color: '#222' },
  withdrawInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingHorizontal: 14, height: 52 },
  withdrawPrefix: { fontSize: 20, fontWeight: '600', color: '#222', marginRight: 4 },
  withdrawInput: { flex: 1, fontSize: 20, fontWeight: '600', color: '#222' },
  withdrawMax: { backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  withdrawMaxText: { fontSize: 12, fontWeight: '700', color: '#717171' },
  withdrawMethodCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#008A05', borderRadius: 12, padding: 16 },
  withdrawMethodTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
  withdrawMethodSub: { fontSize: 12, color: '#717171', marginTop: 2 },
  noFeesBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  noFeesText: { fontSize: 11, fontWeight: '700', color: '#008A05' },
  withdrawFooter: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e5e5', backgroundColor: '#fff' },
  withdrawCancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center' },
  withdrawCancelText: { fontSize: 15, fontWeight: '600', color: '#222' },
  withdrawConfirmBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  withdrawConfirmText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
