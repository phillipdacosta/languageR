import { api } from './api';

/* ── In-memory cache (persists across screen mounts) ── */

interface EarningsCache {
  balance: EarningsBalance | null;
  payments: PaymentItem[] | null;
  withdrawals: WithdrawalItem[] | null;
  timestamp: number;
}

const cache: EarningsCache = {
  balance: null,
  payments: null,
  withdrawals: null,
  timestamp: 0,
};

const STALE_MS = 60_000; // consider data stale after 60s

export function getEarningsCache() {
  const hasAll = cache.balance !== null && cache.payments !== null && cache.withdrawals !== null;
  return {
    balance: cache.balance,
    payments: cache.payments,
    withdrawals: cache.withdrawals,
    hasCachedData: hasAll,
    isStale: !hasAll || Date.now() - cache.timestamp > STALE_MS,
  };
}

export function clearEarningsCache() {
  cache.balance = null;
  cache.payments = null;
  cache.withdrawals = null;
  cache.timestamp = 0;
}

export interface EarningsBalance {
  available: number;
  pending: number;
  lifetime: number;
  withdrawn?: number;
  lastWithdrawal?: string;
}

export interface PaymentItem {
  id: string;
  studentName: string;
  studentPicture?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  amount?: number;
  tutorPayout: number;
  platformFee: number;
  stripeFee?: number;
  status: string;
  lessonStatus?: string;
  lessonId?: string;
  classId?: string;
  className?: string;
  isClassPayment?: boolean;
  isMaterialPurchase?: boolean;
  materialTitle?: string;
  tipAmount?: number;
  paymentType?: string;
  formattedDate?: string;
  formattedTime?: string;
}

export interface WithdrawalItem {
  id: string;
  amount: number;
  netAmount?: number;
  method: string;
  status: string;
  fees?: { paypal?: number; stripe?: number };
  requestedAt: string;
  completedAt?: string;
}

interface EarningsResponse {
  totalEarnings: number;
  pendingEarnings: number;
  recentPayments: PaymentItem[];
  payoutProvider?: string;
  paypalEmail?: string;
  stripeConnectAccountId?: string;
}

interface BalanceResponse {
  success: boolean;
  balance: {
    available: number;
    pending: number;
    lifetime: number;
    withdrawn?: number;
    lastWithdrawal?: string;
  };
  settings?: any;
  payoutMethods?: any;
}

interface WithdrawalHistoryResponse {
  withdrawals: WithdrawalItem[];
}

export const earningsService = {
  async getBalance(): Promise<EarningsBalance> {
    try {
      const data = await api.get<BalanceResponse>('/withdrawals/balance');
      const bal = data.balance || data as any;
      const result: EarningsBalance = {
        available: bal.available || 0,
        pending: bal.pending || 0,
        lifetime: bal.lifetime || 0,
        withdrawn: bal.withdrawn || 0,
        lastWithdrawal: bal.lastWithdrawal,
      };
      cache.balance = result;
      cache.timestamp = Date.now();
      return result;
    } catch (err: any) {
      console.warn('[Earnings] getBalance failed:', err?.message || err);
      return cache.balance || { available: 0, pending: 0, lifetime: 0 };
    }
  },

  async getEarnings(): Promise<{ payments: PaymentItem[]; totalEarnings: number; pendingEarnings: number; payoutProvider?: string }> {
    try {
      const data = await api.get<EarningsResponse>('/payments/tutor/earnings?limit=0');
      const payments = data.recentPayments || [];
      cache.payments = payments;
      cache.timestamp = Date.now();
      return {
        payments,
        totalEarnings: data.totalEarnings || 0,
        pendingEarnings: data.pendingEarnings || 0,
        payoutProvider: data.payoutProvider,
      };
    } catch (err: any) {
      console.warn('[Earnings] getEarnings failed:', err?.message || err);
      return { payments: cache.payments || [], totalEarnings: 0, pendingEarnings: 0 };
    }
  },

  async getWithdrawalHistory(): Promise<WithdrawalItem[]> {
    try {
      const data = await api.get<WithdrawalHistoryResponse>('/withdrawals/history?limit=10');
      const withdrawals = data.withdrawals || [];
      cache.withdrawals = withdrawals;
      cache.timestamp = Date.now();
      return withdrawals;
    } catch (err: any) {
      console.warn('[Earnings] getWithdrawalHistory failed:', err?.message || err);
      return cache.withdrawals || [];
    }
  },

  async requestWithdrawal(amount: number, method: string): Promise<{ success: boolean; message?: string }> {
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await api.post('/withdrawals/request', { amount, method, idempotencyKey });
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Withdrawal failed' };
    }
  },
};

export function buildChartData(payments: PaymentItem[], period: '1m' | '6m' | 'all'): { labels: string[]; data: number[]; total: number } {
  const validPayments = payments.filter(p => {
    const hasTransfer = (p as any).transferStatus;
    if (hasTransfer) {
      return ['available', 'pending_withdrawal', 'withdrawn', 'succeeded'].includes(hasTransfer);
    }
    return p.status === 'paid' || p.status === 'succeeded';
  });

  const now = new Date();
  const weeksBack = period === '1m' ? 4 : period === '6m' ? 26 : 52;

  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - weeksBack * 7);
  const startMonday = new Date(startDate);
  startMonday.setDate(startMonday.getDate() - ((startMonday.getDay() + 6) % 7));
  startMonday.setHours(0, 0, 0, 0);

  const buckets: { label: string; total: number }[] = [];
  const cursor = new Date(startMonday);

  while (cursor <= now) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekTotal = validPayments
      .filter(p => {
        const d = new Date(p.date);
        return d >= cursor && d <= weekEnd;
      })
      .reduce((sum, p) => sum + (p.tutorPayout || 0), 0);

    buckets.push({
      label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      total: Math.round(weekTotal * 100) / 100,
    });

    cursor.setDate(cursor.getDate() + 7);
  }

  const total = buckets.reduce((s, b) => s + b.total, 0);

  return {
    labels: buckets.map(b => b.label),
    data: buckets.map(b => b.total),
    total: Math.round(total * 100) / 100,
  };
}
