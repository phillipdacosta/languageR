import { AfterViewInit, Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IonSearchbar, ModalController, NavParams } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FlagService } from '../../services/flag.service';
import { LanguageService, SupportedLanguage } from '../../services/language.service';
import { LocaleDisplayService } from '../../services/locale-display.service';

export interface Country {
  name: string;
  flag: string;
}

@Component({
  selector: 'app-country-select-modal',
  standalone: false,
  templateUrl: './country-select-modal.component.html',
  styleUrls: ['./country-select-modal.component.scss'],
})
export class CountrySelectModalComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() countries: Country[] = [];
  @Input() selectedCountry: string = '';
  @Input() modalType: 'origin' | 'residence' = 'origin';

  @ViewChild('countrySearch') countrySearch?: IonSearchbar;

  searchTerm = '';
  /** Rows with localized labels for the list UI. */
  countryRows: { name: string; flag: string; displayLabel: string }[] = [];
  filteredRows: { name: string; flag: string; displayLabel: string }[] = [];

  private langSub: Subscription | null = null;
  private searchFocusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private modalController: ModalController,
    private navParams: NavParams,
    private flagService: FlagService,
    private localeDisplay: LocaleDisplayService,
    private translate: TranslateService,
    private languageService: LanguageService
  ) {}

  ngOnInit() {
    const countriesFromParams = this.navParams.get('countries');
    const selectedFromParams = this.navParams.get('selectedCountry');
    const modalTypeFromParams = this.navParams.get('modalType');

    if (countriesFromParams) {
      this.countries = countriesFromParams;
    }
    if (selectedFromParams) {
      this.selectedCountry = selectedFromParams;
    }
    if (modalTypeFromParams) {
      this.modalType = modalTypeFromParams;
    }

    this.rebuildLocalizedRows();
    this.filteredRows = [...this.countryRows];

    this.langSub = this.languageService.currentLanguage$.subscribe(() => {
      this.rebuildLocalizedRows();
      this.filterCountries();
    });
  }

  ngOnDestroy() {
    this.langSub?.unsubscribe();
    this.langSub = null;
    if (this.searchFocusTimer != null) {
      clearTimeout(this.searchFocusTimer);
      this.searchFocusTimer = null;
    }
  }

  ngAfterViewInit(): void {
    this.scheduleSearchFocus();
  }

  ionViewWillEnter() {
    if (this.countryRows.length === 0 && this.countries?.length > 0) {
      this.rebuildLocalizedRows();
      this.filteredRows = [...this.countryRows];
    }
    this.scheduleSearchFocus();
  }

  /** Delay so the modal overlay finishes animating before focusing (iOS/Safari). */
  private scheduleSearchFocus(): void {
    if (this.searchFocusTimer != null) {
      clearTimeout(this.searchFocusTimer);
    }
    this.searchFocusTimer = setTimeout(() => {
      this.searchFocusTimer = null;
      void this.countrySearch?.setFocus();
    }, 280);
  }

  private currentUiLang(): SupportedLanguage {
    const raw = this.translate.currentLang || this.languageService.getCurrentLanguage();
    return (this.languageService.isSupported(raw) ? raw : 'en') as SupportedLanguage;
  }

  private otherLabel(): string {
    const key = 'ONBOARDING.COUNTRY_MODAL.OTHER';
    const t = this.translate.instant(key);
    return t !== key ? t : 'Other';
  }

  private rebuildLocalizedRows(): void {
    const ui = this.currentUiLang();
    const other = this.otherLabel();
    this.countryRows = (this.countries || []).map((c) => {
      const code = this.flagService.getCountryCodeFromCountryName(c.name);
      const displayLabel = this.localeDisplay.localizedCountryRow(c.name, ui, code, other);
      return { name: c.name, flag: c.flag, displayLabel };
    });
    if (!this.searchTerm?.trim()) {
      this.filteredRows = [...this.countryRows];
    }
  }

  trackByCountry(index: number, row: { name: string }): string {
    return row.name;
  }

  filterCountries() {
    if (!this.searchTerm.trim()) {
      this.filteredRows = [...this.countryRows];
      return;
    }
    const q = this.searchTerm.toLowerCase().trim();
    this.filteredRows = this.countryRows.filter(
      (row) =>
        row.displayLabel.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)
    );
  }

  selectCountry(countryName: string) {
    this.modalController.dismiss({
      selectedCountry: countryName,
    });
  }

  dismiss() {
    this.modalController.dismiss();
  }
}
