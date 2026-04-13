import { api } from '../services/api';
import type { User } from '../types/user';

interface OnboardingResponse {
  success: boolean;
  user: User;
}

export async function completeStudentOnboarding(body: Record<string, unknown>): Promise<User> {
  const res = await api.put<OnboardingResponse>('/users/onboarding', body);
  return res.user;
}

export async function completeTutorOnboarding(body: Record<string, unknown>): Promise<User> {
  const res = await api.put<OnboardingResponse>('/users/onboarding', body);
  return res.user;
}

export async function submitTutorForReview(): Promise<void> {
  await api.post('/users/tutor/submit-for-review', {});
}
