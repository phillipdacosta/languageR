import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { LoadingService } from '../services/loading.service';
import { UserService } from '../services/user.service';
import {
  LANGUAGE_SELECT_RETURN_CONTEXT,
  ONBOARDING_AFTER_LANGUAGE_RESTORE,
  LanguageSelectReturnPayload,
  SIGNUP_INTERFACE_LANG_COMPLETED_KEY,
  SIGNUP_LANGUAGE_COMPLETED_LS_KEY,
} from './language-select-flow.storage';

@Component({
  selector: 'app-signup-language',
  templateUrl: './signup-language.page.html',
  styleUrls: ['./signup-language.page.scss'],
  standalone: false,
})
export class SignupLanguagePage implements OnInit, OnDestroy {
  availableInterfaceLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';
  termsOfServiceHref = '/terms?lang=en';
  privacyPolicyHref = '/privacy?lang=en';

  readonly headingRotationKeys: readonly string[] = [
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_01',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_02',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_03',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_04',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_05',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_06',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_07',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_08',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_09',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_10',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_11',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_12',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_13',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_14',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_15',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_16',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_17',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_18',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_19',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_20',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_21',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_22',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_23',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_24',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_25',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_26',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_27',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_28',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_29',
  ];
  activeHeadingIndex = 0;
  private headingInterval: ReturnType<typeof setInterval> | null = null;
  private headingRotationStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private headingRotationLoadSub: Subscription | null = null;
  private languageApplyDebounce: ReturnType<typeof setTimeout> | null = null;
  private static readonly LANGUAGE_APPLY_DEBOUNCE_MS = 0;

  constructor(
    private authService: AuthService,
    private router: Router,
    private languageService: LanguageService,
    private translateService: TranslateService,
    private loadingService: LoadingService,
    private alertController: AlertController,
    private cdr: ChangeDetectorRef,
    private userService: UserService
  ) {
    this.availableInterfaceLanguages = this.languageService.supportedLanguages;
    this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
    this.refreshPublicLegalLinks();
  }

  ngOnInit(): void {
    // Auto-skip (when initial selection is already resolved) is handled by
    // SignupLanguageGuard on the route — by the time we reach here the user
    // intentionally wants to see the picker. We still defend against an
    // unauthenticated state here in case the route guard order changes.
    this.authService.isAuthenticated$.pipe(take(1)).subscribe((isAuthenticated) => {
      if (!isAuthenticated) {
        void this.router.navigate(['/login'], { replaceUrl: true });
      }
    });

    // Re-apply the saved language once translations have been registered.
    // On a fresh page load the HTTP fetches for locale JSON files may not
    // have completed yet when initializeLanguage() ran, so translate.use()
    // may have silently fallen back to English. Calling use() again here
    // (after at least one translation file has been loaded) ensures the
    // correct locale is active when the page is first painted.
    const saved = this.languageService.getCurrentLanguage();
    if (saved && saved !== 'en') {
      this.translateService.use(saved).pipe(take(1)).subscribe(() => {
        this.cdr.detectChanges();
      });
    }

    this.scheduleHeadingRotationAfterLoad();
  }

  ngOnDestroy(): void {
    this.clearLanguageApplyDebounce();
    this.headingRotationLoadSub?.unsubscribe();
    this.headingRotationLoadSub = null;
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();
  }

  private refreshPublicLegalLinks(): void {
    const lang = encodeURIComponent(this.selectedInterfaceLanguage);
    this.termsOfServiceHref = `/terms?lang=${lang}`;
    this.privacyPolicyHref = `/privacy?lang=${lang}`;
  }

  private clearLanguageApplyDebounce(): void {
    if (this.languageApplyDebounce != null) {
      clearTimeout(this.languageApplyDebounce);
      this.languageApplyDebounce = null;
    }
  }

  private scheduleInterfaceLanguageApply(lang: SupportedLanguage): void {
    this.clearLanguageApplyDebounce();
    this.languageService.setLanguage(lang);
    this.refreshPublicLegalLinks();
    this.cdr.detectChanges();
  }

