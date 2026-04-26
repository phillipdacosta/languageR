import { Component, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { AvailabilitySetupComponent } from '../../components/availability-setup/availability-setup.component';
import { UserService } from '../../services/user.service';
import { HasUnsavedChanges } from '../../guards/unsaved-changes.guard';

@Component({
  selector: 'app-availability-setup-page',
  templateUrl: './availability-setup.page.html',
  styleUrls: ['./availability-setup.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, AvailabilitySetupComponent]
})
export class AvailabilitySetupPage implements OnInit, OnDestroy, ViewWillEnter, HasUnsavedChanges {
  @ViewChild(AvailabilitySetupComponent) availabilityComponent?: AvailabilitySetupComponent;
  
  selectedDate: string | null = null;
  profileBlocked = false;
  private destroy$ = new Subject<void>();
  private isInitialized = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {}

  ngOnInit() {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.selectedDate = params['date'] || null;
      
      if (this.isInitialized && this.availabilityComponent) {
        this.availabilityComponent.forceRefreshAvailability();
      }
    });
    this.isInitialized = true;
    this.checkProfileRequirements();
  }

  ionViewWillEnter() {
    if (this.availabilityComponent) {
      this.availabilityComponent.forceRefreshAvailability();
    }
    this.checkProfileRequirements();
  }

  private checkProfileRequirements(): void {
    this.userService.getCurrentUser().pipe(take(1)).subscribe(user => {
      if (!user || user.userType !== 'tutor') return;

      const hasCustomPhoto = !!(user.picture && (
        user.picture.includes('storage.googleapis.com') ||
        (user.auth0Picture && user.picture !== user.auth0Picture)
      ));
      const hasVideo = !!(user.onboardingData?.introductionVideo || user.onboardingData?.pendingVideo);
      const creds = user.tutorCredentials;
      const govIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
      const certsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
      const hasPayoutSetup = user.stripeConnectOnboarded ||
        user.payoutProvider === 'paypal' || user.payoutProvider === 'manual';

      this.profileBlocked = !hasCustomPhoto || !hasVideo || !(govIdUploaded && certsUploaded) || !hasPayoutSetup;
    });
  }

  goToSetup(): void {
    this.router.navigate(['/tutor-approval']);
  }

  get hasUnsavedChanges(): boolean {
    return !!(this.availabilityComponent?.hasUnsavedChanges);
  }

  async saveAvailability(): Promise<void> {
    if (this.availabilityComponent) {
      await this.availabilityComponent.saveAvailability();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
