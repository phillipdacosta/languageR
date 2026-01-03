import { Component, OnInit, Input } from '@angular/core';
import { ModalController, NavParams } from '@ionic/angular';

export interface Country {
  name: string;
  flag: string; // Keeping for backward compatibility but will use SVG flags
}

@Component({
  selector: 'app-country-select-modal',
  standalone: false,
  templateUrl: './country-select-modal.component.html',
  styleUrls: ['./country-select-modal.component.scss']
})
export class CountrySelectModalComponent implements OnInit {
  @Input() countries: Country[] = [];
  @Input() selectedCountry: string = '';

  searchTerm = '';
  filteredCountries: Country[] = [];

  constructor(
    private modalController: ModalController,
    private navParams: NavParams
  ) {}

  ngOnInit() {
    // Get data from NavParams (Ionic modal's way of passing data)
    const countriesFromParams = this.navParams.get('countries');
    const selectedFromParams = this.navParams.get('selectedCountry');
    
    console.log('🌍 Country Modal - Raw NavParams:', {
      countries: countriesFromParams,
      selected: selectedFromParams,
      inputCountries: this.countries
    });
    
    if (countriesFromParams) {
      this.countries = countriesFromParams;
    }
    if (selectedFromParams) {
      this.selectedCountry = selectedFromParams;
    }
    
    console.log('🌍 Country Modal - ngOnInit, countries:', this.countries?.length);
    console.log('🌍 First 3 countries:', this.countries?.slice(0, 3));
    
    if (this.countries && this.countries.length > 0) {
      this.filteredCountries = [...this.countries];
      console.log('🌍 Filtered countries set:', this.filteredCountries?.length);
    } else {
      console.error('❌ No countries data available!');
    }
  }

  ionViewWillEnter() {
    console.log('🌍 Country Modal - ionViewWillEnter, countries:', this.countries?.length);
    if (this.countries && this.countries.length > 0 && this.filteredCountries.length === 0) {
      this.filteredCountries = [...this.countries];
    }
  }

  trackByCountry(index: number, country: Country): string {
    return country.name;
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
