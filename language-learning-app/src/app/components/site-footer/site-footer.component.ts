import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { InterfaceLanguageSelectModalComponent } from '../interface-language-select-modal/interface-language-select-modal.component';
import { AuthService } from '../../services/auth.service';
import { LanguageService, SupportedLanguage } from '../../services/language.service';
import { UserService } from '../../services/user.service';

export type SiteFooterLayout = 'bar' | 'compact';

@Component({
  selector: 'app-site-footer',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, RouterModule],
  templateUrl: './site-footer.component.html',
  styleUrls: ['./site-footer.component.scss'],
})
export class SiteFooterComponent implements OnInit, OnDestroy {
  @Input() layout: SiteFooterLayout = 'bar';
  @Input() showLanguage = true;

  readonly supportEmail = 'support@languageapp.com';
  readonly copyrightYear = new Date().getFullYear();

  currentLang: SupportedLanguage = 'en';
  termsHref = '/terms?lang=en';
  languageLabel = 'English';

  private langSub: Subscription | null = null;

  constructor(
    private languageService: LanguageService,
    private authService: AuthService,
    private userService: UserService,
    private modalController: ModalController,
  ) {}

  ngOnInit(): void {
    this.refreshLegalLinks(this.languageService.getCurrentLanguage());
    this.refreshLanguageLabel(this.languageService.getCurrentLanguage());
    this.langSub = this.languageService.currentLanguage$.subscribe((lang) => {
      this.refreshLegalLinks(lang);
      this.refreshLanguageLabel(lang);
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.langSub = null;
  }

  async openLanguageModal(): Promise<void> {
    const selectedCode = this.languageService.getCurrentLanguage();
    const modal = await this.modalController.create({
      component: InterfaceLanguageSelectModalComponent,
      componentProps: {
        languages: this.languageService.supportedLanguages,
        selectedCode,
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    const next = data?.selectedLanguage as SupportedLanguage | undefined;
    if (next && next !== selectedCode) {
      await this.applyLanguage(next);
    }
  }

  private async applyLanguage(next: SupportedLanguage): Promise<void> {
    this.languageService.setLanguage(next);
    this.refreshLegalLinks(next);
    this.refreshLanguageLabel(next);

    const isAuthenticated = await firstValueFrom(this.authService.isAuthenticated$.pipe(take(1)));
    if (isAuthenticated) {
      this.userService.updateInterfaceLanguage(next).subscribe({ error: () => {} });
    }
  }

  private refreshLegalLinks(lang: SupportedLanguage): void {
    this.currentLang = lang;
    this.termsHref = `/terms?lang=${lang}`;
  }

  private refreshLanguageLabel(lang: SupportedLanguage): void {
    const opt = this.languageService.getLanguageOption(lang);
    this.languageLabel = opt?.nativeName || lang.toUpperCase();
  }
}
