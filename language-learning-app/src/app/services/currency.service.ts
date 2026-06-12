import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface FxContext {
  currency: string; // 'usd' | 'eur' | 'gbp'
  rate: number;     // buffered USD -> currency rate (1 for USD)
  symbol: string;
  buffer: number;
}

export interface PriceQuote {
  usdAmount: number;
  currency: string;
  amount: number; // amount in `currency` the student will be charged
  fxRate: number;
  symbol: string;
}

const SYMBOLS: { [code: string]: string } = { usd: '$', eur: '€', gbp: '£', cad: 'CA$', aud: 'A$' };

/**
 * Central money formatting + local-currency helpers.
 *
 * The ledger is USD. This service lets student-facing screens display the
 * currency a student will actually be charged in (USD/EUR/GBP). It caches the
 * per-user FX context so approximate local prices can be rendered without a
 * round-trip per amount. Templates must stay function-free, so callers should
 * precompute display strings in their component TS.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private apiUrl = environment.apiUrl;
  private fxContext: FxContext | null = null;
  private fxContextPromise: Promise<FxContext> | null = null;

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  /** Currency symbol for a code, falling back to the upper-cased code. */
  symbolFor(currency?: string | null): string {
    const code = (currency || 'usd').toLowerCase();
    return SYMBOLS[code] || code.toUpperCase() + ' ';
  }

  /**
   * Format an amount in a given currency. Uses Intl.NumberFormat when possible,
   * falling back to a simple symbol + fixed-2 string.
   */
  formatMoney(amount: number, currency: string = 'usd', locale?: string): string {
    const code = (currency || 'usd').toLowerCase();
    const value = Number(amount || 0);
    try {
      return new Intl.NumberFormat(locale || undefined, {
        style: 'currency',
        currency: code.toUpperCase()
      }).format(value);
    } catch {
      return `${this.symbolFor(code)}${value.toFixed(2)}`;
    }
  }

  /** Cached FX context for the current user (loads once, then reuses). */
  async getFxContext(forceReload = false): Promise<FxContext> {
    if (this.fxContext && !forceReload) return this.fxContext;
    if (this.fxContextPromise && !forceReload) return this.fxContextPromise;

    this.fxContextPromise = (async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<any>(`${this.apiUrl}/payments/fx-context`, {
            headers: this.userService.getAuthHeadersSync()
          })
        );
        this.fxContext = {
          currency: (res?.currency || 'usd').toLowerCase(),
          rate: res?.rate || 1,
          symbol: res?.symbol || this.symbolFor(res?.currency),
          buffer: res?.buffer || 0
        };
      } catch {
        // Default to USD if context can't be loaded
        this.fxContext = { currency: 'usd', rate: 1, symbol: '$', buffer: 0 };
      }
      return this.fxContext;
    })();

    return this.fxContextPromise;
  }

  /** Synchronous access to the last-loaded context (USD default). */
  get context(): FxContext {
    return this.fxContext || { currency: 'usd', rate: 1, symbol: '$', buffer: 0 };
  }

  /**
   * Convert a USD anchor amount to the user's local currency for display only.
   * Returns an approximate value (the authoritative charge comes from quote()).
   */
  convertForDisplay(usdAmount: number): { amount: number; currency: string; formatted: string; isApprox: boolean } {
    const ctx = this.context;
    const amount = Math.round(usdAmount * (ctx.rate || 1) * 100) / 100;
    return {
      amount,
      currency: ctx.currency,
      formatted: this.formatMoney(amount, ctx.currency),
      isApprox: ctx.currency !== 'usd'
    };
  }

  /** Authoritative charge quote for a lesson (what the student will be billed). */
  async quote(params: { tutorId?: string; duration?: number; isTrialLesson?: boolean; usdAmount?: number }): Promise<PriceQuote> {
    const res = await firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/payments/price-quote`, params, {
        headers: this.userService.getAuthHeadersSync()
      })
    );
    return {
      usdAmount: res.usdAmount,
      currency: (res.currency || 'usd').toLowerCase(),
      amount: res.amount,
      fxRate: res.fxRate,
      symbol: res.symbol || this.symbolFor(res.currency)
    };
  }
}
