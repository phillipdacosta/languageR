import { Component, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AvailabilitySetupComponent } from '../../components/availability-setup/availability-setup.component';
import { UserService } from '../../services/user.service';
import { buildTutorProfileChecklist } from '../../services/tutor-growth.service';
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
    private location: Location,
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

    this.userService.tutorApprovalStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => this.applyProfileBlockFromStatus(status));
  }

  ionViewWillEnter() {
    if (this.availabilityComponent) {
      this.availabilityComponent.forceRefreshAvailability();
    }
    this.userService.refreshTutorApprovalStatus();
  }

  /** Same checklist source as home, profile, and tutor-calendar. */
  private applyProfileBlockFromStatus(status: any): void {
    if (!status) {
      return;
    }

    const checklist = buildTutorProfileChecklist({
      hasCustomPhoto: status.photoComplete === true,
      hasVideo: status.videoComplete === true,
      videoApproved: status.videoApproved === true,
      identityRequired: status.identityRequired === true,
      governmentIdUploaded: status.governmentIdUploaded === true,
      identitySatisfied: status.identitySatisfied === true,
      certificationsUploaded: status.certificationsUploaded === true,
      certificationsApproved: status.certificationsApproved === true,
      hasPayoutSetup: status.stripeComplete === true,
      tosComplete: status.tosComplete === true,
    });

    const doneCount = checklist.filter(i => i.done && !i.pendingReview).length;
    this.profileBlocked = checklist.length > 0 && doneCount < checklist.length;
  }

  goBack(): void {
    if (window.history.length > 1) {
      this.location.back();
      return;
    }
    this.router.navigate(['/tabs/home']);
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
