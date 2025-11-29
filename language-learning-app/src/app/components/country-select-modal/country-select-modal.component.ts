import { Component, OnInit, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';

export interface Country {
  name: string;
  flag: string; // Keeping for backward compatibility but will use SVG flags
}

@Component({
  selector: 'app-country-select-modal',
  standalone: false,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Select Country</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Search Bar -->
      <ion-searchbar
        [(ngModel)]="searchTerm"
        placeholder="Search countries..."
        (ionInput)="filterCountries()"
        debounce="300"
        show-clear-button="focus">
      </ion-searchbar>

      <!-- Country List -->
      <ion-list>
        <ion-item
          *ngFor="let country of filteredCountries"
          button
          (click)="selectCountry(country.name)"
          [class.selected]="selectedCountry === country.name">
          <app-flag-icon 
            [country]="country.name" 
            [size]="24"
            slot="start"
            style="margin-right: 12px;">
          </app-flag-icon>
          <ion-label>
            <h2>{{ country.name }}</h2>
          </ion-label>
          <ion-icon 
            *ngIf="selectedCountry === country.name" 
            name="checkmark" 
            color="primary"
            slot="end">
          </ion-icon>
        </ion-item>
      </ion-list>

      <!-- No Results -->
      <div *ngIf="filteredCountries.length === 0 && searchTerm.trim()" class="no-results">
        <p>No countries found matching "{{ searchTerm }}"</p>
      </div>
    </ion-content>
  `,
  styles: [`
    ion-searchbar {
      padding: 8px;
    }

    ion-item {
      --padding-start: 16px;
      --padding-end: 16px;
    }

    ion-item.selected {
      --background: var(--ion-color-light);
    }

    .no-results {
      text-align: center;
      padding: 40px 20px;
      color: var(--ion-color-medium);
    }

    .no-results p {
      margin: 0;
      font-size: 16px;
    }
  `]
})
export class CountrySelectModalComponent implements OnInit {
  @Input() countries: Country[] = [];
  @Input() selectedCountry: string = '';

  searchTerm = '';
  filteredCountries: Country[] = [];

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    this.filteredCountries = this.countries;
  }

  filterCountries() {
    if (!this.searchTerm.trim()) {
      this.filteredCountries = this.countries;
      return;
    }

    const searchLower = this.searchTerm.toLowerCase().trim();
    this.filteredCountries = this.countries.filter(country =>
      country.name.toLowerCase().includes(searchLower)
    );
  }

  selectCountry(countryName: string) {
    this.modalController.dismiss({
      selectedCountry: countryName
    });
  }

  dismiss() {
    this.modalController.dismiss();
  }
}

