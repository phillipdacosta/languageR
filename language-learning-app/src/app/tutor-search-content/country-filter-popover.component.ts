import { Component, OnInit } from '@angular/core';
import { PopoverController, NavParams } from '@ionic/angular';

@Component({
  selector: 'app-country-filter-popover',
  template: `
    <div class="popover-content">
      <div class="search-wrapper">
        <ion-icon name="search-outline" class="search-icon"></ion-icon>
        <input 
          type="text"
          [(ngModel)]="searchTerm"
          (input)="filterCountries()"
          placeholder="Filter countries"
          class="search-input">
        <ion-icon 
          *ngIf="searchTerm"
          name="close-circle" 
          class="clear-icon"
          (click)="clearSearch()">
        </ion-icon>
      </div>

      <div class="country-list">
        <div
          *ngFor="let country of filteredCountries"
          class="country-item"
          [class.selected]="isSelected(country)"
          (click)="selectCountry(country)">
          <app-flag-icon 
            *ngIf="country !== 'Any country'"
            [country]="country" 
            [size]="18">
          </app-flag-icon>
          <span class="country-name">{{ country }}</span>
          <ion-icon 
            *ngIf="isSelected(country)"
            name="checkmark" 
            class="check-icon">
          </ion-icon>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .popover-content {
      width: 220px;
      max-height: 320px;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      overflow: hidden;
    }

    .search-wrapper {
      position: relative;
      padding: 8px;
      border-bottom: 1px solid #e5e7eb;
      flex-shrink: 0;
    }

    .search-icon {
      position: absolute;
      left: 15px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 13px;
      color: #9ca3af;
      pointer-events: none;
      z-index: 1;
    }

    .search-input {
      width: 91%;
      padding: 5px 26px 5px 26px;
      border: none;
      background: #f3f4f6;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
      transition: background 0.2s;
      box-sizing: border-box;
    }

    .search-input:focus {
      background: #e5e7eb;
    }

    .search-input::placeholder {
      color: #9ca3af;
      font-size: 11px;
    }

    .clear-icon {
      position: absolute;
      right: 28px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 13px;
      color: #9ca3af;
      cursor: pointer;
      transition: color 0.2s;
      z-index: 1;
    }

    .clear-icon:hover {
      color: #6b7280;
    }

    .country-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 2px 0;
      min-height: 0;
    }

    .country-list::-webkit-scrollbar {
      width: 4px;
    }

    .country-list::-webkit-scrollbar-track {
      background: transparent;
    }

    .country-list::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 2px;
    }

    .country-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      cursor: pointer;
      transition: background-color 0.15s ease;
      min-height: 32px;
    }

    .country-item:hover {
      background-color: #f9fafb;
    }

    .country-item.selected {
    width: 94%;
      background-color: #eff6ff;
    }

    .country-name {
      flex: 1;
      font-size: 13px;
      color: #1f2937;
      font-weight: 400;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .check-icon {
      font-size: 16px;
      color: #3b82f6;
      font-weight: 600;
      flex-shrink: 0;
    }

    /* No results message */
    .no-results {
      padding: 20px 10px;
      text-align: center;
      color: #9ca3af;
      font-size: 12px;
    }
  `],
  standalone: false
})
export class CountryFilterPopoverComponent implements OnInit {
  countries: string[] = [];
  selectedCountry: string = 'any';
  searchTerm: string = '';
  filteredCountries: string[] = [];

  constructor(
    private popoverController: PopoverController,
    private navParams: NavParams
  ) {}

  ngOnInit() {
    this.countries = this.navParams.get('countries') || [];
    this.selectedCountry = this.navParams.get('selectedCountry') || 'any';
    this.filteredCountries = [...this.countries];
  }

  filterCountries() {
    if (!this.searchTerm.trim()) {
      this.filteredCountries = [...this.countries];
      return;
    }

    const searchLower = this.searchTerm.toLowerCase().trim();
    this.filteredCountries = this.countries.filter(country =>
      country.toLowerCase().includes(searchLower)
    );
  }

  clearSearch() {
    this.searchTerm = '';
    this.filterCountries();
  }

  isSelected(country: string): boolean {
    return this.selectedCountry === country || (country === 'Any country' && this.selectedCountry === 'any');
  }

  selectCountry(country: string) {
    // Immediately apply the selection and close
    this.popoverController.dismiss({
      selectedCountry: country
    });
  }
}

