import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AfterViewInit, Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IonicModule, IonSearchbar, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { LanguageOption, LanguageService, SupportedLanguage } from '../../services/language.service';

@Component({
  selector: 'app-interface-language-select-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  templateUrl: './interface-language-select-modal.component.html',
  styleUrls: ['./interface-language-select-modal.component.scss'],
})
export class InterfaceLanguageSelectModalComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() languages: LanguageOption[] = [];
  @Input() selectedCode: SupportedLanguage = 'en';

  /** Language highlighted in the list; applied only when user taps Change. */
  pendingCode: SupportedLanguage = 'en';

  @ViewChild('langSearch') langSearch?: IonSearchbar;

  searchTerm = '';
  filteredLanguages: LanguageOption[] = [];

  private searchFocusTimer: ReturnType<typeof setTimeout> | null = null;
  private langSub: Subscription | null = null;

  constructor(
    private modalController: ModalController,
    private languageService: LanguageService
  ) {}

  ngOnInit(): void {
    this.pendingCode = this.selectedCode;
    this.filteredLanguages = [...(this.languages || [])];
    this.langSub = this.languageService.currentLanguage$.subscribe(() => {
      this.filterLanguages();
    });
  }

  ngAfterViewInit(): void {
    this.scheduleSearchFocus();
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.langSub = null;
    if (this.searchFocusTimer != null) {
      clearTimeout(this.searchFocusTimer);
      this.searchFocusTimer = null;
    }
  }

  private scheduleSearchFocus(): void {
    if (this.searchFocusTimer != null) {
      clearTimeout(this.searchFocusTimer);
    }
    this.searchFocusTimer = setTimeout(() => {
      this.searchFocusTimer = null;
      void this.langSearch?.setFocus();
    }, 280);
  }

  filterLanguages(): void {
    const list = this.languages || [];
    if (!this.searchTerm.trim()) {
      this.filteredLanguages = [...list];
      return;
    }
    const q = this.searchTerm.toLowerCase().trim();
    this.filteredLanguages = list.filter(
      (l) =>
        l.code.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q)
    );
  }

  selectLanguage(code: SupportedLanguage): void {
    this.pendingCode = code;
  }

  confirmChange(): void {
    void this.modalController.dismiss({ selectedLanguage: this.pendingCode });
  }

  dismiss(): void {
    void this.modalController.dismiss();
  }

  trackByCode(_index: number, lang: LanguageOption): string {
    return lang.code;
  }
}
