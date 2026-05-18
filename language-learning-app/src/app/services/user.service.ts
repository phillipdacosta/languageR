import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, Subject, from, of } from 'rxjs';
import { map, tap, take, switchMap, catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { SupportedLanguage } from './language.service';
import { setGlobalTimeFormat } from '../shared/timezone.utils';
import { isStripeSupportedCountry } from '../data/stripe-supported-countries';

export interface User {
  id: string;
  auth0Id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  residenceCountry?: string;
  picture?: string;
  auth0Picture?: string; // Original Auth0/Google profile picture
  emailVerified: boolean;
  userType: 'student' | 'tutor';
  isAdmin?: boolean; // Admin flag for backend access
  onboardingCompleted: boolean;
  nativeLanguage?: string;
  interfaceLanguage?: SupportedLanguage;
  // Tutor-specific onboarding tracking
  tutorOnboarding?: {
    photoUploaded: boolean;
    videoUploaded: boolean;
    videoApproved: boolean;
    videoRejected: boolean;
    videoRejectionReason?: string;
    stripeConnected: boolean;
    completedAt?: string;
    approvedBy?: string;
    approvedAt?: string;
  };
  // Tutor credential verification
  tutorCredentials?: {
    governmentId?: {
      url?: string;
      fileName?: string;
      fileType?: string;
      uploadedAt?: string;
      status: 'not_uploaded' | 'pending' | 'approved' | 'rejected';
      rejectionReason?: string;
    };
    teachingCertifications?: Array<{
      _id?: string;
      url: string;
      fileName: string;
      fileType?: string;
      certificationName?: string;
      uploadedAt?: string;
      status: 'pending' | 'approved' | 'rejected';
      rejectionReason?: string;
    }>;
    additionalDocuments?: Array<{
      _id?: string;
      url: string;
      fileName: string;
      fileType?: string;
      documentType?: string;
      label?: string;
      uploadedAt?: string;
      status: 'pending' | 'approved' | 'rejected';
      rejectionReason?: string;
    }>;
  };
  tutorApproved?: boolean;
  stripeConnectOnboarded?: boolean;
  stripeConnectAccountId?: string;
  /** True once Stripe Connect KYC has fully verified the tutor (payouts enabled + no outstanding requirements). When true, the manual Government-ID step is skipped because Stripe already vouches for identity. */
  stripeIdentityVerified?: boolean;
  /** True when Stripe has flagged the Connect account as disabled (rejected, past-due requirements, or `requirements.disabled_reason` set). When true, we re-show the manual Government-ID step as a fallback. */
  stripeAccountDisabled?: boolean;
  // Payout settings
  payoutProvider?: 'stripe' | 'paypal' | 'manual' | 'none';
  payoutDetails?: {
    paypalEmail?: string;
    bankInfo?: any;
  };
  // Tax classification for payout routing
  isUSPersonForTax?: boolean | null;
  hasUSBankAccount?: boolean | null;
  taxInfoCompletedAt?: string;
  tosAcceptedAt?: string;
  tosVersion?: string;
  onboardingData?: {
    languages: string[];
    goals: string[];
    experienceLevel: string;
    preferredSchedule: string;
    // Tutor-specific fields
    experience?: string;
    schedule?: string;
    bio?: string;
    hourlyRate?: number;
    introductionVideo?: string;
    videoThumbnail?: string;
    videoType?: 'upload' | 'youtube' | 'vimeo';
    // Pending video fields (for admin review)
    pendingVideo?: string;
    pendingVideoThumbnail?: string;
    pendingVideoType?: 'upload' | 'youtube' | 'vimeo';
    // Structured learning goal (student-only, powers the Learning Plan / Journey)
    learningGoal?: {
      type?: 'conversational' | 'exam_prep' | 'professional' | 'travel' | 'relocation' | 'other' | null;
      description?: string;
      targetLevel?: string;
      selfAssessedLevel?: 'complete_beginner' | 'some_basics' | 'simple_conversations' | 'intermediate' | 'advanced' | null;
      timeline?: 'specific_date' | 'few_months' | 'no_rush' | null;
      targetDate?: string | null;
    };
    completedAt: string;
  };
  profile?: {
    bio: string;
    timezone: string;
    preferredLanguage: string;
    officeHoursEnabled?: boolean;
    showWalletBalance?: boolean;
    remindersEnabled?: boolean;
    aiAnalysisEnabled?: boolean;
    calendarTimeFormat?: '12h' | '24h';
    calendarDefaultView?: 'week' | 'day';
    weeklyEarningsGoal?: number;
  };
  stats?: {
    totalLessons: number;
    totalHours: number;
    streak: number;
    lastActive: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingData {
  firstName?: string;
  lastName?: string;
  languages: string[];
  goals: string[];
  experienceLevel: string;
  preferredSchedule: string;
  spokenLanguages?: { code: string; level: string }[];
  learningGoal?: {
    type: string;
    description?: string;
    targetLevel?: string;
    selfAssessedLevel?: string;
    timeline?: string;
    targetDate?: string | null;
  };
}

export interface TutorOnboardingData {
  firstName?: string;
  lastName?: string;
  country?: string;
  languages: string[];
  experience: string;
  schedule: string;
  summary?: string;
  bio: string;
  hourlyRate: number;
  introductionVideo?: string;
  videoThumbnail?: string;
  videoType?: 'upload' | 'youtube' | 'vimeo';
  spokenLanguages?: { code: string; level: string }[];
}

export interface Tutor {
  id: string;
  auth0Id?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  picture?: string;
  languages: string[];
  hourlyRate: number;
  experience: string;
  schedule: string;
  summary?: string;
  bio: string;
  introductionVideo?: string;
  videoThumbnail?: string;
  videoType?: 'upload' | 'youtube' | 'vimeo';
  country: string;
  gender: string;
  nativeSpeaker: boolean;
  rating: number;
  totalLessons: number;
  students?: number;
  totalHours: number;
  joinedDate: string;
  profile?: {
    officeHoursEnabled?: boolean;
  };
  isActivelyAvailable?: boolean; // True only if tutor is on pre-call page with recent heartbeat
  coachingBadge?: {
    active: boolean;
    feedbackRate: number;
    avgQuality: number;
  };
  materialCount?: number;
  // UI state properties
  isOnline?: boolean;
  expanded?: boolean;
  responseTime?: string;
  specialties?: string[];
}

export interface TutorSearchFilters {
  language?: string;
  priceMin?: number;
  priceMax?: number;
  country?: string | string[];
  availability?: string;
  specialties?: string[];
  gender?: string;
  nativeSpeaker?: boolean;
  sortBy?: string;
  page?: number;
  limit?: number;
}

export interface TutorSearchResponse {
  success: boolean;
  tutors: Tutor[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private apiUrl = `${environment.backendUrl}/api`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  // Tutor approval status tracking
  private tutorApprovalStatusSubject = new BehaviorSubject<{
    photoComplete: boolean;
    videoComplete: boolean;
    videoApproved: boolean;
    videoRejected: boolean;
    hasApprovedVideo: boolean;
    stripeComplete: boolean;
    // Credential status
    governmentIdUploaded: boolean;
    governmentIdApproved: boolean;
    governmentIdRejected: boolean;
    /** True when Stripe has fully KYC'd the tutor (skip manual gov-ID). */
    stripeIdentityVerified: boolean;
    /** True if identity is satisfied via either Stripe KYC or admin-approved gov-ID. */
    identitySatisfied: boolean;
    /** True when the manual gov-ID step should be shown in the wizard. Driven by payout path: false for healthy Stripe-path tutors, true for PayPal/manual or Stripe-disabled. */
    identityRequired: boolean;
    certificationsUploaded: boolean;
    certificationsApproved: boolean;
    credentialsComplete: boolean; // All required credentials uploaded (or Stripe-verified)
    credentialsApproved: boolean; // All required credentials approved (identity + at least one teaching cert)
    tosComplete: boolean;
    fullyApproved: boolean;
    needsApproval: boolean;
  } | null>(null);
  public tutorApprovalStatus$ = this.tutorApprovalStatusSubject.asObservable();

  // Payout status for tutors (loaded once on app init)
  private payoutStatusSubject = new BehaviorSubject<{
    provider: 'stripe' | 'paypal' | 'manual' | 'none';
    hasPayoutSetup: boolean;
    options: any;
  }>({
    provider: 'none',
    hasPayoutSetup: false,
    options: null
  });
  public payoutStatus$ = this.payoutStatusSubject.asObservable();

  // Availability update notifications - emits the updated availability array
  private availabilityUpdatedSubject = new Subject<any[]>();
  public availabilityUpdated$ = this.availabilityUpdatedSubject.asObservable();
  
  // Cached availability state for tutors - updated when availability changes
  private _hasAvailability: boolean | null = null;
  private _availabilityBlocks: any[] = [];

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {
    // Recompute tutor-approval + payout status on EVERY currentUser$ emit so
    // any consumer that updates the user (picture upload, video upload, payout
    // setup, profile edit, etc.) keeps the shared checklist + Payouts tab in
    // perfect sync without each caller needing to remember to refresh.
    this.currentUserSubject.subscribe(user => {
      if (user && user.userType === 'tutor') {
        this.updateTutorApprovalStatus(user);
      }
    });
  }

  private async getAuthHeadersAsync(): Promise<HttpHeaders> {
    try {
      // getAccessTokenSilently() silently refreshes the access token (and the
      // ID token) when they are near expiry, using Auth0's refresh-token
      // rotation. Calling it first guarantees that the idTokenClaims$ snapshot
      // below is always fresh — solving the "401 Invalid or expired token"
      // error that occurred after ~24h when only idTokenClaims$ was read.
      await this.authService.getAccessToken().pipe(take(1)).toPromise();

      // Now read the fresh ID token. We still use the ID token (not the access
      // token) as the bearer because the backend maps `email → dev-user-{email}`
      // sub format, and the ID token carries the email claim.
      const idTokenClaims = await this.authService.getIdTokenClaims();
      const idToken = idTokenClaims?.__raw;

      if (!idToken) {
        throw new Error('No ID token available after refresh');
      }

      return new HttpHeaders({
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      });
    } catch (error) {
      console.error('❌ Error getting auth token:', error);

      // Fallback to dev token if Auth0 token refresh fails (dev only — backend
      // unconditionally rejects dev-token-* in production).
      const user = await this.authService.user$.pipe(take(1)).toPromise();
      const userEmail = user?.email || 'unknown';
      const tokenEmail = userEmail.replace('@', '-').replace(/\./g, '-');
      const mockToken = `dev-token-${tokenEmail}`;
      
      return new HttpHeaders({
        'Authorization': `Bearer ${mockToken}`,
        'Content-Type': 'application/json'
      });
    }
  }

  private getAuthHeaders(userEmail: string): HttpHeaders {
    // This synchronous version is deprecated - use getAuthHeadersAsync instead
    // Use dev token format for now since Auth0 interceptor isn't working properly
    // Convert email to token format: replace @ and . with -
    const tokenEmail = userEmail.replace('@', '-').replace(/\./g, '-');
    const mockToken = `dev-token-${tokenEmail}`;
    
    return new HttpHeaders({
      'Authorization': `Bearer ${mockToken}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest' // Helps backend identify AJAX requests
    });
  }

  // Options for HTTP requests that need credentials (cookies)
  private getHttpOptions(headers: HttpHeaders) {
    return {
      headers,
      withCredentials: true // Enable sending cookies with requests
    };
  }

  // Public method to get auth headers for current user (synchronous)
  public getAuthHeadersSync(): HttpHeaders {
    let currentUser = this.currentUserSubject.value;
    let userEmail = currentUser?.email;
    
    // Fallback: try localStorage cached email if BehaviorSubject hasn't loaded yet
    if (!userEmail) {
      try {
        const cached = localStorage.getItem('currentUserEmail');
        if (cached) {
          userEmail = cached;
        }
      } catch {}
    }

    if (!userEmail) {
      console.warn('⚠️ getAuthHeadersSync: No user email available yet');
      return new HttpHeaders({
        'Content-Type': 'application/json'
      });
    }
    
    return this.getAuthHeaders(userEmail);
  }
  
  private initialLoadComplete = false;
  
  private isInitialLoadComplete(): boolean {
    // After the first successful getCurrentUser(), mark as complete
    return this.initialLoadComplete;
  }

  /**
   * Get current user from API
   */
  getCurrentUser(forceRefresh = false): Observable<User> {
    // If we already have a user and not forcing refresh, return cached
    const cachedUser = this.currentUserSubject.value;
    if (cachedUser && !forceRefresh) {
      return of(cachedUser);
    }

    // Otherwise fetch from API
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        if (userEmail === 'unknown') {
          console.error('UserService getCurrentUser: No email found in Auth0 user data!');
        }
        
        const headers = this.getAuthHeaders(userEmail);
        
        return this.http.get<{success: boolean, user: User}>(`${this.apiUrl}/users/me`, {
          headers: headers,
          withCredentials: true // Enable cookies for cross-tab auth in incognito
        });
      }),
      map(response => {
        return response.user;
      }),
      tap(user => {
        this.currentUserSubject.next(user);
        this.initialLoadComplete = true;

        // Cache email for resilient auth header generation on page refresh
        if (user?.email) {
          try { localStorage.setItem('currentUserEmail', user.email); } catch {}
        }
        
        setGlobalTimeFormat(user?.profile?.calendarTimeFormat || '12h');

        // Update tutor approval status if user is a tutor
        if (user.userType === 'tutor') {
          this.updateTutorApprovalStatus(user);
        }
      })
    );
  }

  /**
   * Calculate and update tutor approval status based on user data
   */
  private updateTutorApprovalStatus(user: User): void {
    // Photo is complete only if they have a CUSTOM uploaded photo (not just Google/Auth0 default)
    // Check if picture is from GCS (custom upload) or different from their auth0Picture
    const hasCustomPhoto = user.picture && (
      user.picture.includes('storage.googleapis.com') || // GCS uploaded photo
      (user.auth0Picture && user.picture !== user.auth0Picture) // Different from original Auth0 photo
    );
    const photoComplete = !!hasCustomPhoto;
    // Video is complete when there's either a pending submission (awaiting
    // review) or an approved video on file. We intentionally do NOT treat a
    // bare `videoRejected` flag as complete — the Teaching Profile section
    // shows the upload empty-state in that case, so the checklist must agree
    // and prompt the tutor to re-upload.
    const videoComplete = !!user.onboardingData?.pendingVideo ||
                          !!user.onboardingData?.introductionVideo;
    const videoApproved = user.tutorOnboarding?.videoApproved === true;
    const videoRejected = user.tutorOnboarding?.videoRejected === true;
    const hasApprovedVideo = !!user.onboardingData?.introductionVideo; // Has at least one approved video
    
    // Check for any payout method: Stripe, PayPal, or Manual.
    // PayPal is considered complete as soon as payoutProvider is set to 'paypal' — the
    // email is validated before saving so having the provider flag is sufficient.
    const hasStripe = user.stripeConnectOnboarded === true;
    const hasPayPal = user.payoutProvider === 'paypal';
    const hasManual = user.payoutProvider === 'manual';
    const stripeComplete = hasStripe || hasPayPal || hasManual;

    // Credential checks
    const creds = user.tutorCredentials;
    const governmentIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
    const governmentIdApproved = creds?.governmentId?.status === 'approved';
    const governmentIdRejected = creds?.governmentId?.status === 'rejected';

    // Stripe Connect handles its own KYC; when verified we skip the manual
    // Government-ID upload step (and treat identity as satisfied).
    const stripeIdentityVerified = user.stripeIdentityVerified === true;
    const stripeAccountDisabled = user.stripeAccountDisabled === true;
    const identitySatisfied = stripeIdentityVerified || governmentIdApproved;

    // Decide whether to SHOW the manual gov-ID step in the wizard.
    // Rule:
    //   1. Already Stripe-verified → not needed (Stripe owns identity).
    //   2. Tutor explicitly on PayPal/manual payout → needed (we own identity).
    //   3. Country supports Stripe AND Stripe account isn't disabled → not needed
    //      (we expect Stripe to KYC them; webhook re-flips this back if Stripe
    //      rejects or asks for more docs).
    //   4. Otherwise (no country, country not Stripe-supported, Stripe disabled) → needed.
    const payoutProvider = user.payoutProvider || 'none';
    const onPayPalOrManual = payoutProvider === 'paypal' || payoutProvider === 'manual';
    const onStripePathHealthy =
      !onPayPalOrManual &&
      isStripeSupportedCountry(user.residenceCountry) &&
      !stripeAccountDisabled;
    const identityRequired = !stripeIdentityVerified && !onStripePathHealthy;

    // identityUploaded reflects "have we collected something for identity?".
    // When the step is hidden (not required) and Stripe will handle it, treat
    // the identity slot as complete for the credentials-complete checklist.
    const identityUploaded =
      stripeIdentityVerified || (!identityRequired) || governmentIdUploaded;

    const certificationsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
    const certificationsApproved = !!(creds?.teachingCertifications?.some(c => c.status === 'approved'));
    const credentialsComplete = identityUploaded && certificationsUploaded;
    const credentialsApproved = identitySatisfied && certificationsApproved;

    const tosComplete = !!user.tosAcceptedAt;

    const fullyApproved = user.tutorApproved === true;
    
    // Needs approval if onboarding is complete but not fully approved
    const needsApproval = user.onboardingCompleted && !fullyApproved;
    
    const status = {
      photoComplete,
      videoComplete,
      videoApproved,
      videoRejected,
      hasApprovedVideo,
      stripeComplete,
      governmentIdUploaded,
      governmentIdApproved,
      governmentIdRejected,
      stripeIdentityVerified,
      identitySatisfied,
      identityRequired,
      certificationsUploaded,
      certificationsApproved,
      credentialsComplete,
      credentialsApproved,
      tosComplete,
      fullyApproved,
      needsApproval
    };

    this.tutorApprovalStatusSubject.next(status);

    // Keep `payoutStatus$` in lock-step with `tutorApprovalStatus$` so the
    // profile Payouts tab can never disagree with the profile checklist.
    // We only refresh the provider/hasPayoutSetup pair here and preserve the
    // cached `options` (loaded once via `loadPayoutStatus()` on app init).
    const prev = this.payoutStatusSubject.value;
    const provider = (user.payoutProvider || 'none') as 'stripe' | 'paypal' | 'manual' | 'none';
    let hasPayoutSetup = false;
    if (provider === 'stripe') {
      hasPayoutSetup = user.stripeConnectOnboarded === true;
    } else if (provider === 'paypal' || provider === 'manual') {
      hasPayoutSetup = true;
    }
    if (prev.provider !== provider || prev.hasPayoutSetup !== hasPayoutSetup) {
      this.payoutStatusSubject.next({
        provider,
        hasPayoutSetup,
        options: prev.options,
      });
    }
  }

  /**
   * Force refresh tutor approval status (call after video upload, Stripe connect, etc.)
   */
  public refreshTutorApprovalStatus(): void {
    const user = this.currentUserSubject.value;
    if (user && user.userType === 'tutor') {
      this.updateTutorApprovalStatus(user);
    }
  }

  /**
   * Load and cache payout status for tutors
   * This should be called once on app init to avoid flashing in the profile page
   */
  public async loadPayoutStatus(): Promise<void> {
    try {
      const headers = await this.getAuthHeadersAsync();
      
      // Fetch payout options (includes migration logic)
      const optionsResponse = await this.http.get<any>(`${this.apiUrl}/payments/payout-options`, {
        headers
      }).toPromise();

      if (optionsResponse?.success) {
        // Fetch current user to get updated payout provider
        const user = await this.getCurrentUser(true).toPromise();
        const payoutProvider = user?.payoutProvider || 'none';
        
        // Determine if payout is set up. Must stay consistent with the
        // tutorApprovalStatus.stripeComplete logic above so the profile
        // Payouts tab and the shared profile checklist never disagree.
        let hasPayoutSetup = false;
        if (payoutProvider === 'stripe') {
          hasPayoutSetup = user?.stripeConnectOnboarded === true;
        } else if (payoutProvider === 'paypal') {
          hasPayoutSetup = true;
        } else if (payoutProvider === 'manual') {
          hasPayoutSetup = true;
        }

        // Update the subject
        this.payoutStatusSubject.next({
          provider: payoutProvider as any,
          hasPayoutSetup,
          options: optionsResponse.options
        });
      }
    } catch (error) {
      console.error('❌ [UserService] Error loading payout status:', error);
    }
  }

  /**
   * Get current payout status (synchronous)
   */
  public getPayoutStatus() {
    return this.payoutStatusSubject.value;
  }

  /**
   * Create or update user
   */
  createOrUpdateUser(userData: Partial<User>): Observable<User> {
    return from(this.getAuthHeadersAsync()).pipe(
      switchMap(headers => {
        return this.http.post<{success: boolean, user: User}>(`${this.apiUrl}/users`, userData, {
          headers
        });
      }),
      map(response => {
        return response.user;
      }),
      tap(user => {
        this.currentUserSubject.next(user);
      }),
      catchError(error => {
        console.error('🔍 Error in createOrUpdateUser:', error);
        throw error;
      })
    );
  }

  /**
   * Complete onboarding
   */
  completeOnboarding(onboardingData: OnboardingData): Observable<User> {
    return from(this.getAuthHeadersAsync()).pipe(
      switchMap(headers => {
        return this.http.put<{success: boolean, user: User}>(`${this.apiUrl}/users/onboarding`, onboardingData, {
          headers
        });
      }),
      map(response => response.user),
      tap(user => this.currentUserSubject.next(user))
    );
  }

  /**
   * Complete tutor onboarding
   */
  completeTutorOnboarding(tutorData: TutorOnboardingData): Observable<User> {
    return from(this.getAuthHeadersAsync()).pipe(
      switchMap(headers => {
        return this.http.put<{success: boolean, user: User}>(`${this.apiUrl}/users/onboarding`, tutorData, {
          headers
        });
      }),
      map(response => response.user),
      tap(user => this.currentUserSubject.next(user))
    );
  }

  /**
   * Submit tutor profile for review
   */
  submitTutorForReview(): Observable<{ success: boolean, message: string, tutorOnboarding: any }> {
    return from(this.getAuthHeadersAsync()).pipe(
      switchMap(headers => {
        return this.http.post<{ success: boolean, message: string, tutorOnboarding: any }>(
          `${this.apiUrl}/users/tutor/submit-for-review`, 
          {}, 
          { headers }
        );
      }),
      tap(() => {
        // Refresh current user to get updated tutorOnboarding status
        this.getCurrentUser(true).subscribe();
      })
    );
  }

  /**
   * Update user profile
   */
  updateProfile(profileData: Partial<User['profile']> & { interfaceLanguage?: string; calendarTimeFormat?: string; calendarDefaultView?: string }): Observable<User> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        return this.http.put<{success: boolean, user: User}>(`${this.apiUrl}/users/profile`, profileData, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      map(response => response.user),
      tap(user => {
        this.currentUserSubject.next(user);
        setGlobalTimeFormat(user?.profile?.calendarTimeFormat || '12h');
      })
    );
  }

  /**
   * Update user interface language
   */
  updateInterfaceLanguage(language: SupportedLanguage): Observable<User> {
    return this.updateProfile({ interfaceLanguage: language });
  }

  /**
   * Toggle office hours on/off
   */
  toggleOfficeHours(enabled: boolean): Observable<User> {
    return this.updateProfile({ officeHoursEnabled: enabled });
  }

  /**
   * Get office hours status
   */
  getOfficeHoursStatus(): boolean {
    const currentUser = this.currentUserSubject.value;
    return currentUser?.profile?.officeHoursEnabled || false;
  }
  
  /**
   * Update show wallet balance setting
   */
  updateShowWalletBalance(show: boolean): Observable<User> {
    return this.updateProfile({ showWalletBalance: show });
  }
  
  /**
   * Update reminders enabled setting
   */
  updateRemindersEnabled(enabled: boolean): Observable<User> {
    return this.updateProfile({ remindersEnabled: enabled });
  }

  /**
   * Update AI analysis enabled setting
   */
  updateAIAnalysisEnabled(enabled: boolean): Observable<User> {
    return this.updateProfile({ aiAnalysisEnabled: enabled });
  }
  
  /**
   * Get show wallet balance setting (default false for privacy)
   */
  getShowWalletBalance(): boolean {
    const currentUser = this.currentUserSubject.value;
    return currentUser?.profile?.showWalletBalance || false;
  }
  
  /**
   * Get reminders enabled setting (default true)
   */
  getRemindersEnabled(): boolean {
    const currentUser = this.currentUserSubject.value;
    return currentUser?.profile?.remindersEnabled !== false; // Default true
  }

  /**
   * Get the user's preferred time format (12h or 24h). Defaults to 12h.
   */
  getTimeFormat(): '12h' | '24h' {
    const currentUser = this.currentUserSubject.value;
    return currentUser?.profile?.calendarTimeFormat || '12h';
  }

  /**
   * Whether the user prefers 24-hour time format.
   */
  get is24h(): boolean {
    return this.getTimeFormat() === '24h';
  }

  /**
   * Update the user's time format preference.
   */
  updateTimeFormat(format: '12h' | '24h'): Observable<User> {
    setGlobalTimeFormat(format);
    return this.updateProfile({ calendarTimeFormat: format });
  }

  /**
   * Send heartbeat to backend to indicate tutor is actively on pre-call page
   */
  sendOfficeHoursHeartbeat(): Observable<any> {
    const headers = this.getAuthHeadersSync();
    return this.http.post<any>(`${this.apiUrl}/users/office-hours-heartbeat`, {}, { headers });
  }

  /**
   * Check if user exists in database
   */
  checkUserExists(): Observable<boolean> {
    return this.getCurrentUser().pipe(
      map(user => !!user),
    );
  }

  /**
   * Get current user from local state
   */
  getCurrentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Get cached hasAvailability state (returns null if not yet loaded)
   */
  getCachedHasAvailability(): boolean | null {
    return this._hasAvailability;
  }

  /**
   * Get cached availability blocks
   */
  getCachedAvailabilityBlocks(): any[] {
    return this._availabilityBlocks;
  }

  /**
   * Clear current user (should be called on logout)
   */
  clearCurrentUser(): void {
    this.currentUserSubject.next(null);
    this.initialLoadComplete = false;
  }

  /**
   * Get user by email (public endpoint)
   */
  getUserByEmail(email: string): Observable<User | null> {
    return this.http.post<{ success: boolean; user?: any }>(`${this.apiUrl}/users/by-email`, { email }).pipe(
      map(resp => {
        const u = (resp as any)?.user;
        if (!u) return null;
        return {
          id: u.id,
          auth0Id: u.auth0Id,
          email: u.email,
          name: u.name,
          picture: u.picture,
          emailVerified: !!u.emailVerified,
          userType: (u as any).userType || 'student',
          onboardingCompleted: !!u.onboardingCompleted,
          onboardingData: u.onboardingData,
          profile: u.profile,
          stats: u.stats,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        } as User;
      })
    );
  }

  /**
   * Initialize user data after authentication.
   *
   * Forwards the local interface-language pick (set by the picker or by
   * `LanguageService.initializeLanguage`) so the backend can seed a brand
   * new user's `interfaceLanguage` with the user's actual choice instead
   * of falling back to the schema default 'en'. The backend ignores it
   * for users that already have the field set.
   */
  initializeUser(auth0User: any): Observable<User> {
    const userType = localStorage.getItem('selectedUserType') || 'student';
    const interfaceLanguage = (typeof localStorage !== 'undefined')
      ? (localStorage.getItem('userLanguage') || undefined)
      : undefined;

    if (!auth0User?.email) {
      console.error('🔍 UserService initializeUser: No email in Auth0 user data!');
    }

    const userData: Partial<User> = {
      email: auth0User.email,
      name: auth0User.name,
      auth0Picture: auth0User.picture,
      emailVerified: auth0User.email_verified,
      userType: userType as 'student' | 'tutor',
    };
    if (interfaceLanguage) {
      (userData as any).interfaceLanguage = interfaceLanguage;
    }

    return this.createOrUpdateUser(userData);
  }

  /**
   * Search tutors with filters
   */
  searchTutors(filters: TutorSearchFilters): Observable<TutorSearchResponse> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        // Build query parameters
        const params = new URLSearchParams();
        Object.keys(filters).forEach(key => {
          const value = filters[key as keyof TutorSearchFilters];
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              // Only append if array has items
              if (value.length > 0) {
                value.forEach(item => params.append(key, item.toString()));
              }
            } else {
              params.append(key, value.toString());
            }
          }
        });

        return this.http.get<TutorSearchResponse>(`${this.apiUrl}/users/tutors?${params.toString()}`, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      catchError(error => {
        console.error('🔍 Error searching tutors:', error);
        throw error;
      })
    );
  }

  /**
   * Update tutor introduction video with thumbnail and type
   */
  updateTutorVideo(
    introductionVideo: string, 
    videoThumbnail?: string, 
    videoType?: 'upload' | 'youtube' | 'vimeo'
  ): Observable<{ success: boolean; message: string; introductionVideo: string; videoThumbnail?: string; videoType?: string }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        return this.http.put<{ success: boolean; message: string; introductionVideo: string; videoThumbnail?: string; videoType?: string }>(
          `${this.apiUrl}/users/tutor-video`,
          { 
            introductionVideo,
            videoThumbnail: videoThumbnail || '',
            videoType: videoType || 'upload'
          },
          { headers: this.getAuthHeaders(userEmail) }
        );
      }),
      catchError(error => {
        console.error('📹 Error updating tutor video:', error);
        throw error;
      })
    );
  }

  /**
   * Upload a tutor credential document (government ID, teaching certification, additional doc)
   */
  uploadCredential(
    file: File,
    credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument',
    metadata?: { certificationName?: string; documentType?: string; label?: string }
  ): Observable<any> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        const formData = new FormData();
        formData.append('document', file);
        formData.append('credentialType', credentialType);
        if (metadata?.certificationName) formData.append('certificationName', metadata.certificationName);
        if (metadata?.documentType) formData.append('documentType', metadata.documentType);
        if (metadata?.label) formData.append('label', metadata.label);
        
        // Use only Authorization header — do NOT set Content-Type
        // Browser must set multipart/form-data with boundary automatically for FormData
        const authHeaders = this.getAuthHeaders(userEmail);
        const uploadHeaders = new HttpHeaders({
          'Authorization': authHeaders.get('Authorization') || ''
        });
        
        return this.http.post<any>(
          `${this.apiUrl}/users/tutor/upload-credential`,
          formData,
          { headers: uploadHeaders }
        );
      }),
      catchError(error => {
        console.error('📄 Error uploading credential:', error);
        throw error;
      })
    );
  }

  /**
   * Delete a tutor credential document
   */
  deleteCredential(
    credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument',
    credentialId?: string
  ): Observable<any> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        let url = `${this.apiUrl}/users/tutor/credential/${credentialType}`;
        if (credentialId) url += `/${credentialId}`;
        
        return this.http.delete<any>(url, { 
          headers: this.getAuthHeaders(userEmail) 
        });
      }),
      catchError(error => {
        console.error('🗑️ Error deleting credential:', error);
        throw error;
      })
    );
  }

  acceptTos(tosVersion: string = '1.0'): Observable<any> {
    const headers = this.getAuthHeadersSync();
    return this.http.post<any>(
      `${this.apiUrl}/users/tutor/accept-tos`,
      { tosVersion },
      { headers }
    );
  }

  /**
   * Update user profile picture
   */
  updatePicture(pictureUrl: string): Observable<{ success: boolean; message: string; picture: string }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        return this.http.put<{ success: boolean; message: string; picture: string }>(
          `${this.apiUrl}/users/profile-picture`,
          { imageUrl: pictureUrl },
          { headers: this.getAuthHeaders(userEmail) }
        );
      }),
      tap(response => {
        // Update the current user subject with the new picture
        const currentUser = this.currentUserSubject.value;
        if (currentUser && response.picture) {
          currentUser.picture = response.picture;
          this.currentUserSubject.next(currentUser);
        }
        // Also refresh from server
        this.getCurrentUser().pipe(take(1)).subscribe();
      }),
      catchError(error => {
        console.error('🖼️ Error updating profile picture:', error);
        throw error;
      })
    );
  }

  /**
   * Update tutor availability
   * @param availabilityBlocks - Array of availability blocks to save
   * @param editedDates - Optional array of dates (YYYY-MM-DD) being edited (to clear existing availability for those dates)
   */
  updateAvailability(availabilityBlocks: any[], editedDates?: string[]): Observable<{ success: boolean; message: string; availability: any[] }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        return this.http.put<{ success: boolean; message: string; availability: any[] }>(
          `${this.apiUrl}/users/availability`,
          { availabilityBlocks, editedDates },
          { headers: this.getAuthHeaders(userEmail) }
        );
      }),
      tap(response => {
        // Emit event to notify subscribers that availability was updated
        // Include the updated availability array so subscribers can update immediately
        if (response.success && response.availability) {
          // Cache the availability state
          this._availabilityBlocks = response.availability;
          const timeNow = new Date();
          this._hasAvailability = response.availability.some(slot => {
            if (slot.absoluteEnd) return new Date(slot.absoluteEnd) > timeNow;
            if (slot.absoluteStart) return new Date(slot.absoluteStart) > timeNow;
            return true;
          });

          this.availabilityUpdatedSubject.next(response.availability);
        }
      }),
      catchError(error => {
        console.error('📅 Error updating availability:', error);
        throw error;
      })
    );
  }

  /**
   * Get tutor availability
   */
  getAvailability(): Observable<{ success: boolean; availability: any[] }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        // Add cache-busting parameter to force fresh data
        const cacheBuster = `?t=${Date.now()}`;
        
        return this.http.get<{ success: boolean; availability: any[] }>(
          `${this.apiUrl}/users/availability${cacheBuster}`,
          { headers: this.getAuthHeaders(userEmail) }
        );
      }),
      catchError(error => {
        console.error('📅 Error fetching availability:', error);
        throw error;
      })
    );
  }

  /**
   * Get tutor availability by tutor ID (public)
   */
  getTutorAvailability(tutorId: string): Observable<{ success: boolean; availability: any[]; timezone?: string; acceptingBookings?: boolean }> {
    return this.http.get<{ success: boolean; availability: any[]; timezone?: string; acceptingBookings?: boolean }>(
      `${this.apiUrl}/users/${tutorId}/availability`
    ).pipe(
      catchError(error => {
        console.error('📅 Error fetching tutor availability:', error);
        throw error;
      })
    );
  }

  /**
   * Get public tutor profile by ID
   */
  getTutorPublic(tutorId: string): Observable<{ success: boolean; tutor: Tutor & { profile?: any; stats?: any } }> {
    return this.http.get<{ success: boolean; tutor: any }>(
      `${this.apiUrl}/users/${tutorId}/public`
    ).pipe(
      map(res => res as any),
      catchError(error => {
        console.error('👤 Error fetching tutor public profile:', error);
        throw error;
      })
    );
  }

  /**
   * Get user public profile (tutor or student)
   */
  getUserPublic(userId: string): Observable<{ success: boolean; tutor?: any; student?: any }> {
    return this.http.get<{ success: boolean; tutor?: any; student?: any }>(
      `${this.apiUrl}/users/${userId}/public`
    ).pipe(
      catchError(error => {
        console.error('👤 Error fetching user public profile:', error);
        throw error;
      })
    );
  }

  /**
   * Detect and save user's timezone automatically.
   * Returns whether the caller should notify the user:
   *   - `unchanged` — already matched, no write
   *   - `initial`   — first-time save (no prior timezone); stay silent
   *   - `changed`   — user had a different timezone; OK to show a toast
   */
  detectAndSaveTimezone(): Observable<'unchanged' | 'initial' | 'changed'> {
    try {
      const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      return this.getCurrentUser().pipe(
        take(1),
        switchMap(user => {
          const currentTimezone = user?.profile?.timezone;

          if (currentTimezone === detectedTimezone) {
            return of('unchanged' as const);
          }

          const outcome = currentTimezone ? 'changed' as const : 'initial' as const;
          return this.updateProfile({ timezone: detectedTimezone }).pipe(
            map(() => outcome),
            catchError(error => {
              if (error?.status !== 404) {
                console.error('❌ Failed to save timezone:', error);
              }
              return of('unchanged' as const);
            })
          );
        }),
        catchError(error => {
          if (error?.status !== 404) {
            console.error('❌ Error detecting/saving timezone:', error);
          }
          return of('unchanged' as const);
        })
      );
    } catch (error) {
      console.error('❌ Error in detectAndSaveTimezone:', error);
      return of('unchanged');
    }
  }

  /**
   * Get user's timezone (from profile or detect from browser)
   */
  getUserTimezone(): Observable<string> {
    return this.getCurrentUser().pipe(
      take(1),
      map(user => {
        const timezone = user?.profile?.timezone;
        if (timezone) {
          return timezone;
        }
        // Fallback to detected timezone
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          return 'UTC';
        }
      }),
      catchError(() => {
        // Fallback on error
        try {
          return of(Intl.DateTimeFormat().resolvedOptions().timeZone);
        } catch {
          return of('UTC');
        }
      })
    );
  }

  /**
   * Remove user's profile picture (restores to Auth0/Google picture if available)
   */
  removePicture(): Observable<{ success: boolean; message: string; picture?: string }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        if (!user?.email) {
          throw new Error('User not authenticated');
        }

        return this.http.delete<{ success: boolean; message: string; picture?: string }>(
          `${this.apiUrl}/users/profile-picture`,
          { headers: this.getAuthHeaders(user.email) }
        ).pipe(
          tap((response) => {
            // Update current user with restored picture
            const currentUser = this.currentUserSubject.value;
            if (currentUser) {
              currentUser.picture = response.picture;
              this.currentUserSubject.next(currentUser);
            }
            // Also refresh from server
            this.getCurrentUser().pipe(take(1)).subscribe();
          })
        );
      })
    );
  }

  /**
   * Fetch profile picture as a Blob via backend proxy (bypasses CORS)
   */
  getProfilePictureBlob(): Observable<Blob> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        return this.http.get(`${this.apiUrl}/users/profile-picture-proxy`, {
          headers: this.getAuthHeaders(userEmail),
          responseType: 'blob'
        });
      })
    );
  }

  // ── Google Calendar ────────────────────────────────

  getGoogleCalendarAuthUrl(): Observable<{ url: string }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const email = user?.email || 'unknown';
        return this.http.get<{ url: string }>(
          `${this.apiUrl}/auth/google-calendar/url`,
          { headers: this.getAuthHeaders(email) }
        );
      })
    );
  }

  disconnectGoogleCalendar(): Observable<{ success: boolean }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const email = user?.email || 'unknown';
        return this.http.post<{ success: boolean }>(
          `${this.apiUrl}/auth/google-calendar/disconnect`,
          {},
          { headers: this.getAuthHeaders(email) }
        );
      })
    );
  }

  getGoogleCalendarStatus(): Observable<{
    success: boolean;
    connected: boolean;
    email: string | null;
    syncEnabled: boolean;
    pushToGoogle: boolean;
    lastSyncAt: string | null;
    watchActive?: boolean;
  }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const email = user?.email || 'unknown';
        return this.http.get<any>(
          `${this.apiUrl}/auth/google-calendar/status`,
          { headers: this.getAuthHeaders(email) }
        );
      })
    );
  }

  updateGoogleCalendarSettings(settings: { syncEnabled?: boolean; pushToGoogle?: boolean }): Observable<{ success: boolean }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const email = user?.email || 'unknown';
        return this.http.put<{ success: boolean }>(
          `${this.apiUrl}/auth/google-calendar/settings`,
          settings,
          { headers: this.getAuthHeaders(email) }
        );
      })
    );
  }

  getGoogleCalendarEvents(timeMin: string, timeMax: string): Observable<{ success: boolean; events: any[] }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const email = user?.email || 'unknown';
        return this.http.get<{ success: boolean; events: any[] }>(
          `${this.apiUrl}/auth/google-calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          { headers: this.getAuthHeaders(email) }
        );
      })
    );
  }

  registerGoogleCalendarWatch(): Observable<any> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const email = user?.email || 'unknown';
        return this.http.post<any>(
          `${this.apiUrl}/auth/google-calendar/register-watch`,
          {},
          { headers: this.getAuthHeaders(email) }
        );
      })
    );
  }
}
