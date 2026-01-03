import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface WalletBalance {
  balance: number;
  reservedBalance: number;
  availableBalance: number;
  currency: string;
}

export interface WalletTransaction {
  type: 'top_up' | 'deduction' | 'refund' | 'reservation' | 'release';
  amount: number;
  balanceAfter: number;
  lessonId?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  description: string;
  createdAt: Date;
  metadata?: any;
}

export interface PaymentHistory {
  _id: string;
  amount: number;
  currency: string;
  paymentMethod: 'wallet' | 'card' | 'apple_pay' | 'google_pay';
  paymentType: 'lesson_booking' | 'office_hours' | 'wallet_top_up';
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded' | 'cancelled';
  lessonId?: any;
  createdAt: Date;
  chargedAt?: Date;
  metadata?: any;
}

export interface TopUpResponse {
  success: boolean;
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
}

export interface ConfirmTopUpResponse {
  success: boolean;
  message: string;
  balance: number;
  availableBalance: number;
}

@Injectable({
  providedIn: 'root'
})
export class WalletService {
  private apiUrl = environment.apiUrl;
  private balanceSubject = new BehaviorSubject<WalletBalance | null>(null);
  public balance$ = this.balanceSubject.asObservable();

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  private getAuthHeaders(): HttpHeaders {
    return this.userService.getAuthHeadersSync();
  }

  /**
   * Get current wallet balance
   */
  getBalance(): Observable<{ success: boolean; balance: number; reservedBalance: number; availableBalance: number; currency: string }> {
    return this.http.get<any>(`${this.apiUrl}/wallet/balance`, {
      headers: this.getAuthHeaders()
    }).pipe(
      tap(response => {
        if (response.success) {
          this.balanceSubject.next({
            balance: response.balance,
            reservedBalance: response.reservedBalance,
            availableBalance: response.availableBalance,
            currency: response.currency
          });
        }
      })
    );
  }

  /**
   * Get current balance value (synchronous)
   */
  getCurrentBalance(): WalletBalance | null {
    return this.balanceSubject.value;
  }

  /**
   * Initiate wallet top-up (creates Stripe PaymentIntent)
   */
  initiateTopUp(amount: number): Observable<TopUpResponse> {
    return this.http.post<TopUpResponse>(
      `${this.apiUrl}/wallet/top-up`,
      { amount },
      { headers: this.getAuthHeaders() }
    );
  }

  /**
   * Confirm top-up after Stripe payment succeeds
   */
  confirmTopUp(paymentIntentId: string): Observable<ConfirmTopUpResponse> {
    return this.http.post<ConfirmTopUpResponse>(
      `${this.apiUrl}/wallet/confirm-top-up`,
      { paymentIntentId },
      { headers: this.getAuthHeaders() }
    ).pipe(
      tap(response => {
        if (response.success) {
          // Refresh balance after successful top-up
          this.getBalance().subscribe();
        }
      })
    );
  }

  /**
   * Get transaction history (wallet transactions only)
   */
  getTransactions(limit: number = 50): Observable<{ success: boolean; transactions: WalletTransaction[] }> {
    return this.http.get<any>(`${this.apiUrl}/wallet/transactions?limit=${limit}`, {
      headers: this.getAuthHeaders()
    });
  }

  /**
   * Get full payment history (all payment methods: wallet, card, Apple Pay, Google Pay)
   */
  getPaymentHistory(limit: number = 50): Observable<{ success: boolean; payments: PaymentHistory[] }> {
    return this.http.get<any>(`${this.apiUrl}/payments/history?limit=${limit}`, {
      headers: this.getAuthHeaders()
    });
  }

  /**
   * Check if wallet has sufficient balance for a purchase
   */
  hasSufficientBalance(amount: number): boolean {
    const balance = this.balanceSubject.value;
    return balance ? balance.availableBalance >= amount : false;
  }

  /**
   * Format currency amount - always shows 2 decimal places
   */
  formatAmount(amount: number | string, currency: string = 'USD'): string {
    // Ensure amount is a number
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    // Handle invalid numbers
    if (isNaN(numAmount) || !isFinite(numAmount)) {
      return '$0.00';
    }
    
    // Use toFixed(2) to guarantee 2 decimal places, then add currency symbol
    // This ensures $7.5 becomes $7.50
    const formatted = numAmount.toFixed(2);
    
    // Add thousands separators if needed
    const parts = formatted.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    
    return '$' + parts.join('.');
  }
}

