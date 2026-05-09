import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';
import { ClientEntitlements } from './learning-plan.service';

export interface SubscriptionSummary {
  tier: 'free' | 'premium';
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  renewsAt: string | null;
  canceledAt: string | null;
  trialEndsAt: string | null;
  source: 'stripe' | 'apple_iap' | 'google_iap' | 'comp' | null;
}

export interface SubscriptionMeResponse {
  success: boolean;
  subscription: SubscriptionSummary;
  entitlements: ClientEntitlements;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly apiUrl = `${environment.apiUrl}/api/subscription`;

  constructor(private http: HttpClient, private userService: UserService) {}

  getMine(): Observable<SubscriptionMeResponse> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<SubscriptionMeResponse>(`${this.apiUrl}/me`, { headers });
      })
    );
  }

  /**
   * Start a Stripe Checkout flow for the premium plan.
   * Returns the URL the caller should redirect the browser to.
   */
  startCheckout(opts?: { successPath?: string; cancelPath?: string }): Observable<{ success: boolean; url: string }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; url: string }>(
          `${this.apiUrl}/checkout`,
          opts || {},
          { headers }
        );
      })
    );
  }

  /**
   * Open the Stripe Customer Portal so the user can manage / cancel.
   */
  openPortal(opts?: { returnPath?: string }): Observable<{ success: boolean; url: string }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; url: string }>(
          `${this.apiUrl}/portal`,
          opts || {},
          { headers }
        );
      })
    );
  }
}
