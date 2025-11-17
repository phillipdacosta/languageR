// tutor-search-content.page.ts
import { Component, OnInit, OnDestroy, HostListener, Input, AfterViewChecked } from '@angular/core';
import { UserService, TutorSearchFilters, Tutor, TutorSearchResponse, User } from '../services/user.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { trigger, state, style, transition, animate, stagger } from '@angular/animations';
import { ModalController, ViewWillEnter, AnimationController } from '@ionic/angular';
import { Router } from '@angular/router';
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
  tutors: Tutor[] = [];
  searchResponse: TutorSearchResponse | null = null;
  currentUser: User | null = null;
  showPriceFilter = false;
  viewMode: 'grid' | 'list' = 'list'; // View toggle - default to list
  
  filters: TutorSearchFilters = {
    language: 'Spanish',
    priceMin: 0,
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
    lower: 0,
    upper: 200
  };
  
  private readonly FILTER_STORAGE_KEY = 'tutor_search_filters';
  private readonly WATCHED_VIDEOS_KEY = 'watched_tutor_videos';
  private watchedVideos: Set<string> = new Set();

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
    private messagingService: MessagingService,
    private animationCtrl: AnimationController
  ) {}

  ngOnInit() {
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
  }
  
  ionViewWillEnter() {
    // Load tutors every time the view is entered
    console.log('TutorSearchContent: ionViewWillEnter - loading tutors');
    this.getCurrentUser();
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
      // Use requestAnimationFrame for immediate execution after DOM update
      requestAnimationFrame(() => {
        this.scrollToTutorCard(this.scrollToTutorId!);
        this.hasScrolledToTutor = true;
      });
    }
  }
  
  private scrollToTutorCard(tutorId: string) {
    // Find the tutor card element
    const tutorCard = document.querySelector(`[data-tutor-id="${tutorId}"]`);
    if (tutorCard) {
      tutorCard.scrollIntoView({ 
        behavior: 'auto', // Instant scroll, no animation
        block: 'center',
        inline: 'nearest'
      });
      console.log('✅ Scrolled to tutor card:', tutorId);
    } else {
      console.warn('⚠️ Tutor card not found:', tutorId);
    }
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
    
    this.userService.searchTutors(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('🔍 Tutor search successful:', response);
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
    
    this.saveFilters(); // Save filters when applied
    this.searchTutors();
  }

  clearFilters() {
    this.filters = {
      language: 'any',
      priceMin: 0,
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
      lower: 0,
      upper: 200
    };
    // Clear scroll target when filters are cleared
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
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

  selectLanguage(language: string) {
    this.filters.language = language;
    this.showLanguageDropdown = false;
    
    // Clear scroll target when user manually changes language filter
    // This prevents unwanted scrolling when changing filters
    this.scrollToTutorId = undefined;
    this.hasScrolledToTutor = false;
    
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
        border-radius: 50%;
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

  async openVideoModal(tutor: Tutor) {
    if (!tutor || !tutor.introductionVideo) return;
    
    const modal = await this.modalController.create({
      component: VideoPlayerModalComponent,
      componentProps: {
        videoUrl: tutor.introductionVideo,
        thumbnailUrl: tutor.videoThumbnail || '',
        tutorName: this.formatDisplayName(tutor.firstName, tutor.lastName, tutor.name)
      },
      cssClass: 'video-player-modal',
      backdropDismiss: true
    });
    
    await modal.present();
  }

  async openVideoModalWithAnimation(tutor: Tutor, circleBounds: { x: number; y: number; width: number; height: number }) {
    if (!tutor || !tutor.introductionVideo) return;
    
    const modal = await this.modalController.create({
      component: VideoPlayerModalComponent,
      componentProps: {
        videoUrl: tutor.introductionVideo,
        thumbnailUrl: tutor.videoThumbnail || '',
        tutorName: this.formatDisplayName(tutor.firstName, tutor.lastName, tutor.name)
      },
      cssClass: 'video-player-modal',
      backdropDismiss: true,
      enterAnimation: (baseEl: any) => {
        return this.createZoomEnterAnimation(baseEl, circleBounds);
      },
      leaveAnimation: (baseEl: any) => {
        return this.createZoomLeaveAnimation(baseEl, circleBounds);
      }
    });
    
    await modal.present();
  }

  private createZoomEnterAnimation(baseEl: any, circleBounds: { x: number; y: number; width: number; height: number }) {
    const backdropAnimation = this.animationCtrl.create()
      .addElement(baseEl.querySelector('ion-backdrop')!)
      .fromTo('opacity', '0', '0.4')
      .duration(200);

    // Get the modal wrapper element
    const root = baseEl.shadowRoot || baseEl;
    const modalWrapper = root.querySelector('.modal-wrapper') as HTMLElement;
    
    if (!modalWrapper) {
      console.warn('Modal wrapper not found');
      return this.animationCtrl.create();
    }

    // Force layout so measurements are current
    const forcedLayout = modalWrapper.offsetHeight;
    
    // Get the modal's bounding rectangle
    const modalRect = modalWrapper.getBoundingClientRect();
    
    // Compute modal center – if modalRect.top isn't near 0, use window dimensions
    let modalCenterX: number;
    let modalCenterY: number;
    
    if (Math.abs(modalRect.top) > 10) {
      modalCenterX = window.innerWidth / 2;
      modalCenterY = window.innerHeight / 2;
    } else {
      modalCenterX = modalRect.left + modalRect.width / 2;
      modalCenterY = modalRect.top + modalRect.height / 2;
    }
    
    // Compute clicked element (circle) center
    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;
    
    // Adjust for safe area
    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    
    const adjustedCircleCenterY = circleCenterY + safeAreaTop;
    
    // Calculate translation values so that modal center aligns with the circle's center
    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;
    
    // Add extra vertical offset for iOS devices
    let extraOffset = 0;
    if (window.navigator.userAgent.includes('iPhone')) {
      extraOffset = 10;
    }
    
    const adjustedTranslateY = translateY - extraOffset;
    
    // Calculate scale factor
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

    // Get the modal wrapper element
    const root = baseEl.shadowRoot || baseEl;
    const modalWrapper = root.querySelector('.modal-wrapper') as HTMLElement;
    
    if (!modalWrapper) {
      console.warn('Modal wrapper not found');
      return this.animationCtrl.create();
    }

    // Get the modal's bounding rectangle
    const modalRect = modalWrapper.getBoundingClientRect();
    
    // Compute modal center
    let modalCenterX: number;
    let modalCenterY: number;
    
    if (Math.abs(modalRect.top) > 10) {
      modalCenterX = window.innerWidth / 2;
      modalCenterY = window.innerHeight / 2;
    } else {
      modalCenterX = modalRect.left + modalRect.width / 2;
      modalCenterY = modalRect.top + modalRect.height / 2;
    }
    
    // Compute clicked element (circle) center
    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;
    
    // Adjust for safe area
    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    
    const adjustedCircleCenterY = circleCenterY + safeAreaTop;
    
    // Calculate translation values
    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;
    
    // Add extra vertical offset for iOS devices
    let extraOffset = 0;
    if (window.navigator.userAgent.includes('iPhone')) {
      extraOffset = 10;
    }
    
    const adjustedTranslateY = translateY - extraOffset;
    
    // Calculate scale factor
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
  }

  // Open tutor profile (new tab on desktop, same page on mobile)
  openTutorProfile(tutor: Tutor, event: Event) {
    event.stopPropagation();
    const url = `/tutor/${tutor.id}`;
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
      // Navigate in the same window on mobile
      this.router.navigate([url]);
    } else {
      // Open in new tab on desktop
      window.open(url, '_blank');
    }
  }

  // Handle avatar click - open video if available
  onAvatarClick(tutor: Tutor, event: Event) {
    if (tutor.videoThumbnail || tutor.introductionVideo) {
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
      
      this.openVideoModalWithAnimation(tutor, circleBounds);
      this.markVideoAsWatched(tutor.id);
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
    
    this.openVideoModalWithAnimation(tutor, circleBounds);
    this.markVideoAsWatched(tutor.id);
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
}