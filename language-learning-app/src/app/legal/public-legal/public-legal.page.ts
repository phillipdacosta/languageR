import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { LanguageService, SupportedLanguage } from '../../services/language.service';

export type PublicLegalDoc = 'terms' | 'privacy';

interface LegalSection {
  title: string;
  body: string;
}

interface LegalCopy {
  docTitle: string;
  lastUpdated: string;
  sections: LegalSection[];
}

const TERMS_KEYS = [
  { titleKey: 'TERMS_S1_TITLE', bodyKey: 'TERMS_S1_BODY' },
  { titleKey: 'TERMS_S2_TITLE', bodyKey: 'TERMS_S2_BODY' },
  { titleKey: 'TERMS_S3_TITLE', bodyKey: 'TERMS_S3_BODY' },
  { titleKey: 'TERMS_S4_TITLE', bodyKey: 'TERMS_S4_BODY' },
  { titleKey: 'TERMS_S5_TITLE', bodyKey: 'TERMS_S5_BODY' },
  { titleKey: 'TERMS_S6_TITLE', bodyKey: 'TERMS_S6_BODY' },
  { titleKey: 'TERMS_S7_TITLE', bodyKey: 'TERMS_S7_BODY' },
  { titleKey: 'TERMS_S8_TITLE', bodyKey: 'TERMS_S8_BODY' },
  { titleKey: 'TERMS_S9_TITLE', bodyKey: 'TERMS_S9_BODY' },
  { titleKey: 'TERMS_S10_TITLE', bodyKey: 'TERMS_S10_BODY' },
  { titleKey: 'TERMS_S11_TITLE', bodyKey: 'TERMS_S11_BODY' },
  { titleKey: 'TERMS_S12_TITLE', bodyKey: 'TERMS_S12_BODY' },
  { titleKey: 'TERMS_S13_TITLE', bodyKey: 'TERMS_S13_BODY' },
  { titleKey: 'TERMS_S14_TITLE', bodyKey: 'TERMS_S14_BODY' },
  { titleKey: 'TERMS_S15_TITLE', bodyKey: 'TERMS_S15_BODY' },
];

const PRIVACY_KEYS = [
  { titleKey: 'PRIVACY_S1_TITLE', bodyKey: 'PRIVACY_S1_BODY' },
  { titleKey: 'PRIVACY_S2_TITLE', bodyKey: 'PRIVACY_S2_BODY' },
  { titleKey: 'PRIVACY_S3_TITLE', bodyKey: 'PRIVACY_S3_BODY' },
  { titleKey: 'PRIVACY_S4_TITLE', bodyKey: 'PRIVACY_S4_BODY' },
  { titleKey: 'PRIVACY_S5_TITLE', bodyKey: 'PRIVACY_S5_BODY' },
  { titleKey: 'PRIVACY_S6_TITLE', bodyKey: 'PRIVACY_S6_BODY' },
  { titleKey: 'PRIVACY_S7_TITLE', bodyKey: 'PRIVACY_S7_BODY' },
  { titleKey: 'PRIVACY_S8_TITLE', bodyKey: 'PRIVACY_S8_BODY' },
  { titleKey: 'PRIVACY_S9_TITLE', bodyKey: 'PRIVACY_S9_BODY' },
  { titleKey: 'PRIVACY_S10_TITLE', bodyKey: 'PRIVACY_S10_BODY' },
  { titleKey: 'PRIVACY_S11_TITLE', bodyKey: 'PRIVACY_S11_BODY' },
  { titleKey: 'PRIVACY_S12_TITLE', bodyKey: 'PRIVACY_S12_BODY' },
];

@Component({
  selector: 'app-public-legal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './public-legal.page.html',
  styleUrls: ['./public-legal.page.scss'],
})
export class PublicLegalPage implements OnInit, OnDestroy {
  legalDoc: PublicLegalDoc = 'terms';
  isTermsDoc = true;
  copy: LegalCopy = { docTitle: '', lastUpdated: '', sections: [] };

  private querySub: Subscription | null = null;
  private readonly supportedCodes: ReadonlySet<string>;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly http: HttpClient,
    private readonly cdr: ChangeDetectorRef,
    languageService: LanguageService,
  ) {
    this.supportedCodes = new Set(
      languageService.supportedLanguages.map((l) => l.code),
    );
  }

  ngOnInit(): void {
    const dataDoc = this.route.snapshot.data['legalDoc'] as PublicLegalDoc | undefined;
    this.legalDoc = dataDoc === 'privacy' ? 'privacy' : 'terms';
    this.isTermsDoc = this.legalDoc === 'terms';

    this.querySub = this.route.queryParamMap
      .pipe(
        map((qp) => qp.get('lang')),
        distinctUntilChanged(),
        map((raw) => (raw && this.supportedCodes.has(raw) ? raw : 'en') as SupportedLanguage),
        switchMap((lang) =>
          this.http.get<Record<string, any>>(`/assets/i18n/${lang}.json`).pipe(
            catchError(() => this.http.get<Record<string, any>>(`/assets/i18n/en.json`)),
            map((bundle) => bundle?.['LEGAL_PUBLIC'] ?? {}),
          ),
        ),
        tap((block: Record<string, string>) => {
          const keys = this.isTermsDoc ? TERMS_KEYS : PRIVACY_KEYS;
          const docTitleKey = this.isTermsDoc ? 'TERMS_TITLE' : 'PRIVACY_TITLE';
          this.copy = {
            docTitle: block[docTitleKey] ?? (this.isTermsDoc ? 'Terms of Service' : 'Privacy Policy'),
            lastUpdated: block['LAST_UPDATED'] ?? '',
            sections: keys.map((k) => ({
              title: block[k.titleKey] ?? '',
              body: block[k.bodyKey] ?? '',
            })),
          };
          if (typeof document !== 'undefined') {
            document.title = this.copy.docTitle;
          }
          this.cdr.markForCheck();
        }),
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
    this.querySub = null;
  }
}
