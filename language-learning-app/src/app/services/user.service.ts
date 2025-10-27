import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, tap, take, switchMap, catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';

export interface User {
  id: string;
  auth0Id: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
  userType: 'student' | 'tutor';
  onboardingCompleted: boolean;
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
  languages: string[];
  goals: string[];
  experienceLevel: string;
  preferredSchedule: string;
}

export interface TutorOnboardingData {
  languages: string[];
  experience: string;
  schedule: string;
  bio: string;
  hourlyRate: number;
  introductionVideo?: string;
}

export interface Tutor {
  id: string;
  name: string;
  email: string;
  picture?: string;
  languages: string[];
  hourlyRate: number;
  experience: string;
  schedule: string;
  bio: string;
  introductionVideo?: string;
  country: string;
  gender: string;
  nativeSpeaker: boolean;
  rating: number;
  totalLessons: number;
  totalHours: number;
  joinedDate: string;
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
  private apiUrl = 'http://localhost:3000/api';
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  private getAuthHeaders(userEmail: string): HttpHeaders {
    // For now, we'll use a mock token that includes the user's email
    // In a real app, you'd get the actual Auth0 token
    const mockToken = `dev-token-${userEmail}`;
    
    console.log('🔍 UserService: Using token for user:', userEmail);
    
    return new HttpHeaders({
      'Authorization': `Bearer ${mockToken}`,
      'Content-Type': 'application/json'
    });
  }

  /**
   * Get current user from API
   */
  getCurrentUser(): Observable<User> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        return this.http.get<{success: boolean, user: User}>(`${this.apiUrl}/users/me`, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      map(response => response.user),
      tap(user => this.currentUserSubject.next(user))
    );
  }

  /**
   * Create or update user
   */
  createOrUpdateUser(userData: Partial<User>): Observable<User> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        console.log('🔍 Making POST request to:', `${this.apiUrl}/users`);
        console.log('🔍 Request headers:', this.getAuthHeaders(userEmail));
        return this.http.post<{success: boolean, user: User}>(`${this.apiUrl}/users`, userData, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      map(response => {
        console.log('🔍 POST response received:', response);
        return response.user;
      }),
      tap(user => {
        console.log('🔍 User stored in service:', user);
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
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        return this.http.put<{success: boolean, user: User}>(`${this.apiUrl}/users/onboarding`, onboardingData, {
          headers: this.getAuthHeaders(userEmail)
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
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        return this.http.put<{success: boolean, user: User}>(`${this.apiUrl}/users/onboarding`, tutorData, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      map(response => response.user),
      tap(user => this.currentUserSubject.next(user))
    );
  }

  /**
   * Update user profile
   */
  updateProfile(profileData: Partial<User['profile']>): Observable<User> {
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
   * Check if user exists in database
   */
  checkUserExists(): Observable<boolean> {
    return this.getCurrentUser().pipe(
      map(user => !!user),
      tap(exists => console.log('User exists in database:', exists))
    );
  }

  /**
   * Get current user from local state
   */
  getCurrentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Clear current user
   */
  clearCurrentUser(): void {
    this.currentUserSubject.next(null);
  }

  /**
   * Initialize user data after authentication
   */
  initializeUser(auth0User: any): Observable<User> {
    // Get user type from localStorage (set during login)
    const userType = localStorage.getItem('selectedUserType') || 'student';
    
    console.log('🔍 UserService: Initializing user with userType:', userType);
    console.log('🔍 UserService: Auth0User data:', auth0User);
    
    const userData = {
      email: auth0User.email,
      name: auth0User.name,
      picture: auth0User.picture,
      emailVerified: auth0User.email_verified,
      userType: userType as 'student' | 'tutor'
    };

    console.log('🔍 UserService: User data being sent:', userData);
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

        console.log('🔍 Searching tutors with filters:', filters);
        console.log('🔍 Query params:', params.toString());

        return this.http.get<TutorSearchResponse>(`${this.apiUrl}/users/tutors?${params.toString()}`, {
          headers: this.getAuthHeaders(userEmail)
        });
      }),
      tap(response => {
        console.log('🔍 Tutor search response:', response);
      }),
      catchError(error => {
        console.error('🔍 Error searching tutors:', error);
        throw error;
      })
    );
  }

  /**
   * Update tutor introduction video
   */
  updateTutorVideo(introductionVideo: string): Observable<{ success: boolean; message: string; introductionVideo: string }> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        const userEmail = user?.email || 'unknown';
        
        return this.http.put<{ success: boolean; message: string; introductionVideo: string }>(
          `${this.apiUrl}/users/tutor-video`,
          { introductionVideo },
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
}
