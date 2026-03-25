import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { SharedModule } from '../../shared/shared.module';

export interface ExploreFilters {
  language: string;
  priceMin: number;
  priceMax: number;
  dateFrom: string;
  dateTo: string;
  sortBy: string;
  searchQuery: string;
}

@Component({
  selector: 'app-explore-filters-modal',
  templateUrl: './explore-filters-modal.component.html',
  styleUrls: ['./explore-filters-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, SharedModule]
})
export class ExploreFiltersModalComponent implements OnInit {
  @Input() initialFilters!: ExploreFilters;
  @Input() totalClassCount = 0;

  filters: ExploreFilters = {
    language: 'any',
    priceMin: 0,
    priceMax: 200,
    dateFrom: '',
    dateTo: '',
    sortBy: 'date_asc',
    searchQuery: ''
  };

  priceRange = { lower: 0, upper: 200 };
  languageSearch = '';
  expandedSections = new Set<string>(['language', 'price']);

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

  sortOptions = [
    { value: 'date_asc', label: 'Date (earliest)' },
    { value: 'date_desc', label: 'Date (latest)' },
    { value: 'price_asc', label: 'Price (low → high)' },
    { value: 'price_desc', label: 'Price (high → low)' },
    { value: 'name_asc', label: 'Name (A–Z)' }
  ];

  filteredLanguages: typeof this.availableLanguages = [];
  activeFilterCount = 0;

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    if (this.initialFilters) {
      this.filters = { ...this.initialFilters };
      this.priceRange = { lower: this.filters.priceMin, upper: this.filters.priceMax };
    }
    this.filteredLanguages = [...this.availableLanguages];
    this.computeActiveFilterCount();
  }

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

  onLanguageSearch() {
    const q = this.languageSearch.toLowerCase().trim();
    this.filteredLanguages = q
      ? this.availableLanguages.filter(l => l.label.toLowerCase().includes(q))
      : [...this.availableLanguages];
  }

  selectLanguage(value: string) {
    this.filters.language = value;
    this.computeActiveFilterCount();
  }

  onPriceRangeChange(event: any) {
    const v = event.detail.value;
    this.priceRange = { lower: v.lower, upper: v.upper };
    this.filters.priceMin = v.lower;
    this.filters.priceMax = v.upper;
    this.computeActiveFilterCount();
  }

  selectSort(value: string) {
    this.filters.sortBy = value;
    this.computeActiveFilterCount();
  }

  onSearchChange() {
    this.computeActiveFilterCount();
  }

  onDateChange() {
    this.computeActiveFilterCount();
  }

  computeActiveFilterCount() {
    let count = 0;
    if (this.filters.language && this.filters.language !== 'any') count++;
    if (this.filters.priceMin !== 0 || this.filters.priceMax !== 200) count++;
    if (this.filters.dateFrom) count++;
    if (this.filters.dateTo) count++;
    if (this.filters.searchQuery) count++;
    if (this.filters.sortBy !== 'date_asc') count++;
    this.activeFilterCount = count;
  }

  clearAll() {
    this.filters = {
      language: 'any',
      priceMin: 0,
      priceMax: 200,
      dateFrom: '',
      dateTo: '',
      sortBy: 'date_asc',
      searchQuery: ''
    };
    this.priceRange = { lower: 0, upper: 200 };
    this.languageSearch = '';
    this.filteredLanguages = [...this.availableLanguages];
    this.computeActiveFilterCount();
  }

  apply() {
    this.modalCtrl.dismiss(this.filters, 'apply');
  }

  dismiss() {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
