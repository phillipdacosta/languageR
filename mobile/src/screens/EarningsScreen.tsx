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
const DATE_OPTIONS: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

interface Props { goBack: () => void }

export default function EarningsScreen({ goBack }: Props) {
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
    if (!amount || amount <= 0) { Alert.alert('Invalid Amount', 'Please enter a valid amount.'); return; }
    if (amount > balance.available) { Alert.alert('Insufficient Funds', 'Amount exceeds available balance.'); return; }
    Alert.alert('Confirm Withdrawal', `Withdraw $${amount.toFixed(2)} to your account?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        setWithdrawing(true);
        const res = await earningsService.requestWithdrawal(amount, 'stripe_connect');
        setWithdrawing(false);
        if (res.success) { setWithdrawModalOpen(false); setWithdrawAmount(''); Alert.alert('Success', 'Withdrawal submitted!'); await fetchAll(); }
        else Alert.alert('Error', res.message || 'Withdrawal failed.');
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

  const getStatusLabel = (s: string) => {
    const map: Record<string, string> = {
      paid: 'Transferred', succeeded: 'Available', pending: 'Pending', in_progress: 'In Progress',
      processing: 'Processing', scheduled: 'Scheduled', class_scheduled: 'Scheduled',
      cancelled: 'Cancelled', refunded: 'Refunded', partially_refunded: 'Reduced',
    };
    return map[s] || s.charAt(0).toUpperCase() + s.slice(1);
  };

  const getStatusDotColor = (s: string) => {
    if (s === 'paid' || s === 'succeeded') return '#008A05';
    if (s === 'pending' || s === 'processing' || s === 'in_progress' || s === 'scheduled' || s === 'class_scheduled') return '#E07912';
    if (s === 'cancelled' || s === 'refunded' || s === 'partially_refunded') return '#C13515';
    return '#ccc';
  };

  if (loading) return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Header goBack={goBack} />
      <SkeletonLoader />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Header goBack={goBack} />
      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#999" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Balance Hero ── */}
        <View style={s.heroCard}>
          <TouchableOpacity onPress={() => setShowBalance(!showBalance)} activeOpacity={0.8} style={s.heroMain}>
            <Text style={s.heroLabel}>AVAILABLE</Text>
            <Text style={s.heroAmount}>{showBalance ? `$${balance.available.toFixed(2)}` : '$••••'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.withdrawBtn, balance.available <= 0 && s.withdrawBtnDisabled]}
            onPress={() => { setWithdrawAmount(''); setWithdrawModalOpen(true); }}
            disabled={balance.available <= 0} activeOpacity={0.85}
          >
            <Text style={[s.withdrawBtnText, balance.available <= 0 && s.withdrawBtnTextOff]}>Withdraw Funds</Text>
          </TouchableOpacity>
        </View>

        {/* ── Pending / Lifetime ── */}
        <View style={s.statRow}>
          <TouchableOpacity style={s.statCard} onPress={() => setShowBalance(!showBalance)} activeOpacity={0.8}>
            <Text style={[s.statLabel, { color: '#E07912' }]}>Pending</Text>
            <Text style={s.statValue}>{showBalance ? `$${balance.pending.toFixed(2)}` : '$••••'}</Text>
            <Text style={s.statSub}>In hold period</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.statCard} onPress={() => setShowBalance(!showBalance)} activeOpacity={0.8}>
            <Text style={s.statLabel}>Lifetime</Text>
            <Text style={s.statValue}>{showBalance ? `$${balance.lifetime.toFixed(2)}` : '$••••'}</Text>
            <Text style={s.statSub}>Total earned</Text>
          </TouchableOpacity>
        </View>

        {/* ── Chart ── */}
        {payments.length > 0 && (
          <View style={s.chartCard}>
            <View style={s.chartHeader}>
              <Text style={s.chartTitle}>Earnings Over Time</Text>
              <View style={s.periodRow}>
                {(['1m', '6m', 'all'] as ChartPeriod[]).map(p => (
                  <TouchableOpacity key={p} style={[s.periodBtn, chartPeriod === p && s.periodActive]} onPress={() => setChartPeriod(p)} activeOpacity={0.7}>
                    <Text style={[s.periodText, chartPeriod === p && s.periodTextActive]}>{p === 'all' ? 'All' : p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={s.chartTotal}>{showBalance ? `$${chartData.total.toFixed(2)}` : '$••••'}</Text>
            {hasChartData ? (
              <MiniChart data={chartData.data} labels={chartData.labels} />
            ) : (
              <View style={s.chartEmpty}>
                <Ionicons name="bar-chart-outline" size={36} color="#ccc" />
                <Text style={s.chartEmptyText}>No earnings data yet</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Transfers ── */}
        {withdrawals.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Transfers</Text>
            {withdrawals.map(w => (
              <View key={w.id} style={s.transferRow}>
                <View style={s.transferIconWrap}>
                  <Ionicons name={w.method === 'paypal' ? 'logo-paypal' : 'card-outline'} size={20} color="#717171" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.transferMethod}>{w.method === 'paypal' ? 'PayPal' : 'Stripe'}</Text>
                  <Text style={s.transferDate}>{new Date(w.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.transferAmt}>${(w.netAmount || w.amount).toFixed(2)}</Text>
                  <Text style={[s.transferStat, { color: getStatusDotColor(w.status) }]}>{w.status.charAt(0).toUpperCase() + w.status.slice(1)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Transactions ── */}
        <View style={s.section}>
          <View style={s.txnHeader}>
            <Text style={s.sectionTitle}>Transactions</Text>
            <TouchableOpacity style={s.filterBtn} onPress={() => setFiltersOpen(true)} activeOpacity={0.7}>
              <Ionicons name="options-outline" size={16} color="#222" />
              <Text style={s.filterBtnText}>Filters</Text>
              {activeFilterCount > 0 && <View style={s.filterBadge}><Text style={s.filterBadgeText}>{activeFilterCount}</Text></View>}
            </TouchableOpacity>
          </View>

          {activeFilterCount > 0 && (
            <View style={s.activeChips}>
              {filterDate !== 'all' && (
                <TouchableOpacity style={s.chip} onPress={() => setFilterDateSmooth('all')}>
                  <Text style={s.chipText}>{DATE_OPTIONS.find(d => d.key === filterDate)?.label}</Text>
                  <Ionicons name="close" size={14} color="#717171" />
                </TouchableOpacity>
              )}
              {filterStudent !== 'all' && (
                <TouchableOpacity style={s.chip} onPress={() => setFilterStudentSmooth('all')}>
                  <Text style={s.chipText}>{filterStudent}</Text>
                  <Ionicons name="close" size={14} color="#717171" />
                </TouchableOpacity>
              )}
              {filterStatus !== 'all' && (
                <TouchableOpacity style={s.chip} onPress={() => setFilterStatusSmooth('all')}>
                  <Text style={s.chipText}>{getStatusLabel(filterStatus)}</Text>
                  <Ionicons name="close" size={14} color="#717171" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={clearFilters}><Text style={s.clearAll}>Clear all</Text></TouchableOpacity>
            </View>
          )}

          {filteredPayments.length === 0 ? (
            <View style={s.txnEmpty}>
              <Ionicons name={activeFilterCount > 0 ? 'filter-outline' : 'receipt-outline'} size={36} color="#ccc" />
              <Text style={s.txnEmptyTitle}>{activeFilterCount > 0 ? 'No matching transactions' : 'No transactions yet'}</Text>
              <Text style={s.txnEmptyBody}>{activeFilterCount > 0 ? 'Try adjusting your filters.' : 'Your payment history will appear here.'}</Text>
              {activeFilterCount > 0 && <TouchableOpacity onPress={clearFilters}><Text style={s.clearLink}>Clear filters</Text></TouchableOpacity>}
            </View>
          ) : (
            displayedPayments.map(p => (
              <View key={p.id} style={s.txnRow}>
                <View style={s.txnAvatarWrap}>
                  {p.studentPicture ? <Image source={{ uri: p.studentPicture }} style={s.txnAvatar} /> : (
                    <View style={[s.txnAvatar, s.txnAvatarPH]}><Ionicons name="person" size={16} color="#999" /></View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.txnName} numberOfLines={1}>{p.studentName}</Text>
                  <Text style={s.txnDate}>{p.formattedDate || new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{p.formattedTime ? ` · ${p.formattedTime}` : ''}</Text>
                  <View style={s.txnChips}>
                    {p.isClassPayment && <View style={[s.txnChip, { backgroundColor: '#E8F5E9' }]}><Text style={[s.txnChipText, { color: '#2E7D32' }]}>Class</Text></View>}
                    {p.isMaterialPurchase && <View style={[s.txnChip, { backgroundColor: '#E3F2FD' }]}><Text style={[s.txnChipText, { color: '#1565C0' }]}>Material</Text></View>}
                    {(p.tipAmount || 0) > 0 && <View style={[s.txnChip, { backgroundColor: '#FFF3E0' }]}><Text style={[s.txnChipText, { color: '#E07912' }]}>Tip</Text></View>}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.txnAmt}>${p.tutorPayout.toFixed(2)}</Text>
                  <View style={s.txnStatusRow}>
                    <View style={[s.dot, { backgroundColor: getStatusDotColor(p.status) }]} />
                    <Text style={s.txnStatusText}>{getStatusLabel(p.status)}</Text>
                  </View>
                </View>
              </View>
            ))
          )}
          {displayLimit < filteredPayments.length && (
            <TouchableOpacity style={s.loadMore} onPress={() => setDisplayLimit(n => n + 20)} activeOpacity={0.7}>
              <Text style={s.loadMoreText}>Load More</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Filters Modal ── */}
      <Modal visible={filtersOpen} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaProvider>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.modalHead}>
            <TouchableOpacity onPress={() => setFiltersOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Ionicons name="close" size={24} color="#222" /></TouchableOpacity>
            <Text style={s.modalHeadTitle}>Filters</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView contentContainerStyle={s.filterContent} showsVerticalScrollIndicator={false}>
            {/* Active chips */}
            {activeFilterCount > 0 && (
              <View style={s.filterChipRow}>
                {filterDate !== 'all' && (
                  <TouchableOpacity style={s.filterChip} onPress={() => setFilterDateSmooth('all')}>
                    <Text style={s.filterChipText}>{DATE_OPTIONS.find(d => d.key === filterDate)?.label}</Text>
                    <Ionicons name="close-circle" size={16} color="#717171" />
                  </TouchableOpacity>
                )}
                {filterStudent !== 'all' && (
                  <TouchableOpacity style={s.filterChip} onPress={() => setFilterStudentSmooth('all')}>
                    <Text style={s.filterChipText}>{filterStudent}</Text>
                    <Ionicons name="close-circle" size={16} color="#717171" />
                  </TouchableOpacity>
                )}
                {filterStatus !== 'all' && (
                  <TouchableOpacity style={s.filterChip} onPress={() => setFilterStatusSmooth('all')}>
                    <Text style={s.filterChipText}>{getStatusLabel(filterStatus)}</Text>
                    <Ionicons name="close-circle" size={16} color="#717171" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Time Period */}
            <Text style={s.filterSectionTitle}>Time Period</Text>
            <View style={s.filterGrid}>
              {DATE_OPTIONS.map(d => (
                <TouchableOpacity key={d.key} style={[s.filterGridBtn, filterDate === d.key && s.filterGridBtnActive]} onPress={() => setFilterDateSmooth(d.key)} activeOpacity={0.7}>
                  <Text style={[s.filterGridBtnText, filterDate === d.key && s.filterGridBtnTextActive]}>{d.label}</Text>
                  {filterDate === d.key && <Ionicons name="checkmark" size={16} color="#3478f7" style={{ marginLeft: 4 }} />}
                </TouchableOpacity>
              ))}
            </View>

            {/* Student */}
            <Text style={s.filterSectionTitle}>Student</Text>
            <TouchableOpacity style={[s.filterListItem, filterStudent === 'all' && s.filterListItemActive]} onPress={() => setFilterStudentSmooth('all')}>
              <Text style={[s.filterListText, filterStudent === 'all' && s.filterListTextActive]}>All Students</Text>
              {filterStudent === 'all' && <Ionicons name="checkmark" size={18} color="#3478f7" />}
            </TouchableOpacity>
            {uniqueStudents.map(st => (
              <TouchableOpacity key={st.id} style={[s.filterListItem, filterStudent === st.id && s.filterListItemActive]} onPress={() => setFilterStudentSmooth(st.id)}>
                <View style={s.filterStudentRow}>
                  {st.picture ? <Image source={{ uri: st.picture }} style={s.filterStudentAvatar} /> : (
                    <View style={[s.filterStudentAvatar, s.txnAvatarPH]}><Ionicons name="person" size={14} color="#999" /></View>
                  )}
                  <Text style={[s.filterListText, filterStudent === st.id && s.filterListTextActive]}>{st.name}</Text>
                </View>
                {filterStudent === st.id && <Ionicons name="checkmark" size={18} color="#3478f7" />}
              </TouchableOpacity>
            ))}

            {/* Status */}
            <Text style={s.filterSectionTitle}>Status</Text>
            <TouchableOpacity style={[s.filterListItem, filterStatus === 'all' && s.filterListItemActive]} onPress={() => setFilterStatusSmooth('all')}>
              <Text style={[s.filterListText, filterStatus === 'all' && s.filterListTextActive]}>All Statuses</Text>
              {filterStatus === 'all' && <Ionicons name="checkmark" size={18} color="#3478f7" />}
            </TouchableOpacity>
            {uniqueStatuses.map(st => (
              <TouchableOpacity key={st} style={[s.filterListItem, filterStatus === st && s.filterListItemActive]} onPress={() => setFilterStatusSmooth(st)}>
                <View style={s.filterStatusRow}>
                  <View style={[s.dot, { backgroundColor: getStatusDotColor(st), marginRight: 8 }]} />
                  <Text style={[s.filterListText, filterStatus === st && s.filterListTextActive]}>{getStatusLabel(st)}</Text>
                </View>
                {filterStatus === st && <Ionicons name="checkmark" size={18} color="#3478f7" />}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={s.filterFooter}>
            <TouchableOpacity style={s.filterClearBtn} onPress={() => { clearFilters(); }} disabled={activeFilterCount === 0}>
              <Text style={[s.filterClearText, activeFilterCount === 0 && { color: '#ccc' }]}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.filterShowBtn} onPress={() => setFiltersOpen(false)} activeOpacity={0.85}>
              <Text style={s.filterShowText}>Show {filteredPayments.length} {filteredPayments.length === 1 ? 'Result' : 'Results'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {/* ── Withdraw Modal ── */}
      <Modal visible={withdrawModalOpen} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaProvider>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.modalHead}>
            <View style={{ width: 24 }} />
            <Text style={s.modalHeadTitle}>Withdraw Funds</Text>
            <TouchableOpacity onPress={() => setWithdrawModalOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Ionicons name="close" size={24} color="#222" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.withdrawContent}>
            <View style={s.withdrawBalanceCard}>
              <Text style={s.withdrawBalanceLabel}>Available Balance</Text>
              <Text style={s.withdrawBalanceAmt}>${balance.available.toFixed(2)}</Text>
            </View>
            <Text style={s.withdrawInputLabel}>Withdrawal Amount</Text>
            <View style={s.withdrawInputRow}>
              <Text style={s.withdrawPrefix}>$</Text>
              <TextInput style={s.withdrawInput} value={withdrawAmount} onChangeText={setWithdrawAmount} placeholder="0.00" placeholderTextColor="#b0b0b0" keyboardType="decimal-pad" />
              <TouchableOpacity style={s.withdrawMax} onPress={() => setWithdrawAmount(balance.available.toFixed(2))} activeOpacity={0.7}>
                <Text style={s.withdrawMaxText}>MAX</Text>
              </TouchableOpacity>
            </View>
            <View style={s.withdrawMethodCard}>
              <Ionicons name="card-outline" size={24} color="#008A05" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.withdrawMethodTitle}>Stripe Connect</Text>
                <Text style={s.withdrawMethodSub}>No withdrawal fees</Text>
              </View>
              <View style={s.noFeesBadge}><Text style={s.noFeesText}>No fees</Text></View>
            </View>
          </ScrollView>
          <View style={s.withdrawFooter}>
            <TouchableOpacity style={s.withdrawCancelBtn} onPress={() => setWithdrawModalOpen(false)} activeOpacity={0.7}>
              <Text style={s.withdrawCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.withdrawConfirmBtn, withdrawing && { opacity: 0.5 }]} onPress={handleWithdraw} disabled={withdrawing} activeOpacity={0.85}>
              {withdrawing ? <ActivityIndicator color="#fff" /> : <Text style={s.withdrawConfirmText}>Request Withdrawal</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

/* ─── Mini Chart (pure RN, no SVG dependency) ─── */

function MiniChart({ data, labels }: { data: number[]; labels: string[] }) {
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
          <Text key={i} style={s.miniChartLabel}>{labels[i]}</Text>
        ))}
      </View>
    </View>
  );
}

/* ─── Header ─── */

function Header({ goBack }: { goBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity onPress={goBack} activeOpacity={0.7} style={s.headerBack}>
        <Ionicons name="chevron-back" size={22} color="#222" />
        <Text style={s.headerBackText}>Home</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ─── Skeleton ─── */

function SkeletonLoader() {
  return (
    <View style={[s.content, { paddingTop: 16 }]}>
      <View style={[s.heroCard, { alignItems: 'flex-start' }]}>
        <View style={{ width: 80, height: 12, borderRadius: 6, backgroundColor: '#eee', marginBottom: 12 }} />
        <View style={{ width: 160, height: 32, borderRadius: 8, backgroundColor: '#eee', marginBottom: 16 }} />
        <View style={{ width: '100%', height: 44, borderRadius: 8, backgroundColor: '#eee' }} />
      </View>
      <View style={s.statRow}>
        <View style={[s.statCard, { height: 80 }]} />
        <View style={[s.statCard, { height: 80 }]} />
      </View>
      <View style={[s.section, { height: 240 }]}>
        <View style={{ width: 140, height: 14, borderRadius: 7, backgroundColor: '#eee', marginBottom: 12 }} />
        <View style={{ width: 100, height: 24, borderRadius: 8, backgroundColor: '#eee', marginBottom: 20 }} />
        <View style={{ flex: 1, backgroundColor: '#f5f5f5', borderRadius: 8 }} />
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
