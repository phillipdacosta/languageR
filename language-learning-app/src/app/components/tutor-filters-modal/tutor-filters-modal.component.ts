import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { UserService, TutorSearchFilters } from '../../services/user.service';
import { SharedModule } from '../../shared/shared.module';

interface ActiveFilter {
  type: string;
  value: string;
  label: string;
}

interface QuickPick {
  id: string;
  icon: string;
  label: string;
  description: string;
  filter: Partial<TutorSearchFilters>;
}

@Component({
  selector: 'app-tutor-filters-modal',
  templateUrl: './tutor-filters-modal.component.html',
  styleUrls: ['./tutor-filters-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, SharedModule]
})
export class TutorFiltersModalComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private countSubject$ = new Subject<void>();
  
  @Input() initialFilters!: TutorSearchFilters;
  
  filters: TutorSearchFilters = {
    language: 'any',
    priceMin: 0,
    priceMax: 200,
    country: [],
    availability: 'anytime',
    specialties: [],
    gender: 'any',
    nativeSpeaker: false,
    sortBy: 'random',
    page: 1,
    limit: 20
  };
  
  priceRange = { lower: 0, upper: 200 };
  resultCount: number | null = null;
  isLoadingCount = false;
  
  // Expanded sections
  expandedSections: Set<string> = new Set(['language']); // Language expanded by default
  
  // Search terms for filters
  languageSearchTerm = '';
  countrySearchTerm = '';
  
  // Available options
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

  availableCountries = [
    { value: 'any', label: 'Any country' },
    { value: 'United States', label: 'United States' },
    { value: 'United Kingdom', label: 'United Kingdom' },
    { value: 'Spain', label: 'Spain' },
    { value: 'Mexico', label: 'Mexico' },
    { value: 'Argentina', label: 'Argentina' },
    { value: 'Colombia', label: 'Colombia' },
    { value: 'France', label: 'France' },
    { value: 'Germany', label: 'Germany' },
    { value: 'Italy', label: 'Italy' },
    { value: 'Brazil', label: 'Brazil' },
    { value: 'Portugal', label: 'Portugal' },
    { value: 'Canada', label: 'Canada' },
    { value: 'Australia', label: 'Australia' },
    { value: 'Japan', label: 'Japan' },
    { value: 'China', label: 'China' },
    { value: 'South Korea', label: 'South Korea' },
    { value: 'India', label: 'India' },
    { value: 'Russia', label: 'Russia' },
    { value: 'Poland', label: 'Poland' },
    { value: 'Netherlands', label: 'Netherlands' },
    { value: 'Sweden', label: 'Sweden' },
    { value: 'Norway', label: 'Norway' },
    { value: 'Denmark', label: 'Denmark' },
    { value: 'Finland', label: 'Finland' },
    { value: 'Switzerland', label: 'Switzerland' },
    { value: 'Austria', label: 'Austria' },
    { value: 'Belgium', label: 'Belgium' },
    { value: 'Ireland', label: 'Ireland' },
    { value: 'Greece', label: 'Greece' },
    { value: 'Turkey', label: 'Turkey' },
    { value: 'South Africa', label: 'South Africa' },
    { value: 'New Zealand', label: 'New Zealand' },
    { value: 'Jamaica', label: 'Jamaica' },
    { value: 'Trinidad and Tobago', label: 'Trinidad and Tobago' },
    { value: 'Philippines', label: 'Philippines' },
    { value: 'Indonesia', label: 'Indonesia' },
    { value: 'Malaysia', label: 'Malaysia' },
    { value: 'Singapore', label: 'Singapore' },
    { value: 'Thailand', label: 'Thailand' },
    { value: 'Vietnam', label: 'Vietnam' }
  ].sort((a, b) => {
    if (a.value === 'any') return -1;
    if (b.value === 'any') return 1;
    return a.label.localeCompare(b.label);
  });

  availableSpecialties = [
    { value: 'conversation', label: 'Conversation practice', icon: 'chatbubbles-outline' },
    { value: 'business', label: 'Business language', icon: 'briefcase-outline' },
    { value: 'exam', label: 'Exam preparation', icon: 'school-outline' },
    { value: 'grammar', label: 'Grammar focus', icon: 'book-outline' },
    { value: 'pronunciation', label: 'Pronunciation', icon: 'mic-outline' },
    { value: 'kids', label: 'Kids & teens', icon: 'happy-outline' },
    { value: 'travel', label: 'Travel language', icon: 'airplane-outline' },
    { value: 'culture', label: 'Culture & media', icon: 'film-outline' }
  ];

  availableAvailability = [
    { value: 'anytime', label: 'Any time' },
    { value: 'morning', label: 'Morning (6am - 12pm)' },
    { value: 'afternoon', label: 'Afternoon (12pm - 6pm)' },
    { value: 'evening', label: 'Evening (6pm - 12am)' },
    { value: 'night', label: 'Night (12am - 6am)' }
  ];

  quickPicks: QuickPick[] = [
    {
      id: 'native',
      icon: 'person-circle-outline',
      label: 'Native speakers',
      description: 'Learn from native tutors',
      filter: { nativeSpeaker: true }
    },
    {
      id: 'budget',
      icon: 'wallet-outline',
      label: 'Under $15/hr',
      description: 'Budget-friendly options',
      filter: { priceMin: 0, priceMax: 15 }
    },
    {
      id: 'top-rated',
      icon: 'star-outline',
      label: 'Top rated',
      description: '4.8+ star tutors',
      filter: { sortBy: 'rating' }
    },
    {
      id: 'available-now',
      icon: 'flash-outline',
      label: 'Available now',
      description: 'Start a lesson instantly',
      filter: { availability: 'now' }
    }
  ];

  activeQuickPicks: Set<string> = new Set();

  constructor(
    private modalController: ModalController,
    private userService: UserService
  ) {}

  ngOnInit() {
    // Initialize filters from input
    if (this.initialFilters) {
      this.filters = { ...this.initialFilters };
      this.priceRange = {
        lower: this.filters.priceMin || 0,
        upper: this.filters.priceMax || 200
      };
    }
    
    // Set up debounced count updates
    this.countSubject$.pipe(
      debounceTime(500),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.fetchResultCount();
    });
    
    // Initial count
    this.triggerCountUpdate();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Section management
  toggleSection(section: string) {
    if (this.expandedSections.has(section)) {
      this.expandedSections.delete(section);
    } else {
      this.expandedSections.add(section);
    }
  }

  isSectionExpanded(section: string): boolean {
    return this.expandedSections.has(section);
  }

  // Get active filters for chips display
  getActiveFilters(): ActiveFilter[] {
    const active: ActiveFilter[] = [];
    
    // Language
    if (this.filters.language && this.filters.language !== 'any') {
      active.push({
        type: 'language',
        value: this.filters.language,
        label: this.filters.language
      });
    }
    
    // Price (only if not default range)
    if (this.filters.priceMin !== 0 || this.filters.priceMax !== 200) {
      active.push({
        type: 'price',
        value: `${this.filters.priceMin}-${this.filters.priceMax}`,
        label: `$${this.filters.priceMin} - $${this.filters.priceMax}`
      });
    }
    
    // Countries
    if (Array.isArray(this.filters.country) && this.filters.country.length > 0) {
      this.filters.country.forEach(c => {
        active.push({
          type: 'country',
          value: c,
          label: c
        });
      });
    }
    
    // Availability
    if (this.filters.availability && this.filters.availability !== 'anytime') {
      const avail = this.availableAvailability.find(a => a.value === this.filters.availability);
      active.push({
        type: 'availability',
        value: this.filters.availability,
        label: avail?.label || this.filters.availability
      });
    }
    
    // Specialties
    if (Array.isArray(this.filters.specialties) && this.filters.specialties.length > 0) {
      this.filters.specialties.forEach(s => {
        const spec = this.availableSpecialties.find(sp => sp.value === s);
        active.push({
          type: 'specialty',
          value: s,
          label: spec?.label || s
        });
      });
    }
    
    // Gender
    if (this.filters.gender && this.filters.gender !== 'any') {
      active.push({
        type: 'gender',
        value: this.filters.gender,
        label: this.filters.gender.charAt(0).toUpperCase() + this.filters.gender.slice(1)
      });
    }
    
    // Native speaker
    if (this.filters.nativeSpeaker) {
      active.push({
        type: 'nativeSpeaker',
        value: 'true',
        label: 'Native speaker'
      });
    }
    
    return active;
  }

  removeFilter(filter: ActiveFilter) {
    switch (filter.type) {
      case 'language':
        this.filters.language = 'any';
        break;
      case 'price':
        this.filters.priceMin = 0;
        this.filters.priceMax = 200;
        this.priceRange = { lower: 0, upper: 200 };
        break;
      case 'country':
        if (Array.isArray(this.filters.country)) {
          this.filters.country = this.filters.country.filter(c => c !== filter.value);
        }
        break;
      case 'availability':
        this.filters.availability = 'anytime';
        break;
      case 'specialty':
        if (Array.isArray(this.filters.specialties)) {
          this.filters.specialties = this.filters.specialties.filter(s => s !== filter.value);
        }
        break;
      case 'gender':
        this.filters.gender = 'any';
        break;
      case 'nativeSpeaker':
        this.filters.nativeSpeaker = false;
        break;
    }
    this.triggerCountUpdate();
  }

  // Quick picks
  toggleQuickPick(pick: QuickPick) {
    if (this.activeQuickPicks.has(pick.id)) {
      this.activeQuickPicks.delete(pick.id);
      // Remove the filter values
      Object.keys(pick.filter).forEach(key => {
        if (key === 'nativeSpeaker') {
          this.filters.nativeSpeaker = false;
        } else if (key === 'priceMin') {
          this.filters.priceMin = 0;
          this.priceRange.lower = 0;
        } else if (key === 'priceMax') {
          this.filters.priceMax = 200;
          this.priceRange.upper = 200;
        } else if (key === 'sortBy') {
          this.filters.sortBy = 'random';
        } else if (key === 'availability') {
          this.filters.availability = 'anytime';
        }
      });
    } else {
      this.activeQuickPicks.add(pick.id);
      // Apply the filter values
      this.filters = { ...this.filters, ...pick.filter };
      if (pick.filter.priceMin !== undefined) {
        this.priceRange.lower = pick.filter.priceMin;
      }
      if (pick.filter.priceMax !== undefined) {
        this.priceRange.upper = pick.filter.priceMax;
      }
    }
    this.triggerCountUpdate();
  }

  isQuickPickActive(pick: QuickPick): boolean {
    return this.activeQuickPicks.has(pick.id);
  }

  // Language selection
  selectLanguage(language: string) {
    this.filters.language = language;
    this.triggerCountUpdate();
  }

  isLanguageSelected(language: string): boolean {
    if (language === 'any') {
      return !this.filters.language || this.filters.language === 'any';
    }
    return this.filters.language === language;
  }

  getFilteredLanguages() {
    if (!this.languageSearchTerm.trim()) {
      return this.availableLanguages;
    }
    const search = this.languageSearchTerm.toLowerCase().trim();
    return this.availableLanguages.filter(l => 
      l.label.toLowerCase().includes(search)
    );
  }

  // Country selection (multi-select)
  toggleCountry(country: string) {
    if (country === 'any') {
      this.filters.country = [];
    } else {
      const countries = Array.isArray(this.filters.country) ? [...this.filters.country] : [];
      const index = countries.indexOf(country);
      if (index > -1) {
        countries.splice(index, 1);
      } else {
        countries.push(country);
      }
      this.filters.country = countries;
    }
    this.triggerCountUpdate();
  }

  isCountrySelected(country: string): boolean {
    if (country === 'any') {
      return !this.filters.country || (Array.isArray(this.filters.country) && this.filters.country.length === 0);
    }
    return Array.isArray(this.filters.country) && this.filters.country.includes(country);
  }

  getFilteredCountries() {
    if (!this.countrySearchTerm.trim()) {
      return this.availableCountries;
    }
    const search = this.countrySearchTerm.toLowerCase().trim();
    return this.availableCountries.filter(c => 
      c.label.toLowerCase().includes(search)
    );
  }

  // Price range
  onPriceRangeChange(event: any) {
    const value = event.detail.value;
    this.priceRange = { lower: value.lower, upper: value.upper };
    this.filters.priceMin = value.lower;
    this.filters.priceMax = value.upper;
    this.triggerCountUpdate();
  }

  // Specialty selection (multi-select)
  toggleSpecialty(specialty: string) {
    const specialties = Array.isArray(this.filters.specialties) ? [...this.filters.specialties] : [];
    const index = specialties.indexOf(specialty);
    if (index > -1) {
      specialties.splice(index, 1);
    } else {
      specialties.push(specialty);
    }
    this.filters.specialties = specialties;
    this.triggerCountUpdate();
  }

  isSpecialtySelected(specialty: string): boolean {
    return Array.isArray(this.filters.specialties) && this.filters.specialties.includes(specialty);
  }

  // Availability
  selectAvailability(availability: string) {
    this.filters.availability = availability;
    this.triggerCountUpdate();
  }

  // Gender
  selectGender(gender: string) {
    this.filters.gender = gender;
    this.triggerCountUpdate();
  }

  // Native speaker
  toggleNativeSpeaker() {
    this.filters.nativeSpeaker = !this.filters.nativeSpeaker;
    this.triggerCountUpdate();
  }

  // Result count
  private triggerCountUpdate() {
    this.countSubject$.next();
  }

  private async fetchResultCount() {
    this.isLoadingCount = true;
    try {
      const response = await this.userService.searchTutors({
        ...this.filters,
        page: 1,
        limit: 1 // Just need the count
      }).toPromise();
      this.resultCount = response?.pagination?.totalCount || 0;
    } catch (error) {
      console.error('Error fetching result count:', error);
      this.resultCount = null;
    } finally {
      this.isLoadingCount = false;
    }
  }

  // Actions
  clearAllFilters() {
    this.filters = {
      language: 'any',
      priceMin: 0,
      priceMax: 200,
      country: [],
      availability: 'anytime',
      specialties: [],
      gender: 'any',
      nativeSpeaker: false,
      sortBy: 'random',
      page: 1,
      limit: 20
    };
    this.priceRange = { lower: 0, upper: 200 };
    this.activeQuickPicks.clear();
    this.triggerCountUpdate();
  }

  dismiss() {
    this.modalController.dismiss(null, 'cancel');
  }

  applyFilters() {
    this.modalController.dismiss(this.filters, 'apply');
  }

  hasActiveFilters(): boolean {
    return this.getActiveFilters().length > 0;
  }
}

