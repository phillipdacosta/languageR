import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, from, of } from 'rxjs';
import { map, tap, take, switchMap, catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export interface User {
  id: string;
  auth0Id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  picture?: string;
  emailVerified: boolean;
  userType: 'student' | 'tutor';
  onboardingCompleted: boolean;
  nativeLanguage?: string;
  interfaceLanguage?: 'en' | 'es' | 'fr' | 'pt' | 'de';
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
    completedAt: string;
  };
  profile?: {
    bio: string;
    timezone: string;
    preferredLanguage: string;
    officeHoursEnabled?: boolean;
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
}

export interface TutorOnboardingData {
  firstName?: string;
  lastName?: string;
  country?: string;
  languages: string[];
  experience: string;
  schedule: string;
  bio: string;
  hourlyRate: number;
  introductionVideo?: string;
  videoThumbnail?: string;
  videoType?: 'upload' | 'youtube' | 'vimeo';
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
  bio: string;
  introductionVideo?: string;
  videoThumbnail?: string;
  videoType?: 'upload' | 'youtube' | 'vimeo';
  country: string;
  gender: string;
  nativeSpeaker: boolean;
  rating: number;
  totalLessons: number;
  totalHours: number;
  joinedDate: string;
  profile?: {
    officeHoursEnabled?: boolean;
  };
  isActivelyAvailable?: boolean; // True only if tutor is on pre-call page with recent heartbeat
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
  country?: string;
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

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  private async getAuthHeadersAsync(): Promise<HttpHeaders> {
    try {
      // Get ID token claims which include user profile (email, name, picture)
      const idTokenClaims = await this.authService.getIdTokenClaims();
      console.log('🔑 Got ID token claims:', idTokenClaims ? 'present' : 'null');
      console.log('🔑 ID token claims content:', JSON.stringify(idTokenClaims, null, 2));
      
      // The ID token itself is in __raw
      const idToken = idTokenClaims?.__raw;
      
      if (!idToken) {
        throw new Error('No ID token available');
      }
      
      console.log('🔑 Using ID token:', idToken.substring(0, 20) + '...');
      console.log('🖼️ Picture in ID token claims:', idTokenClaims?.picture || 'NOT FOUND');
      
      return new HttpHeaders({
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      });
    } catch (error) {
      console.error('❌ Error getting ID token:', error);
      console.log('⚠️ Falling back to dev token');
      
      // Fallback to dev token if Auth0 token fails
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
      'Content-Type': 'application/json'
    });
  }

  // Public method to get auth headers for current user (synchronous)
  public getAuthHeadersSync(): HttpHeaders {
    // First try to get the current user from the BehaviorSubject (synchronous)
    let currentUser = this.currentUserSubject.value;
    let userEmail = currentUser?.email;
    
    // If not available, check if we can get it from localStorage or another source
    if (!userEmail) {
      console.warn('⚠️ getAuthHeadersSync: No user email available yet');
      // Return empty headers instead of 'unknown' to prevent malformed token
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
      console.log('📦 UserService: Returning cached user');
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
          headers: headers
        });
      }),
      map(response => {
        return response.user;
      }),
      tap(user => {
        this.currentUserSubject.next(user);
        this.initialLoadComplete = true;
      })
    );
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
   * Update user profile
   */
  updateProfile(profileData: Partial<User['profile']> & { interfaceLanguage?: string }): Observable<User> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        return this.http.put<{success: boolean, user: User}>(`${this.apiUrl}/users/profile`, profileData, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      map(response => response.user),
      tap(user => this.currentUserSubject.next(user))
    );
  }

  /**
   * Update user interface language
   */
  updateInterfaceLanguage(language: 'en' | 'es' | 'fr' | 'pt' | 'de'): Observable<User> {
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
   * Clear current user (should be called on logout)
   */
  clearCurrentUser(): void {
    console.log('🧹 UserService: Clearing cached user');
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
   * Initialize user data after authentication
   */
  initializeUser(auth0User: any): Observable<User> {
    // Get user type from localStorage (set during login)
    const userType = localStorage.getItem('selectedUserType') || 'student';
    
    console.log('🔍 UserService initializeUser: auth0User data:', auth0User);
    console.log('🖼️ UserService initializeUser: auth0User.picture:', auth0User.picture);
    
    if (!auth0User?.email) {
      console.error('🔍 UserService initializeUser: No email in Auth0 user data!');
    }
    
    const userData = {
      email: auth0User.email,
      name: auth0User.name,
      picture: auth0User.picture,
      emailVerified: auth0User.email_verified,
      userType: userType as 'student' | 'tutor'
    };

    console.log('🖼️ UserService initializeUser: userData being sent:', userData);

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
              value.forEach(item => params.append(key, item.toString()));
            } else {
              params.append(key, value.toString());
            }
          }
        });


        return this.http.get<TutorSearchResponse>(`${this.apiUrl}/users/tutors?${params.toString()}`, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      tap(response => {
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
      tap(response => {
        console.log('📹 Tutor video updated:', response);
      }),
      catchError(error => {
        console.error('📹 Error updating tutor video:', error);
        throw error;
      })
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
        console.log('✅ Profile picture updated in database');
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
   */
  updateAvailability(availabilityBlocks: any[]): Observable<{ success: boolean; message: string; availability: any[] }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        return this.http.put<{ success: boolean; message: string; availability: any[] }>(
          `${this.apiUrl}/users/availability`,
          { availabilityBlocks },
          { headers: this.getAuthHeaders(userEmail) }
        );
      }),
      tap(response => {
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
      tap(response => {
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
  getTutorAvailability(tutorId: string): Observable<{ success: boolean; availability: any[]; timezone?: string }> {
    return this.http.get<{ success: boolean; availability: any[]; timezone?: string }>(
      `${this.apiUrl}/users/${tutorId}/availability`
    ).pipe(
      tap(response => {
      }),
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
      tap(response => {
      }),
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
   * Detect and save user's timezone automatically
   * This should be called on login or when the app starts
   */
  detectAndSaveTimezone(): Observable<boolean> {
    try {
      const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log('🌍 Detected timezone:', detectedTimezone);
      
      // Get current user to check existing timezone
      return this.getCurrentUser().pipe(
        take(1),
        switchMap(user => {
          const currentTimezone = user?.profile?.timezone;
          
          // Only update if timezone changed or doesn't exist
          if (!currentTimezone || currentTimezone !== detectedTimezone) {
            console.log('🌍 Updating timezone from', currentTimezone, 'to', detectedTimezone);
            return this.updateProfile({ timezone: detectedTimezone }).pipe(
              map(() => true),
              catchError(error => {
                console.error('❌ Failed to save timezone:', error);
                return of(false);
              })
            );
          } else {
            console.log('🌍 Timezone already up to date:', currentTimezone);
            return of(false); // No update needed
          }
        }),
        catchError(error => {
          console.error('❌ Error detecting/saving timezone:', error);
          return of(false);
        })
      );
    } catch (error) {
      console.error('❌ Error in detectAndSaveTimezone:', error);
      return of(false);
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
            console.log('✅ Profile picture removed');
            if (response.picture) {
              console.log('✅ Restored to Auth0 picture:', response.picture);
            }
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
}
