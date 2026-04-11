import { api, ApiError } from './api';

export interface LessonAnalysis {
  status?: string;
  error?: string;
  overallAssessment?: { proficiencyLevel?: string };
  vocabularyAnalysis?: { uniqueWordCount?: number };
  grammarAnalysis?: { accuracyScore?: number };
  progressionMetrics?: { keyImprovements?: string[] };
}

export type AnalysisPollResult =
  | { kind: 'completed'; analysis: LessonAnalysis }
  | { kind: 'unavailable' }
  | { kind: 'pending' };

export async function fetchLessonAnalysis(lessonId: string): Promise<AnalysisPollResult> {
  try {
    const data = await api.get<{ analysis?: LessonAnalysis }>(
      `/transcription/lesson/${lessonId}/analysis`,
    );
    const a = data.analysis;
    if (!a) return { kind: 'pending' };
    if (a.status === 'completed') return { kind: 'completed', analysis: a };
    if (a.status === 'insufficient_data' || a.status === 'failed') return { kind: 'unavailable' };
    return { kind: 'pending' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'unavailable' };
    return { kind: 'pending' };
  }
}

export async function submitTutorNote(
  lessonId: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await api.post<{ success?: boolean; message?: string }>(
      `/lessons/${lessonId}/tutor-note`,
      payload,
    );
    return { success: !!res.success, message: res.message };
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Failed to send note';
    return { success: false, message: msg };
  }
}

export interface PaymentMethodCard {
  type?: string;
  stripePaymentMethodId?: string;
  brand?: string;
  last4?: string;
  isDefault?: boolean;
  country?: string;
}

export async function getPaymentMethods(): Promise<PaymentMethodCard[]> {
  try {
    const data = await api.get<{ success?: boolean; paymentMethods?: PaymentMethodCard[] }>(
      '/payments/payment-methods',
    );
    if (!data.success || !data.paymentMethods) return [];
    return data.paymentMethods.filter(pm => pm.type === 'card');
  } catch {
    return [];
  }
}

export async function getWalletBalance(): Promise<number> {
  try {
    const data = await api.get<{ success?: boolean; availableBalance?: number }>('/wallet/balance');
    return data.success ? data.availableBalance || 0 : 0;
  } catch {
    return 0;
  }
}

export async function submitLessonTip(
  lessonId: string,
  body: { amount: number; useWallet?: boolean; paymentMethodId?: string },
): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await api.post<{ success?: boolean; error?: string }>(`/lessons/${lessonId}/tip`, body);
    return { success: !!res.success, message: res.error };
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Failed to send tip';
    return { success: false, message: msg };
  }
}

export interface VocabEntry {
  word: string;
  translation: string;
  example?: string;
}

export interface GoalEntry {
  text: string;
  completed?: boolean;
}

export async function getLessonVocabularyBundle(lessonId: string): Promise<{
  vocabulary: VocabEntry[];
  goals: GoalEntry[];
} | null> {
  try {
    const data = await api.get<{
      success?: boolean;
      data?: { vocabulary?: VocabEntry[]; goals?: GoalEntry[] };
    }>(`/vocabulary/${lessonId}`);
    if (!data.success || !data.data) return null;
    return {
      vocabulary: data.data.vocabulary || [],
      goals: data.data.goals || [],
    };
  } catch {
    return null;
  }
}
