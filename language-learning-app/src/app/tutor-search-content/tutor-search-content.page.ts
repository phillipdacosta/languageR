// tutor-search-content.page.ts
import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { UserService, TutorSearchFilters, Tutor, TutorSearchResponse, User } from '../services/user.service';
import { Subject, timer } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { trigger, state, style, transition, animate, stagger } from '@angular/animations';

@Component({
  selector: 'app-tutor-search-content',
  templateUrl: './tutor-search-content.page.html',
  styleUrls: ['./tutor-search-content.page.scss'],
  standalone: false,
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('300ms ease-in-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-in-out', style({ opacity: 0 }))
      ])
    ]),
    trigger('slideInUp', [
      transition(':enter', [
        style({ 
          opacity: 0, 
          transform: 'translateY(20px)' 
        }),
        animate('400ms ease-out', style({ 
          opacity: 1, 
          transform: 'translateY(0)' 
        }))
      ])
    ])
  ]
})
export class TutorSearchContentPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<void>();
  
  showFiltersView = false;
  showLanguageDropdown = false;
  isLoading = false;
  tutors: Tutor[] = [];
  searchResponse: TutorSearchResponse | null = null;
  currentUser: User | null = null;
  showPriceFilter = false;
  
  filters: TutorSearchFilters = {
    language: 'Spanish',
    priceMin: 0,
    priceMax: 200,
    country: 'any',
    availability: 'anytime',
    specialties: [],
    gender: 'any',
    nativeSpeaker: false,
    sortBy: 'rating',
    page: 1,
    limit: 20
  };

  // Price range for the dual-knob slider
  priceRange = {
    lower: 0,
    upper: 200
  };

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


  constructor(private userService: UserService) {}

  ngOnInit() {
    this.getCurrentUser();
    
    // Set up debounced search to prevent flashing
    this.searchSubject$.pipe(
      debounceTime(300), // Wait 300ms after the last change
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.performSearch();
    });
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
      console.log('Database user data:', user);
      this.currentUser = user;
      this.getPreferredLanguage();
      console.log('Current user:', this.currentUser);
      console.log('Preferred language set to:', this.filters.language);
      // Now search tutors with the correct language
      this.searchTutors();
    });
  }

  getPreferredLanguage() {
    if (this.currentUser) {
      const preferredLang = this.currentUser.onboardingData?.languages[0] || 'Spanish';
      console.log('Setting preferred language from user data:', preferredLang);
      console.log('User languages array:', this.currentUser.onboardingData?.languages);
      this.filters.language = preferredLang;
    } else {
      console.log('No current user found, using default language: Spanish');
    }
  }
  
  searchTutors() {
    // Trigger debounced search
    this.searchSubject$.next();
  }

  private performSearch() {
    // Only show loading spinner if we have no tutors yet
    if (this.tutors.length === 0) {
      this.isLoading = true;
    }
    
    console.log('🔍 Searching tutors with filters:', this.filters);
    
    this.userService.searchTutors(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('🔍 Tutor search successful:', response);
          this.searchResponse = response;
          this.tutors = response.tutors;
          this.isLoading = false;
          
          // If no tutors found and user has a specific language preference, suggest alternatives
          if (response.tutors.length === 0 && this.filters.language !== 'any' && this.currentUser?.onboardingData?.languages?.[0]) {
            console.log('No tutors found for preferred language, consider showing all tutors');
          }
        },
        error: (error) => {
          console.error('🔍 Error searching tutors:', error);
          this.isLoading = false;
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
      sortBy: 'rating',
      page: 1,
      limit: 20
    };
    this.priceRange = {
      lower: 0,
      upper: 200
    };
    this.searchTutors();
  }

  toggleLanguageDropdown() {
    this.showLanguageDropdown = !this.showLanguageDropdown;
  }

  selectLanguage(language: string) {
    this.filters.language = language;
    this.showLanguageDropdown = false;
    this.searchSubject$.next();
  }

  updateLanguage(language: string) {
    this.filters.language = language;
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
    const target = event.target as HTMLElement;
    const languageFilter = target.closest('.language-filter');
    
    if (!languageFilter && this.showLanguageDropdown) {
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
    // Trigger debounced search
    this.searchSubject$.next();
  }

  updateSortBy(sortBy: string) {
    this.filters.sortBy = sortBy;
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
}