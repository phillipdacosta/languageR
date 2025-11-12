import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { AvailabilitySetupComponent } from '../../components/availability-setup/availability-setup.component';

@Component({
  selector: 'app-availability-setup-page',
  templateUrl: './availability-setup.page.html',
  styleUrls: ['./availability-setup.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, AvailabilitySetupComponent]
})
export class AvailabilitySetupPage implements OnInit {
  @ViewChild(AvailabilitySetupComponent) availabilityComponent?: AvailabilitySetupComponent;
  
  selectedDate: string | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.selectedDate = params['date'] || null;
    });
  }

  // Ionic lifecycle hook - called when view has fully entered and is now the active view
  ionViewDidEnter() {
    // Give the component time to render the indicator, then scroll
    setTimeout(() => {
      if (this.availabilityComponent) {
        this.availabilityComponent.scrollToNowIndicator();
      }
    }, 125);
  }
}
