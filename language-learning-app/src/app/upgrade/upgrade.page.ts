import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router, ActivatedRoute } from '@angular/router';
import { take } from 'rxjs/operators';
import { SubscriptionService, SubscriptionSummary } from '../services/subscription.service';
import { UserService } from '../services/user.service';

/**
 * Premium upgrade / management page.
 *
 *   ?upgrade=success → success toast (after Stripe Checkout return)
 *   ?upgrade=cancelled → silent (user backed out)
 *
 * Monochrome by design — black, white, grey only. Single CTA.
 */
@Component({
  selector: 'app-upgrade',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './upgrade.page.html',
  styleUrls: ['./upgrade.page.scss']
})
export class UpgradePage implements OnInit {
  loading = true;
  busy = false;
  isPremium = false;
  summary: SubscriptionSummary | null = null;

  freePerks: string[] = [];
  premiumPerks: string[] = [];

  // Premium-with-AI-off banner state. Shown when the student is paying
  // for Premium but has the AI analysis switch off — we want them to
  // know they're not getting the personalization they're billed for.
  showAiOffBanner = false;
  aiTogglePending = false;

  constructor(
    private subscriptionService: SubscriptionService,
    private userService: UserService,
    private translate: TranslateService,
    private router: Router,
    private route: ActivatedRoute,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.freePerks = [
      this.translate.instant('UPGRADE.FREE_PERK_1'),
      this.translate.instant('UPGRADE.FREE_PERK_2'),
      this.translate.instant('UPGRADE.FREE_PERK_3'),
      this.translate.instant('UPGRADE.FREE_PERK_4')
    ];
    this.premiumPerks = [
      this.translate.instant('UPGRADE.PREMIUM_PERK_1'),
      this.translate.instant('UPGRADE.PREMIUM_PERK_2'),
      this.translate.instant('UPGRADE.PREMIUM_PERK_3'),
      this.translate.instant('UPGRADE.PREMIUM_PERK_4')
    ];

    this.loadSummary();

    const flag = this.route.snapshot.queryParamMap.get('upgrade');
    if (flag === 'success') {
      this.presentToast(this.translate.instant('UPGRADE.SUCCESS_TOAST'));
    }
  }

  private loadSummary() {
    this.loading = true;
    this.subscriptionService.getMine().pipe(take(1)).subscribe({
      next: (res) => {
        this.summary = res?.subscription || null;
        this.isPremium = this.summary?.tier === 'premium' && this.summary?.status !== 'canceled';
        this.loading = false;
        this.refreshAiOffBanner();
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  /** Show the AI-off banner only for premium users who currently have AI analysis disabled. */
  private refreshAiOffBanner() {
    if (!this.isPremium) {
      this.showAiOffBanner = false;
      return;
    }
    this.userService.getCurrentUser().pipe(take(1)).subscribe({
      next: (user: any) => {
        const aiEnabled = user?.profile?.aiAnalysisEnabled !== false;
        this.showAiOffBanner = !aiEnabled;
        this.cdr.detectChanges();
      },
      error: () => { /* fail soft — banner stays hidden */ }
    });
  }

  /** One-tap "turn AI back on" from the banner. */
  enableAiNow() {
    if (this.aiTogglePending) return;
    this.aiTogglePending = true;
    this.cdr.detectChanges();
    this.userService.updateAIAnalysisEnabled(true).pipe(take(1)).subscribe({
      next: () => {
        this.aiTogglePending = false;
        this.showAiOffBanner = false;
        this.presentToast(this.translate.instant('UPGRADE.AI_ON_TOAST'));
        this.cdr.detectChanges();
      },
      error: () => {
        this.aiTogglePending = false;
        this.presentToast(this.translate.instant('UPGRADE.AI_ON_FAILED'));
        this.cdr.detectChanges();
      }
    });
  }

  startCheckout() {
    if (this.busy) return;
    this.busy = true;

    this.subscriptionService.startCheckout({
      successPath: '/tabs/home/upgrade?upgrade=success',
      cancelPath: '/tabs/home/upgrade?upgrade=cancelled'
    }).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.url) {
          window.location.href = res.url;
        } else {
          this.busy = false;
          this.presentToast(this.translate.instant('UPGRADE.CHECKOUT_ERROR'));
        }
      },
      error: () => {
        this.busy = false;
        this.presentToast(this.translate.instant('UPGRADE.CHECKOUT_ERROR'));
      }
    });
  }

  openPortal() {
    if (this.busy) return;
    this.busy = true;

    this.subscriptionService.openPortal({
      returnPath: '/tabs/home/upgrade'
    }).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.url) {
          window.location.href = res.url;
        } else {
          this.busy = false;
          this.presentToast(this.translate.instant('UPGRADE.PORTAL_ERROR'));
        }
      },
      error: () => {
        this.busy = false;
        this.presentToast(this.translate.instant('UPGRADE.PORTAL_ERROR'));
      }
    });
  }

  goBack() {
    this.router.navigate(['/tabs/home']);
  }

  private async presentToast(message: string) {
    const t = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'bottom',
      cssClass: 'mono-toast'
    });
    await t.present();
  }
}
