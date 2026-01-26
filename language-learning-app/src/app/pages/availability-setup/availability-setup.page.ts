import { Component, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AvailabilitySetupComponent } from '../../components/availability-setup/availability-setup.component';

@Component({
  selector: 'app-availability-setup-page',
  templateUrl: './availability-setup.page.html',
  styleUrls: ['./availability-setup.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, AvailabilitySetupComponent]
})
export class AvailabilitySetupPage implements OnInit, OnDestroy, ViewWillEnter {
  @ViewChild(AvailabilitySetupComponent) availabilityComponent?: AvailabilitySetupComponent;
  
  selectedDate: string | null = null;
  private destroy$ = new Subject<void>();
  private isInitialized = false;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    // Subscribe to route params with takeUntil for proper cleanup
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.selectedDate = params['date'] || null;
      console.log('📅 [AvailabilitySetupPage] Route params:', { selectedDate: this.selectedDate });
      
      // If component is already initialized and we get new params, refresh it
      if (this.isInitialized && this.availabilityComponent) {
        this.availabilityComponent.forceRefreshAvailability();
      }
    });
    this.isInitialized = true;
  }

  // Ionic lifecycle hook - called every time the view is about to enter
  ionViewWillEnter() {
    console.log('📅 [AvailabilitySetupPage] ionViewWillEnter');
    // Force refresh when returning to this page
    if (this.availabilityComponent) {
      this.availabilityComponent.forceRefreshAvailability();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