  private scheduleHeadingRotationAfterLoad(): void {
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();
    this.headingRotationLoadSub?.unsubscribe();
    this.headingRotationLoadSub = null;

    const startAfterDelay = () => {
      this.headingRotationStartTimeout = setTimeout(() => {
        this.headingRotationStartTimeout = null;
        this.activeHeadingIndex = 0;
        this.startHeadingRotation();
      }, 4000);
    };

    const afterDocumentLoaded = () => {
      if (typeof document === 'undefined' || typeof window === 'undefined') {
        startAfterDelay();
        return;
      }
      if (document.readyState === 'complete') {
        startAfterDelay();
      } else {
        window.addEventListener('load', () => startAfterDelay(), { once: true });
      }
    };

    this.headingRotationLoadSub = this.loadingService.loading$
      .pipe(filter((isLoading) => !isLoading), take(1))
      .subscribe(() => {
        this.headingRotationLoadSub = null;
        afterDocumentLoaded();
      });
  }

  private cancelHeadingRotationSchedule(): void {
    if (this.headingRotationStartTimeout != null) {
      clearTimeout(this.headingRotationStartTimeout);
      this.headingRotationStartTimeout = null;
    }
  }

  private startHeadingRotation(): void {
    this.stopHeadingRotation();
    this.headingInterval = setInterval(() => {
      this.activeHeadingIndex = (this.activeHeadingIndex + 1) % this.headingRotationKeys.length;
      this.cdr.detectChanges();
    }, 2400);
  }

  private stopHeadingRotation(): void {
    if (this.headingInterval != null) {
      clearInterval(this.headingInterval);
      this.headingInterval = null;
    }
  }

  selectInterfaceLanguage(lang: SupportedLanguage): void {
    this.selectedInterfaceLanguage = lang;
    this.scheduleInterfaceLanguageApply(lang);
  }

  confirmLanguageSelection(): void {
    this.clearLanguageApplyDebounce();
    this.languageService.setLanguage(this.selectedInterfaceLanguage);
    this.refreshPublicLegalLinks();
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();

    // Persist to backend so a reload doesn't revert to the stale profile value.
    // Fire-and-forget: we navigate immediately and let the request finish in the
    // background. If the user isn't yet authenticated we skip silently.
    this.authService.isAuthenticated$.pipe(take(1)).subscribe((isAuth) => {
      if (isAuth) {
        this.userService
          .updateInterfaceLanguage(this.selectedInterfaceLanguage)
          .pipe(take(1))
          .subscribe({
            error: (err) => console.warn('Failed to persist interface language', err),
          });
      }
    });

    sessionStorage.setItem(SIGNUP_INTERFACE_LANG_COMPLETED_KEY, '1');
    try {
      localStorage.setItem(SIGNUP_LANGUAGE_COMPLETED_LS_KEY, '1');
    } catch {
      /* localStorage may be unavailable; ignore */
    }

    const ctxRaw = sessionStorage.getItem(LANGUAGE_SELECT_RETURN_CONTEXT);
    if (ctxRaw) {
      sessionStorage.removeItem(LANGUAGE_SELECT_RETURN_CONTEXT);
      let payload: LanguageSelectReturnPayload;
      try {
        payload = JSON.parse(ctxRaw) as LanguageSelectReturnPayload;
      } catch {
        void this.router.navigate(['/role-select'], { replaceUrl: true });
        return;
      }
      sessionStorage.setItem(ONBOARDING_AFTER_LANGUAGE_RESTORE, JSON.stringify(payload));
      void this.router.navigate(['/onboarding']);
      return;
    }

    sessionStorage.removeItem(ONBOARDING_AFTER_LANGUAGE_RESTORE);
    void this.router.navigate(['/role-select'], { replaceUrl: true });
  }

  async handleLogout(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT'),
      message: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT_CONFIRM'),
      buttons: [
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT'),
          handler: async () => {
            await this.authService.logout();
          },
        },
      ],
    });
    await alert.present();
  }
}
