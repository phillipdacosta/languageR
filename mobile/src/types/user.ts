export interface User {
  _id: string;
  id?: string;
  auth0Id?: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  residenceCountry?: string;
  picture?: string;
  auth0Picture?: string;
  emailVerified?: boolean;
  userType: 'student' | 'tutor';
  isAdmin?: boolean;
  isActive?: boolean;
  nativeLanguage?: string;
  interfaceLanguage?: string;
  languages?: string[];
  languagesLearning?: string[];
  bio?: string;
  experience?: string;
  schedule?: string;
  experienceLevel?: string;
  onboardingCompleted?: boolean;
  tutorApproved?: boolean;
  stripeConnectOnboarded?: boolean;
  stripeCustomerId?: string;
  payoutProvider?: string;
  payoutDetails?: {
    paypalEmail?: string;
    stripeAccountId?: string;
  };
  introductionVideo?: string;
  videoThumbnail?: string;
  videoType?: 'upload' | 'youtube' | 'vimeo';
  tutorOnboarding?: {
    videoApproved?: boolean;
    [key: string]: any;
  };
  tutorCredentials?: any;
  onboardingData?: {
    languages?: any[];
    goals?: string[];
    bio?: string;
    hourlyRate?: number;
    trialRate?: number;
    videoUrl?: string;
    introductionVideo?: string;
    pendingVideo?: string;
    pendingVideoThumbnail?: string;
    pendingVideoType?: 'upload' | 'youtube' | 'vimeo';
    videoThumbnail?: string;
    videoType?: 'upload' | 'youtube' | 'vimeo';
    learningGoal?: string;
    [key: string]: any;
  };
  profile?: {
    bio?: string;
    timezone?: string;
    preferredLanguage?: string;
    calendarTimeFormat?: string;
    calendarDefaultView?: string;
    showWalletBalance?: boolean;
    remindersEnabled?: boolean;
    aiAnalysisEnabled?: boolean;
    [key: string]: any;
  };
  stats?: {
    totalLessons?: number;
    totalHours?: number;
    streak?: number;
    rating?: number;
    lastActive?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}
