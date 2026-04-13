import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import i18n from 'i18next';
import type { User } from '../types/user';

export interface OnboardingFormState {
  interfaceLanguage: string;
  firstName: string;
  lastName: string;
  nativeLanguage: string;
  learningLanguages: string[];
  learningGoalType: string;
  learningGoalDescription: string;
  selfAssessedLevel: string;
  goalTimeline: string;
  goalTargetDate: string;
  country: string;
  residenceCountry: string;
  teachLanguages: string[];
  tutorExperience: string;
  tutorSchedule: string;
  profileSummary: string;
  profileBio: string;
  hourlyRate: number;
  introVideoUrl: string;
  videoThumbnail: string;
  videoType: 'upload' | 'youtube' | 'vimeo';
  videoLinkDraft: string;
}

function initialFromUser(user: User | null): OnboardingFormState {
  const learnPref =
    user?.userType === 'student'
      ? user.languagesLearning?.length
        ? [...user.languagesLearning]
        : []
      : [];
  const teachPref =
    user?.userType === 'tutor' && user.languages?.length ? [user.languages[0]] : [];

  return {
    interfaceLanguage: user?.interfaceLanguage || 'en',
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    nativeLanguage: user?.nativeLanguage || 'en',
    learningLanguages: learnPref,
    learningGoalType: '',
    learningGoalDescription: '',
    selfAssessedLevel: '',
    goalTimeline: 'no_rush',
    goalTargetDate: '',
    country: user?.country || '',
    residenceCountry: user?.residenceCountry || '',
    teachLanguages: teachPref,
    tutorExperience: '',
    tutorSchedule: '',
    profileSummary: '',
    profileBio: user?.onboardingData?.bio || user?.bio || '',
    hourlyRate: Math.max(10, user?.onboardingData?.hourlyRate || 25),
    introVideoUrl:
      (user?.onboardingData?.pendingVideo as string | undefined)?.trim() ||
      (user?.onboardingData?.introductionVideo as string | undefined)?.trim() ||
      user?.introductionVideo?.trim() ||
      '',
    videoThumbnail:
      (user?.onboardingData?.pendingVideoThumbnail as string | undefined) ||
      (user?.onboardingData?.videoThumbnail as string | undefined) ||
      user?.videoThumbnail ||
      '',
    videoType:
      ((user?.onboardingData?.pendingVideo
        ? user.onboardingData.pendingVideoType
        : user?.onboardingData?.videoType) as 'upload' | 'youtube' | 'vimeo') || 'upload',
    videoLinkDraft: '',
  };
}

interface Ctx {
  state: OnboardingFormState;
  setState: React.Dispatch<React.SetStateAction<OnboardingFormState>>;
  patch: (p: Partial<OnboardingFormState>) => void;
}

const OnboardingFormContext = createContext<Ctx | null>(null);

export function OnboardingFormProvider({ user, children }: { user: User | null; children: ReactNode }) {
  const [state, setState] = useState<OnboardingFormState>(() => initialFromUser(user));

  const patch = useCallback((p: Partial<OnboardingFormState>) => {
    setState(s => ({ ...s, ...p }));
  }, []);

  useEffect(() => {
    const lang = state.interfaceLanguage?.trim();
    if (!lang) return;
    void i18n.changeLanguage(lang);
  }, [state.interfaceLanguage]);

  const value = useMemo(() => ({ state, setState, patch }), [state, patch]);

  return <OnboardingFormContext.Provider value={value}>{children}</OnboardingFormContext.Provider>;
}

export function useOnboardingForm() {
  const c = useContext(OnboardingFormContext);
  if (!c) throw new Error('useOnboardingForm outside provider');
  return c;
}
