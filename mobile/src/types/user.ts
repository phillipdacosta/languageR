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
  onboardingCompleted?: boolean;
  tutorApproved?: boolean;
  stripeConnectOnboarded?: boolean;
  stripeCustomerId?: string;
  payoutProvider?: string;
  payoutDetails?: {
    paypalEmail?: string;
    stripeAccountId?: string;
  };
  onboardingData?: {
    languages?: any[];
    goals?: string[];
    bio?: string;
    hourlyRate?: number;
    trialRate?: number;
    videoUrl?: string;
    [key: string]: any;
  };
  profile?: {
    bio?: string;
    timezone?: string;
    preferredLanguage?: string;
    calendarTimeFormat?: string;
    calendarDefaultView?: string;
    showWalletBalance?: boolean;
    [key: string]: any;
  };
  stats?: {
    totalLessons?: number;
    totalHours?: number;
    streak?: number;
    lastActive?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}
