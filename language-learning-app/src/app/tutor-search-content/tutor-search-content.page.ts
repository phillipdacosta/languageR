// tutor-search-content.page.ts
import { Component, OnInit, OnDestroy, HostListener, Input, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { UserService, TutorSearchFilters, Tutor, TutorSearchResponse, User } from '../services/user.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';
import { trigger, state, style, transition, animate, stagger } from '@angular/animations';
import { ModalController, ViewWillEnter, AnimationController, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { MessagingService } from '../services/messaging.service';
import { VideoPlayerModalComponent } from './video-player-modal.component';

@Component({
  selector: 'app-tutor-search-content',
  templateUrl: './tutor-search-content.page.html',
  styleUrls: ['./tutor-search-content.page.scss'],
  standalone: false,
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('400ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0 }))
      ])
    ]),
    trigger('slideInUp', [
      transition(':enter', [
        style({ 
          opacity: 0, 
          transform: 'translateY(30px) scale(0.98)' 
        }),
        animate('500ms cubic-bezier(0.4, 0, 0.2, 1)', style({ 
          opacity: 1, 
          transform: 'translateY(0) scale(1)' 
        }))
      ])
    ]),
    trigger('listAnimation', [
      transition('* => *', [
        // This will be used for the list container
        animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')
      ])
    ])
  ]
})
export class TutorSearchContentPage implements OnInit, OnDestroy, AfterViewChecked, ViewWillEnter {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<void>();
  
  @Input() scrollToTutorId?: string;
  private hasScrolledToTutor = false;
  
  showFiltersView = false;
  showLanguageDropdown = false;
  showSecondaryFilters = false;
  isLoading = true; // prevent initial FOUC of empty state until first load completes
  isTransitioning = false; // For smooth filter transitions
  hasLoadedOnce = false; // Track if we've done initial data load
  tutors: Tutor[] = [];
  searchResponse: TutorSearchResponse | null = null;
  currentUser: User | null = null;
  showPriceFilter = false;
  viewMode: 'grid' | 'list' = 'list'; // View toggle - default to list
  
  filters: TutorSearchFilters = {
    language: 'Spanish',
    priceMin: 6,
    priceMax: 200,
    country: 'any',
    availability: 'anytime',
    specialties: [],
    gender: 'any',
    nativeSpeaker: false,
    sortBy: 'random', // Random order for fairness - rotates daily
    page: 1,
    limit: 20
  };

  // Price range for the dual-knob slider
  priceRange = {
    lower: 6,
    upper: 200
  };
  
  private readonly FILTER_STORAGE_KEY = 'tutor_search_filters';
  private readonly WATCHED_VIDEOS_KEY = 'watched_tutor_videos';
  private watchedVideos: Set<string> = new Set();
  expandedBios: Set<string> = new Set(); // Track which tutor bios are expanded
  highlightedTutorId: string | null = null; // Track which tutor is highlighted
  isReturningFromProfile = false; // Track if we're returning from a profile to prevent animations
  
  // Video modal state (inline ion-modal)
  isVideoModalOpen = false;
  currentVideoTutor: Tutor | null = null;
  videoModalCircleBounds: { x: number; y: number; width: number; height: number } | null = null;

  // Available languages for the dropdown
  availableLanguages = [
    { value: 'any', label: 'Any language' },
    { value: 'Spanish', label: 'Spanish' },
    { value: 'French', label: 'French' },
    { value: 'German', label: 'German' },
    { value: 'Italian', label: 'Italian' },
    { value: 'Portuguese', label: 'Portuguese' },
    { value: 'Russian', label: 'Russian' },
    { value: 'Chinese', label: 'Chinese' },
    { value: 'Japanese', label: 'Japanese' },
    { value: 'Korean', label: 'Korean' },
    { value: 'Arabic', label: 'Arabic' },
    { value: 'Hindi', label: 'Hindi' },
    { value: 'Dutch', label: 'Dutch' },
    { value: 'Swedish', label: 'Swedish' },
    { value: 'Norwegian', label: 'Norwegian' },
    { value: 'Danish', label: 'Danish' },
    { value: 'Finnish', label: 'Finnish' },
    { value: 'Polish', label: 'Polish' },
    { value: 'Czech', label: 'Czech' },
    { value: 'Hungarian', label: 'Hungarian' },
    { value: 'Turkish', label: 'Turkish' },
    { value: 'Greek', label: 'Greek' },
    { value: 'Hebrew', label: 'Hebrew' },
    { value: 'Thai', label: 'Thai' },
    { value: 'Vietnamese', label: 'Vietnamese' },
    { value: 'Indonesian', label: 'Indonesian' },
    { value: 'Malay', label: 'Malay' },
    { value: 'Tagalog', label: 'Tagalog' },
    { value: 'Swahili', label: 'Swahili' },
    { value: 'English', label: 'English' }
  ];


  constructor(
    private userService: UserService,
    private modalController: ModalController,
    private router: Router,
    private route: ActivatedRoute,
    private messagingService: MessagingService,
    private animationCtrl: AnimationController,
    private cdr: ChangeDetectorRef,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    // Load view mode from localStorage
    const savedViewMode = localStorage.getItem('tutorSearchViewMode');
    if (savedViewMode) {
      this.viewMode = savedViewMode as 'grid' | 'list';
    } else {
      this.viewMode = 'list';
    }
    
    // Load saved filters first
    this.loadSavedFilters();
    
    // Load watched videos from localStorage
    this.loadWatchedVideos();
    
    // Set up debounced search to prevent flashing
    this.searchSubject$.pipe(
      debounceTime(300), // Wait 300ms after the last change
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.performSearch();
    });
    
    // Listen for router events to detect navigation
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: any) => {
      console.log('🔄 Navigation event detected:', event.url);
      if (event.url.includes('/tabs/tutor-search')) {
        console.log('🎯 Navigated to tutor-search, checking localStorage');

        // Handle forced refresh after a cancelled quick session
        const forceRefresh = localStorage.getItem('forceRefreshTutors');
        if (forceRefresh === 'true') {
          console.log('🔄 Force refresh (router event) - reloading tutors with fresh data');
          localStorage.removeItem('forceRefreshTutors');

          // Clear cache so we always hit backend
          this.isReturningFromProfile = false;
          this.hasLoadedOnce = false;
          this.tutors = [];

          // Small delay to let backend finish any profile updates
          setTimeout(() => {
            console.log('✅ Triggering fresh search after office hours update (router event)');
            this.getCurrentUser();
          }, 500);
          return;
        }

        // Normal return-navigation handling (scroll/highlight)
        setTimeout(() => {
          this.checkForReturnNavigation();
        }, 200);
      }
    });
    
    // Also check immediately on init in case we're already on the page
    setTimeout(() => {
      console.log('🚀 Initial check for return navigation on init');
      this.checkForReturnNavigation();
    }, 300);
  }
  
  ionViewWillEnter() {
    console.log('🔍 ionViewWillEnter - Checking for return navigation');
    
    // Check if we need to force refresh (e.g., after lesson cancellation)
    const forceRefresh = localStorage.getItem('forceRefreshTutors');
    if (forceRefresh === 'true') {
      console.log('🔄 Force refresh requested - reloading tutors with fresh data');
      localStorage.removeItem('forceRefreshTutors');
      
      // Clear the cache and reload
      this.isReturningFromProfile = false;
      this.hasLoadedOnce = false;
      this.tutors = []; // Clear existing tutors to show fresh data
      
      // Add a delay to ensure backend has fully updated office hours status
      console.log('⏳ Waiting 1500ms for backend to sync office hours status...');
      setTimeout(() => {
        console.log('✅ Triggering fresh search after office hours update');
        this.getCurrentUser();
      }, 1500);
      return;
    }
    
    const handledReturn = this.checkForReturnNavigation();
    
    // If we handled a return navigation with existing tutors, stop here
    if (handledReturn) {
      console.log('✅ Return navigation handled, skipping normal load');
      return;
    }
    
    // Only load tutors on first view entry
    if (!this.hasLoadedOnce) {
      console.log('📥 Loading tutors for first time in ionViewWillEnter');
      this.getCurrentUser();
      this.hasLoadedOnce = true;
    }
  }
  
  ionViewDidEnter() {
    console.log('🔍 ionViewDidEnter - Double checking return navigation');
    const handledReturn = this.checkForReturnNavigation();
    
    // If we handled a return navigation with existing tutors, stop here
    if (handledReturn) {
      console.log('✅ Return navigation handled in didEnter, skipping normal load');
      return;
    }
  }
  
  private checkForReturnNavigation() {
    // Check localStorage for returnToTutorId
    const returnToTutorId = localStorage.getItem('returnToTutorId');
    
    console.log('🔍 localStorage returnToTutorId:', returnToTutorId);
    console.log('🔍 Current URL:', this.router.url);
    console.log('🔍 Existing tutors count:', this.tutors.length);
    console.log('🔍 hasLoadedOnce:', this.hasLoadedOnce);
    
    if (returnToTutorId) {
      console.log('🔙 FOUND returnToTutorId in localStorage:', returnToTutorId);
      
      // Set flag to prevent card animations when returning
      this.isReturningFromProfile = true;
      console.log('🚩 Set isReturningFromProfile to TRUE');
      
      // Clear from localStorage immediately
      localStorage.removeItem('returnToTutorId');
      
      // Set up scroll target
      this.scrollToTutorId = returnToTutorId;
      this.hasScrolledToTutor = false;
      
      // If tutors are already loaded, scroll immediately and DO NOT reload
      if (this.tutors.length > 0) {
        console.log('✅ Tutors already loaded, scrolling immediately WITHOUT reloading');
        setTimeout(() => {
          this.scrollToTutorCard(returnToTutorId);
          setTimeout(() => {
            this.highlightTutorCard(returnToTutorId);
            // Don't clear isReturningFromProfile flag - it will be cleared when user interacts with filters
          }, 500);
        }, 100);
        
        // CRITICAL: Return early to prevent any reload
        return true; // Signal that we handled return navigation
      } else {
        console.log('⏳ Tutors not loaded yet, will scroll after they load');
        // Wait for tutors to load, then scroll
        const checkInterval = setInterval(() => {
          if (this.tutors.length > 0) {
            console.log('✅ Tutors loaded! Now scrolling...');
            clearInterval(checkInterval);
            setTimeout(() => {
              this.scrollToTutorCard(returnToTutorId);
              setTimeout(() => {
                this.highlightTutorCard(returnToTutorId);
                // Don't clear isReturningFromProfile flag - it will be cleared when user interacts with filters
              }, 500);
            }, 100);
          }
        }, 100);
        
        // Stop checking after 5 seconds - don't clear flag, let it persist
        setTimeout(() => {
          clearInterval(checkInterval);
        }, 5000);
      }
    }
    
    console.log('🔍 No return navigation detected');
    return false; // Signal that we didn't handle return navigation
  }
  
  private loadSavedFilters() {
    try {
      const savedFilters = localStorage.getItem(this.FILTER_STORAGE_KEY);
      if (savedFilters) {
        const parsed = JSON.parse(savedFilters);
        
        // For fairness, always use random sorting by default
        // Users can still manually change to other sort options
        if (!parsed.sortBy || parsed.sortBy === 'rating') {
          parsed.sortBy = 'random';
        }
        
        // Restore filters while preserving defaults for missing fields
        this.filters = {
          ...this.filters,
          ...parsed,
          page: 1, // Always reset page to 1
          limit: this.filters.limit // Preserve limit
        };
        
        // Restore price range if it exists
        if (parsed.priceMin !== undefined && parsed.priceMax !== undefined) {
          this.priceRange = {
            lower: parsed.priceMin,
            upper: parsed.priceMax
          };
        }
      }
    } catch (error) {
      console.warn('Failed to load saved filters:', error);
    }
  }
  
  private saveFilters() {
    try {
      // Don't save page in localStorage as we always want to start at page 1
      const filtersToSave = {
        ...this.filters,
        page: 1
      };
      localStorage.setItem(this.FILTER_STORAGE_KEY, JSON.stringify(filtersToSave));
    } catch (error) {
      console.warn('Failed to save filters:', error);
    }
  }

  ngAfterViewChecked() {
    // Scroll to the specified tutor card if we haven't already
    if (this.scrollToTutorId && !this.hasScrolledToTutor && !this.isLoading && this.tutors.length > 0) {
      console.log('🎯 ngAfterViewChecked - Ready to scroll to:', this.scrollToTutorId);
      // Use requestAnimationFrame for immediate execution after DOM update
      requestAnimationFrame(() => {
        this.scrollToTutorCard(this.scrollToTutorId!);
        this.hasScrolledToTutor = true;
        
        // Highlight the tutor card briefly after a small delay
        setTimeout(() => {
          this.highlightTutorCard(this.scrollToTutorId!);
        }, 300);
      });
    }
  }
  
  private scrollToTutorCard(tutorId: string) {
    console.log('📜 Scrolling to tutor card:', tutorId);
    // Find the tutor card element
    const tutorCard = document.querySelector(`[data-tutor-id="${tutorId}"]`) as HTMLElement;
    console.log('📜 Found tutor card element:', tutorCard);
    
    if (tutorCard) {
      tutorCard.scrollIntoView({ 
        behavior: 'smooth', // Smooth scroll animation
        block: 'center',
        inline: 'nearest'
      });
      console.log('✅ Scrolled to tutor card:', tutorId);
    } else {
      console.warn('⚠️ Tutor card not found:', tutorId);
      console.warn('Available tutor IDs:', this.tutors.map(t => t.id));
    }
  }
  
  private highlightTutorCard(tutorId: string) {
    console.log('✨ Highlighting tutor card:', tutorId);
    
    // Set the highlighted tutor ID - this will add the CSS class via [class.highlighted]
    this.highlightedTutorId = tutorId;
    this.cdr.detectChanges(); // Manually trigger change detection
    console.log('✅ Set highlightedTutorId to:', tutorId);
    
    // Remove highlight after animation completes (brief 800ms highlight)
    setTimeout(() => {
      this.highlightedTutorId = null;
      console.log('✅ Removed highlight from card');
      // Use markForCheck instead of detectChanges to avoid re-rendering everything
      this.cdr.markForCheck();
    }, 800);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.searchSubject$.complete();
  }

  getCurrentUser() {
    this.userService.getCurrentUser()
    .pipe(takeUntil(this.destroy$))
    .subscribe(user => {
      console.log('TutorSearchContent: Database user data:', user);
      console.log('TutorSearchContent: User type:', user?.userType);
      this.currentUser = user;
      
      // Redirect tutors away from this page
      if (user?.userType === 'tutor') {
        console.log('TutorSearchContent: Tutor detected, redirecting to calendar');
        // Redirect tutors to their calendar instead
        window.location.href = '/tabs/tutor-calendar';
        return;
      }
      
      this.getPreferredLanguage();
      console.log('Current user:', this.currentUser);
      console.log('Preferred language set to:', this.filters.language);
      // Now search tutors with the correct language
      this.searchTutors();
    });
  }

  getPreferredLanguage() {
    // Only set preferred language if no saved filters exist
    const savedFilters = localStorage.getItem(this.FILTER_STORAGE_KEY);
    if (savedFilters) {
      // Filters already loaded from localStorage, don't override
      return;
    }
    
    if (this.currentUser) {
      const preferredLang = this.currentUser.onboardingData?.languages[0] || 'Spanish';
      console.log('Setting preferred language from user data:', preferredLang);
      console.log('User languages array:', this.currentUser.onboardingData?.languages);
      this.filters.language = preferredLang;
      this.saveFilters(); // Save the initial preferred language
    } else {
      console.log('No current user found, using default language: Spanish');
      this.saveFilters(); // Save the default
    }
  }
  
  searchTutors() {
    // Trigger debounced search
    this.searchSubject$.next();
  }

  private performSearch() {
    const hasExistingContent = this.tutors.length > 0 || (!this.isLoading && this.tutors.length === 0);
    const isFirstLoad = this.isLoading && this.tutors.length === 0;
    
    // CRITICAL: Don't search if we're returning from a profile
    if (this.isReturningFromProfile) {
      console.log('🚫 BLOCKED search - returning from profile, keeping existing tutors');
      return;
    }
    
    if (hasExistingContent && !isFirstLoad) {
      // If we have existing content (tutors OR empty state), use smooth transition
      this.isTransitioning = true;
    } else {
      // First load only
      this.isLoading = true;
    }
    
    // Reset scroll flag when performing a new search
    this.hasScrolledToTutor = false;
    
    console.log('🔍 Searching tutors with filters:', this.filters);
    
    const lastCancelledTutorId = localStorage.getItem('lastCancelledTutorId');
    this.userService.searchTutors(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('🔍 Tutor search successful:', response);
          console.log('🔍 Total tutors returned:', response.tutors.length);
          
          // Log office hours status for tutors and apply client-side guard
          response.tutors = response.tutors.map((tutor, index) => {
            const isCancelledTutor = lastCancelledTutorId && String(tutor.id) === String(lastCancelledTutorId);
            const effectiveIsActivelyAvailable = tutor.isActivelyAvailable && !isCancelledTutor;
            
            if (index < 5 && (tutor.isActivelyAvailable || tutor.profile?.officeHoursEnabled || isCancelledTutor)) {
              console.log(`🔍 Tutor ${index}: ${tutor.name}`, {
                originalIsActivelyAvailable: tutor.isActivelyAvailable,
                officeHoursEnabled: tutor.profile?.officeHoursEnabled,
                isCancelledTutor,
                effectiveIsActivelyAvailable
              });
            }
            
            return {
              ...tutor,
              isActivelyAvailable: effectiveIsActivelyAvailable
            } as Tutor;
          });

          // Clear the cancelled tutor guard after one refresh
          if (lastCancelledTutorId) {
            localStorage.removeItem('lastCancelledTutorId');
          }
          
          console.log('🔍 First tutor video data:', response.tutors[0] ? {
            name: response.tutors[0].name,
            hasVideo: !!response.tutors[0].introductionVideo,
            videoUrl: response.tutors[0].introductionVideo,
            hasThumbnail: !!response.tutors[0].videoThumbnail,
            thumbnailUrl: response.tutors[0].videoThumbnail,
            videoType: response.tutors[0].videoType
          } : 'No tutors');
          
          this.searchResponse = response;
          
          if (hasExistingContent && !isFirstLoad) {
            // Smooth transition: fade out old, fade in new
            setTimeout(() => {
              this.tutors = response.tutors;
              this.isLoading = false;
              setTimeout(() => {
                this.isTransitioning = false;
              }, 50);
            }, 250); // Brief delay for fade-out (increased for empty state transition)
          } else {
            // Direct update for first load
            this.tutors = response.tutors;
            this.isLoading = false;
          }
          
          // If no tutors found and user has a specific language preference, suggest alternatives
          if (response.tutors.length === 0 && this.filters.language !== 'any' && this.currentUser?.onboardingData?.languages?.[0]) {
            console.log('No tutors found for preferred language, consider showing all tutors');
          }
        },
        error: (error) => {
          console.error('🔍 Error searching tutors:', error);
          this.isLoading = false;
          this.isTransitioning = false;
          // Handle error - maybe show a toast or alert
        }
      });
  }

  openFiltersView() {
    this.showFiltersView = true;
  }

  closeFilters() {
    this.showFiltersView = false;
  }

  applyFilters() {
    console.log('🔍 Applying filters:', this.filters);
    this.showFiltersView = false;
    this.filters.page = 1; // Reset to first page when applying new filters
    
    // Clear scroll target when user applies filters
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
    // Clear the returning from profile flag since user is now actively filtering
    this.isReturningFromProfile = false;
    
    this.saveFilters(); // Save filters when applied
    this.searchTutors();
  }

  clearFilters() {
    this.filters = {
      language: 'any',
      priceMin: 6,
      priceMax: 200,
      country: 'any',
      availability: 'anytime',
      specialties: [],
      gender: 'any',
      nativeSpeaker: false,
      sortBy: 'random', // Random order for fairness
      page: 1,
      limit: 20
    };
    this.priceRange = {
      lower: 6,
      upper: 200
    };
    // Clear scroll target when filters are cleared
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
    // Clear the returning from profile flag since user is now actively filtering
    this.isReturningFromProfile = false;
    
    this.saveFilters(); // Save cleared filters
    this.searchTutors();
  }

  toggleLanguageDropdown() {
    console.log('Toggle language dropdown', this.showLanguageDropdown);
    this.showLanguageDropdown = !this.showLanguageDropdown;
  }

  toggleSecondaryFilters() {
    this.showSecondaryFilters = !this.showSecondaryFilters;
  }

  getActiveFilterCount(): number {
    let count = 0;
    
    // Count language if not 'any' (even if 'Spanish' is default, we still count it)
    if (this.filters.language && this.filters.language !== 'any') {
      count++;
    }
    
    // Count price if not default range
    if (this.filters.priceMin !== 6 || this.filters.priceMax !== 200) {
      count++;
    }
    
    // Count country if not 'any'
    if (this.filters.country && this.filters.country !== 'any') {
      count++;
    }
    
    // Count availability if not 'anytime'
    if (this.filters.availability && this.filters.availability !== 'anytime') {
      count++;
    }
    
    // Count specialties if any selected
    if (this.filters.specialties && this.filters.specialties.length > 0) {
      count++;
    }
    
    // Count gender if not 'any'
    if (this.filters.gender && this.filters.gender !== 'any') {
      count++;
    }
    
    // Count native speaker if true
    if (this.filters.nativeSpeaker === true) {
      count++;
    }
    
    return count;
  }

  selectLanguage(language: string) {
    this.filters.language = language;
    this.showLanguageDropdown = false;
    
    // Clear scroll target when user manually changes language filter
    // This prevents unwanted scrolling when changing filters
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
    // Clear the returning from profile flag since user is now actively filtering
    this.isReturningFromProfile = false;
    
    this.saveFilters(); // Save language change
    this.searchSubject$.next();
  }

  updateLanguage(language: string) {
    this.filters.language = language;
    
    // Clear scroll target when user manually changes language filter
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
    this.saveFilters(); // Save language change
    this.searchSubject$.next();
  }

  getCurrentLanguageLabel(): string {
    const currentLang = this.availableLanguages.find(lang => lang.value === this.filters.language);
    return currentLang ? currentLang.label : 'Any language';
  }

  getTutorImageSrc(tutor: Tutor): string {
    if (tutor.picture) {
      return tutor.picture;
    }
    
    // Generate a data URL SVG with the tutor's initial
    const initial = tutor.name.charAt(0).toUpperCase();
    const svg = `
      <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="30" cy="30" r="30" fill="#cccccc"/>
        <text x="30" y="38" text-anchor="middle" fill="#666666" font-family="Arial" font-size="24" font-weight="bold">${initial}</text>
      </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    // Close language dropdown when clicking outside
    if (this.showLanguageDropdown) {
      this.showLanguageDropdown = false;
    }
  }

  updatePriceRange(min: number, max: number) {
    this.filters.priceMin = min;
    this.filters.priceMax = max;
    this.searchTutors();
  }

  onPriceRangeChange(event: any) {
    const value = event.detail.value;
    this.priceRange = {
      lower: value.lower,
      upper: value.upper
    };
    this.filters.priceMin = value.lower;
    this.filters.priceMax = value.upper;
    
    // Clear scroll target when user changes price range
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
    this.saveFilters(); // Save price range change
    // Trigger debounced search
    this.searchSubject$.next();
  }

  updateSortBy(sortBy: string) {
    this.filters.sortBy = sortBy;
    
    // Clear scroll target when user changes sort order
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
    this.saveFilters(); // Save sort order change
    this.searchTutors();
  }

  loadMoreTutors() {
    if (this.searchResponse && this.searchResponse.pagination.hasNext) {
      this.filters.page = (this.filters.page || 1) + 1;
      this.searchTutors();
    }
  }


  trackByTutorId(index: number, tutor: Tutor): string {
    return tutor.id;
  }

  onImageError(event: any) {
    const target = event.target;
    
    // Prevent infinite loop by checking if we're already showing a data URL
    if (target.src.includes('data:image')) {
      return;
    }
    
    // Hide the broken image and show a fallback div
    target.style.display = 'none';
    const parent = target.parentElement;
    const tutorName = target.alt || 'T';
    const initial = tutorName.charAt(0).toUpperCase();
    
    if (parent && !parent.querySelector('.avatar-fallback')) {
      const fallback = document.createElement('div');
      fallback.className = 'avatar-fallback';
      fallback.style.cssText = `
        width: 60px;
        height: 60px;
        background-color: #cccccc;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #666666;
        font-size: 24px;
        font-weight: bold;
      `;
      fallback.textContent = initial;
      parent.appendChild(fallback);
    }
  }

  openPriceFilter() {
    // Open price filter popover for desktop
  }

  openCountryFilter() {
    // Open country filter popover for desktop
  }

  openAvailabilityFilter() {
    // Open availability filter popover for desktop
  }

  openSpecialtiesFilter() {
    // Open specialties filter
  }

  openGenderFilter() {
    // Open gender filter
  }

  openAlsoSpeaksFilter() {
    // Open also speaks filter
  }

  openNativeSpeakerFilter() {
    // Open native speaker filter
  }

  openCategoriesFilter() {
    // Open categories filter
  }

  openSortFilter() {
    // Open sort filter
  }

  async messageTutor(tutor: Tutor) {
    if (!tutor) return;
    
    // Get the tutor's auth0Id - it should be in the tutor object
    const tutorId = tutor.auth0Id || tutor.id;
    
    // Navigate to messages page with the tutor's auth0Id as a query param
    await this.router.navigate(['/tabs/messages'], {
      queryParams: { tutorId: tutorId }
    });
  }

  async saveTutor(tutor: Tutor, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!tutor || !this.currentUser) return;
    
    // Check if user is a student
    if (this.currentUser.userType !== 'student') {
      console.log('Only students can save tutors');
      return;
    }
    
    // Get the tutor's auth0Id
    const tutorId = tutor.auth0Id || tutor.id;
    
    console.log('🔍 Tutor object:', { 
      tutorId, 
      auth0Id: tutor.auth0Id, 
      id: tutor.id,
      name: tutor.name,
      fullTutor: tutor 
    });
    
    try {
      // Create potential student conversation
      const response = await this.messagingService.createPotentialStudent(tutorId, 'favorite').pipe(takeUntil(this.destroy$)).toPromise();
      
      if (response?.success) {
        console.log('Potential student conversation created:', response.conversationId);
        // Optionally show a toast or update UI
      } else {
        console.error('Failed to create potential student conversation');
      }
    } catch (error) {
      console.error('Error creating potential student conversation:', error);
    }
  }

  async bookLesson(tutor: Tutor, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!tutor || !this.currentUser) return;
    
    // Check if user is a student
    if (this.currentUser.userType !== 'student') {
      console.log('Only students can book lessons');
      return;
    }
    
    // Get the tutor's auth0Id
    const tutorId = tutor.auth0Id || tutor.id;
    
    console.log('🔍 Tutor object (book lesson):', { 
      tutorId, 
      auth0Id: tutor.auth0Id, 
      id: tutor.id,
      name: tutor.name,
      fullTutor: tutor 
    });
    
    try {
      // Create potential student conversation
      const response = await this.messagingService.createPotentialStudent(tutorId, 'book_lesson').pipe(takeUntil(this.destroy$)).toPromise();
      
      if (response?.success) {
        console.log('Potential student conversation created:', response.conversationId);
        // Navigate to checkout or booking page
        // For now, we'll just create the conversation
        // TODO: Navigate to booking/checkout page
      } else {
        console.error('Failed to create potential student conversation');
      }
    } catch (error) {
      console.error('Error creating potential student conversation:', error);
    }
  }

  /**
   * Book a quick office hours session with a tutor (from search results)
   */
  async bookOfficeHours(tutor: Tutor, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    if (!tutor || !this.currentUser) {
      console.log('❌ Cannot book office hours: missing tutor or currentUser');
      return;
    }

    // Only students can book office hours
    if (this.currentUser.userType !== 'student') {
      console.log('Only students can book office hours');
      return;
    }

    try {
      console.log('⚡ Checking tutor availability before opening modal...', {
        id: tutor.id,
        auth0Id: tutor.auth0Id,
        name: tutor.name
      });

      // Verify tutor is still available for office hours with a fresh API call
      const tutorProfileResponse = await this.userService.getTutorPublic(tutor.id).pipe(takeUntil(this.destroy$)).toPromise();
      
      if (!tutorProfileResponse?.success || !tutorProfileResponse?.tutor?.profile?.officeHoursEnabled) {
        console.log('❌ Tutor no longer available for office hours');
        
        // Show alert to user
        const alert = await this.alertController.create({
          header: 'Tutor Unavailable',
          message: `${tutor.name} is no longer available for quick sessions. Please try booking a scheduled lesson instead or find another tutor.`,
          buttons: ['OK']
        });
        await alert.present();
        
        // Refresh the tutor list to show updated availability
        this.performSearch();
        return;
      }

      console.log('✅ Tutor is available for office hours, opening modal...');

      // Dynamically import the office hours booking modal
      const { OfficeHoursBookingComponent } = await import('../modals/office-hours-booking/office-hours-booking.component');

      const modal = await this.modalController.create({
        component: OfficeHoursBookingComponent,
        componentProps: {
          tutorId: tutor.id,
          tutorName: tutor.name,
          tutorPicture: (tutor as any).picture,
          hourlyRate: (tutor as any).hourlyRate
        }
      });

      await modal.present();

      const { data } = await modal.onWillDismiss();
      if (data?.success) {
        console.log('⚡ Office hours booked successfully from search:', data.lesson);
      }
    } catch (error) {
      console.error('❌ Error booking office hours from search:', error);
    }
  }

  async navigateToTutorProfile(tutorId: string) {
    // Check if we're inside a modal (from tab1 search bar on mobile)
    const topModal = await this.modalController.getTop();
    const isInModal = !!topModal;
    
    if (isInModal) {
      // Store scroll position before dismissing
      const scrollPosition = window.scrollY || document.documentElement.scrollTop;
      
      // Dismiss modal and pass data to indicate we came from modal, including scroll position
      await this.modalController.dismiss({ 
        navigateToProfile: true, 
        tutorId,
        scrollPosition 
      }, 'navigate');
    }
    
    // Navigate to tutor profile page
    // Only add fromModal query param if we're actually in a modal
    const queryParams = isInModal ? { fromModal: 'true', tutorId } : {};
    this.router.navigate(['/tutor', tutorId], {
      queryParams: queryParams
    });
  }

  async viewAvailability(tutor: Tutor) {
    const modal = await this.modalController.create({
      component: TutorAvailabilityViewerComponent,
      componentProps: {
        tutorId: tutor.id,
        tutorName: tutor.name
      },
      cssClass: 'tutor-availability-modal'
    });
    
    return await modal.present();
  }

  playIntroVideo(videoEl: HTMLVideoElement) {
    if (!videoEl) return;
    // reveal native controls, start playback
    videoEl.controls = true;
    videoEl.play();
    // hide overlay button by adding a class on its container
    const container = videoEl.parentElement as HTMLElement | null;
    if (container) {
      const btn = container.querySelector('.floating-play') as HTMLElement | null;
      if (btn) btn.style.display = 'none';
    }
    // when paused/ended, show overlay again
    const showOverlay = () => {
      const btn = videoEl.parentElement?.querySelector('.floating-play') as HTMLElement | null;
      if (btn) btn.style.display = '';
    };
    videoEl.addEventListener('pause', showOverlay, { once: true });
    videoEl.addEventListener('ended', showOverlay, { once: true });
  }

  // Track which tutor videos are currently playing
  private playingVideos = new Set<string>();

  isExternalVideo(url: string): boolean {
    if (!url) return false;
    return url.includes('youtube.com') || url.includes('youtu.be') || 
           url.includes('vimeo.com');
  }

  isTutorVideoPlaying(tutorId: string): boolean {
    return this.playingVideos.has(tutorId);
  }

  // Open video modal with zoom animation (inline modal)
  openVideoModal(tutor: Tutor, circleBounds?: { x: number; y: number; width: number; height: number }) {
    if (!tutor || !tutor.introductionVideo) return;
    
    this.currentVideoTutor = tutor;
    this.videoModalCircleBounds = circleBounds || null;
    this.isVideoModalOpen = true;
    this.markVideoAsWatched(tutor.id);
  }

  // Close video modal
  closeVideoModal() {
    this.isVideoModalOpen = false;
    // Clear tutor and bounds after animation completes
    setTimeout(() => {
      this.currentVideoTutor = null;
      this.videoModalCircleBounds = null;
    }, 300);
  }

  // Handle video modal dismissed event
  onVideoModalDismiss() {
    this.closeVideoModal();
  }

  // Animation factory for zoom enter (bound to inline modal)
  createVideoModalEnterAnimation = (baseEl: any) => {
    if (!this.videoModalCircleBounds) {
      // No animation, just fade in
      return this.animationCtrl.create()
        .addElement(baseEl)
        .duration(200)
        .fromTo('opacity', '0', '1');
    }
    
    return this.createZoomEnterAnimation(baseEl, this.videoModalCircleBounds);
  }

  // Animation factory for zoom leave (bound to inline modal)
  createVideoModalLeaveAnimation = (baseEl: any) => {
    if (!this.videoModalCircleBounds) {
      // No animation, just fade out
      return this.animationCtrl.create()
        .addElement(baseEl)
        .duration(200)
        .fromTo('opacity', '1', '0');
    }
    
    return this.createZoomLeaveAnimation(baseEl, this.videoModalCircleBounds);
  }
  
  // Get embed URL with autoplay for external videos
  getVideoEmbedUrl(videoUrl: string): string {
    if (!videoUrl) return '';
    // Add autoplay parameter to external videos
    const separator = videoUrl.includes('?') ? '&' : '?';
    return `${videoUrl}${separator}autoplay=1`;
  }

  private createZoomEnterAnimation(baseEl: any, circleBounds: { x: number; y: number; width: number; height: number }) {
    const backdropAnimation = this.animationCtrl.create()
      .addElement(baseEl.querySelector('ion-backdrop')!)
      .fromTo('opacity', '0', '0.4')
      .duration(200);

    const root = baseEl.shadowRoot || baseEl;
    const modalWrapper = root.querySelector('.modal-wrapper') as HTMLElement;
    
    if (!modalWrapper) {
      console.warn('Modal wrapper not found');
      return this.animationCtrl.create();
    }

    const forcedLayout = modalWrapper.offsetHeight;
    const modalRect = modalWrapper.getBoundingClientRect();
    
    let modalCenterX: number;
    let modalCenterY: number;
    
    if (Math.abs(modalRect.top) > 10) {
      modalCenterX = window.innerWidth / 2;
      modalCenterY = window.innerHeight / 2;
    } else {
      modalCenterX = modalRect.left + modalRect.width / 2;
      modalCenterY = modalRect.top + modalRect.height / 2;
    }
    
    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;
    
    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    
    const adjustedCircleCenterY = circleCenterY + safeAreaTop;
    
    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;
    
    let extraOffset = 0;
    if (window.navigator.userAgent.includes('iPhone')) {
      extraOffset = 10;
    }
    
    const adjustedTranslateY = translateY - extraOffset;
    
    const scaleX = circleBounds.width / modalRect.width;
    const scaleY = circleBounds.height / modalRect.height;
    const finalScale = Math.min(scaleX, scaleY);

    const wrapperAnimation = this.animationCtrl.create()
      .addElement(modalWrapper)
      .duration(250)
      .easing('ease-in-out')
      .fromTo('transform', 
        `translate(${translateX}px, ${adjustedTranslateY}px) scale(${finalScale})`, 
        'translate(0px, 0px) scale(1)')
      .fromTo('opacity', '0.3', '1');

    return this.animationCtrl.create()
      .addAnimation([backdropAnimation, wrapperAnimation]);
  }

  private createZoomLeaveAnimation(baseEl: any, circleBounds: { x: number; y: number; width: number; height: number }) {
    const backdropAnimation = this.animationCtrl.create()
      .addElement(baseEl.querySelector('ion-backdrop')!)
      .fromTo('opacity', '0.4', '0')
      .duration(250);

    const root = baseEl.shadowRoot || baseEl;
    const modalWrapper = root.querySelector('.modal-wrapper') as HTMLElement;
    
    if (!modalWrapper) {
      console.warn('Modal wrapper not found');
      return this.animationCtrl.create();
    }

    const modalRect = modalWrapper.getBoundingClientRect();
    
    let modalCenterX: number;
    let modalCenterY: number;
    
    if (Math.abs(modalRect.top) > 10) {
      modalCenterX = window.innerWidth / 2;
      modalCenterY = window.innerHeight / 2;
    } else {
      modalCenterX = modalRect.left + modalRect.width / 2;
      modalCenterY = modalRect.top + modalRect.height / 2;
    }
    
    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;
    
    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    
    const adjustedCircleCenterY = circleCenterY + safeAreaTop;
    
    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;
    
    let extraOffset = 0;
    if (window.navigator.userAgent.includes('iPhone')) {
      extraOffset = 10;
    }
    
    const adjustedTranslateY = translateY - extraOffset;
    
    const scaleX = circleBounds.width / modalRect.width;
    const scaleY = circleBounds.height / modalRect.height;
    const finalScale = Math.min(scaleX, scaleY);

    const wrapperAnimation = this.animationCtrl.create()
      .addElement(modalWrapper)
      .duration(300)
      .easing('ease-in-out')
      .fromTo('transform', 
        'translate(0px, 0px) scale(1)',
        `translate(${translateX}px, ${adjustedTranslateY}px) scale(${finalScale})`)
      .fromTo('opacity', '1', '0.3');

    return this.animationCtrl.create()
      .addAnimation([backdropAnimation, wrapperAnimation]);
  }

  playTutorVideo(tutor: Tutor) {
    if (!tutor || !tutor.introductionVideo) return;
    
    // Mark this tutor's video as playing
    this.playingVideos.add(tutor.id);
    
    // For HTML5 videos, programmatically start playback after view updates
    if (!this.isExternalVideo(tutor.introductionVideo)) {
      setTimeout(() => {
        const videoElement = document.getElementById('tutor-video-' + tutor.id) as HTMLVideoElement;
        if (videoElement) {
          videoElement.play().catch(err => {
            console.error('Error playing video:', err);
          });
        }
      }, 100);
    }
  }

  getTutorVideoUrl(tutor: Tutor): string {
    if (!tutor.introductionVideo) return '';
    
    // If video is already playing, add autoplay parameter
    if (this.isTutorVideoPlaying(tutor.id)) {
      const separator = tutor.introductionVideo.includes('?') ? '&' : '?';
      return tutor.introductionVideo + separator + 'autoplay=1';
    }
    
    return tutor.introductionVideo;
  }

  // Format name as "FirstName LastInitial."
  formatDisplayName(firstName?: string, lastName?: string, fullName?: string): string {
    // If we have firstName and lastName, use them
    if (firstName && lastName) {
      const lastInitial = lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    // Fallback: try to parse from fullName
    if (fullName) {
      const parts = fullName.trim().split(' ');
      if (parts.length >= 2) {
        const first = parts[0];
        const last = parts[parts.length - 1];
        const lastInitial = last.charAt(0).toUpperCase();
        return `${first} ${lastInitial}.`;
      }
      // If only one name, return as is
      return fullName;
    }
    
    return '';
  }

  // Toggle view mode
  toggleViewMode(mode: 'grid' | 'list') {
    this.viewMode = mode;
    localStorage.setItem('tutorSearchViewMode', mode);
  }

  // Open tutor profile (new tab on desktop, same page on mobile)
  openTutorProfile(tutor: Tutor, event: Event) {
    event.stopPropagation();
    const url = `/tutor/${tutor.id}`;
    const isMobile = window.innerWidth <= 768;
    
    console.log('🔗 openTutorProfile called for tutor:', tutor.id, 'isMobile:', isMobile);
    
    if (isMobile) {
      // Store tutor ID in localStorage for return navigation
      localStorage.setItem('returnToTutorId', tutor.id);
      console.log('💾 Saved returnToTutorId to localStorage:', tutor.id);
      
      // Verify it was saved
      const saved = localStorage.getItem('returnToTutorId');
      console.log('✅ Verified localStorage value:', saved);
      
      // Navigate to tutor profile
      this.router.navigate([url]);
    } else {
      // Open in new tab on desktop
      window.open(url, '_blank');
    }
  }

  // Handle avatar click - open video if available (mobile only)
  onAvatarClick(tutor: Tutor, event: Event) {
    // Only open video on mobile (screen width <= 768px)
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile && (tutor.videoThumbnail || tutor.introductionVideo)) {
      event.stopPropagation();
      
      // Get element bounds for animation origin
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ion-safe-area-top')) || 0;
      
      const circleBounds = {
        x: rect.left,
        y: rect.top - safeTop,
        width: rect.width,
        height: rect.height
      };
      
      this.openVideoModal(tutor, circleBounds);
    }
  }

  // Handle video thumbnail click in list view
  onVideoThumbnailClick(tutor: Tutor, event: Event) {
    event.stopPropagation();
    
    // Get element bounds for animation origin
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ion-safe-area-top')) || 0;
    
    const circleBounds = {
      x: rect.left,
      y: rect.top - safeTop,
      width: rect.width,
      height: rect.height
    };
    
    this.openVideoModal(tutor, circleBounds);
  }

  // Load watched videos from localStorage
  private loadWatchedVideos() {
    try {
      const stored = localStorage.getItem(this.WATCHED_VIDEOS_KEY);
      if (stored) {
        const watchedArray = JSON.parse(stored);
        this.watchedVideos = new Set(watchedArray);
      }
    } catch (error) {
      console.warn('Failed to load watched videos:', error);
      this.watchedVideos = new Set();
    }
  }

  // Check if user has watched a tutor's video
  hasWatchedVideo(tutorId: string): boolean {
    return this.watchedVideos.has(tutorId);
  }

  // Mark a video as watched
  private markVideoAsWatched(tutorId: string) {
    this.watchedVideos.add(tutorId);
    try {
      localStorage.setItem(
        this.WATCHED_VIDEOS_KEY, 
        JSON.stringify(Array.from(this.watchedVideos))
      );
    } catch (error) {
      console.warn('Failed to save watched video:', error);
    }
  }

  // Toggle bio expansion
  toggleBioExpansion(tutorId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (this.expandedBios.has(tutorId)) {
      this.expandedBios.delete(tutorId);
    } else {
      this.expandedBios.add(tutorId);
    }
  }

  // Check if bio is expanded
  isBioExpanded(tutorId: string): boolean {
    return this.expandedBios.has(tutorId);
  }
}